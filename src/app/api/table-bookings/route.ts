import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import crypto from 'crypto';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { calculateBookingTotal } from '@/app/actions/table-booking-menu';
import { createPayPalOrder } from '@/lib/paypal';
import { sendSameDayBookingAlertIfNeeded, TableBookingNotificationRecord } from '@/lib/table-bookings/managerNotifications';

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Validation schema
const CreateBookingSchema = z.object({
  booking_type: z.enum(['regular', 'sunday_lunch']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  party_size: z.number().min(1).max(20),
  customer: z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email().optional(),
    mobile_number: z.string().min(10),
    sms_opt_in: z.boolean().default(true),
  }),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional().default([]),
  allergies: z.array(z.string()).optional().default([]),
  celebration_type: z.string().optional(),
  duration_minutes: z.number().optional().default(120),
  source: z.string().optional().default('website'),
  menu_selections: z.array(z.object({
    menu_item_id: z.string().optional(),
    custom_item_name: z.string().optional(),
    item_type: z.enum(['main', 'side']).optional(), // Made optional - server will enrich
    quantity: z.number().min(1),
    special_requests: z.string().optional(),
    guest_name: z.string().optional(),
    price_at_booking: z.number().optional(), // Made optional - server will fetch from DB
  })).optional(),
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      // Parse and validate request body
      const body = await req.json();
      const validatedData = CreateBookingSchema.parse(body);

      const supabase = createAdminClient();
      
      // Phase 1B: Idempotency protection
      const idempotencyKey = req.headers.get('Idempotency-Key');
      if (idempotencyKey) {
        // Generate request hash from key booking data
        const requestHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({
            date: validatedData.date,
            time: validatedData.time,
            party_size: validatedData.party_size,
            customer_phone: validatedData.customer.mobile_number,
            booking_type: validatedData.booking_type
          }))
          .digest('hex');
        
        // Check if we've seen this request before
        const { data: existingRequest } = await supabase
          .from('idempotency_keys')
          .select('response')
          .eq('key', idempotencyKey)
          .eq('request_hash', requestHash)
          .single();
        
        if (existingRequest) {
          // Return the cached response for this idempotent request
          console.log('Idempotent request detected, returning cached response');
          return NextResponse.json(existingRequest.response, { status: 201 });
        }
      }
      
      // Generate correlation ID for request tracing
      const correlationId = crypto.randomUUID();

      if (validatedData.booking_type === 'sunday_lunch') {
        const { data: sundayStatus } = await supabase
          .from('service_statuses')
          .select('is_enabled, message')
          .eq('service_code', 'sunday_lunch')
          .single();

        const { data: overrideRows } = await supabase
          .from('service_status_overrides')
          .select('is_enabled, message, start_date, end_date')
          .eq('service_code', 'sunday_lunch')
          .lte('start_date', validatedData.date)
          .gte('end_date', validatedData.date)
          .order('start_date', { ascending: false })
          .limit(1);

        const override = overrideRows && overrideRows.length > 0 ? overrideRows[0] : null;

        let sundayLunchEnabled = sundayStatus ? sundayStatus.is_enabled !== false : true;
        let sundayLunchMessage = sundayStatus?.message || null;

        if (override) {
          sundayLunchEnabled = override.is_enabled;
          sundayLunchMessage = override.message || sundayLunchMessage;
        }

        if (!sundayLunchEnabled) {
          return createErrorResponse(
            sundayLunchMessage || 'Sunday lunch bookings are currently unavailable.',
            'SERVICE_UNAVAILABLE',
            400
          );
        }
      }

      // Phase 2A: Use atomic capacity check for Sunday lunch
      if (validatedData.booking_type === 'sunday_lunch') {
        // Use the new atomic capacity check function
        const { data: capacityCheck, error: capacityError } = await supabase.rpc(
          'check_and_reserve_capacity',
          {
            p_service_date: validatedData.date,
            p_booking_time: validatedData.time,
            p_party_size: validatedData.party_size,
            p_booking_type: validatedData.booking_type,
            p_duration_minutes: validatedData.duration_minutes || 120
          }
        );
        
        if (capacityError || !capacityCheck?.[0]?.available) {
          return createErrorResponse(
            capacityCheck?.[0]?.message || 'No tables available for the selected time',
            'NO_AVAILABILITY',
            400
          );
        }
      } else {
        // Regular bookings use the existing check (for now)
        const availability = await checkAvailability(
          validatedData.date,
          validatedData.party_size,
          validatedData.booking_type,
          supabase // Pass admin client
        );

        if (!availability.data?.available) {
          return createErrorResponse(
            'No tables available for the selected time',
            'NO_AVAILABILITY',
            400
          );
        }
      }

      // Find or create customer
      const standardizedPhone = formatPhoneForStorage(validatedData.customer.mobile_number);
      const phoneVariants = generatePhoneVariants(standardizedPhone);
    
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('*')
        .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
        .single();
        
      let customer = existingCustomer;
      const providedEmail = validatedData.customer.email?.trim() ? validatedData.customer.email.trim().toLowerCase() : null;
      const providedLastName = validatedData.customer.last_name?.trim() || null;
      
      if (!customer) {
        const insertPayload = {
          first_name: validatedData.customer.first_name,
          last_name: providedLastName,
          email: providedEmail,
          mobile_number: standardizedPhone,
          sms_opt_in: validatedData.customer.sms_opt_in,
        };

        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert(insertPayload)
          .select()
          .single();
          
        if (customerError) {
          console.error('Customer creation error:', {
            message: customerError.message,
            code: customerError.code,
            details: customerError.details,
            hint: customerError.hint,
          });
          return createErrorResponse(
            'Failed to create customer record',
            'DATABASE_ERROR',
            500
          );
        }
        
        customer = newCustomer;
      } else if (customer && (providedEmail || providedLastName)) {
        const updates: Record<string, unknown> = {};
        if (providedEmail && providedEmail !== customer.email) {
          updates.email = providedEmail;
        }
        if (providedLastName && providedLastName !== customer.last_name) {
          updates.last_name = providedLastName;
        }
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('customers')
            .update(updates)
            .eq('id', customer.id);
          customer = { ...customer, ...updates };
        }
      }

      // Validate booking against policy
      const { data: policyCheck, error: policyError } = await supabase.rpc(
        'validate_booking_against_policy',
        {
          p_booking_type: validatedData.booking_type,
          p_booking_date: validatedData.date,
          p_booking_time: validatedData.time,
          p_party_size: validatedData.party_size,
        }
      );
      
      if (policyError || !policyCheck?.[0]?.is_valid) {
        return createErrorResponse(
          policyCheck?.[0]?.error_message || 'Booking does not meet policy requirements',
          'POLICY_VIOLATION',
          400
        );
      }

      // Create booking with correlation ID for tracing
      const { data: booking, error: bookingError } = await supabase
        .from('table_bookings')
        .insert({
          customer_id: customer.id,
          booking_date: validatedData.date,
          booking_time: validatedData.time,
          party_size: validatedData.party_size,
          booking_type: validatedData.booking_type,
          special_requirements: validatedData.special_requirements,
          dietary_requirements: validatedData.dietary_requirements,
          allergies: validatedData.allergies,
          celebration_type: validatedData.celebration_type,
          duration_minutes: validatedData.duration_minutes,
          source: validatedData.source,
          status: validatedData.booking_type === 'sunday_lunch' ? 'pending_payment' : 'confirmed',
          correlation_id: correlationId,
        })
        .select(`
          *,
          customer:customers(first_name, last_name, mobile_number, email)
        `)
        .single();
        
      if (bookingError) {
        console.error('Booking creation error:', {
          message: bookingError.message,
          code: bookingError.code,
          details: bookingError.details,
          hint: bookingError.hint,
          bookingData: {
            customer_id: customer.id,
            booking_date: validatedData.date,
            booking_time: validatedData.time,
            party_size: validatedData.party_size,
            booking_type: validatedData.booking_type,
          }
        });
        return createErrorResponse(
          'Failed to create booking',
          'DATABASE_ERROR',
          500
        );
      }
      
      // Log booking creation to audit trail
      await supabase.from('booking_audit').insert({
        booking_id: booking.id,
        event: 'booking_created',
        new_status: booking.status,
        meta: {
          correlation_id: correlationId,
          party_size: validatedData.party_size,
          booking_type: validatedData.booking_type,
          source: validatedData.source,
          customer_id: customer.id,
        }
      });

      // Add menu selections if Sunday lunch
      let totalAmount = 0;
      let depositAmount = 0;
      if (validatedData.booking_type === 'sunday_lunch' && validatedData.menu_selections) {
        // Phase 1A Fix: Server-side menu lookup to prevent null custom_item_name
        // Collect all menu_item_ids that need lookup
        const menuItemIds = validatedData.menu_selections
          .filter(s => s.menu_item_id && !s.custom_item_name)
          .map(s => s.menu_item_id);
        
        // Fetch menu items from database if needed
        let menuItemMap = new Map<string, any>();
        if (menuItemIds.length > 0) {
          const { data: menuItems, error: menuError } = await supabase
            .from('menu_dishes_with_costs')
            .select('dish_id, name, selling_price, category_code, is_active, is_default_side')
            .eq('menu_code', 'sunday_lunch')
            .in('dish_id', menuItemIds);
          
          if (menuError) {
            console.error('Failed to fetch menu items:', menuError);
            // Rollback booking
            await supabase.from('table_bookings').delete().eq('id', booking.id);
            return createErrorResponse(
              'Failed to validate menu selections',
              'INVALID_MENU_ITEMS',
              400
            );
          }
          
          menuItemMap = new Map((menuItems || []).map(item => [item.dish_id, item]));
        }
        
        // Phase 1C: Auto-add included sides for Sunday lunch
        // First, fetch ALL menu items including included sides
        const { data: allMenuItems } = await supabase
          .from('menu_dishes_with_costs')
          .select('dish_id, name, selling_price, category_code, is_active, is_default_side')
          .eq('menu_code', 'sunday_lunch')
          .eq('is_active', true);
        
        const includedSides = (allMenuItems || []).filter(item => 
          item.category_code === 'sunday_lunch_sides' && (item.is_default_side || Number(item.selling_price ?? 0) === 0)
        );
        
        // Enrich and validate menu selections
        const enrichedSelections = validatedData.menu_selections.map(selection => {
          // If menu_item_id provided, enrich from database
          if (selection.menu_item_id) {
            const dbItem = menuItemMap.get(selection.menu_item_id);
            
            if (!dbItem) {
              // Menu item not found or inactive
              throw new Error(`Invalid menu item: ${selection.menu_item_id}`);
            }
            
            if (!dbItem.is_active) {
              throw new Error(`Menu item unavailable: ${dbItem.name}`);
            }
            
            // Server-side data enrichment - never trust client for these
            return {
              booking_id: booking.id,
              menu_item_id: selection.menu_item_id,
              custom_item_name: dbItem.name, // Always populate from DB
              item_type: dbItem.category_code === 'sunday_lunch_mains' ? 'main' : 'side', // Enforce from DB
              quantity: selection.quantity || 1,
              special_requests: selection.special_requests || null,
              price_at_booking: Number(dbItem.selling_price ?? 0), // Always use DB price
              guest_name: selection.guest_name || null,
            };
          } else if (selection.custom_item_name) {
            // Custom/off-menu item - validate has required fields
            if (!selection.price_at_booking && selection.price_at_booking !== 0) {
              throw new Error('Custom items must have a price');
            }
            
            return {
              booking_id: booking.id,
              menu_item_id: null,
              custom_item_name: selection.custom_item_name,
              item_type: selection.item_type || 'main',
              quantity: selection.quantity || 1,
              special_requests: selection.special_requests || null,
              price_at_booking: selection.price_at_booking,
              guest_name: selection.guest_name || null,
            };
          } else {
            throw new Error('Each item must have either menu_item_id or custom_item_name');
          }
        });
        
        // Validate meal completeness - must have correct number of mains
        const mainCourses = enrichedSelections.filter(s => s.item_type === 'main');
        const totalMainQuantity = mainCourses.reduce((sum, item) => sum + item.quantity, 0);
        
        if (totalMainQuantity !== validatedData.party_size) {
          // Rollback booking
          await supabase.from('table_bookings').delete().eq('id', booking.id);
          return createErrorResponse(
            `Must select exactly ${validatedData.party_size} main course(s) for ${validatedData.party_size} guest(s). Currently have ${totalMainQuantity}.`,
            'INVALID_MEAL_SELECTION',
            400
          );
        }
        
        // Auto-add included sides for each main course
        const finalSelections = [...enrichedSelections];
        
        // For each main course, add the included sides
        mainCourses.forEach(mainCourse => {
          // Check if included sides already exist for this guest
          const guestName = mainCourse.guest_name || `Guest ${finalSelections.indexOf(mainCourse) + 1}`;
          const existingSidesForGuest = enrichedSelections.filter(s => 
            s.guest_name === guestName && s.item_type === 'side' && s.price_at_booking === 0
          );
          
          // If no included sides for this guest, add them
          if (existingSidesForGuest.length === 0 && includedSides.length > 0) {
            includedSides.forEach(side => {
              finalSelections.push({
                booking_id: booking.id,
                menu_item_id: side.dish_id,
                custom_item_name: side.name,
                item_type: 'side',
                quantity: mainCourse.quantity, // Same quantity as the main
                special_requests: null,
                price_at_booking: 0, // Included sides are free
                guest_name: guestName,
              });
            });
          }
        });
        
        // Insert enriched menu selections with auto-added sides
        const { error: itemsError } = await supabase
          .from('table_booking_items')
          .insert(finalSelections);
          
        if (itemsError) {
          console.error('Failed to insert menu items:', itemsError);
          // Rollback booking
          await supabase.from('table_bookings').delete().eq('id', booking.id);
          return createErrorResponse(
            'Failed to add menu selections',
            'DATABASE_ERROR',
            500
          );
        }
        
        // Calculate total amount from final selections (using DB prices)
        totalAmount = finalSelections.reduce(
          (sum, item) => sum + (item.price_at_booking * item.quantity), 
          0
        );
        
        // Calculate deposit: £5 per person
        depositAmount = validatedData.party_size * 5;
      }

      await sendSameDayBookingAlertIfNeeded(booking as TableBookingNotificationRecord);

      // Prepare response
      const response: any = {
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: booking.status,
      };

      if (validatedData.booking_type === 'regular') {
        response.confirmation_details = {
          date: booking.booking_date,
          time: booking.booking_time,
          party_size: booking.party_size,
          duration_minutes: booking.duration_minutes,
        };
      } else {
        // Sunday lunch requires payment - create PayPal order immediately
        const outstandingAmount = totalAmount - depositAmount;
        
        try {
          // Create PayPal order for deposit
          const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/return?booking_id=${booking.id}`;
          const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment?cancelled=true`;
          
          const bookingWithItems = {
            ...booking,
            table_booking_items: validatedData.menu_selections || []
          };
          
          const paypalOrder = await createPayPalOrder(
            bookingWithItems,
            returnUrl,
            cancelUrl,
            true // depositOnly
          );
          
          // Store payment record
          await supabase
            .from('table_booking_payments')
            .insert({
              booking_id: booking.id,
              amount: depositAmount,
              payment_method: 'paypal',
              status: 'pending',
              transaction_id: paypalOrder.orderId,
              payment_metadata: {
                paypal_order_id: paypalOrder.orderId,
                deposit_amount: depositAmount,
                total_amount: totalAmount,
                outstanding_amount: outstandingAmount,
                approve_url: paypalOrder.approveUrl,
              }
            });
          
          response.payment_required = true;
          response.payment_details = {
            amount: depositAmount, // Include 'amount' for backward compatibility
            deposit_amount: depositAmount,
            total_amount: totalAmount,
            outstanding_amount: outstandingAmount,
            currency: 'GBP',
            payment_url: paypalOrder.approveUrl, // Direct PayPal URL
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
          };
        } catch (paymentError) {
          console.error('Failed to create PayPal order:', paymentError);
          
          // Fall back to web-based payment flow if PayPal fails
          response.payment_required = true;
          response.payment_details = {
            amount: depositAmount,
            deposit_amount: depositAmount,
            total_amount: totalAmount,
            outstanding_amount: outstandingAmount,
            currency: 'GBP',
            payment_url: `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment`,
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            error: 'Payment system temporarily unavailable. Please use the payment link to complete your booking.'
          };
        }
      }

      // Queue confirmation SMS if regular booking
      if (booking.status === 'confirmed' && customer.sms_opt_in) {
        // Use the correct template key based on booking type
        const templateKey = validatedData.booking_type === 'sunday_lunch'
          ? 'booking_confirmation_sunday_lunch'
          : 'booking_confirmation_regular';
          
        await supabase.from('jobs').insert({
          type: 'send_sms',
          payload: {
            to: customer.mobile_number,
            template: templateKey,
            variables: {
              customer_name: customer.first_name,
              party_size: booking.party_size,
              date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              }),
              time: booking.booking_time,
              reference: booking.booking_reference,
              contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
            },
            booking_id: booking.id,
            customer_id: customer.id,
          },
          scheduled_for: new Date().toISOString(),
        });
      }

      // Store idempotency key if provided
      if (idempotencyKey) {
        const requestHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({
            date: validatedData.date,
            time: validatedData.time,
            party_size: validatedData.party_size,
            customer_phone: validatedData.customer.mobile_number,
            booking_type: validatedData.booking_type
          }))
          .digest('hex');
        
        await supabase.from('idempotency_keys').insert({
          key: idempotencyKey,
          request_hash: requestHash,
          response: response
        });
      }

      return createApiResponse(response, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return createErrorResponse(
          'Validation error',
          'VALIDATION_ERROR',
          400,
          error.errors
        );
      }
      
      console.error('Create booking API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
  }, ['write:table_bookings'], request);
}

// Search bookings (GET)
export async function GET(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      const supabase = createAdminClient();
      const searchParams = request.nextUrl.searchParams;
      
      // Build query
      let query = supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(
            id,
            first_name,
            last_name,
            mobile_number,
            email
          )
        `);

      // Apply filters
      const dateFrom = searchParams.get('date_from');
      const dateTo = searchParams.get('date_to');
      const status = searchParams.get('status');
      const bookingType = searchParams.get('booking_type');
      const search = searchParams.get('search');
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '50');

      if (dateFrom) {
        query = query.gte('booking_date', dateFrom);
      }
      if (dateTo) {
        query = query.lte('booking_date', dateTo);
      }
      if (status) {
        query = query.eq('status', status);
      }
      if (bookingType) {
        query = query.eq('booking_type', bookingType);
      }
      if (search) {
        query = query.or(`booking_reference.ilike.%${search}%`);
      }

      // Pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, error: queryError, count } = await query;

      if (queryError) {
        console.error('Query error:', queryError);
        return createErrorResponse(
          'Failed to fetch bookings',
          'DATABASE_ERROR',
          500
        );
      }

      return createApiResponse({
        bookings: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      console.error('Get bookings API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
}, ['read:table_bookings'], request);
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { z } from 'zod';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { calculateBookingTotal } from '@/app/actions/table-booking-menu';

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
    item_type: z.enum(['main', 'side']),
    quantity: z.number().min(1),
    special_requests: z.string().optional(),
    guest_name: z.string().optional(),
    price_at_booking: z.number(),
  })).optional(),
});

export async function POST(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      // Parse and validate request body
      const body = await req.json();
      const validatedData = CreateBookingSchema.parse(body);

      const supabase = createAdminClient();

      // Check availability
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

      // Find or create customer
      const standardizedPhone = formatPhoneForStorage(validatedData.customer.mobile_number);
      const phoneVariants = generatePhoneVariants(standardizedPhone);
    
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('*')
        .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
        .single();
        
      let customer = existingCustomer;
      
      if (!customer) {
        // Remove email from customer data since the column doesn't exist
        const { email, ...customerDataWithoutEmail } = validatedData.customer;
        
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            ...customerDataWithoutEmail,
            mobile_number: standardizedPhone,
          })
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

      // Create booking
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
        })
        .select()
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

      // Add menu selections if Sunday lunch
      let totalAmount = 0;
      let depositAmount = 0;
      if (validatedData.booking_type === 'sunday_lunch' && validatedData.menu_selections) {
        const { error: itemsError } = await supabase
          .from('table_booking_items')
          .insert(validatedData.menu_selections.map(item => ({
            booking_id: booking.id,
            ...item,
          })));
          
        if (itemsError) {
          // Rollback booking
          await supabase.from('table_bookings').delete().eq('id', booking.id);
          return createErrorResponse(
            'Failed to add menu selections',
            'DATABASE_ERROR',
            500
          );
        }
        
        // Calculate total amount from menu selections
        totalAmount = validatedData.menu_selections.reduce(
          (sum, item) => sum + (item.price_at_booking * item.quantity), 
          0
        );
        
        // Calculate deposit: £5 per person
        depositAmount = validatedData.party_size * 5;
      }

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
        // Sunday lunch requires payment (deposit only)
        const outstandingAmount = totalAmount - depositAmount;
        
        response.payment_required = true;
        response.payment_details = {
          deposit_amount: depositAmount,
          total_amount: totalAmount,
          outstanding_amount: outstandingAmount,
          currency: 'GBP',
          payment_url: `${process.env.NEXT_PUBLIC_APP_URL}/table-booking/${booking.booking_reference}/payment`,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        };
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
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyApiKey } from '@/lib/api-auth';
import { z } from 'zod';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { calculateBookingTotal } from '@/app/actions/table-booking-menu';
import { checkRateLimit, getClientIp, rateLimitConfigs } from '@/lib/rate-limiter';

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
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  menu_selections: z.array(z.object({
    menu_item_id: z.string().optional(),
    custom_item_name: z.string().optional(),
    item_type: z.enum(['main', 'side', 'extra']),
    quantity: z.number().min(1),
    special_requests: z.string().optional(),
    guest_name: z.string().optional(),
    price_at_booking: z.number(),
  })).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Verify API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const { valid, error } = await verifyApiKey(apiKey, 'write:table_bookings');
    if (!valid) {
      return NextResponse.json(
        { error: error || 'Invalid API key' },
        { status: 401 }
      );
    }

    // Check rate limit
    const clientIp = await getClientIp();
    const rateLimitResult = await checkRateLimit(clientIp, rateLimitConfigs.createBooking);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Too many booking requests. Please try again later.',
          retry_after: rateLimitResult.resetAt.toISOString()
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitConfigs.createBooking.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000).toString()
          }
        }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = CreateBookingSchema.parse(body);

    const supabase = await createClient();

    // Check availability
    const availability = await checkAvailability(
      validatedData.date,
      validatedData.party_size,
      validatedData.booking_type
    );

    if (!availability.data?.available) {
      return NextResponse.json(
        { error: 'No tables available for the selected time' },
        { status: 400 }
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
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          ...validatedData.customer,
          mobile_number: standardizedPhone,
        })
        .select()
        .single();
        
      if (customerError) {
        return NextResponse.json(
          { error: 'Failed to create customer record' },
          { status: 500 }
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
      return NextResponse.json(
        { error: policyCheck?.[0]?.error_message || 'Booking does not meet policy requirements' },
        { status: 400 }
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
        duration_minutes: 120,
        source: 'website',
        status: validatedData.booking_type === 'sunday_lunch' ? 'pending_payment' : 'confirmed',
      })
      .select()
      .single();
      
    if (bookingError) {
      console.error('Booking creation error:', bookingError);
      return NextResponse.json(
        { error: 'Failed to create booking' },
        { status: 500 }
      );
    }

    // Add menu selections if Sunday lunch
    let totalAmount = 0;
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
        return NextResponse.json(
          { error: 'Failed to add menu selections' },
          { status: 500 }
        );
      }
      
      totalAmount = validatedData.menu_selections.reduce(
        (sum, item) => sum + (item.price_at_booking * item.quantity), 
        0
      );
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
      // Sunday lunch requires payment
      response.payment_required = true;
      response.payment_details = {
        amount: totalAmount,
        currency: 'GBP',
        payment_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/create?booking_id=${booking.id}`,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
      };
    }

    // Queue confirmation SMS if regular booking
    if (booking.status === 'confirmed' && customer.sms_opt_in) {
      await supabase.from('jobs').insert({
        type: 'send_sms',
        payload: {
          to: customer.mobile_number,
          template: 'table_booking_confirmation',
          variables: {
            customer_name: customer.first_name,
            party_size: booking.party_size,
            date: new Date(booking.booking_date).toLocaleDateString('en-GB'),
            time: booking.booking_time,
            reference: booking.booking_reference,
          },
        },
        scheduled_for: new Date().toISOString(),
      });
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Create booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Search bookings (GET)
export async function GET(request: NextRequest) {
  try {
    // Verify API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const { valid, error } = await verifyApiKey(apiKey, 'read:table_bookings');
    if (!valid) {
      return NextResponse.json(
        { error: error || 'Invalid API key' },
        { status: 401 }
      );
    }

    const supabase = await createClient();
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
      return NextResponse.json(
        { error: 'Failed to fetch bookings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      bookings: data || [],
      pagination: {
        page,
        limit,
        total_badge: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Get bookings API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
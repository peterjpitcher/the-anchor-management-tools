import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveParkingRate } from '@/lib/parking/repository';
import { calculateParkingPricing } from '@/lib/parking/pricing';
import { checkParkingCapacity } from '@/lib/parking/capacity';
import { randomUUID } from 'crypto';

export type CreateParkingBookingInput = {
  customer_id: string;
  vehicle_registration: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_colour?: string;
  start_at: string;
  end_at: string;
  notes?: string;
  override_price?: number;
  override_reason?: string;
  capacity_override?: boolean;
  capacity_override_reason?: string;
  send_payment_link?: boolean;
};

export class ParkingService {
  static async createBooking(input: CreateParkingBookingInput) {
    const supabase = await createClient();
    const adminClient = createAdminClient();

    const startDate = new Date(input.start_at);
    const endDate = new Date(input.end_at);

    if (endDate <= startDate) {
      throw new Error('End time must be after start time');
    }

    // 1. Pricing
    const rateRecord = await getActiveParkingRate(adminClient);
    if (!rateRecord) {
      throw new Error('Parking rates have not been configured');
    }

    const pricing = calculateParkingPricing(startDate, endDate, {
      hourlyRate: Number(rateRecord.hourly_rate),
      dailyRate: Number(rateRecord.daily_rate),
      weeklyRate: Number(rateRecord.weekly_rate),
      monthlyRate: Number(rateRecord.monthly_rate),
    });
    const finalPrice = input.override_price ?? pricing.total;

    // 2. Capacity Check
    if (!input.capacity_override) {
      // Capacity check returns remaining/capacity counts; block when none left.
      const capacity = await checkParkingCapacity(input.start_at, input.end_at);
      if (capacity.remaining <= 0) {
        throw new Error('No parking spaces available for the selected time range');
      }
    }

    // 3. Prepare Transaction Data
    const bookingData = {
      customer_id: input.customer_id,
      vehicle_registration: input.vehicle_registration.replace(/\s+/g, '').toUpperCase(),
      vehicle_make: input.vehicle_make,
      vehicle_model: input.vehicle_model,
      vehicle_colour: input.vehicle_colour,
      start_at: input.start_at,
      end_at: input.end_at,
      status: 'pending_payment', // Initial status
      total_price: finalPrice,
      notes: input.notes,
      override_price: input.override_price,
      override_reason: input.override_reason,
      capacity_override: input.capacity_override,
      capacity_override_reason: input.capacity_override_reason
    };

    let paymentOrderData = null;
    if (input.send_payment_link && finalPrice > 0) {
      // Expire in 24 hours or at start time, whichever is sooner
      const expiresIn24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const expiresAt = startDate < expiresIn24h ? startDate : expiresIn24h;
      
      paymentOrderData = {
        amount: finalPrice,
        status: 'pending',
        order_reference: `PKG-${randomUUID().substring(0, 8).toUpperCase()}`,
        expires_at: expiresAt.toISOString()
      };
    } else {
      // If no payment link or free, mark as confirmed immediately?
      // Actually, if price is 0, status should probably be 'confirmed'.
      if (finalPrice === 0) {
        bookingData.status = 'confirmed';
      }
    }

    // 4. Atomic Transaction
    const { data: booking, error } = await supabase.rpc('create_parking_booking_transaction', {
      p_booking_data: bookingData,
      p_payment_order_data: paymentOrderData
    });

    if (error) {
      console.error('Create parking booking transaction error:', error);
      throw new Error('Failed to create parking booking');
    }

    return booking;
  }
}

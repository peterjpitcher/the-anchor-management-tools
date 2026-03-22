import { NextResponse } from 'next/server';
import { PrivateBookingService } from '@/services/private-bookings';

/**
 * Public endpoint to fetch configuration for the private booking calculator.
 * Returns active venue spaces, catering packages, and vendors.
 *
 * IMPORTANT: Only public-safe fields are returned. Internal fields such as
 * supplier contacts, finance data, tax identifiers, and invoice contacts
 * are stripped before the response is sent.
 */
export async function GET() {
  try {
    const [spaces, packages, vendors] = await Promise.all([
      PrivateBookingService.getVenueSpaces(true, true),
      PrivateBookingService.getCateringPackages(true, true),
      PrivateBookingService.getVendors(undefined, true, true)
    ]);

    // Filter to public-safe fields only
    const safeSpaces = (spaces || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      capacity_seated: s.capacity_seated,
      capacity_standing: s.capacity_standing,
      rate_per_hour: s.rate_per_hour,
      setup_fee: s.setup_fee,
      minimum_hours: s.minimum_hours,
    }));

    const safePackages = (packages || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      cost_per_head: p.cost_per_head,
      minimum_guests: p.minimum_guests,
      maximum_guests: p.maximum_guests,
      includes: p.includes,
      dietary_notes: p.dietary_notes,
      guest_description: p.guest_description,
      good_to_know: p.good_to_know,
      served: p.served,
      serving_style: p.serving_style,
      summary: p.summary,
      pricing_model: p.pricing_model,
    }));

    const safeVendors = (vendors || []).map((v: Record<string, unknown>) => ({
      id: v.id,
      name: v.name,
      service_type: v.service_type,
      typical_rate: v.typical_rate,
      preferred: v.preferred,
      website: v.website,
    }));

    return NextResponse.json({
      success: true,
      data: {
        spaces: safeSpaces,
        packages: safePackages,
        vendors: safeVendors,
      }
    });
  } catch (error) {
    console.error('Error fetching private booking config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

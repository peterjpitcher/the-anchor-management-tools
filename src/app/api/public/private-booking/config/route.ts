import { NextResponse } from 'next/server';
import { PrivateBookingService } from '@/services/private-bookings';

/**
 * Public endpoint to fetch configuration for the private booking calculator.
 * Returns active venue spaces, catering packages, and vendors.
 */
export async function GET() {
  try {
    const [spaces, packages, vendors] = await Promise.all([
      PrivateBookingService.getVenueSpaces(true),
      PrivateBookingService.getCateringPackages(true),
      PrivateBookingService.getVendors(undefined, true)
    ]);

    return NextResponse.json({
      success: true,
      data: {
        spaces,
        packages,
        vendors
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

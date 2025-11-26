import { NextRequest, NextResponse } from 'next/server';

import { withApiAuth } from '@/lib/api/auth';
import { PrivateBookingService } from '@/services/private-bookings';

export const dynamic = 'force-dynamic';

interface ExternalBookingPayload {
  name?: string;
  email?: string;
  phone?: string;
  partySize?: string | number;
  preferredDate?: string;
  preferredTime?: string;
  notes?: string;
  extras?: string[];
  perks?: string[];
}

export async function POST(request: NextRequest) {
  return withApiAuth(async (req) => {
    try {
      const body = (await req.json()) as ExternalBookingPayload;

      const nameParts = (body.name ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const firstName = nameParts[0] ?? 'Unknown';
      const lastName =
        nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

      const noteSections: string[] = [];
      if (body.notes?.trim()) {
        noteSections.push(body.notes.trim());
      }
      if (body.extras?.length) {
        noteSections.push(`Requested Extras: ${body.extras.join(', ')}`);
      }
      if (body.perks?.length) {
        noteSections.push(`Offers Claimed: ${body.perks.join(', ')}`);
      }
      noteSections.push('[Created via Website Christmas Form]');

      const guestCount = body.partySize ? Number(body.partySize) : undefined;

      const input = {
        customer_first_name: firstName,
        customer_last_name: lastName,
        contact_email: body.email,
        contact_phone: body.phone,
        event_date: body.preferredDate,
        start_time: body.preferredTime,
        guest_count: Number.isFinite(guestCount) ? guestCount : undefined,
        event_type: 'Christmas Party',
        source: 'website',
        status: 'draft',
        internal_notes: noteSections.join('\n\n'),
        date_tbd: false,
      };

      const booking = await PrivateBookingService.createBooking(input);

      return NextResponse.json({ success: true, id: booking.id });
    } catch (error) {
      console.error('External booking creation failed:', error);
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }, ['create:bookings'], request);
}

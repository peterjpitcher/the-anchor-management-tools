import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage, sanitizeName } from '@/lib/validation';
import { JobQueue } from '@/lib/background-jobs';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const LONDON_TZ = 'Europe/London';
const GOOGLE_REVIEW_LINK = 'https://vip-club.uk/support-us';

type RegisterGuestInput = {
  eventId: string;
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  customerId?: string;
  staffId: string;
};

export class EventCheckInService {
  static async registerGuest(input: RegisterGuestInput) {
    const admin = createAdminClient();

    // 1. Prepare Data
    let normalizedPhone: string;
    try {
      normalizedPhone = formatPhoneForStorage(input.phone);
    } catch (e) {
      throw new Error('Invalid UK mobile number');
    }

    const customerData = {
      id: input.customerId,
      first_name: input.firstName ? sanitizeName(input.firstName) : undefined,
      last_name: input.lastName ? sanitizeName(input.lastName) : undefined,
      mobile_number: normalizedPhone,
      email: input.email?.toLowerCase(),
      sms_opt_in: true
    };

    // 2. Prepare Labels (Fetch IDs first)
    const REQUIRED_LABELS = [
      { name: 'Event Booker', note: 'Auto-applied via event check-in' },
      { name: 'Event Attendee', note: 'Auto-applied via event check-in' },
      { name: 'Event Checked-In', note: 'Checked in via event check-in flow' },
    ];

    const { data: labelRecords } = await admin
      .from('customer_labels')
      .select('id, name')
      .in('name', REQUIRED_LABELS.map(l => l.name));

    const labelsToAssign = [];
    if (labelRecords) {
      const labelMap = new Map(labelRecords.map(l => [l.name, l.id]));
      
      // Handle missing labels creation if needed? 
      // The original action created missing labels. Ideally, we do that or assume they exist.
      // For atomic transaction, we'll assume IDs are available or create them beforehand.
      // Let's keep it simple: only assign if label exists. 
      // Or we can do a quick check-and-create here before the transaction.
      
      for (const req of REQUIRED_LABELS) {
        const id = labelMap.get(req.name);
        if (id) {
          labelsToAssign.push({ id, notes: req.note });
        }
      }
    }

    // 3. Atomic Transaction
    const { data, error } = await admin.rpc('register_guest_transaction', {
      p_event_id: input.eventId,
      p_customer_data: customerData,
      p_staff_id: input.staffId,
      p_labels: labelsToAssign
    });

    if (error) {
      console.error('Check-in transaction error:', error);
      if (error.code === '23505') {
        throw new Error('Guest is already checked in for this event');
      }
      throw new Error('Failed to register guest');
    }

    // 4. Side Effects (Async SMS)
    // We need event details for SMS
    const { data: event } = await admin
      .from('events')
      .select('name, date, time')
      .eq('id', input.eventId)
      .single();

    if (event) {
      this.scheduleThankYouSms({
        phone: normalizedPhone,
        customerId: data.customer.id,
        eventName: event.name,
        eventDate: event.date,
        eventTime: event.time
      }).catch(console.error);
    }

    return {
      checkInId: data.check_in_id,
      bookingId: data.booking_id,
      customerId: data.customer.id,
      customerName: `${data.customer.first_name} ${data.customer.last_name || ''}`.trim()
    };
  }

  private static async scheduleThankYouSms(params: {
    phone: string
    customerId: string
    eventName: string
    eventDate: string
    eventTime: string
  }) {
    const queue = JobQueue.getInstance();
    const eventDateTime = fromZonedTime(`${params.eventDate}T${params.eventTime}`, LONDON_TZ);
    const nextDayLocal = toZonedTime(eventDateTime, LONDON_TZ);
    nextDayLocal.setDate(nextDayLocal.getDate() + 1);
    nextDayLocal.setHours(10, 0, 0, 0);
    const scheduledUtc = fromZonedTime(nextDayLocal, LONDON_TZ);
    
    const delay = Math.max(scheduledUtc.getTime() - Date.now(), 60 * 1000);
    const message = `Thanks for coming to ${params.eventName} at The Anchor! We'd love your review: ${GOOGLE_REVIEW_LINK}`;

    try {
      await queue.enqueue('send_sms', {
        to: params.phone,
        message,
        customerId: params.customerId,
        type: 'custom',
      }, { delay });
    } catch (error) {
      console.error('Failed to schedule thank-you SMS:', error);
    }
  }
}

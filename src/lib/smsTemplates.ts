import { createAdminClient } from '@/lib/supabase/admin';
import { ensureReplyInstruction } from './sms/support';
import { cache } from './cache';
import { formatDateInLondon } from '@/lib/dateUtils';

export async function getSMSTemplates() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getSMSTemplate(key: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .eq('template_type', key)
    .single();
  return data;
}

export async function createSMSTemplate(template: any) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('message_templates')
    .insert(template)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const smsTemplates = {
  bookingConfirmation: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: string | Date
    eventTime: string
    qrCodeUrl?: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    const baseMessage = `Hi ${params.firstName}, your booking for ${params.seats} people for our ${params.eventName} on ${formattedDate} at ${params.eventTime} is confirmed!`
    const qrMessage = params.qrCodeUrl ? ` Check-in with QR: ${params.qrCodeUrl}` : ''
    return `${baseMessage}${qrMessage} Save this message as your confirmation. The Anchor`
  },

  bookingConfirmationNew: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const seatCopy = params.seats > 1
      ? `${params.seats} tickets are reserved for you`
      : 'your ticket is reserved for you'
    return `Hi ${params.firstName}, you're all set for ${params.eventName} on ${formattedDate} at ${params.eventTime} — ${seatCopy}. The Anchor`
  },

  bookedOneMonth: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, one month to go until ${params.eventName} on ${formattedDate}. We can't wait to host you. The Anchor`
  },

  bookedOneWeek: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const seatsLine = params.seats > 1
      ? `${params.seats} tickets are waiting for you`
      : 'your ticket is waiting for you'
    return `Hi ${params.firstName}, we're a week out from ${params.eventName} on ${formattedDate} at ${params.eventTime} — ${seatsLine}. The Anchor`
  },

  bookedOneDay: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats: number
  }) => {
    const seatsLine = params.seats > 1
      ? `${params.seats} tickets are ready`
      : 'your ticket is ready'
    return `Hi ${params.firstName}, tomorrow's the night! ${params.eventName} starts at ${params.eventTime} and ${seatsLine}. The Anchor`
  },

  reminderInviteOneMonth: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, we'd love to see you at ${params.eventName} on ${formattedDate}. Want us to save you tickets? Reply with how many. The Anchor`
  },

  reminderInviteOneWeek: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, ${params.eventName} is next week on ${formattedDate} at ${params.eventTime}. Fancy joining us? Reply with tickets and we'll look after the rest. The Anchor`
  },

  reminderInviteOneDay: (params: {
    firstName: string
    eventName: string
    eventTime: string
  }) => {
    return `Hi ${params.firstName}, ${params.eventName} is TOMORROW at ${params.eventTime}. Last chance to grab tickets — reply with how many you'd like and we'll keep them aside. The Anchor`
  },

  reminderOnly: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, don't forget, we've got our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Let us know if you want to book tickets. The Anchor`
  },

  noSeats2Weeks: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, we'd love to see you at our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Reply with the number of tickets you'd like to book. The Anchor`
  },

  noSeats1Week: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, just 1 week until our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Still time to book your tickets - just reply with how many you need. The Anchor`
  },

  noSeatsDayBefore: (params: {
    firstName: string
    eventName: string
    eventTime: string
  }) => {
    return `Hi ${params.firstName}, our ${params.eventName} is TOMORROW at ${params.eventTime}! Last chance to book - reply NOW with number of tickets needed or just turn up. The Anchor`
  },

  hasSeats1Week: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    return `Hi ${params.firstName}, see you next week! You have ${params.seats} tickets booked for our ${params.eventName} on ${formattedDate} at ${params.eventTime}. Want to bring more friends? Reply to add extra tickets. The Anchor`
  },

  hasSeatsDayBefore: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats: number
  }) => {
    return `Hi ${params.firstName}, see you TOMORROW! You have ${params.seats} tickets for our ${params.eventName} at ${params.eventTime}. Need to change numbers? Reply to this message. The Anchor`
  },

  dayBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats?: number
  }) => {
    const seatInfo = params.seats
      ? `and you have ${params.seats} tickets booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is tomorrow at ${params.eventTime} ${seatInfo}. See you tomorrow! The Anchor`
  },

  weekBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventDate: string | Date
    eventTime: string
    seats?: number
  }) => {
    const formattedDate = formatDateInLondon(params.eventDate, {
      month: 'long',
      day: 'numeric'
    })
    const seatInfo = params.seats
      ? `and you have ${params.seats} tickets booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is next week on ${formattedDate} at ${params.eventTime} ${seatInfo}. See you here! The Anchor`
  },
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  });
  return result;
}

const TEMPLATE_TYPE_MAP: Record<string, string> = {
  bookingConfirmation: 'booking_confirmation',
  bookingConfirmationNew: 'booking_confirmation',
  weekBeforeReminder: 'reminder_7_day', 
  dayBeforeReminder: 'reminder_24_hour',
  reminderOnly: 'booking_reminder_confirmation',
  noSeats2Weeks: 'no_seats_2_weeks',
  noSeats1Week: 'no_seats_1_week',
  noSeatsDayBefore: 'no_seats_day_before',
  hasSeats1Week: 'has_seats_1_week',
  hasSeatsDayBefore: 'has_seats_day_before',
  bookedOneMonth: 'booked_1_month',
  bookedOneWeek: 'booked_1_week',
  bookedOneDay: 'booked_1_day',
  reminderInviteOneMonth: 'reminder_invite_1_month',
  reminderInviteOneWeek: 'reminder_invite_1_week',
  reminderInviteOneDay: 'reminder_invite_1_day',
  booking_reminder_24_hour: 'booking_reminder_24_hour',
  booking_reminder_7_day: 'booking_reminder_7_day'
};

export async function getMessageTemplatesBatch(
  requests: Array<{ eventId: string; templateType: string }>
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  try {
    const supabase = createAdminClient();

    const uniqueEventIds = Array.from(new Set(requests.map(r => r.eventId)));
    const uniqueTemplateTypes = Array.from(new Set(requests.map(r => TEMPLATE_TYPE_MAP[r.templateType] || r.templateType)));

    const { data: eventTemplates, error: eventError } = await supabase
      .from('event_message_templates')
      .select('event_id, template_type, content')
      .in('event_id', uniqueEventIds)
      .in('template_type', uniqueTemplateTypes)
      .eq('is_active', true);

    if (eventError) {
      console.error('Error fetching event templates batch:', eventError);
    }

    const { data: globalTemplates, error: globalError } = await supabase
      .from('message_templates')
      .select('template_type, content')
      .in('template_type', uniqueTemplateTypes)
      .eq('is_default', true)
      .eq('is_active', true);

    for (const request of requests) {
      const mappedType = TEMPLATE_TYPE_MAP[request.templateType] || request.templateType;
      const key = `${request.eventId}-${request.templateType}`;
      
      const eventTemplate = eventTemplates?.find(
        t => t.event_id === request.eventId && t.template_type === mappedType
      );
      
      if (eventTemplate?.content) {
        results.set(key, eventTemplate.content);
      } else {
        const globalTemplate = globalTemplates?.find(
          t => t.template_type === mappedType
        );
        if (globalTemplate?.content) {
          results.set(key, globalTemplate.content);
        } else {
          results.set(key, null);
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Error in getMessageTemplatesBatch:', error);
    return results;
  }
}

export async function getMessageTemplate(
  eventId: string | undefined,
  templateType: string,
  variables: Record<string, string>,
  bypassCache: boolean = false
): Promise<string | null> {
  try {
    if (!eventId) {
      return getGlobalMessageTemplate(templateType, variables);
    }
    
    const cacheKey = cache.buildKey('TEMPLATE', eventId, templateType);
    const cacheDisabled = process.env.DISABLE_TEMPLATE_CACHE === 'true';
    
    if (!bypassCache && !cacheDisabled) {
      const cached = await cache.get<string>(cacheKey);
      if (cached !== null) {
        const rendered = renderTemplate(cached, variables);
        return rendered;
      }
    }
    
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[getMessageTemplate] Missing Supabase environment variables');
      return null;
    }
    
    const supabase = createAdminClient();
    const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;

    const { data, error } = await supabase
      .rpc('get_message_template', {
        p_event_id: eventId,
        p_template_type: mappedType
      })
      .single<{ content: string; variables: string[]; send_timing: string; custom_timing_hours: number | null }>();
      
    if (error || !data?.content) {
      return getGlobalMessageTemplate(templateType, variables);
    }
    
    if (!cacheDisabled) {
      await cache.set(cacheKey, data.content, 'LONG');
    }
    
    const rendered = renderTemplate(data.content, variables);
    return rendered;
  } catch (error) {
    console.error('Error in getMessageTemplate:', error);
    return null;
  }
}

async function getGlobalMessageTemplate(
  templateType: string,
  variables: Record<string, string>
): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;
    
    const { data, error } = await supabase
      .from('message_templates')
      .select('content')
      .eq('template_type', mappedType)
      .eq('is_default', true)
      .eq('is_active', true)
      .single();
    
    if (error || !data?.content) {
      return null;
    }
    
    const rendered = renderTemplate(data.content, variables);
    return rendered;
  } catch (error) {
    console.error('Error in getGlobalMessageTemplate:', error);
    return null;
  }
}
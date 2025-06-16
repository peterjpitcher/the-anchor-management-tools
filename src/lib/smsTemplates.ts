import { createClient } from '@supabase/supabase-js';

// Get Supabase admin client
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

// Legacy templates for fallback
export const smsTemplates = {
  bookingConfirmation: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: Date
    eventTime: string
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    return `Hi ${params.firstName}, your booking for ${params.seats} people for our ${params.eventName} on ${formattedDate} at ${params.eventTime} is confirmed! See you then. The Anchor 01753682707`
  },

  reminderOnly: (params: {
    firstName: string
    eventName: string
    eventDate: Date
    eventTime: string
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    return `Hi ${params.firstName}, don't forget, we've got our ${params.eventName} on ${formattedDate} at ${params.eventTime}! Let us know if you want to book seats. The Anchor 01753682707`
  },

  dayBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats?: number
  }) => {
    const seatInfo = params.seats
      ? `and you have ${params.seats} seats booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is tomorrow at ${params.eventTime} ${seatInfo}. See you tomorrow! The Anchor 01753682707`
  },

  weekBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventDate: Date
    eventTime: string
    seats?: number
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    const seatInfo = params.seats
      ? `and you have ${params.seats} seats booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is next week on ${formattedDate} at ${params.eventTime} ${seatInfo}. See you here! The Anchor 01753682707`
  },
}

// Render a template with variables
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  });
  
  return result;
}

// Map legacy template names to new template types
const TEMPLATE_TYPE_MAP: Record<string, string> = {
  bookingConfirmation: 'booking_confirmation',
  weekBeforeReminder: 'reminder_7_day', 
  dayBeforeReminder: 'reminder_24_hour',
  reminderOnly: 'custom'
};

// Get template from database or fallback to legacy
export async function getMessageTemplate(
  eventId: string,
  templateType: string,
  variables: Record<string, string>
): Promise<string | null> {
  try {
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      console.error('Failed to get Supabase client for templates');
      return null;
    }

    // Map legacy template type to new type
    const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;

    // Try to get template from database
    const { data, error } = await supabase
      .rpc('get_message_template', {
        p_event_id: eventId,
        p_template_type: mappedType
      })
      .single();

    if (error) {
      console.error('Error fetching template:', error);
      return null;
    }

    // Type guard to ensure data has content property
    if (data && typeof data === 'object' && 'content' in data) {
      const templateData = data as { content: string | null };
      if (templateData.content) {
        // Render the template with variables
        return renderTemplate(templateData.content, variables);
      }
    }

    return null;
  } catch (error) {
    console.error('Error in getMessageTemplate:', error);
    return null;
  }
}
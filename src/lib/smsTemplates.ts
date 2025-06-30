import { getSupabaseAdminClient } from '@/lib/supabase-singleton';
import { cache } from './cache';

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
  reminderOnly: 'booking_reminder_confirmation',
  // Direct mappings for new template types
  booking_reminder_24_hour: 'booking_reminder_24_hour',
  booking_reminder_7_day: 'booking_reminder_7_day'
};

// Get template from database or fallback to legacy
/**
 * Get multiple message templates in a single batch query
 */
export async function getMessageTemplatesBatch(
  requests: Array<{ eventId: string; templateType: string }>
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  try {
    const supabase = getSupabaseAdminClient();

    // Get all unique event IDs and template types
    const uniqueEventIds = Array.from(new Set(requests.map(r => r.eventId)));
    const uniqueTemplateTypes = Array.from(new Set(requests.map(r => TEMPLATE_TYPE_MAP[r.templateType] || r.templateType)));

    // Fetch event-specific templates
    const { data: eventTemplates, error: eventError } = await supabase
      .from('event_message_templates')
      .select('event_id, template_type, content')
      .in('event_id', uniqueEventIds)
      .in('template_type', uniqueTemplateTypes)
      .eq('is_active', true);

    if (eventError) {
      console.error('Error fetching event templates batch:', eventError);
    }

    // Also fetch global templates
    const { data: globalTemplates, error: globalError } = await supabase
      .from('message_templates')
      .select('template_type, content')
      .in('template_type', uniqueTemplateTypes)
      .eq('is_default', true)
      .eq('is_active', true);

    // Build the results map
    for (const request of requests) {
      const mappedType = TEMPLATE_TYPE_MAP[request.templateType] || request.templateType;
      const key = `${request.eventId}-${request.templateType}`;
      
      // First try event-specific template
      const eventTemplate = eventTemplates?.find(
        t => t.event_id === request.eventId && t.template_type === mappedType
      );
      
      if (eventTemplate?.content) {
        results.set(key, eventTemplate.content);
      } else {
        // Fall back to global template
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
  eventId: string,
  templateType: string,
  variables: Record<string, string>
): Promise<string | null> {
  try {
    // Build cache key
    const cacheKey = cache.buildKey('TEMPLATE', eventId, templateType);
    
    // Try to get template content from cache
    const cachedTemplate = await cache.getOrSet(
      cacheKey,
      async () => {
        const supabase = getSupabaseAdminClient();

        // Map legacy template type to new type
        const mappedType = TEMPLATE_TYPE_MAP[templateType] || templateType;

        // Try to get template from database
        const { data, error } = await supabase
          .rpc('get_message_template', {
            p_event_id: eventId,
            p_template_type: mappedType
          })
          .single<{ content: string; variables: string[]; send_timing: string; custom_timing_hours: number | null }>();
          
        if (error || !data?.content) {
          return null;
        }
        
        return data.content;
      },
      'LONG' // Cache templates for 1 hour
    );

    if (!cachedTemplate) {
      return null;
    }

    // Render the template with variables
    return renderTemplate(cachedTemplate, variables);
  } catch (error) {
    console.error('Error in getMessageTemplate:', error);
    return null;
  }
}
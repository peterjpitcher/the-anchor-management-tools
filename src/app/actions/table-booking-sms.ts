'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { formatDateWithTimeForSms } from '@/lib/dateUtils';

// Helper function to format time from 24hr to 12hr format
function formatTime12Hour(time24: string): string {
  // Remove seconds if present
  const timeWithoutSeconds = time24.split(':').slice(0, 2).join(':');
  const [hours, minutes] = timeWithoutSeconds.split(':').map(Number);
  
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  
  // Format with or without minutes
  if (minutes === 0) {
    return `${hours12}${period}`;
  } else {
    return `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
  }
}

// Validation schema
const SMSTemplateSchema = z.object({
  template_key: z.string().min(1, 'Template key is required'),
  booking_type: z.enum(['regular', 'sunday_lunch']).nullable(),
  template_text: z.string().min(1, 'Template text is required').max(500),
  variables: z.array(z.string()).optional(),
  is_active: z.boolean().default(true),
});

// Get all SMS templates
export async function getSMSTemplates() {
  try {
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to view SMS templates' };
    }

    const supabase = createAdminClient();
    
    const { data, error } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .order('template_key');
      
    if (error) {
      console.error('Fetch templates error:', error);
      return { error: 'Failed to fetch SMS templates' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get templates error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Update SMS template
export async function updateSMSTemplate(
  templateId: string,
  formData: FormData
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage SMS templates' };
    }
    
    // Extract variables from template text
    const templateText = formData.get('template_text') as string;
    const variableMatches = templateText.match(/\{\{(\w+)\}\}/g) || [];
    const variables = variableMatches.map(match => match.replace(/[{}]/g, ''));
    
    // Validate data
    const validatedData = SMSTemplateSchema.parse({
      template_key: formData.get('template_key'),
      booking_type: formData.get('booking_type') || null,
      template_text: templateText,
      variables,
      is_active: formData.get('is_active') === 'true',
    });
    
    // Update template
    const { data, error } = await supabase
      .from('table_booking_sms_templates')
      .update(validatedData)
      .eq('id', templateId)
      .select()
      .single();
      
    if (error) {
      console.error('Template update error:', error);
      return { error: 'Failed to update SMS template' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'sms_template',
      resource_id: templateId,
      operation_status: 'success',
      additional_info: { 
        template_key: data.template_key,
        character_badge: templateText.length,
      }
    });
    
    revalidatePath('/table-bookings/settings/sms-templates');
    
    return { success: true, data };
  } catch (error) {
    console.error('Update template error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Test SMS template
export async function testSMSTemplate(
  templateId: string,
  testPhone: string
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to test SMS templates' };
    }
    
    // Get template
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('id', templateId)
      .single();
      
    if (!template) {
      return { error: 'Template not found' };
    }
    
    // Replace variables with sample data
    const sampleData: Record<string, string> = {
      customer_name: 'John Smith',
      party_size: '4',
      date: 'Sunday, March 10',
      time: '1pm',
      reference: 'TB-2024-TEST',
      roast_summary: '2x Roast Beef, 1x Chicken, 1x Vegetarian',
      allergies: 'Nuts, Gluten',
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '',
      refund_message: 'Full refund will be processed.',
      review_link: 'https://g.page/r/example',
      deposit_amount: '20.00',
      total_amount: '100.00',
      outstanding_amount: '80.00',
      deadline: 'Saturday 1pm',
      payment_link: 'https://example.com/pay',
    };
    
    let messageText = template.template_text;
    template.variables?.forEach((variable: string) => {
      const value = sampleData[variable] || `{{${variable}}}`;
      messageText = messageText.replace(new RegExp(`{{${variable}}}`, 'g'), value);
    });
    
    // Queue test SMS
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: testPhone,
          body: `TEST: ${messageText}`,
          is_test: true,
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Test SMS error:', error);
      return { error: error.message || 'Failed to send test SMS' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'test',
      resource_type: 'sms_template',
      resource_id: templateId,
      operation_status: 'success',
      additional_info: { 
        template_key: template.template_key,
        test_phone: testPhone,
      }
    });
    
    return { 
      success: true, 
      message: 'Test SMS queued for sending',
      preview: messageText,
    };
  } catch (error) {
    console.error('Test template error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue booking confirmation SMS
export async function queueBookingConfirmationSMS(bookingId: string, useAdminClient: boolean = false) {
  try {
    // Use admin client when called from unauthenticated contexts (like PayPal return)
    const { createClient } = await import('@/lib/supabase/server');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = useAdminClient ? createAdminClient() : await createClient();
    
    // Get booking with customer and payment details
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.sms_opt_in) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    // Get appropriate template
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_confirmation_sunday_lunch'
      : 'booking_confirmation_regular';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'SMS template not found' };
    }
    
    // Prepare variables
    const variables: Record<string, string> = {
      customer_name: booking.customer.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    // Add deposit information for Sunday lunch bookings
    if (booking.booking_type === 'sunday_lunch' && booking.table_booking_payments?.length > 0) {
      const payment = booking.table_booking_payments[0];
      const depositAmount = payment.payment_metadata?.deposit_amount || payment.amount;
      const totalAmount = payment.payment_metadata?.total_amount || 0;
      const outstandingAmount = payment.payment_metadata?.outstanding_amount || (totalAmount - depositAmount);
      
      variables.deposit_amount = depositAmount.toFixed(2);
      variables.outstanding_amount = outstandingAmount.toFixed(2);
    }
    
    // Queue SMS
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id,
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue SMS error:', error);
      return { error: 'Failed to queue SMS' };
    }
    
    return { success: true, message: 'Confirmation SMS queued' };
  } catch (error) {
    console.error('Queue confirmation error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue booking update SMS
export async function queueBookingUpdateSMS(bookingId: string) {
  try {
    const supabase = await createClient();
    
    // Fetch booking with customer details
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (booking.status !== 'confirmed') {
      return { message: 'Booking is not confirmed. Skipping update SMS.' };
    }
    
    if (!booking.customer?.sms_opt_in || !booking.customer?.mobile_number) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_update_sunday_lunch'
      : 'booking_update_regular';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'SMS template not found' };
    }
    
    const variables: Record<string, string> = {
      customer_name: booking.customer.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id,
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue booking update SMS error:', error);
      return { error: 'Failed to queue booking update SMS' };
    }
    
    return { success: true, message: 'Booking update SMS queued' };
  } catch (error) {
    console.error('Queue booking update SMS error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue booking reminder SMS
export async function queueBookingReminderSMS(
  bookingId: string,
  options: { requirePermission?: boolean } = {},
) {
  try {
    const { requirePermission = true } = options;

    if (requirePermission) {
      const hasPermission = await checkUserPermission('table_bookings', 'edit');
      if (!hasPermission) {
        return { error: 'You do not have permission to send reminder SMS messages' };
      }
    }

    const supabase = createAdminClient();
    
    // Get booking with customer, items and payments
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.sms_opt_in) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    // Get appropriate template
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'reminder_sunday_lunch'
      : 'reminder_regular';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'SMS template not found' };
    }
    
    // Prepare variables
    const variables: Record<string, string> = {
      customer_name: booking.customer.first_name,
      party_size: booking.party_size.toString(),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
    };
    
    // Add Sunday lunch specific variables
    if (booking.booking_type === 'sunday_lunch' && booking.table_booking_items) {
      const roastSummary = booking.table_booking_items
        .filter((item: any) => item.item_type === 'main')
        .map((item: any) => `${item.quantity}x ${item.custom_item_name || 'Roast'}`)
        .join(', ');
        
      variables.roast_summary = roastSummary || 'Your roast selections';
      
      // Add outstanding balance if payment exists
      if (booking.table_booking_payments?.length > 0) {
        const payment = booking.table_booking_payments[0];
        const outstandingAmount = payment.payment_metadata?.outstanding_amount || 0;
        variables.outstanding_amount = outstandingAmount.toFixed(2);
      }
    }
    
    // Queue SMS
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id,
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue reminder error:', error);
      return { error: 'Failed to queue reminder SMS' };
    }
    
    return { success: true, message: 'Reminder SMS queued' };
  } catch (error) {
    console.error('Queue reminder error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue cancellation SMS
export async function queueCancellationSMS(
  bookingId: string,
  refundMessage: string
) {
  try {
    const supabase = await createClient();
    
    // Get booking with customer
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.sms_opt_in) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    // Get cancellation template
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', 'cancellation')
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'SMS template not found' };
    }
    
    // Prepare variables
    const variables = {
      reference: booking.booking_reference,
      refund_message: refundMessage,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '',
    };
    
    // Queue SMS
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: 'cancellation',
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue cancellation error:', error);
      return { error: 'Failed to queue cancellation SMS' };
    }
    
    return { success: true, message: 'Cancellation SMS queued' };
  } catch (error) {
    console.error('Queue cancellation error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Queue payment request SMS for Sunday lunch
type QueuePaymentRequestOptions = {
  useAdminClient?: boolean;
  requirePermission?: boolean;
};

export async function queuePaymentRequestSMS(
  bookingId: string,
  optionsOrUseAdminClient: boolean | QueuePaymentRequestOptions = {},
) {
  try {
    const options: QueuePaymentRequestOptions =
      typeof optionsOrUseAdminClient === 'boolean'
        ? { useAdminClient: optionsOrUseAdminClient }
        : optionsOrUseAdminClient;

    const { useAdminClient = false, requirePermission = true } = options;

    if (requirePermission) {
      const hasPermission = await checkUserPermission('table_bookings', 'manage');
      if (!hasPermission) {
        return { error: 'You do not have permission to send payment request SMS messages' };
      }
    }

    const supabase = createAdminClient();
    
    // Get booking with customer and items
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    if (!booking.customer?.sms_opt_in) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    // Get payment request template
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', 'payment_request')
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'SMS template not found' };
    }
    
    // Calculate amounts
    let totalAmount = 0;
    if (booking.table_booking_items) {
      booking.table_booking_items.forEach((item: any) => {
        totalAmount += item.price_at_booking * item.quantity;
      });
    } else {
      // Fallback if no items (shouldn't happen)
      totalAmount = booking.party_size * 25; // £25 average per person
    }
    
    // Calculate deposit amount (£5 per person)
    const depositAmount = booking.party_size * 5;
    
    // Calculate payment deadline (Saturday 1pm before the Sunday booking)
    const bookingDate = new Date(booking.booking_date);
    const deadlineDate = new Date(bookingDate);
    deadlineDate.setDate(bookingDate.getDate() - 1); // Saturday before
    deadlineDate.setHours(13, 0, 0, 0); // 1pm
    
    const deadlineFormatted = formatDateWithTimeForSms(
      deadlineDate,
      `${deadlineDate.getHours().toString().padStart(2, '0')}:${deadlineDate.getMinutes().toString().padStart(2, '0')}`
    );
    
    // Generate payment link with shortening
    const longPaymentUrl = `/table-booking/${booking.booking_reference}/payment`;
    const { createShortLinkInternal } = await import('@/app/actions/short-links');
    const shortLinkResult = await createShortLinkInternal({
      destination_url: `${process.env.NEXT_PUBLIC_APP_URL}${longPaymentUrl}`,
      link_type: 'custom',
      metadata: { 
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        type: 'sunday_lunch_payment_reminder'
      },
      expires_at: deadlineDate.toISOString()
    });
    
    const paymentLink = shortLinkResult.success 
      ? shortLinkResult.data.full_url 
      : `${process.env.NEXT_PUBLIC_APP_URL}${longPaymentUrl}`;
    
    // Prepare variables
    const variables = {
      customer_name: booking.customer.first_name,
      reference: booking.booking_reference,
      deposit_amount: depositAmount.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      payment_link: paymentLink,
      deadline: deadlineFormatted,
    };
    
    // Queue SMS
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: 'payment_request',
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue payment request error:', error);
      return { error: 'Failed to queue payment request SMS' };
    }
    
    return { success: true, message: 'Payment request SMS queued' };
  } catch (error) {
    return { error: 'An unexpected error occurred' };
  }
}

// Queue booking review request SMS
export async function queueBookingReviewRequestSMS(
  bookingId: string,
  options: { requirePermission?: boolean } = { requirePermission: true }
) {
  try {
    const { requirePermission = true } = options;

    if (requirePermission) {
      // This check might need to be adjusted based on whether this is called from a cron job (admin) or user action
      // For now, assuming system/admin context often calls this, permissions might be skipped by passing requirePermission: false
      const hasPermission = await checkUserPermission('table_bookings', 'manage');
      if (!hasPermission) {
        return { error: 'You do not have permission to send review request SMS messages' };
      }
    }

    const supabase = createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`*, customer:customers(*)`)
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }

    if (!booking.customer?.sms_opt_in) {
      return { message: 'Customer has opted out of SMS' };
    }
    
    const templateKey = 'review_request';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) {
      return { error: 'Template not found' };
    }
    
    // Get Google Review Link from env
    const reviewLink = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_LINK || 'https://g.page/r/example';
    
    const variables = {
      customer_name: booking.customer.first_name,
      review_link: reviewLink,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    const { error } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: {
          to: booking.customer.mobile_number,
          template: templateKey,
          variables,
          booking_id: bookingId,
          customer_id: booking.customer.id,
        },
        scheduled_for: new Date().toISOString(),
      });
    
    if (error) {
      console.error('Queue review request error:', error);
      return { error: 'Failed to queue review request SMS' };
    }
    
    return { success: true, message: 'Review request SMS queued' };
  } catch (error) {
    console.error('Queue review request error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

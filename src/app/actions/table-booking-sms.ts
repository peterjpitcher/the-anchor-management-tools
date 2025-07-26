'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

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
    const supabase = await createClient();
    
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
      date: '10/03/2024',
      time: '13:00',
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
export async function queueBookingConfirmationSMS(bookingId: string) {
  try {
    const supabase = await createClient();
    
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
      date: new Date(booking.booking_date).toLocaleDateString('en-GB'),
      time: booking.booking_time,
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

// Queue booking reminder SMS
export async function queueBookingReminderSMS(bookingId: string) {
  try {
    const supabase = await createClient();
    
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
      time: booking.booking_time,
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
export async function queuePaymentRequestSMS(bookingId: string) {
  try {
    const supabase = await createClient();
    
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
    
    // Generate payment link 
    const paymentLink = `${process.env.NEXT_PUBLIC_APP_URL}/api/table-bookings/payment/create?booking_id=${bookingId}`;
    
    // Prepare variables
    const variables = {
      customer_name: booking.customer.first_name,
      reference: booking.booking_reference,
      deposit_amount: depositAmount.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      payment_link: paymentLink,
      deadline: 'Saturday 1pm',
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
        },
        scheduled_for: new Date().toISOString(),
      });
      
    if (error) {
      console.error('Queue payment request error:', error);
      return { error: 'Failed to queue payment request SMS' };
    }
    
    return { success: true, message: 'Payment request SMS queued' };
  } catch (error) {
    console.error('Queue payment request error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
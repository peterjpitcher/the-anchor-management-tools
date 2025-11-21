'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/emailService';

export async function sendManagerOrderNotification(bookingId: string) {
  try {
    const supabase = createAdminClient();
    
    // Get complete booking details
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (error || !booking) {
      console.error('[Manager Email] Booking not found:', bookingId);
      return { error: 'Booking not found' };
    }
    
    // Format the order details
    const orderDate = new Date(booking.booking_date).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    
    const orderTime = formatTime12Hour(booking.booking_time);
    
    // Format order items
    let itemsHtml = '<ul style="margin: 0; padding-left: 20px;">';
    let totalAmount = 0;
    
    if (booking.table_booking_items && booking.table_booking_items.length > 0) {
      booking.table_booking_items.forEach((item: any) => {
        const itemTotal = item.price_at_booking * item.quantity;
        totalAmount += itemTotal;
        
        itemsHtml += `<li><strong>${item.quantity}x ${item.custom_item_name || 'Item'}</strong> - £${itemTotal.toFixed(2)}`;
        
        if (item.guest_name) {
          itemsHtml += ` (for ${item.guest_name})`;
        }
        
        if (item.special_requests) {
          itemsHtml += `<br><em>Special requests: ${item.special_requests}</em>`;
        }
        
        itemsHtml += '</li>';
      });
    }
    itemsHtml += '</ul>';
    
    // Get payment info
    const payment = booking.table_booking_payments?.[0];
    const depositAmount = payment?.amount || 0;
    const outstandingAmount = totalAmount - depositAmount;
    
    // Build email content
    const emailContent = `
      <h2>New Sunday Lunch Order - Payment Received</h2>
      
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #005131; margin-top: 0;">Booking Details</h3>
        <p><strong>Reference:</strong> ${booking.booking_reference}</p>
        <p><strong>Date:</strong> ${orderDate}</p>
        <p><strong>Time:</strong> ${orderTime}</p>
        <p><strong>Party Size:</strong> ${booking.party_size} ${booking.party_size === 1 ? 'guest' : 'guests'}</p>
      </div>
      
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #005131; margin-top: 0;">Customer Information</h3>
        <p><strong>Name:</strong> ${booking.customer.first_name} ${booking.customer.last_name}</p>
        <p><strong>Phone:</strong> ${booking.customer.mobile_number}</p>
        <p><strong>Email:</strong> ${booking.customer.email || 'Not provided'}</p>
      </div>
      
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #005131; margin-top: 0;">Order Details</h3>
        ${itemsHtml}
        
        ${booking.dietary_requirements && booking.dietary_requirements.length > 0 ? `
          <p style="margin-top: 15px;"><strong>Dietary Requirements:</strong><br>
          ${booking.dietary_requirements.join(', ')}</p>
        ` : ''}
        
        ${booking.allergies && booking.allergies.length > 0 ? `
          <p><strong>Allergies:</strong><br>
          ${booking.allergies.join(', ')}</p>
        ` : ''}
        
        ${booking.special_requirements ? `
          <p><strong>Special Requirements:</strong><br>
          ${booking.special_requirements}</p>
        ` : ''}
      </div>
      
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #005131; margin-top: 0;">Payment Summary</h3>
        <p><strong>Total Amount:</strong> £${totalAmount.toFixed(2)}</p>
        <p><strong>Deposit Paid:</strong> £${depositAmount.toFixed(2)}</p>
        <p><strong>Balance Due:</strong> £${outstandingAmount.toFixed(2)}</p>
        <p><strong>Payment Method:</strong> PayPal</p>
        <p><strong>Transaction ID:</strong> ${payment?.transaction_id || 'N/A'}</p>
      </div>
      
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        This email was sent automatically when the customer completed their deposit payment.
      </p>
    `;
    
    // Send email to manager
    const emailResult = await sendEmail({
      to: 'manager@the-anchor.pub',
      subject: `Sunday Lunch Order - ${booking.booking_reference} - ${orderDate}`,
      html: emailContent
    });
    
    if (!emailResult.success) {
      console.error('[Manager Email] Failed to send:', emailResult.error);
      return { error: 'Failed to send manager notification' };
    }
    
    console.log('[Manager Email] Sent successfully for booking:', booking.booking_reference);
    return { success: true };
    
  } catch (error) {
    console.error('[Manager Email] Error:', error);
    return { error: 'Failed to send manager notification' };
  }
}

function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return minutes === 0 ? `${hours12}${period}` : `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
}
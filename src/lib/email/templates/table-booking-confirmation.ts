import { format } from 'date-fns';
import type { TableBooking, TableBookingItem } from '@/types/table-bookings';

interface EmailTemplateData {
  booking: TableBooking & {
    customer?: {
      first_name: string;
      last_name: string | null;
      email?: string;
      mobile_number: string;
    };
    table_booking_items?: TableBookingItem[];
  };
  payment_amount?: number;
}

export function generateBookingConfirmationEmail(data: EmailTemplateData): { subject: string; html: string } {
  const { booking, payment_amount } = data;
  const bookingDate = new Date(booking.booking_date);
  const formattedDate = format(bookingDate, 'EEEE, d MMMM yyyy');
  
  const subject = `Booking Confirmation - ${booking.booking_reference}`;
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e7b44; padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0;">The Anchor</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0;">Table Booking Confirmation</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 20px;">
              <h2 style="color: #1e7b44; margin: 0 0 20px 0;">Hello ${booking.customer?.first_name}!</h2>
              
              <p style="font-size: 16px; line-height: 1.6; color: #333333;">
                Your table booking has been confirmed. We look forward to welcoming you!
              </p>
              
              <!-- Booking Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; border: 1px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #1e7b44; margin: 0 0 15px 0;">Booking Details</h3>
                    
                    <table width="100%" cellpadding="5" cellspacing="0">
                      <tr>
                        <td style="color: #666666; width: 40%;">Reference:</td>
                        <td style="color: #333333; font-weight: bold;">${booking.booking_reference}</td>
                      </tr>
                      <tr>
                        <td style="color: #666666;">Date:</td>
                        <td style="color: #333333; font-weight: bold;">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="color: #666666;">Time:</td>
                        <td style="color: #333333; font-weight: bold;">${booking.booking_time}</td>
                      </tr>
                      <tr>
                        <td style="color: #666666;">Party Size:</td>
                        <td style="color: #333333; font-weight: bold;">${booking.party_size} ${booking.party_size === 1 ? 'person' : 'people'}</td>
                      </tr>
                      <tr>
                        <td style="color: #666666;">Type:</td>
                        <td style="color: #333333; font-weight: bold;">${booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular Dining'}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
  `;
  
  // Add Sunday Lunch order details if applicable
  if (booking.booking_type === 'sunday_lunch' && booking.table_booking_items && booking.table_booking_items.length > 0) {
    html += `
              <!-- Sunday Lunch Order -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; border: 1px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #1e7b44; margin: 0 0 15px 0;">Your Sunday Lunch Order</h3>
                    
                    <table width="100%" cellpadding="5" cellspacing="0">
    `;
    
    booking.table_booking_items.forEach(item => {
      html += `
                      <tr>
                        <td style="color: #333333;">${item.quantity}x ${item.custom_item_name || 'Menu Item'}</td>
                        <td style="color: #333333; text-align: right;">£${(item.price_at_booking * item.quantity).toFixed(2)}</td>
                      </tr>
      `;
      if (item.special_requests) {
        html += `
                      <tr>
                        <td colspan="2" style="color: #666666; font-size: 14px; padding-left: 20px;">${item.special_requests}</td>
                      </tr>
        `;
      }
    });
    
    const total = booking.table_booking_items.reduce((sum, item) => sum + (item.price_at_booking * item.quantity), 0);
    
    html += `
                      <tr style="border-top: 1px solid #e0e0e0;">
                        <td style="color: #333333; font-weight: bold; padding-top: 10px;">Total</td>
                        <td style="color: #333333; font-weight: bold; text-align: right; padding-top: 10px;">£${total.toFixed(2)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
    `;
  }
  
  // Add special requirements if any
  if (booking.special_requirements || booking.dietary_requirements?.length || booking.allergies?.length) {
    html += `
              <!-- Special Requirements -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; border: 1px solid #e0e0e0; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #1e7b44; margin: 0 0 15px 0;">Special Requirements</h3>
    `;
    
    if (booking.special_requirements) {
      html += `<p style="color: #333333; margin: 5px 0;">${booking.special_requirements}</p>`;
    }
    
    if (booking.dietary_requirements && booking.dietary_requirements.length > 0) {
      html += `<p style="color: #333333; margin: 5px 0;"><strong>Dietary:</strong> ${booking.dietary_requirements.join(', ')}</p>`;
    }
    
    if (booking.allergies && booking.allergies.length > 0) {
      html += `<p style="color: #d32f2f; margin: 5px 0;"><strong>⚠️ Allergies:</strong> ${booking.allergies.join(', ')}</p>`;
    }
    
    html += `
                  </td>
                </tr>
              </table>
    `;
  }
  
  // Add payment confirmation if applicable
  if (payment_amount && payment_amount > 0) {
    html += `
              <!-- Payment Confirmation -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; background-color: #e8f5e9; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="color: #1e7b44; margin: 0; font-size: 16px;">
                      ✓ Payment of £${payment_amount.toFixed(2)} has been received
                    </p>
                  </td>
                </tr>
              </table>
    `;
  }
  
  html += `
              <!-- Important Information -->
              <div style="margin: 30px 0; padding: 20px; background-color: #f5f5f5; border-radius: 8px;">
                <h3 style="color: #1e7b44; margin: 0 0 10px 0;">Important Information</h3>
                <ul style="color: #333333; margin: 0; padding-left: 20px;">
                  <li style="margin-bottom: 8px;">Please arrive on time for your booking</li>
                  <li style="margin-bottom: 8px;">Tables are held for 15 minutes after the booking time</li>
                  <li style="margin-bottom: 8px;">For any changes or cancellations, please call us as soon as possible</li>
                  ${booking.booking_type === 'sunday_lunch' ? '<li>Sunday lunch orders cannot be changed on the day</li>' : ''}
                </ul>
              </div>
              
              <!-- Contact Information -->
              <div style="text-align: center; margin: 30px 0;">
                <p style="color: #666666; margin: 0 0 10px 0;">Need to make changes or have questions?</p>
                <p style="color: #333333; margin: 0; font-size: 18px;">
                  Call us: <a href="tel:${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}" style="color: #1e7b44; text-decoration: none;">${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}</a>
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px 20px; text-align: center;">
              <p style="color: #666666; margin: 0 0 10px 0; font-size: 14px;">
                The Anchor<br>
                Your favourite local venue
              </p>
              <p style="color: #999999; margin: 0; font-size: 12px;">
                This is an automated confirmation email. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
  
  return { subject, html };
}

export function generateBookingCancellationEmail(
  booking: TableBooking & { customer?: { first_name: string } },
  refundMessage: string
): { subject: string; html: string } {
  const subject = `Booking Cancelled - ${booking.booking_reference}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Cancellation</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #d32f2f; padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0;">The Anchor</h1>
              <p style="color: #ffffff; margin: 10px 0 0 0;">Booking Cancellation</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 20px;">
              <h2 style="color: #333333; margin: 0 0 20px 0;">Hello ${booking.customer?.first_name}!</h2>
              
              <p style="font-size: 16px; line-height: 1.6; color: #333333;">
                Your booking <strong>${booking.booking_reference}</strong> has been cancelled.
              </p>
              
              <p style="font-size: 16px; line-height: 1.6; color: #333333;">
                ${refundMessage}
              </p>
              
              <div style="text-align: center; margin: 40px 0;">
                <p style="color: #666666; margin: 0 0 10px 0;">We hope to see you again soon!</p>
                <p style="color: #333333; margin: 0; font-size: 18px;">
                  For any questions: <a href="tel:${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}" style="color: #1e7b44; text-decoration: none;">${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}</a>
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px 20px; text-align: center;">
              <p style="color: #666666; margin: 0 0 10px 0; font-size: 14px;">
                The Anchor<br>
                Your favourite local venue
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
  
  return { subject, html };
}

export function generateBookingReminderEmail(data: EmailTemplateData): { subject: string; html: string } {
  const { booking } = data;
  const bookingDate = new Date(booking.booking_date);
  const formattedDate = format(bookingDate, 'EEEE, d MMMM');
  
  const subject = `Reminder: Your table booking tomorrow at ${booking.booking_time}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Reminder</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e7b44; padding: 40px 20px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0;">See You Tomorrow!</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 20px;">
              <h2 style="color: #1e7b44; margin: 0 0 20px 0;">Hello ${booking.customer?.first_name}!</h2>
              
              <p style="font-size: 16px; line-height: 1.6; color: #333333;">
                Just a friendly reminder about your table booking tomorrow.
              </p>
              
              <!-- Booking Details -->
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0; color: #333333;">
                  <strong>Date:</strong> ${formattedDate}<br>
                  <strong>Time:</strong> ${booking.booking_time}<br>
                  <strong>Party Size:</strong> ${booking.party_size} ${booking.party_size === 1 ? 'person' : 'people'}<br>
                  <strong>Reference:</strong> ${booking.booking_reference}
                </p>
              </div>
              
              ${booking.booking_type === 'sunday_lunch' && booking.table_booking_items ? `
              <div style="margin: 30px 0;">
                <h3 style="color: #1e7b44;">Your Sunday Lunch Order</h3>
                ${booking.table_booking_items.map(item => 
                  `<p style="color: #333333; margin: 5px 0;">${item.quantity}x ${item.custom_item_name}</p>`
                ).join('')}
              </div>
              ` : ''}
              
              <div style="text-align: center; margin: 40px 0;">
                <p style="color: #666666; margin: 0;">We look forward to seeing you!</p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px 20px; text-align: center;">
              <p style="color: #666666; margin: 0 0 10px 0; font-size: 14px;">
                Need to make changes?<br>
                Call us: <a href="tel:${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}" style="color: #1e7b44;">${process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
  
  return { subject, html };
}

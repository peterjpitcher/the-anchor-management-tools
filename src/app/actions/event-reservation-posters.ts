'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { generatePDFFromHTML } from '@/lib/pdf-generator';
import { formatDate } from '@/lib/dateUtils';
import { formatPhoneForDisplay } from '@/lib/validation';
import QRCode from 'qrcode';

interface EventWithDetails {
  id: string;
  name: string;
  date: string;
  time: string;
  bookings: {
    id: string;
    seats: number | null;
    customer: {
      first_name: string;
      last_name: string;
    };
  }[];
}

interface UpcomingEvent {
  id: string;
  name: string;
  date: string;
  time: string;
  slug: string;
}

export async function generateEventReservationPosters(eventId: string) {
  try {
    // Get authenticated client
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('events', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to perform this action' };
    }
    
    // Fetch event details and active bookings
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        name,
        date,
        time
      `)
      .eq('id', eventId)
      .single();
      
    if (eventError || !event) {
      console.error('Event fetch error:', eventError);
      return { error: 'Failed to fetch event details' };
    }
    
    // Fetch active bookings (those with seats > 0)
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        seats,
        customer:customers!inner(
          first_name,
          last_name
        )
      `)
      .eq('event_id', eventId)
      .gt('seats', 0)
      .order('created_at', { ascending: true });
      
    if (bookingsError) {
      console.error('Bookings fetch error:', bookingsError);
      return { error: 'Failed to fetch bookings' };
    }
    
    if (!bookings || bookings.length === 0) {
      return { error: 'No active bookings found for this event' };
    }
    
    // Fetch upcoming events for QR codes
    const today = new Date().toISOString().split('T')[0];
    const { data: upcomingEvents, error: upcomingError } = await supabase
      .from('events')
      .select('id, name, date, time, slug')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(6); // Show up to 6 upcoming events
      
    if (upcomingError) {
      console.error('Upcoming events fetch error:', upcomingError);
      // Continue without upcoming events
    }
    
    // Generate QR codes for upcoming events
    const eventsWithQR: (UpcomingEvent & { qrCode: string })[] = [];
    if (upcomingEvents) {
      for (const upEvent of upcomingEvents) {
        try {
          // Generate URL for public website using the correct domain
          const bookingUrl = `https://www.the-anchor.pub/events/${upEvent.slug}`;
          const qrCode = await QRCode.toDataURL(bookingUrl, {
            width: 200,
            margin: 0,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          eventsWithQR.push({ ...upEvent, qrCode });
        } catch (err) {
          console.error('QR code generation error:', err);
        }
      }
    }
    
    // Generate HTML for all reservation posters
    const html = generateReservationPostersHTML({
      ...event,
      bookings: bookings as any
    }, eventsWithQR);
    
    // Generate PDF
    const pdfBuffer = await generatePDFFromHTML(html);
    
    // Return the PDF as base64 for download
    return { 
      success: true, 
      pdf: pdfBuffer.toString('base64'),
      filename: `${event.name.replace(/[^a-z0-9]/gi, '_')}_reservations.pdf`
    };
    
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

function generateReservationPostersHTML(
  event: EventWithDetails, 
  upcomingEvents: (UpcomingEvent & { qrCode: string })[] = []
): string {
  const logoUrl = process.env.NEXT_PUBLIC_APP_URL 
    ? `${process.env.NEXT_PUBLIC_APP_URL}/logo-black.png`
    : 'https://management.orangejelly.co.uk/logo-black.png';
    
  const contactPhone = formatPhoneForDisplay(process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707');
  
  // Generate pages for each booking
  const pages = event.bookings.map((booking, index) => {
    const isLastPage = index === event.bookings.length - 1;
    
    return `
      <div class="page ${!isLastPage ? 'page-break' : ''}">
        <div class="content">
          <!-- Logo -->
          <div class="logo-container">
            <img src="${logoUrl}" alt="The Anchor" class="logo" />
          </div>
          
          <!-- Reserved For Section -->
          <div class="reserved-section">
            <h1 class="reserved-text">RESERVED</h1>
            <div class="customer-name">${booking.customer.first_name} ${booking.customer.last_name}</div>
            <div class="seats-info">${booking.seats} ${booking.seats === 1 ? 'seat' : 'seats'}</div>
          </div>
          
          <!-- Event Details -->
          <div class="event-details">
            <h2 class="event-name">${event.name}</h2>
            <div class="event-datetime">
              <div class="date">${formatDate(event.date)}</div>
              <div class="time">${event.time}</div>
            </div>
          </div>
          
          <!-- Footer with upcoming events and contact -->
          <div class="footer-section">
            ${upcomingEvents.length > 0 ? `
              <div class="upcoming-events">
                <p class="upcoming-title">Upcoming Events - Scan to Book!</p>
                <div class="events-grid">
                  ${upcomingEvents.map(upEvent => `
                    <div class="event-qr">
                      <img src="${upEvent.qrCode}" alt="QR Code for ${upEvent.name}" class="qr-code" />
                      <div class="event-info">
                        <div class="event-name-small">${upEvent.name}</div>
                        <div class="event-date-small">${formatDate(upEvent.date)}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
              <div class="divider"></div>
            ` : ''}
            
            <div class="footer-cta">
              <p class="cta-text">Want to book a table for events?</p>
              <div class="contact-options">
                <div class="contact-item">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <span>Call ${contactPhone}</span>
                </div>
                <div class="contact-item">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                  <span>WhatsApp ${contactPhone}</span>
                </div>
                <div class="contact-item">
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span>Ask our team at the bar</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 0;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            color: #000;
            background: white;
          }
          
          .page {
            width: 210mm;
            height: 297mm;
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20mm;
            background: white;
          }
          
          .page-break {
            page-break-after: always;
          }
          
          .content {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            border: 3px solid #000;
            border-radius: 20px;
            padding: 20mm 15mm;
            position: relative;
          }
          
          .logo-container {
            text-align: center;
            margin-bottom: 20px;
          }
          
          .logo {
            height: 60px;
            width: auto;
          }
          
          .reserved-section {
            text-align: center;
            margin: 20px 0;
          }
          
          .reserved-text {
            font-size: 48px;
            font-weight: 900;
            color: #000;
            letter-spacing: 6px;
            margin-bottom: 20px;
          }
          
          .customer-name {
            font-size: 36px;
            font-weight: 700;
            color: #000;
            margin-bottom: 10px;
          }
          
          .seats-info {
            font-size: 24px;
            color: #000;
            font-weight: 500;
          }
          
          .event-details {
            text-align: center;
            margin: 20px 0;
            padding: 20px;
            background: #fff;
            border: 2px solid #000;
            border-radius: 15px;
            width: 100%;
          }
          
          .event-name {
            font-size: 28px;
            font-weight: 700;
            color: #000;
            margin-bottom: 20px;
          }
          
          .event-datetime {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 30px;
            font-size: 22px;
            color: #000;
          }
          
          .date {
            font-weight: 600;
          }
          
          .time {
            font-weight: 600;
            color: #000;
          }
          
          .footer-section {
            width: 100%;
          }
          
          .upcoming-events {
            margin-bottom: 20px;
          }
          
          .upcoming-title {
            font-size: 18px;
            font-weight: 700;
            color: #000;
            text-align: center;
            margin-bottom: 15px;
          }
          
          .events-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-bottom: 20px;
          }
          
          .event-qr {
            text-align: center;
          }
          
          .qr-code {
            width: 80px;
            height: 80px;
            margin: 0 auto 5px;
            display: block;
          }
          
          .event-info {
            font-size: 10px;
            line-height: 1.2;
          }
          
          .event-name-small {
            font-weight: 600;
            color: #000;
          }
          
          .event-date-small {
            color: #000;
          }
          
          .divider {
            height: 2px;
            background: #000;
            margin: 20px 0;
          }
          
          .footer-cta {
            width: 100%;
            text-align: center;
          }
          
          .cta-text {
            font-size: 20px;
            color: #000;
            margin-bottom: 20px;
            font-weight: 600;
          }
          
          .contact-options {
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 30px;
          }
          
          .contact-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
            color: #000;
            font-weight: 500;
          }
          
          .icon {
            width: 20px;
            height: 20px;
            color: #000;
          }
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        ${pages}
      </body>
    </html>
  `;
}
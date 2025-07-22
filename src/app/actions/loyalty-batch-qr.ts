'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';

// Validation schema
const BatchQRSchema = z.object({
  event_id: z.string().uuid(),
  format: z.enum(['pdf', 'individual']).default('pdf'),
  include_unbooked: z.boolean().default(false)
});

// Generate QR codes for all bookings of an event
export async function generateEventQRCodes(data: z.infer<typeof BatchQRSchema>) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('events', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to generate QR codes' };
    }
    
    // Validate input
    const validatedData = BatchQRSchema.parse(data);
    
    // Get event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        category:event_categories(name)
      `)
      .eq('id', validatedData.event_id)
      .single();
    
    if (eventError || !event) {
      return { error: 'Event not found' };
    }
    
    // Get all bookings for the event
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(
          id,
          name,
          email_address,
          phone_number
        )
      `)
      .eq('event_id', validatedData.event_id)
      .order('created_at', { ascending: false });
    
    if (bookingsError || !bookings) {
      return { error: 'Failed to load bookings' };
    }
    
    if (bookings.length === 0) {
      return { error: 'No bookings found for this event' };
    }
    
    // Generate QR data for each booking
    const qrDataArray = await Promise.all(
      bookings.map(async (booking) => {
        const qrData = {
          type: 'loyalty_checkin',
          event_id: event.id,
          booking_id: booking.id,
          customer_id: booking.customer_id,
          token: booking.qr_token || 'temp-token', // In production, generate proper tokens
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        
        const qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
          width: 300,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        
        return {
          booking,
          qrCode,
          customer: booking.customer
        };
      })
    );
    
    if (validatedData.format === 'pdf') {
      // Generate PDF with all QR codes
      const pdfBuffer = await generateBatchQRPDF(event, qrDataArray);
      
      // Log audit event
      await logAuditEvent({
        operation_type: 'create',
        resource_type: 'loyalty_qr_batch',
        resource_id: event.id,
        operation_status: 'success',
        new_values: {
          event_id: event.id,
          booking_badge: bookings.length,
          format: 'pdf'
        }
      });
      
      return { 
        success: true, 
        data: {
          pdf: pdfBuffer.toString('base64'),
          bookingCount: bookings.length,
          eventName: event.title
        }
      };
    } else {
      // Return individual QR codes
      const qrCodes = qrDataArray.map(({ booking, qrCode, customer }) => ({
        bookingId: booking.id,
        customerName: customer?.name || 'Unknown',
        qrCode
      }));
      
      // Log audit event
      await logAuditEvent({
        operation_type: 'create',
        resource_type: 'loyalty_qr_batch',
        resource_id: event.id,
        operation_status: 'success',
        new_values: {
          event_id: event.id,
          booking_badge: bookings.length,
          format: 'individual'
        }
      });
      
      return { 
        success: true, 
        data: {
          qrCodes,
          eventName: event.title
        }
      };
    }
  } catch (error) {
    console.error('Error generating QR codes:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message };
    }
    return { error: 'Failed to generate QR codes' };
  }
}

// Generate PDF with batch QR codes
async function generateBatchQRPDF(
  event: any,
  qrDataArray: Array<{ booking: any; qrCode: string; customer: any }>
): Promise<Buffer> {
  let browser = null;
  
  try {
    // Launch puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Generate HTML for the PDF
    const html = generateBatchQRHTML(event, qrDataArray);
    
    // Set content
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
    
    return Buffer.from(pdf);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate PDF');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Generate HTML for batch QR PDF
function generateBatchQRHTML(
  event: any,
  qrDataArray: Array<{ booking: any; qrCode: string; customer: any }>
): string {
  const eventDate = new Date(event.start_date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  const eventTime = new Date(event.start_date).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  const qrCodesPerPage = 6; // 2x3 grid
  const pages = [];
  
  for (let i = 0; i < qrDataArray.length; i += qrCodesPerPage) {
    const pageQRs = qrDataArray.slice(i, i + qrCodesPerPage);
    pages.push(pageQRs);
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>QR Codes - ${event.title}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #1a1a1a;
          line-height: 1.5;
        }
        
        .page {
          width: 210mm;
          min-height: 297mm;
          padding: 10mm;
          page-break-after: always;
          position: relative;
        }
        
        .page:last-child {
          page-break-after: auto;
        }
        
        .header {
          text-align: center;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 2px solid #f59e0b;
        }
        
        .header h1 {
          font-size: 24px;
          color: #1a1a1a;
          margin-bottom: 5px;
        }
        
        .header p {
          font-size: 14px;
          color: #666;
        }
        
        .qr-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          margin-top: 20px;
        }
        
        .qr-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 15px;
          text-align: center;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .qr-card img {
          width: 200px;
          height: 200px;
          margin: 0 auto 10px;
          display: block;
        }
        
        .customer-name {
          font-size: 16px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 5px;
        }
        
        .booking-info {
          font-size: 12px;
          color: #666;
          margin-bottom: 10px;
        }
        
        .instructions {
          font-size: 11px;
          color: #666;
          padding: 10px;
          background: #f9fafb;
          border-radius: 4px;
          margin-top: 10px;
        }
        
        .footer {
          position: absolute;
          bottom: 10mm;
          left: 10mm;
          right: 10mm;
          text-align: center;
          font-size: 10px;
          color: #999;
          padding-top: 10px;
          border-top: 1px solid #e5e7eb;
        }
        
        @media print {
          body { -webkit-print-color-adjust: exact; }
          .page { margin: 0; border: none; page-break-after: always; }
        }
      </style>
    </head>
    <body>
      ${pages.map((pageQRs, pageIndex) => `
        <div class="page">
          <div class="header">
            <h1>${event.title}</h1>
            <p>${eventDate} at ${eventTime}</p>
            ${event.category?.name ? `<p>Category: ${event.category.name}</p>` : ''}
            <p>Page ${pageIndex + 1} of ${pages.length}</p>
          </div>
          
          <div class="qr-grid">
            ${pageQRs.map(({ booking, qrCode, customer }) => `
              <div class="qr-card">
                <img src="${qrCode}" alt="QR Code" />
                <div class="customer-name">${customer?.name || 'Guest'}</div>
                <div class="booking-info">
                  Booking #${booking.id.slice(-8).toUpperCase()}<br>
                  ${booking.number_of_people} ${booking.number_of_people === 1 ? 'person' : 'people'}
                </div>
                <div class="instructions">
                  Present this QR code at check-in to earn loyalty points
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="footer">
            <p>The Anchor VIP Club - Generated on ${new Date().toLocaleDateString('en-GB')}</p>
          </div>
        </div>
      `).join('')}
    </body>
    </html>
  `;
}

// Generate QR codes for unbooked slots
export async function generateUnbookedQRCodes(eventId: string, quantity: number) {
  try {
    const supabase = await createClient();
    
    const hasPermission = await checkUserPermission('events', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to generate QR codes' };
    }
    
    // Get event details
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();
    
    if (!event) {
      return { error: 'Event not found' };
    }
    
    // Generate temporary QR codes for walk-ins
    const qrCodes = [];
    for (let i = 0; i < quantity; i++) {
      const tempId = `WALKIN-${Date.now()}-${i}`;
      const qrData = {
        type: 'loyalty_walkin',
        event_id: eventId,
        temp_id: tempId,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      
      const qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 300,
        margin: 1
      });
      
      qrCodes.push({
        tempId,
        qrCode,
        number: i + 1
      });
    }
    
    // Generate PDF
    const pdfBuffer = await generateWalkInQRPDF(event, qrCodes);
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'loyalty_qr_walkin',
      resource_id: eventId,
      operation_status: 'success',
      new_values: {
        event_id: eventId,
        quantity,
        type: 'walk-in'
      }
    });
    
    return { 
      success: true, 
      data: {
        pdf: pdfBuffer.toString('base64'),
        quantity,
        eventName: event.title
      }
    };
  } catch (error) {
    console.error('Error generating walk-in QR codes:', error);
    return { error: 'Failed to generate QR codes' };
  }
}

// Generate PDF for walk-in QR codes
async function generateWalkInQRPDF(
  event: any,
  qrCodes: Array<{ tempId: string; qrCode: string; number: number }>
): Promise<Buffer> {
  let browser = null;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Similar HTML generation but for walk-in codes
    const html = generateWalkInQRHTML(event, qrCodes);
    
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });
    
    return Buffer.from(pdf);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Generate HTML for walk-in QR codes
function generateWalkInQRHTML(
  event: any,
  qrCodes: Array<{ tempId: string; qrCode: string; number: number }>
): string {
  const eventDate = new Date(event.start_date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  const qrCodesPerPage = 6;
  const pages = [];
  
  for (let i = 0; i < qrCodes.length; i += qrCodesPerPage) {
    const pageQRs = qrCodes.slice(i, i + qrCodesPerPage);
    pages.push(pageQRs);
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Walk-in QR Codes - ${event.title}</title>
      <style>
        /* Same styles as batch QR HTML */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #1a1a1a;
        }
        
        .page {
          width: 210mm;
          min-height: 297mm;
          padding: 10mm;
          page-break-after: always;
        }
        
        .header {
          text-align: center;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 2px solid #f59e0b;
        }
        
        .qr-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          margin-top: 20px;
        }
        
        .qr-card {
          border: 2px dashed #f59e0b;
          border-radius: 8px;
          padding: 15px;
          text-align: center;
          background: #fffbeb;
        }
        
        .qr-card img {
          width: 200px;
          height: 200px;
          margin: 0 auto 10px;
          display: block;
        }
        
        .walk-in-label {
          font-size: 18px;
          font-weight: bold;
          color: #f59e0b;
          margin-bottom: 5px;
        }
        
        .instructions {
          font-size: 12px;
          color: #666;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      ${pages.map((pageQRs, pageIndex) => `
        <div class="page">
          <div class="header">
            <h1>Walk-in QR Codes - ${event.title}</h1>
            <p>${eventDate}</p>
            <p style="color: #f59e0b; font-weight: bold;">For customers without pre-bookings</p>
          </div>
          
          <div class="qr-grid">
            ${pageQRs.map(({ qrCode, number }) => `
              <div class="qr-card">
                <div class="walk-in-label">WALK-IN #${number}</div>
                <img src="${qrCode}" alt="QR Code" />
                <div class="instructions">
                  Hand this to walk-in customers<br>
                  They can use it to join the loyalty program
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </body>
    </html>
  `;
}
'use server';

import { createClient } from '@/lib/supabase/server';
import QRCode from 'qrcode';
import { generateBookingQRCode } from './loyalty-checkins';

// Generate QR code image for a booking
export async function generateQRCodeImage(bookingId: string, eventId: string) {
  try {
    const supabase = await createClient();
    
    // Check if booking exists and user has permission
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*, customer:customers(*)')
      .eq('id', bookingId)
      .single();
    
    if (error || !booking) {
      return { error: 'Booking not found' };
    }
    
    // Generate QR data
    const qrResult = await generateBookingQRCode(eventId, bookingId);
    
    if (qrResult.error || !qrResult.qrData) {
      return { error: qrResult.error || 'Failed to generate QR code' };
    }
    
    // Generate QR code image
    const qrCodeDataUrl = await QRCode.toDataURL(qrResult.qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return { 
      success: true, 
      qrCodeImage: qrCodeDataUrl,
      qrUrl: qrResult.qrUrl,
      customerName: booking.customer?.name,
      eventId
    };
  } catch (error) {
    console.error('Error generating QR code image:', error);
    return { error: 'Failed to generate QR code image' };
  }
}

// Generate batch QR codes for an event
export async function generateEventQRCodes(eventId: string) {
  try {
    const supabase = await createClient();
    
    // Get all bookings for the event
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, customer:customers(*)')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');
    
    if (error || !bookings) {
      return { error: 'Failed to load bookings' };
    }
    
    // Generate QR codes for each booking
    const qrCodes = await Promise.all(
      bookings.map(async (booking) => {
        const qrResult = await generateQRCodeImage(booking.id, eventId);
        return {
          bookingId: booking.id,
          customerName: booking.customer?.name,
          customerPhone: booking.customer?.mobile_number,
          qrCode: qrResult.qrCodeImage,
          error: qrResult.error
        };
      })
    );
    
    return { 
      success: true, 
      qrCodes: qrCodes.filter(qr => !qr.error),
      errors: qrCodes.filter(qr => qr.error)
    };
  } catch (error) {
    console.error('Error generating event QR codes:', error);
    return { error: 'Failed to generate QR codes' };
  }
}
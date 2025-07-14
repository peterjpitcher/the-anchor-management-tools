'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle, Calendar, Clock, MapPin, Users, Phone } from 'lucide-react';
import { formatPhoneForDisplay } from '@/lib/validation';


export default function BookingSuccessPage() {
  const params = useParams();
  const bookingId = params.id as string;
  
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBooking();
  }, [bookingId]);

  async function loadBooking() {
    try {
      const supabase = createClient();
      
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          seats,
          event:events!inner(
            name,
            date,
            time,
            location
          ),
          customer:customers!inner(
            first_name,
            last_name
          )
        `)
        .eq('id', bookingId)
        .single();

      if (!error && data) {
        setBooking(data);
      }
    } catch (err) {
      console.error('Error loading booking:', err);
    } finally {
      setLoading(false);
    }
  }

  const confirmationNumber = booking ? `ANH-${new Date().getFullYear()}-${booking.id.slice(0, 8).toUpperCase()}` : '';

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-center mb-6">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-2">Booking Confirmed!</h1>
            <p className="text-gray-600">Thank you for your booking</p>
          </div>

          {booking && (
            <div className="space-y-6">
              <div className="bg-green-50 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-600 mb-1">Confirmation Number</p>
                <p className="text-2xl font-mono font-bold text-green-600">{confirmationNumber}</p>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h2 className="text-xl font-semibold">{booking.event.name}</h2>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-gray-500" />
                    <span>{new Date(booking.event.date).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}</span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-gray-500" />
                    <span>{booking.event.time}</span>
                  </div>
                  
                  {booking.event.location && (
                    <div className="flex items-center gap-3">
                      <MapPin className="h-5 w-5 text-gray-500" />
                      <span>{booking.event.location}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-gray-500" />
                    <span>{booking.seats} {booking.seats === 1 ? 'seat' : 'seats'}</span>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <p className="text-gray-600 mb-4">
                  A confirmation SMS has been sent to your mobile number with these details.
                </p>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-semibold mb-2">Need Help?</p>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4" />
                    <span>Call us on {formatPhoneForDisplay(process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '+447979797979')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle, Calendar, Clock, MapPin, Users, Phone } from 'lucide-react';
import { formatPhoneForDisplay } from '@/lib/validation';
import { Page, Card, Badge, Spinner, Alert, Container } from '@/components/ui-v2';

export default function BookingSuccessPage() {
  const params = useParams();
  const rawId = params?.id;
  const bookingId = Array.isArray(rawId) ? rawId[0] : rawId ?? null;
  
  const [booking, setBooking] = useState<{
    id: string;
    seats: number;
    event: {
      name: string;
      date: string;
      time: string;
      location?: string;
    };
    customer: {
      first_name: string;
      last_name: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookingId) {
      setLoading(false);
      return;
    }

    loadBooking();
  }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBooking() {
    if (!bookingId) {
      return;
    }

    try {
      const supabase = createClient();
      
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          seats,
          events!event_id(
            name,
            date,
            time,
            location
          ),
          customers!customer_id(
            first_name,
            last_name
          )
        `)
        .eq('id', bookingId)
        .single();

      if (!error && data) {
        // Type assertion for Supabase joined data
        const typedData = data as unknown as {
          id: string;
          seats: number;
          events: {
            name: string;
            date: string;
            time: string;
            location?: string;
          };
          customers: {
            first_name: string;
            last_name: string;
          };
        };
        
        setBooking({
          id: typedData.id,
          seats: typedData.seats,
          event: typedData.events,
          customer: typedData.customers
        });
      }
    } catch (err) {
      console.error('Error loading booking:', err);
    } finally {
      setLoading(false);
    }
  }

  const confirmationNumber = booking ? `ANH-${new Date().getFullYear()}-${booking.id.slice(0, 8).toUpperCase()}` : '';

  if (loading) {
    return (
      <Page title="" spacing={false}>
        <Container size="sm" className="py-8">
          <div className="flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        </Container>
      </Page>
    );
  }

  if (!bookingId || !booking) {
    return (
      <Page title="" spacing={false}>
        <Container size="sm" className="py-8">
          <Alert variant="error" title="Booking not found" description="We couldn't locate this booking." />
        </Container>
      </Page>
    );
  }

  return (
    <Page title="" spacing={false}>
      <Container size="sm" className="py-8">
        <Card padding="lg">
          <div className="text-center mb-6">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-2">Booking Confirmed!</h1>
            <p className="text-gray-600">Thank you for your booking</p>
          </div>

          {booking && (
            <div className="space-y-6">
              <Alert variant="success"
                title="Confirmation Number"
                description={confirmationNumber}
                className="text-center"
              />

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
                    <Badge variant="primary">
                      {booking.seats} {booking.seats === 1 ? 'seat' : 'seats'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <p className="text-gray-600 mb-4">
                  A confirmation SMS has been sent to your mobile number with these details.
                </p>
                
                <Card variant="bordered" padding="sm">
                  <p className="text-sm font-semibold mb-2">Need Help?</p>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4" />
                    <span>Call us on {formatPhoneForDisplay(process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '+447979797979')}</span>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </Card>
      </Container>
    </Page>
  );
}

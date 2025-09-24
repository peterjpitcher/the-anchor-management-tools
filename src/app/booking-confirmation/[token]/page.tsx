'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Select } from '@/components/ui-v2/forms/Select';
import { Card } from '@/components/ui-v2/layout/Card';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Calendar, Clock, Users, CheckCircle, XCircle } from 'lucide-react';
import { formatPhoneForDisplay } from '@/lib/validation';
import Image from 'next/image';

interface PendingBooking {
  id: string;
  token: string;
  event_id: string;
  mobile_number: string;
  customer_id: string | null;
  expires_at: string;
  confirmed_at: string | null;
  event: {
    id: string;
    name: string;
    date: string;
    time: string;
    capacity: number;
    hero_image_url?: string | null;
    thumbnail_image_url?: string | null;
  } | null;
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

export default function BookingConfirmationPage() {
  const params = useParams();
  const router = useRouter();
  const rawToken = params?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken ?? null;
  
  const [loading, setLoading] = useState(true);
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  const [customerDetails, setCustomerDetails] = useState({
    first_name: '',
    last_name: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  const loadPendingBooking = useCallback(async () => {
    if (!token) {
      setError('Invalid or expired booking link');
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      
      // First, fetch the pending booking without joins to avoid the .single() error
      const { data: pendingBookingData, error: pendingError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('token', token)
        .single();

      if (pendingError) {
        console.error('Error loading pending booking:', pendingError);
        if (pendingError.code === 'PGRST116') {
          setError('Invalid or expired booking link');
        } else {
          setError(`Database error: ${pendingError.message}`);
        }
        return;
      }
      
      if (!pendingBookingData) {
        console.error('No pending booking found for token:', token);
        setError('Invalid or expired booking link');
        return;
      }
      
      console.log('Loaded pending booking:', pendingBookingData);

      // Check if already confirmed
      if (pendingBookingData.confirmed_at) {
        setError('This booking has already been confirmed');
        return;
      }

      // Check if expired
      if (new Date(pendingBookingData.expires_at) < new Date()) {
        setError('This booking link has expired');
        return;
      }

      // Now fetch the event data separately
      let eventData = null;
      if (pendingBookingData.event_id) {
        const { data: event, error: eventError } = await supabase
          .from('events')
          .select('id, name, date, time, capacity, hero_image_url, thumbnail_image_url')
          .eq('id', pendingBookingData.event_id)
          .single();
        
        if (!eventError && event) {
          eventData = event;
        } else {
          console.error('Error loading event:', eventError);
        }
      }

      // Fetch customer data separately if customer_id exists
      let customerData = null;
      if (pendingBookingData.customer_id) {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('id, first_name, last_name')
          .eq('id', pendingBookingData.customer_id)
          .single();
        
        if (!customerError && customer) {
          customerData = customer;
        } else {
          console.error('Error loading customer:', customerError);
        }
      }

      // Construct the full pending booking object
      const pendingBooking: PendingBooking = {
        id: pendingBookingData.id,
        token: pendingBookingData.token,
        event_id: pendingBookingData.event_id,
        mobile_number: pendingBookingData.mobile_number,
        customer_id: pendingBookingData.customer_id,
        expires_at: pendingBookingData.expires_at,
        confirmed_at: pendingBookingData.confirmed_at,
        event: eventData,
        customer: customerData,
      };

      setPendingBooking(pendingBooking);
      
      // Don't pre-fill customer details for existing customers
      // They can't change their details during booking
    } catch (err) {
      console.error('Error loading pending booking:', err);
      setError('Failed to load booking details');
    } finally {
      setLoading(false);
    }
  }, [token])

  useEffect(() => {
    loadPendingBooking();
  }, [loadPendingBooking]);

  async function confirmBooking() {
    if (!pendingBooking || !token) return;
    
    setConfirming(true);
    setConfirmationError(null);
    
    try {
      const requestBody: { token: string; seats: number; customer?: { first_name: string; last_name: string } } = {
        token,
        seats,
      };
      
      // Only include customer details if they have values
      if (customerDetails.first_name || customerDetails.last_name) {
        requestBody.customer = {
          first_name: customerDetails.first_name,
          last_name: customerDetails.last_name
        };
      }
      
      const response = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to confirm booking');
      }

      setConfirmed(true);
      
      // Redirect to success page after 3 seconds
      setTimeout(() => {
        router.push(`/booking-success/${result.booking_id}`);
      }, 3000);
    } catch (err) {
      console.error('Error confirming booking:', err);
      setConfirmationError(err instanceof Error ? err.message : 'Failed to confirm booking');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar p-4">
          <div className="max-w-2xl mx-auto flex items-center justify-center">
            <Image 
              src="/logo.png" 
              alt="The Anchor" 
              width={80}
              height={80}
            />
          </div>
        </div>
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar p-4 mb-8">
          <div className="max-w-2xl mx-auto flex items-center justify-center">
            <Image 
              src="/logo.png" 
              alt="The Anchor" 
              width={60}
              height={60}
            />
          </div>
        </div>
        <div className="flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Booking Error</h1>
            <p className="text-gray-600">{error}</p>
          </Card>
        </div>
      </div>
    );
  }

  if (!pendingBooking || !pendingBooking.event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar p-4 mb-8">
          <div className="max-w-2xl mx-auto flex items-center justify-center">
            <Image 
              src="/logo.png" 
              alt="The Anchor" 
              width={60}
              height={60}
            />
          </div>
        </div>
        <div className="flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Booking Error</h1>
            <p className="text-gray-600">Invalid booking data</p>
          </Card>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar p-4 mb-8">
          <div className="max-w-2xl mx-auto flex items-center justify-center">
            <Image 
              src="/logo.png" 
              alt="The Anchor" 
              width={60}
              height={60}
            />
          </div>
        </div>
        <div className="flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Booking Confirmed!</h1>
            <p className="text-gray-600 mb-4">
              Your booking for {pendingBooking.event.name} has been confirmed.
            </p>
            <p className="text-sm text-gray-500">
              Redirecting to your booking details...
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const needsCustomerDetails = !pendingBooking.customer_id;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-sidebar p-4 mb-8">
        <div className="max-w-2xl mx-auto flex items-center justify-center">
          <Image 
            src="/logo.png" 
            alt="The Anchor" 
            width={60}
            height={60}
            className="mr-3"
          />
          <h1 className="text-2xl font-bold text-white">The Anchor</h1>
        </div>
      </div>
      <div className="max-w-2xl mx-auto p-4">
        <Card>
          <h1 className="text-2xl font-bold mb-6">
            {pendingBooking.customer ? 
              `Welcome back, ${pendingBooking.customer.first_name}!` : 
              'Confirm Your Booking'}
          </h1>
          
          <div className="space-y-6">
            {/* Event Image */}
            {pendingBooking.event.hero_image_url && (
              <div className="w-full aspect-square relative rounded-lg overflow-hidden">
                <img 
                  src={pendingBooking.event.hero_image_url}
                  alt={pendingBooking.event.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            
            {/* Event Details */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h2 className="text-lg font-semibold">{pendingBooking.event.name}</h2>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span>{new Date(pendingBooking.event.date).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>{pendingBooking.event.time}</span>
                </div>
                
              </div>
            </div>

            {/* Customer Details */}
            {needsCustomerDetails && (
              <div className="space-y-4">
                <h3 className="font-semibold">Your Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormGroup label="First Name" required>
                    <Input
                      type="text"
                      id="first_name"
                      value={customerDetails.first_name}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, first_name: e.target.value }))}
                      required
                    />
                  </FormGroup>
                  <FormGroup label="Last Name" required>
                    <Input
                      type="text"
                      id="last_name"
                      value={customerDetails.last_name}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, last_name: e.target.value }))}
                      required
                    />
                  </FormGroup>
                </div>
                <p className="text-sm text-gray-600">
                  Phone Number: {formatPhoneForDisplay(pendingBooking.mobile_number)}
                </p>
              </div>
            )}
            
            {/* Show existing customer info */}
            {!needsCustomerDetails && pendingBooking.customer && (
              <Alert variant="info">
                <p className="text-sm">
                  Booking for: <span className="font-semibold">{pendingBooking.customer.first_name} {pendingBooking.customer.last_name}</span>
                </p>
                <p className="text-sm mt-1">
                  Phone: {formatPhoneForDisplay(pendingBooking.mobile_number)}
                </p>
              </Alert>
            )}

            {/* Seats Selection */}
            <FormGroup label="Number of Seats">
              <div className="flex items-center gap-4">
                <Users className="h-5 w-5 text-gray-500" />
                <Select
                  id="seats"
                  value={seats.toString()}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => ({
                    value: num.toString(),
                    label: `${num} ${num === 1 ? 'seat' : 'seats'}`
                  }))}
                />
              </div>
            </FormGroup>

            {/* Error Message */}
            {confirmationError && (
              <Alert variant="error">
                {confirmationError}
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={confirmBooking}
                disabled={confirming || (needsCustomerDetails && (!customerDetails.first_name || !customerDetails.last_name))}
                className="flex-1"
                loading={confirming}
              >
                Confirm Booking
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push('/')}
                disabled={confirming}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

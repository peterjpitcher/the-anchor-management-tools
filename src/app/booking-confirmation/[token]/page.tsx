'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Loader2, Calendar, Clock, MapPin, Users, CheckCircle, XCircle } from 'lucide-react';
import { formatPhoneForDisplay } from '@/lib/validation';

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
    location: string;
    capacity: number;
  };
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
  };
}

export default function BookingConfirmationPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  
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

  useEffect(() => {
    loadPendingBooking();
  }, [token]);

  async function loadPendingBooking() {
    try {
      const supabase = createClient();
      
      const { data, error } = await supabase
        .from('pending_bookings')
        .select(`
          *,
          event:events(
            id,
            name,
            date,
            time,
            capacity
          ),
          customer:customers(
            id,
            first_name,
            last_name
          )
        `)
        .eq('token', token)
        .single();

      if (error || !data) {
        setError('Invalid or expired booking link');
        return;
      }

      // Check if already confirmed
      if (data.confirmed_at) {
        setError('This booking has already been confirmed');
        return;
      }

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        setError('This booking link has expired');
        return;
      }

      setPendingBooking(data as PendingBooking);
      
      // Pre-fill customer details if they exist
      if (data.customer) {
        setCustomerDetails({
          first_name: data.customer.first_name,
          last_name: data.customer.last_name,
        });
      }
    } catch (err) {
      console.error('Error loading pending booking:', err);
      setError('Failed to load booking details');
    } finally {
      setLoading(false);
    }
  }

  async function confirmBooking() {
    if (!pendingBooking) return;
    
    setConfirming(true);
    setConfirmationError(null);
    
    try {
      const response = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          seats,
          first_name: customerDetails.first_name,
          last_name: customerDetails.last_name,
        }),
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Booking Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!pendingBooking) {
    return null;
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Booking Confirmed!</h1>
          <p className="text-gray-600 mb-4">
            Your booking for {pendingBooking.event.name} has been confirmed.
          </p>
          <p className="text-sm text-gray-500">
            Redirecting to your booking details...
          </p>
        </div>
      </div>
    );
  }

  const needsCustomerDetails = !pendingBooking.customer_id;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h1 className="text-2xl font-bold mb-6">Confirm Your Booking</h1>
          
          <div className="space-y-6">
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
                  <div>
                    <label htmlFor="first_name" className="block text-sm font-medium mb-1">
                      First Name
                    </label>
                    <input
                      type="text"
                      id="first_name"
                      value={customerDetails.first_name}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, first_name: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-md"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="last_name" className="block text-sm font-medium mb-1">
                      Last Name
                    </label>
                    <input
                      type="text"
                      id="last_name"
                      value={customerDetails.last_name}
                      onChange={(e) => setCustomerDetails(prev => ({ ...prev, last_name: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-md"
                      required
                    />
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Phone Number: {formatPhoneForDisplay(pendingBooking.mobile_number)}
                </p>
              </div>
            )}

            {/* Seats Selection */}
            <div className="space-y-2">
              <label htmlFor="seats" className="block font-semibold">
                Number of Seats
              </label>
              <div className="flex items-center gap-4">
                <Users className="h-5 w-5 text-gray-500" />
                <select
                  id="seats"
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  className="px-3 py-2 border rounded-md"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                    <option key={num} value={num}>{num} {num === 1 ? 'seat' : 'seats'}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Error Message */}
            {confirmationError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                {confirmationError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={confirmBooking}
                disabled={confirming || (needsCustomerDetails && (!customerDetails.first_name || !customerDetails.last_name))}
                className="flex-1"
              >
                {confirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  'Confirm Booking'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/')}
                disabled={confirming}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
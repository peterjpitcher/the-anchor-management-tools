'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircleIcon, CalendarIcon, ClockIcon, UserGroupIcon, CurrencyPoundIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui-v2/layout/Card';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { format } from 'date-fns';

interface BookingDetails {
  booking_reference: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  customer_name: string;
  deposit_amount: number;
  outstanding_amount: number;
}

function BookingSuccessContent() {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reference) {
      loadBookingDetails();
    } else {
      setError('No booking reference provided');
      setLoading(false);
    }
  }, [reference]);

  async function loadBookingDetails() {
    try {
      const response = await fetch(`/api/table-bookings/${reference}/public`);
      const data = await response.json();

      if (!response.ok || data.error) {
        setError('Unable to load booking details');
        setLoading(false);
        return;
      }

      // Extract deposit info from items
      const depositAmount = data.party_size * 5;
      const totalAmount = data.items?.reduce(
        (sum: number, item: any) => sum + (item.price_at_booking * item.quantity), 
        0
      ) || 0;

      setBooking({
        booking_reference: data.booking_reference,
        booking_date: data.booking_date,
        booking_time: data.booking_time,
        party_size: data.party_size,
        customer_name: data.customer_name,
        deposit_amount: depositAmount,
        outstanding_amount: totalAmount - depositAmount
      });
      setLoading(false);
    } catch (err) {
      console.error('Error loading booking:', err);
      setError('Unable to load booking details');
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <Alert variant="error" title="Error">
            {error || 'Unable to load booking details'}
          </Alert>
        </Card>
      </div>
    );
  }

  // Format time to 12-hour format
  const formatTime = (time24: string) => {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'pm' : 'am';
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return minutes === 0 ? `${hours12}${period}` : `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircleIcon className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Payment Successful!</h1>
          <p className="mt-2 text-gray-600">Your deposit has been received</p>
        </div>

        <Card className="mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Booking Confirmation</h2>
            <p className="text-gray-600 mb-4">
              Thank you, {booking.customer_name}. Your Sunday lunch booking has been confirmed.
            </p>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-gray-500 mb-1">Booking Reference</p>
              <p className="text-lg font-mono font-semibold">{booking.booking_reference}</p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center text-gray-600">
                <CalendarIcon className="h-5 w-5 mr-3" />
                <span>{format(new Date(booking.booking_date), 'EEEE, MMMM d, yyyy')}</span>
              </div>
              
              <div className="flex items-center text-gray-600">
                <ClockIcon className="h-5 w-5 mr-3" />
                <span>{formatTime(booking.booking_time)}</span>
              </div>
              
              <div className="flex items-center text-gray-600">
                <UserGroupIcon className="h-5 w-5 mr-3" />
                <span>{booking.party_size} {booking.party_size === 1 ? 'guest' : 'guests'}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Payment Details</h2>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit Paid</span>
                <span className="font-medium text-green-600">£{booking.deposit_amount.toFixed(2)}</span>
              </div>
              
              {booking.outstanding_amount > 0 && (
                <>
                  <div className="border-t pt-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Balance Due at Venue</span>
                      <span className="font-medium">£{booking.outstanding_amount.toFixed(2)}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Please pay the remaining balance when you arrive
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">What Happens Next?</h2>
            
            <ul className="space-y-3 text-gray-600">
              <li className="flex">
                <span className="text-green-600 mr-2">✓</span>
                <span>You'll receive a confirmation text message shortly</span>
              </li>
              <li className="flex">
                <span className="text-green-600 mr-2">✓</span>
                <span>We'll send you a reminder the day before</span>
              </li>
              <li className="flex">
                <span className="text-green-600 mr-2">✓</span>
                <span>Simply give your name or booking reference when you arrive</span>
              </li>
            </ul>
            
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Need to make changes?</strong><br />
                Call us at {process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'}
              </p>
            </div>
          </div>
        </Card>

        <div className="text-center mt-8">
          <p className="text-gray-600">
            We look forward to seeing you for Sunday lunch!
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TableBookingSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    }>
      <BookingSuccessContent />
    </Suspense>
  );
}
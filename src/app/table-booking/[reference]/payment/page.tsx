'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CurrencyPoundIcon, CalendarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { format } from 'date-fns';

interface TableBooking {
  id: string;
  booking_reference: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  status: string;
  booking_type: string;
  total_amount?: number;
  customer: {
    first_name: string;
    last_name: string;
  };
  table_booking_items: Array<{
    quantity: number;
    price_at_booking: number;
  }>;
}

export default function TableBookingPaymentPage(props: { params: Promise<{ reference: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const [booking, setBooking] = useState<TableBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBooking();
  }, [params.reference]);

  async function loadBooking() {
    try {
      const supabase = createClient();
      
      // Find booking by reference
      const { data, error } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*),
          table_booking_items(*)
        `)
        .eq('booking_reference', params.reference)
        .single();

      if (error || !data) {
        setError('Booking not found. Please check your booking reference.');
        setLoading(false);
        return;
      }

      // Check if payment is required
      if (data.status !== 'pending_payment') {
        if (data.status === 'confirmed') {
          setError('This booking has already been paid and confirmed.');
        } else {
          setError('This booking does not require payment at this time.');
        }
        setLoading(false);
        return;
      }

      setBooking(data);
      setLoading(false);
    } catch (err) {
      console.error('Error loading booking:', err);
      setError('Unable to load booking details. Please try again later.');
      setLoading(false);
    }
  }

  const handlePayment = async () => {
    if (!booking) return;
    
    setProcessing(true);
    // Redirect to payment API endpoint
    window.location.href = `/api/table-bookings/payment/create?booking_id=${booking.id}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <Alert variant="error" title="Payment Error">
            {error}
          </Alert>
        </Card>
      </div>
    );
  }

  if (!booking) {
    return null;
  }

  // Calculate amounts
  const totalAmount = booking.table_booking_items.reduce(
    (sum, item) => sum + (item.price_at_booking * item.quantity), 
    0
  );
  const depositAmount = booking.party_size * 5;
  const outstandingAmount = totalAmount - depositAmount;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Complete Your Booking</h1>
          <p className="mt-2 text-gray-600">Secure your Sunday lunch reservation</p>
        </div>

        <Card className="mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Booking Details</h2>
            
            <div className="space-y-3">
              <div className="flex items-center text-gray-600">
                <CalendarIcon className="h-5 w-5 mr-3" />
                <span>{format(new Date(booking.booking_date), 'EEEE, MMMM d, yyyy')}</span>
              </div>
              
              <div className="flex items-center text-gray-600">
                <ClockIcon className="h-5 w-5 mr-3" />
                <span>{booking.booking_time}</span>
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
            <h2 className="text-xl font-semibold mb-4">Payment Summary</h2>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Amount</span>
                <span className="font-medium">£{totalAmount.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit Required (£5 per person)</span>
                <span className="font-medium text-green-600">£{depositAmount.toFixed(2)}</span>
              </div>
              
              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Remaining Balance</span>
                  <span className="text-gray-500">£{outstandingAmount.toFixed(2)}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">To be paid at the venue</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="text-center">
          <Button
            variant="primary"
            size="lg"
            onClick={handlePayment}
            loading={processing}
            disabled={processing}
            leftIcon={<CurrencyPoundIcon className="h-5 w-5" />}
          >
            Pay Deposit £{depositAmount.toFixed(2)}
          </Button>
          
          <p className="mt-4 text-sm text-gray-500">
            You will be redirected to PayPal to complete your payment securely
          </p>
        </div>
      </div>
    </div>
  );
}
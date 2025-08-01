'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CurrencyPoundIcon, CalendarIcon, ClockIcon, UserGroupIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import { Button } from '@/components/ui-v2/forms/Button';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { format } from 'date-fns';
import { createTableBookingPayment } from '@/app/actions/table-booking-payment';

interface BookingItem {
  custom_item_name: string;
  quantity: number;
  price_at_booking: number;
  special_requests?: string;
  guest_name?: string;
}

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
  table_booking_items: BookingItem[];
}

export default function TableBookingPaymentPage(props: { params: Promise<{ reference: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [booking, setBooking] = useState<TableBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  
  // Check for cancellation or errors
  const wasCancelled = searchParams.get('cancelled') === 'true';
  const errorParam = searchParams.get('error');
  const errorMessage = searchParams.get('message');

  useEffect(() => {
    loadBooking();
    // Set error from URL parameters if present
    if (errorParam && errorMessage) {
      setError(decodeURIComponent(errorMessage));
    }
  }, [params.reference, errorParam, errorMessage]);

  async function loadBooking() {
    try {
      // Use public API endpoint to fetch booking
      const response = await fetch(`/api/table-bookings/${params.reference}/public`);
      const data = await response.json();

      if (!response.ok || data.error) {
        setError('Booking not found. Please check your booking reference.');
        setLoading(false);
        return;
      }

      // Check if payment is required
      if (!data.requires_payment) {
        if (data.status === 'confirmed') {
          setError('This booking has already been paid and confirmed.');
        } else {
          setError('This booking does not require payment at this time.');
        }
        setLoading(false);
        return;
      }

      // Transform the data to match our interface
      const booking: TableBooking = {
        id: data.id,
        booking_reference: data.booking_reference,
        booking_date: data.booking_date,
        booking_time: data.booking_time,
        party_size: data.party_size,
        status: data.status,
        booking_type: data.booking_type,
        customer: {
          first_name: data.customer_name.split(' ')[0],
          last_name: data.customer_name.split(' ').slice(1).join(' ')
        },
        table_booking_items: data.items || []
      };

      setBooking(booking);
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
    setPaymentError(null);
    
    try {
      // Create payment using server action
      const result = await createTableBookingPayment(booking.id);
      
      if (result.error) {
        setPaymentError(result.error);
        setProcessing(false);
        return;
      }
      
      if (result.approveUrl) {
        // Redirect to PayPal
        window.location.href = result.approveUrl;
      } else {
        setPaymentError('Unable to create payment link. Please try again.');
        setProcessing(false);
      }
    } catch (err) {
      console.error('Payment error:', err);
      setPaymentError('An unexpected error occurred. Please try again.');
      setProcessing(false);
    }
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
    <div className="min-h-screen bg-white">
      {/* Header with branding */}
      <div className="bg-[#005131] px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <Image
            src="/logo.png"
            alt="The Anchor"
            width={150}
            height={75}
            className="object-contain"
            priority
          />
        </div>
      </div>
      
      <div className="px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Complete Your Booking</h2>
            <p className="mt-2 text-gray-600">Secure your Sunday lunch reservation</p>
          </div>
        
        {wasCancelled && (
          <Alert variant="warning" className="mb-6">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <div>
              <h3 className="font-semibold">Payment Cancelled</h3>
              <p>You cancelled the payment process. You can try again when you're ready.</p>
            </div>
          </Alert>
        )}
        
        {paymentError && (
          <Alert variant="error" className="mb-6">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <div>
              <h3 className="font-semibold">Payment Error</h3>
              <p>{paymentError}</p>
              {paymentError.includes('contact support') && (
                <p className="mt-2 text-sm">
                  Please call us at {process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707'}
                </p>
              )}
            </div>
          </Alert>
        )}

        <Card className="mb-6 border-2 border-[#005131]">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4 text-[#005131]">Booking Details</h2>
            
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

        {/* Order details */}
        <Card className="mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4 text-[#005131]">Your Order</h2>
            <div className="space-y-3">
              {booking.table_booking_items.map((item, index) => (
                <div key={index} className="border-b border-gray-100 pb-3 last:border-0">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium">
                        {item.quantity}x {item.custom_item_name}
                      </p>
                      {item.guest_name && (
                        <p className="text-sm text-gray-600">For: {item.guest_name}</p>
                      )}
                      {item.special_requests && (
                        <p className="text-sm text-gray-600 italic">Note: {item.special_requests}</p>
                      )}
                    </div>
                    <p className="font-medium text-[#005131]">£{(item.price_at_booking * item.quantity).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="mb-6">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4 text-[#005131]">Payment Summary</h2>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Amount</span>
                <span className="font-medium">£{totalAmount.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit Required (£5 per person)</span>
                <span className="font-medium text-[#005131]">£{depositAmount.toFixed(2)}</span>
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
          <button
            onClick={handlePayment}
            disabled={processing}
            className="bg-[#005131] hover:bg-[#004028] text-white font-semibold py-4 px-8 rounded-lg flex items-center justify-center w-full sm:w-auto mx-auto disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {processing ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating secure payment...
              </>
            ) : (
              <>
                <CurrencyPoundIcon className="h-5 w-5 mr-2" />
                Pay Deposit £{depositAmount.toFixed(2)}
              </>
            )}
          </button>
          
          <p className="mt-4 text-sm text-gray-500">
            You will be redirected to PayPal to complete your payment securely
          </p>
          
          <div className="mt-6 text-sm text-gray-600">
            <p className="font-semibold">Having trouble?</p>
            <p>Call us at <a href="tel:01753682707" className="text-[#005131] font-semibold">01753 682707</a></p>
          </div>
        </div>
        
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ</p>
        </div>
      </div>
    </div>
    </div>
  );
}
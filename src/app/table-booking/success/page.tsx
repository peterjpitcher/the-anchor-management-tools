'use client';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircleIcon, CalendarIcon, ClockIcon, UserGroupIcon, ArrowTopRightOnSquareIcon, CameraIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import { Card } from '@/components/ui-v2/layout/Card';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { format } from 'date-fns';

interface BookingItem {
  custom_item_name: string;
  quantity: number;
  price_at_booking: number;
  special_requests?: string;
  guest_name?: string;
}

interface BookingDetails {
  booking_reference: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  deposit_amount: number;
  outstanding_amount: number;
  items: BookingItem[];
}

function BookingSuccessContent() {
  const searchParams = useSearchParams();
  const reference = searchParams?.get('reference');
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookingDetails = useCallback(async () => {
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
      const totalAmount = (data.items as BookingItem[] | undefined)?.reduce(
        (sum: number, item: BookingItem) => sum + (item.price_at_booking * item.quantity), 
        0
      ) || 0;

      setBooking({
        booking_reference: data.booking_reference,
        booking_date: data.booking_date,
        booking_time: data.booking_time,
        party_size: data.party_size,
        deposit_amount: depositAmount,
        outstanding_amount: totalAmount - depositAmount,
        items: data.items || []
      });
      setLoading(false);
    } catch (err) {
      console.error('Error loading booking:', err);
      setError('Unable to load booking details');
      setLoading(false);
    }
  }, [reference])

  useEffect(() => {
    if (reference) {
      loadBookingDetails();
    } else {
      setError('No booking reference provided');
      setLoading(false);
    }
  }, [reference, loadBookingDetails]);

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
    <div className="min-h-screen bg-white">
      {/* Header with branding */}
      <div className="bg-[#005131] px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="relative">
            <Image
              src="/logo.png"
              alt="The Anchor"
              width={150}
              height={75}
              className="object-contain h-auto w-auto max-w-[150px]"
              priority
            />
          </div>
          <a 
            href="https://www.the-anchor.pub" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center text-sm text-white underline hover:no-underline"
          >
            Visit Website
            <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-1" />
          </a>
        </div>
      </div>

      {/* Success banner */}
      <div className="bg-green-50 border-b border-green-200 px-4 py-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-3">
            <CheckCircleIcon className="h-10 w-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Payment Successful!</h2>
          <p className="text-gray-600 mt-1">Your Sunday lunch is confirmed</p>
        </div>
      </div>

      {/* Screenshot reminder - mobile optimized */}
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center text-blue-800">
          <CameraIcon className="h-5 w-5 mr-2 flex-shrink-0" />
          <p className="text-sm font-medium">Please screenshot this page for your records</p>
        </div>
      </div>

      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Booking details - most important info first */}
          <Card className="border-2 border-[#005131]">
            <div className="p-4">
              <div className="text-center mb-4">
                <p className="text-sm text-gray-500">Booking Reference</p>
                <p className="text-2xl font-bold font-mono text-[#005131]">{booking.booking_reference}</p>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <CalendarIcon className="h-6 w-6 mx-auto mb-1 text-[#005131]" />
                  <p className="text-xs text-gray-500">Date</p>
                  <p className="font-semibold text-sm">{format(new Date(booking.booking_date), 'EEE, MMM d')}</p>
                </div>
                <div>
                  <ClockIcon className="h-6 w-6 mx-auto mb-1 text-[#005131]" />
                  <p className="text-xs text-gray-500">Time</p>
                  <p className="font-semibold text-sm">{formatTime(booking.booking_time)}</p>
                </div>
                <div>
                  <UserGroupIcon className="h-6 w-6 mx-auto mb-1 text-[#005131]" />
                  <p className="text-xs text-gray-500">Guests</p>
                  <p className="font-semibold text-sm">{booking.party_size}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Order details */}
          <Card>
            <div className="p-4">
              <h3 className="font-semibold text-[#005131] mb-3">Your Order</h3>
              <div className="space-y-2">
                {booking.items.map((item, index) => (
                  <div key={index} className="border-b border-gray-100 pb-2 last:border-0">
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

          {/* Payment summary */}
          <Card>
            <div className="p-4">
              <h3 className="font-semibold text-[#005131] mb-3">Payment Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Deposit Paid</span>
                  <span className="font-semibold text-green-600">£{booking.deposit_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Balance Due</span>
                  <span className="font-semibold">£{booking.outstanding_amount.toFixed(2)}</span>
                </div>
                <div className="text-sm text-gray-600 pt-2 border-t">
                  <p>• Balance payable at the venue</p>
                  <p>• We accept cash or card</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Contact info */}
          <Card className="bg-gray-50">
            <div className="p-4">
              <h3 className="font-semibold text-[#005131] mb-2">Need to make changes?</h3>
              <p className="text-sm">
                Call us at <a href="tel:01753682707" className="font-semibold text-[#005131]">01753 682707</a>
              </p>
              <p className="text-xs text-gray-600 mt-1">
                The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ
              </p>
            </div>
          </Card>

          {/* Desktop only - additional info */}
          <div className="hidden sm:block space-y-4">
            <Card>
              <div className="p-4">
                <h3 className="font-semibold text-[#005131] mb-3">What Happens Next?</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-green-600 mr-2">✓</span>
                    <span>You&apos;ll receive a confirmation text message shortly</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-600 mr-2">✓</span>
                    <span>We&apos;ll send you a reminder the day before</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-600 mr-2">✓</span>
                    <span>Simply give your name or booking reference when you arrive</span>
                  </li>
                </ul>
              </div>
            </Card>
          </div>

          <div className="text-center py-4">
            <p className="text-gray-600">We look forward to seeing you!</p>
          </div>
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

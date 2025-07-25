'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, addDays } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { updateTableBooking } from '@/app/actions/table-bookings';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { TableBooking } from '@/types/table-bookings';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { Card } from '@/components/ui-v2/layout/Card';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
interface TimeSlot {
  time: string;
  available_capacity: number;
  requires_prepayment: boolean;
}

export default function EditTableBookingPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [booking, setBooking] = useState<TableBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [bookingDate, setBookingDate] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [dietaryRequirements, setDietaryRequirements] = useState('');
  const [allergies, setAllergies] = useState('');
  const [celebrationType, setCelebrationType] = useState('');

  const canEdit = hasPermission('table_bookings', 'edit');

  useEffect(() => {
    if (canEdit) {
      loadBooking();
    }
  }, [params.id, canEdit]);

  useEffect(() => {
    if (bookingDate && partySize && booking) {
      // Only check availability if date or party size changed
      if (bookingDate !== booking.booking_date || partySize !== booking.party_size) {
        checkBookingAvailability();
      }
    }
  }, [bookingDate, partySize]);

  async function loadBooking() {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*),
          table_booking_items(*)
        `)
        .eq('id', params.id)
        .single();

      if (error) throw error;
      
      setBooking(data);
      
      // Initialize form with booking data
      setBookingDate(data.booking_date);
      setPartySize(data.party_size);
      setSelectedTime(data.booking_time);
      setSpecialRequirements(data.special_requirements || '');
      setDietaryRequirements(data.dietary_requirements?.join(', ') || '');
      setAllergies(data.allergies?.join(', ') || '');
      setCelebrationType(data.celebration_type || '');
      
      // Set initial available slots with current time
      setAvailableSlots([{
        time: data.booking_time,
        available_capacity: 100, // Dummy capacity for current slot
        requires_prepayment: data.booking_type === 'sunday_lunch'
      }]);
    } catch (err: any) {
      console.error('Error loading booking:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function checkBookingAvailability() {
    if (!booking) return;
    
    try {
      setCheckingAvailability(true);
      setError(null);
      
      const result = await checkAvailability(bookingDate, partySize, booking.booking_type);
      
      if (result.error) {
        setError(result.error);
        // Keep current time slot even if no others available
        setAvailableSlots([{
          time: booking.booking_time,
          available_capacity: 100,
          requires_prepayment: booking.booking_type === 'sunday_lunch'
        }]);
      } else if (result.data) {
        const slots = result.data.time_slots;
        
        // Always include current booking time in available slots
        const hasCurrentTime = slots.some(slot => slot.time === booking.booking_time);
        if (!hasCurrentTime) {
          slots.push({
            time: booking.booking_time,
            available_capacity: 100,
            requires_prepayment: booking.booking_type === 'sunday_lunch'
          });
          slots.sort((a, b) => a.time.localeCompare(b.time));
        }
        
        setAvailableSlots(slots);
        
        if (result.data.special_notes) {
          setError(result.data.special_notes);
        }
      }
    } catch (err: any) {
      console.error('Availability check error:', err);
      setError('Failed to check availability');
    } finally {
      setCheckingAvailability(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!booking || !selectedTime) {
      setError('Please select a time slot');
      return;
    }
    
    try {
      setSubmitting(true);
      setError(null);
      
      // Prepare update data
      const updates: any = {
        booking_date: bookingDate,
        booking_time: selectedTime,
        party_size: partySize,
      };
      
      // Optional fields
      if (specialRequirements !== undefined) updates.special_requirements = specialRequirements || null;
      if (dietaryRequirements) {
        updates.dietary_requirements = dietaryRequirements.split(',').map(s => s.trim()).filter(s => s);
      } else {
        updates.dietary_requirements = [];
      }
      if (allergies) {
        updates.allergies = allergies.split(',').map(s => s.trim()).filter(s => s);
      } else {
        updates.allergies = [];
      }
      if (celebrationType !== undefined) updates.celebration_type = celebrationType || null;
      
      const result = await updateTableBooking(booking.id, updates);
      
      if (result.error) {
        setError(result.error);
      } else {
        // Success - redirect to booking details
        router.push(`/table-bookings/${booking.id}`);
      }
    } catch (err: any) {
      console.error('Booking update error:', err);
      setError('Failed to update booking');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canEdit) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Edit Booking"
          subtitle="Update booking details"
          backButton={{
            label: "Back to Bookings",
            href: "/table-bookings"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" 
              title="Access Denied" 
              description="You do not have permission to edit bookings." 
            />
          </Card>
        </PageContent>
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Edit Booking"
          subtitle="Update booking details"
          backButton={{
            label: "Back to Bookings",
            href: "/table-bookings"
          }}
        />
        <PageContent>
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" />
          </div>
        </PageContent>
      </PageWrapper>
    );
  }

  if (error && !booking) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Edit Booking"
          subtitle="Update booking details"
          backButton={{
            label: "Back to Bookings",
            href: "/table-bookings"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" title="Error" description={error} />
          </Card>
        </PageContent>
      </PageWrapper>
    );
  }

  if (!booking) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Edit Booking"
          subtitle="Update booking details"
          backButton={{
            label: "Back to Bookings",
            href: "/table-bookings"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" 
              title="Booking not found" 
              description="The requested booking could not be found." 
            />
          </Card>
        </PageContent>
      </PageWrapper>
    );
  }

  const isPast = new Date(`${booking.booking_date}T${booking.booking_time}`) < new Date();
  const canEditDateTime = !isPast && booking.status === 'confirmed';

  return (
    <PageWrapper>
      <PageHeader 
        title={`Edit Booking ${booking.booking_reference}`}
        subtitle={`${booking.customer?.first_name} ${booking.customer?.last_name} • ${booking.customer?.mobile_number}`}
        backButton={{
          label: "Back to Booking Details",
          href: `/table-bookings/${booking.id}`
        }}
      />
      <PageContent>
        <div className="max-w-3xl mx-auto">
          {error && (
            <Alert variant="error" description={error} className="mb-4" />
          )}

          {booking.status !== 'confirmed' && (
            <Alert 
              variant="warning" 
              description={`Only confirmed bookings can be edited. This booking is currently ${booking.status}.`}
              className="mb-4"
            />
          )}

          {isPast && (
            <Alert 
              variant="info" 
              description="Past bookings cannot be edited."
              className="mb-4"
            />
          )}

          <Card>
            <form onSubmit={handleSubmit} className="space-y-6">
        {/* Date and Party Size */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
              min={format(new Date(), 'yyyy-MM-dd')}
              max={format(addDays(new Date(), 56), 'yyyy-MM-dd')}
              required
              disabled={!canEditDateTime}
              className="w-full border rounded-md px-3 py-2 disabled:bg-gray-100"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Party Size
            </label>
            <input
              type="number"
              value={partySize}
              onChange={(e) => setPartySize(parseInt(e.target.value))}
              min={1}
              max={20}
              required
              disabled={!canEditDateTime}
              className="w-full border rounded-md px-3 py-2 disabled:bg-gray-100"
            />
          </div>
        </div>

        {/* Time Slots */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Time Slot
          </label>
          {!canEditDateTime ? (
            <p className="text-gray-600">{selectedTime}</p>
          ) : checkingAvailability ? (
            <div className="flex items-center gap-2 text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking availability...
            </div>
          ) : availableSlots.length === 0 ? (
            <p className="text-gray-500">No available slots for this date</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {availableSlots.map((slot) => (
                <label
                  key={slot.time}
                  className={`border rounded-md p-2 text-center cursor-pointer transition-colors ${
                    selectedTime === slot.time
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'hover:bg-gray-50'
                  } ${slot.time === booking.booking_time ? 'ring-2 ring-green-500' : ''}`}
                >
                  <input
                    type="radio"
                    value={slot.time}
                    checked={selectedTime === slot.time}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    className="sr-only"
                  />
                  <div>{slot.time}</div>
                  <div className="text-xs opacity-75">
                    {slot.available_capacity} seats
                  </div>
                  {slot.time === booking.booking_time && (
                    <div className="text-xs text-green-600 dark:text-green-400">Current</div>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Additional Details */}
        <div className="border-t pt-6">
          <h2 className="text-lg font-medium mb-4">Additional Details</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Special Requirements
              </label>
              <textarea
                value={specialRequirements}
                onChange={(e) => setSpecialRequirements(e.target.value)}
                rows={2}
                placeholder="Window table, high chair needed, etc."
                className="w-full border rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dietary Requirements
              </label>
              <input
                type="text"
                value={dietaryRequirements}
                onChange={(e) => setDietaryRequirements(e.target.value)}
                placeholder="Vegetarian, Vegan, Gluten-free (comma separated)"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allergies
              </label>
              <input
                type="text"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Nuts, Shellfish, Dairy (comma separated)"
                className="w-full border rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Celebration Type
              </label>
              <select
                value={celebrationType}
                onChange={(e) => setCelebrationType(e.target.value)}
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="">None</option>
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="engagement">Engagement</option>
                <option value="other">Other Celebration</option>
              </select>
            </div>
          </div>
        </div>

              {/* Submit Buttons */}
              <div className="border-t pt-6 flex gap-4">
                <Button
                  type="submit"
                  disabled={submitting || !selectedTime || checkingAvailability || booking.status !== 'confirmed'}
                  variant="primary"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Update Booking
                </Button>
                
                <LinkButton
                  href={`/table-bookings/${booking.id}`}
                  variant="secondary"
                >
                  Cancel
                </LinkButton>
              </div>
            </form>
          </Card>
        </div>
      </PageContent>
    </PageWrapper>
  );
}
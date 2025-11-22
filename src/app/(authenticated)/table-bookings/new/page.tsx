'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, addDays } from 'date-fns';
import { createTableBooking } from '@/app/actions/table-bookings';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Form } from '@/components/ui-v2/forms/Form';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { toast } from '@/components/ui-v2/feedback/Toast';
interface TimeSlot {
  time: string;
  available_capacity: number;
  requires_prepayment: boolean;
}

interface SundayLunchMenuOption {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  dietary_info: string[];
  allergens: string[];
  included?: boolean;
}

type SundayLunchMenuData = {
  menuDate: string;
  mains: SundayLunchMenuOption[];
  sides: SundayLunchMenuOption[];
  cutoffTime: string | null;
};

type SundayLunchGuestSelection = {
  guest_name: string;
  main_course_id: string;
  extra_side_ids: string[];
};

function getNextSunday(fromDate: Date = new Date()): Date {
  const baseDate = new Date(fromDate);
  const dayOfWeek = baseDate.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  baseDate.setDate(baseDate.getDate() + daysUntilSunday);
  baseDate.setHours(0, 0, 0, 0);
  return baseDate;
}

function resolveMenuDate(dateString?: string): Date {
  if (!dateString) {
    return getNextSunday();
  }

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return getNextSunday();
  }

  if (parsed.getDay() === 0) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  return getNextSunday(parsed);
}

export default function NewTableBookingPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityNotice, setAvailabilityNotice] = useState<string | null>(null);
  
  // Form state
  const [bookingType, setBookingType] = useState<'regular' | 'sunday_lunch'>('regular');
  const [bookingDate, setBookingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [partySize, setPartySize] = useState(2);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [menuData, setMenuData] = useState<SundayLunchMenuData | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cashPaymentReceived, setCashPaymentReceived] = useState(false);
  
  // Sunday lunch menu state
  const [sundayLunchItems, setSundayLunchItems] = useState<SundayLunchGuestSelection[]>([]);
  const includedSideOptions = useMemo(
    () => (menuData?.sides || []).filter((item) => item.included),
    [menuData]
  );
  const extraSideOptions = useMemo(
    () => (menuData?.sides || []).filter((item) => !item.included && item.price > 0),
    [menuData]
  );
  const sundayLunchCutoffDisplay = useMemo(() => {
    if (!menuData?.cutoffTime) {
      return null;
    }
    try {
      return format(new Date(menuData.cutoffTime), 'EEEE d MMM yyyy, h:mmaaa');
    } catch (err) {
      console.error('Failed to format Sunday lunch cutoff time:', err);
      return null;
    }
  }, [menuData]);
  
  // Customer state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [existingCustomer, setExistingCustomer] = useState<any>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [smsOptIn, setSmsOptIn] = useState(true);
  
  // Booking details
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [dietaryRequirements, setDietaryRequirements] = useState('');
  const [allergies, setAllergies] = useState('');
  const [celebrationType, setCelebrationType] = useState('');

  const canCreate = hasPermission('table_bookings', 'create');

  // Calculate Sunday lunch total based on selections
  function calculateSundayLunchTotal(): string {
    if (!menuData) {
      return '0.00';
    }

    const mainsById = new Map(menuData.mains.map((item) => [item.id, item]));
    const extrasById = new Map(
      menuData.sides
        .filter((item) => !item.included && item.price > 0)
        .map((item) => [item.id, item])
    );

    let total = 0;
    
    sundayLunchItems.forEach(item => {
      const selectedMain = mainsById.get(item.main_course_id);
      if (selectedMain) {
        total += selectedMain.price;
      }

      item.extra_side_ids.forEach((sideId) => {
        const side = extrasById.get(sideId);
        if (side) {
          total += side.price;
        }
      });
    });
    
    return total.toFixed(2);
  }

  useEffect(() => {
    if (!bookingDate || Number.isNaN(partySize) || partySize < 1) {
      setAvailableSlots([]);
      setSelectedTime('');
      setAvailabilityNotice(null);
      return;
    }

    checkBookingAvailability();
  }, [bookingDate, partySize, bookingType]);

  // Initialize Sunday lunch items when party size changes
  useEffect(() => {
    if (
      bookingType !== 'sunday_lunch' ||
      Number.isNaN(partySize) ||
      partySize < 1
    ) {
      setSundayLunchItems([]);
      return;
    }

    setSundayLunchItems((prev) => {
      const next = Array.from({ length: partySize }, (_, index) => {
        const existing = prev[index];
        if (existing) {
          return { ...existing };
        }
        return {
          guest_name: `Guest ${index + 1}`,
          main_course_id: '',
          extra_side_ids: [],
        };
      });

      return next;
    });
  }, [partySize, bookingType]);

  useEffect(() => {
    if (phoneNumber.length >= 10) {
      searchCustomer();
    } else {
      setExistingCustomer(null);
      setFirstName('');
      setLastName('');
      setEmail('');
    }
  }, [phoneNumber]);

  useEffect(() => {
    if (bookingType !== 'sunday_lunch') {
      setMenuData(null);
      setMenuError(null);
      setMenuLoading(false);
      return;
    }

    let isActive = true;

    async function loadMenu() {
      try {
        setMenuLoading(true);
        setMenuError(null);

        const targetMenuDate = resolveMenuDate(bookingDate);
        const cutoffDate = new Date(targetMenuDate);
        cutoffDate.setDate(targetMenuDate.getDate() - 1);
        cutoffDate.setHours(13, 0, 0, 0);

        const response = await fetch(`/api/table-bookings/menu/sunday-lunch?date=${format(targetMenuDate, 'yyyy-MM-dd')}`);
        const result = await response.json();

        if (!response.ok || result?.success === false) {
          throw new Error(result?.error?.message || 'Failed to load menu');
        }

        if (!isActive) {
          return;
        }

        const menuPayload = result.data;

        setMenuData({
          menuDate: menuPayload.menu_date,
          mains: (menuPayload.mains || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: Number(item.price ?? 0),
            dietary_info: item.dietary_info || [],
            allergens: item.allergens || [],
          })),
          sides: (menuPayload.sides || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: Number(item.price ?? 0),
            dietary_info: item.dietary_info || [],
            allergens: item.allergens || [],
            included: Boolean(item.included),
          })),
          cutoffTime: menuPayload.cutoff_time || cutoffDate.toISOString(),
        });
      } catch (err: any) {
        console.error('Sunday lunch menu load error:', err);
        if (!isActive) {
          return;
        }
        setMenuData(null);
        setMenuError(
          err?.message || 'Failed to load Sunday lunch menu. Please try again.'
        );
      } finally {
        if (isActive) {
          setMenuLoading(false);
        }
      }
    }

    loadMenu();

    return () => {
      isActive = false;
    };
  }, [bookingType, bookingDate]);

  useEffect(() => {
    if (bookingType !== 'sunday_lunch' && cashPaymentReceived) {
      setCashPaymentReceived(false);
    }
  }, [bookingType, cashPaymentReceived]);

  async function checkBookingAvailability() {
    try {
      setCheckingAvailability(true);
      setError(null);
      setAvailabilityNotice(null);
      
      // Validate Sunday lunch bookings
      if (bookingType === 'sunday_lunch') {
        const selectedDay = new Date(bookingDate).getDay();
        if (selectedDay !== 0) { // 0 is Sunday
          setError('Sunday lunch bookings are only available on Sundays');
          setAvailableSlots([]);
          setSelectedTime('');
          return;
        }
      }
      
      const availabilityOptions =
        bookingType === 'sunday_lunch'
          ? { allowSundayLunchCutoffOverride: true }
          : undefined;

      const result = await checkAvailability(
        bookingDate,
        partySize,
        bookingType,
        undefined,
        availabilityOptions
      );
      
      if (result.error) {
        setError(result.error);
        setAvailableSlots([]);
        setSelectedTime('');
      } else if (result.data) {
        setAvailableSlots(result.data.time_slots);
        setAvailabilityNotice(result.data.special_notes || null);
        if (!result.data.time_slots.some(slot => slot.time === selectedTime)) {
          setSelectedTime('');
        }
      }
    } catch (err: any) {
      console.error('Availability check error:', err);
      setError('Failed to check availability');
    } finally {
      setCheckingAvailability(false);
    }
  }

  async function searchCustomer() {
    try {
      const standardizedPhone = formatPhoneForStorage(phoneNumber);
      const phoneVariants = Array.from(
        new Set([
          ...generatePhoneVariants(standardizedPhone),
          standardizedPhone,
        ])
      );
      const orConditions = [
        ...phoneVariants.map((v) => `mobile_number.eq.${v}`),
        `mobile_e164.eq.${standardizedPhone}`,
      ];

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .or(orConditions.join(','))
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('Customer lookup error:', error);
        setExistingCustomer(null);
        return;
      }

      const match = Array.isArray(data) ? data[0] : data;

      if (match) {
        setExistingCustomer(match);
        setFirstName((match as any).first_name);
        setLastName((match as any).last_name);
        setEmail((match as any).email || '');
        setSmsOptIn((match as any).sms_opt_in);
      }
    } catch (err) {
      // No existing customer found
      setExistingCustomer(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!selectedTime) {
      setError('Please select a time slot');
      return;
    }
    if (Number.isNaN(partySize) || partySize < 1) {
      setError('Please enter a valid party size before submitting.');
      return;
    }
    
    let mainsById: Map<string, SundayLunchMenuOption> | null = null;
    let extrasById: Map<string, SundayLunchMenuOption> | null = null;

    // Validate Sunday lunch selections
    if (bookingType === 'sunday_lunch') {
      if (!menuData) {
        setError('Sunday lunch menu is unavailable. Please reload the page.');
        return;
      }

      mainsById = new Map(menuData.mains.map((item) => [item.id, item]));
      extrasById = new Map(
        menuData.sides
          .filter((item) => !item.included && item.price > 0)
          .map((item) => [item.id, item])
      );

      for (let i = 0; i < sundayLunchItems.length; i++) {
        const item = sundayLunchItems[i];
        if (!item.main_course_id || !mainsById.has(item.main_course_id)) {
          setError(`Please select a main course for Guest ${i + 1}`);
          return;
        }

        const invalidExtra = item.extra_side_ids.find(
          (sideId) => !extrasById!.has(sideId)
        );

        if (invalidExtra) {
          setError(
            'An extra side that was selected is no longer available. Please review the Sunday lunch selections.'
          );
          return;
        }
      }
    }
    
    try {
      setSubmitting(true);
      setError(null);
      
      const formData = new FormData();
      
      // Booking data
      formData.append('booking_date', bookingDate);
      formData.append('booking_time', selectedTime);
      formData.append('party_size', partySize.toString());
      formData.append('booking_type', bookingType);
      formData.append('source', 'phone');
      formData.append(
        'cash_payment_received',
        bookingType === 'sunday_lunch' && cashPaymentReceived ? 'true' : 'false'
      );
      
      // Customer data
      if (existingCustomer) {
        formData.append('customer_id', existingCustomer.id);
      } else {
        formData.append('customer_first_name', firstName);
        formData.append('customer_last_name', lastName);
        formData.append('customer_mobile_number', phoneNumber);
        formData.append('customer_email', email);
        formData.append('customer_sms_opt_in', smsOptIn.toString());
      }
      
      // Optional fields
      if (specialRequirements) formData.append('special_requirements', specialRequirements);
      const dietaryList = dietaryRequirements
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (dietaryList.length > 0) {
        formData.append('dietary_requirements', JSON.stringify(dietaryList));
      }

      const allergyList = allergies
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allergyList.length > 0) {
        formData.append('allergies', JSON.stringify(allergyList));
      }
      if (celebrationType) formData.append('celebration_type', celebrationType);
      
      // Sunday lunch menu items
      if (bookingType === 'sunday_lunch' && mainsById && extrasById) {
        const menuItems = sundayLunchItems.flatMap((item, index) => {
          const selections = [];
          const guestLabel = item.guest_name || `Guest ${index + 1}`;

          const selectedMain = mainsById!.get(item.main_course_id);
          if (selectedMain) {
            selections.push({
              custom_item_name: selectedMain.name,
              item_type: 'main',
              quantity: 1,
              guest_name: guestLabel,
              price_at_booking: selectedMain.price,
            });
          }

          item.extra_side_ids.forEach((sideId) => {
            const extra = extrasById!.get(sideId);
            if (extra) {
              selections.push({
                custom_item_name: extra.name,
                item_type: 'extra',
                quantity: 1,
                guest_name: guestLabel,
                price_at_booking: extra.price,
              });
            }
          });

          return selections;
        });

        formData.append('menu_items', JSON.stringify(menuItems));
      }
      
      const result = await createTableBooking(formData);
      
      if (result.error) {
        setError(result.error);
      } else if (result.data?.status === 'pending_payment' && result.data.booking_reference) {
        router.push(`/table-booking/${result.data.booking_reference}/payment`);
      } else if (result.data?.id) {
        router.push(`/table-bookings/${result.data.id}`);
      } else {
        router.push('/table-bookings');
      }
    } catch (err: any) {
      console.error('Booking creation error:', err);
      setError('Failed to create booking');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <PageLayout
        title="New Table Booking"
        subtitle="Create a new restaurant table reservation"
        backButton={{
          label: 'Back to Table Bookings',
          href: '/table-bookings',
        }}
      >
        <Card>
          <Alert
            variant="error"
            title="Access Denied"
            description="You do not have permission to create bookings."
          />
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="New Table Booking"
      subtitle="Create a new restaurant table reservation"
      backButton={{
        label: 'Back to Table Bookings',
        href: '/table-bookings',
      }}
    >
      {error && (
        <Alert variant="error" title="Error" description={error} />
      )}
      {availabilityNotice && !error && (
        <Alert variant="info" title="Availability Notice" description={availabilityNotice} />
      )}

      <Form onSubmit={handleSubmit} className="space-y-6">
        {/* Booking Type */}
        <Card>
          <FormGroup label="Booking Type">
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="regular"
                  checked={bookingType === 'regular'}
                  onChange={(e) => setBookingType(e.target.value as 'regular')}
                  className="mr-2"
                />
                Regular Dining
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="sunday_lunch"
                  checked={bookingType === 'sunday_lunch'}
                  onChange={(e) => setBookingType(e.target.value as 'sunday_lunch')}
                  className="mr-2"
                />
                Sunday Lunch
              </label>
            </div>
            {bookingType === 'sunday_lunch' && (
              <Alert variant="warning" 
                description="Sunday lunch bookings require pre-order at the bar by 1pm on Saturday. Payment required to confirm booking."
                className="mt-2"
              />
            )}
          </FormGroup>
        </Card>

        {/* Date and Party Size */}
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Date">
              <Input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={format(new Date(), 'yyyy-MM-dd')}
                max={format(addDays(new Date(), 56), 'yyyy-MM-dd')}
                required
              />
            </FormGroup>
            
            <FormGroup label="Party Size">
              <Input
                type="number"
                value={Number.isNaN(partySize) ? '' : partySize}
                onChange={(e) => {
                  const nextValue = parseInt(e.target.value, 10);
                  if (Number.isNaN(nextValue)) {
                    setPartySize(Number.NaN);
                  } else {
                    setPartySize(nextValue);
                  }
                }}
                min={1}
                max={20}
                required
              />
            </FormGroup>
          </div>
        </Card>

        {/* Time Slots */}
        <Card>
          <FormGroup label="Time Slot">
            {checkingAvailability ? (
              <div className="flex items-center gap-2 text-gray-600">
                <Spinner size="sm" />
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
                    }`}
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
                  </label>
                ))}
              </div>
            )}
          </FormGroup>
        </Card>

        {/* Customer Information */}
        <Section title="Customer Information">
          <Card>
            <FormGroup label="Phone Number">
              <Input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
                placeholder="07700900000"
              />
              {existingCustomer && (
                <p className="text-sm text-green-600 mt-1">
                  ✓ Existing customer found
                </p>
              )}
            </FormGroup>

            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="First Name">
                <Input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  disabled={!!existingCustomer}
                />
              </FormGroup>
              
              <FormGroup label="Last Name">
                <Input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={!!existingCustomer}
                />
              </FormGroup>
            </div>

            <FormGroup label="Email (Optional)">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!!existingCustomer}
              />
            </FormGroup>

            <Checkbox
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              disabled={!!existingCustomer}
              label="Customer consents to receive SMS notifications"
            />
          </Card>
        </Section>

        {/* Additional Details */}
        <Section title="Additional Details">
          <Card>
            <FormGroup label="Special Requirements">
              <Textarea
                value={specialRequirements}
                onChange={(e) => setSpecialRequirements(e.target.value)}
                rows={2}
                placeholder="Window table, high chair needed, etc."
              />
            </FormGroup>

            <FormGroup label="Dietary Requirements">
              <Input
                type="text"
                value={dietaryRequirements}
                onChange={(e) => setDietaryRequirements(e.target.value)}
                placeholder="Vegetarian, Vegan, Gluten-free (comma separated)"
              />
            </FormGroup>

            <FormGroup label="Allergies">
              <Input
                type="text"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Nuts, Shellfish, Dairy (comma separated)"
              />
            </FormGroup>

            <FormGroup label="Celebration Type">
              <Select
                value={celebrationType}
                onChange={(e) => setCelebrationType(e.target.value)}
              >
                <option value="">None</option>
                <option value="birthday">Birthday</option>
                <option value="anniversary">Anniversary</option>
                <option value="engagement">Engagement</option>
                <option value="other">Other Celebration</option>
              </Select>
            </FormGroup>
          </Card>
        </Section>

        {bookingType === 'sunday_lunch' && (
          <Section
            title="Payment"
            description="Sunday lunch bookings require a £5 per guest deposit. Mark it as paid if you've already collected cash."
          >
            <Card>
              <Checkbox
                checked={cashPaymentReceived}
                onChange={(e) => setCashPaymentReceived(e.target.checked)}
                label="Deposit paid in cash (skip payment link)"
                description="We'll confirm the booking without sending the automated payment link."
              />
            </Card>
          </Section>
        )}

        {/* Sunday Lunch Menu Selection */}
        {bookingType === 'sunday_lunch' && selectedTime && (
          <Section 
            title="Sunday Lunch Pre-Order"
            description="Please select main course and extras for each guest. Payment will be required to confirm the booking unless you've marked the deposit as paid in cash."
          >
            {menuLoading && (
              <Card className="mb-4">
                <div className="flex items-center gap-2 text-gray-600">
                  <Spinner size="sm" />
                  Loading Sunday lunch menu...
                </div>
              </Card>
            )}

            {menuError && !menuLoading && (
              <Card className="mb-4">
                <Alert variant="error" title="Menu unavailable" description={menuError} />
              </Card>
            )}

            {!menuLoading && !menuError && !menuData && (
              <Card className="mb-4">
                <Alert
                  variant="warning"
                  title="Menu unavailable"
                  description="We were unable to load the Sunday lunch menu. Please refresh the page or try again later."
                />
              </Card>
            )}

            {!menuLoading && menuData && (
              <>
                {sundayLunchCutoffDisplay && (
                  <Alert
                    variant="warning"
                    title="Pre-order deadline"
                    description={`Orders must be confirmed by ${sundayLunchCutoffDisplay}. Unpaid bookings will be cancelled after this time.`}
                    className="mb-4"
                  />
                )}

                {includedSideOptions.length > 0 && (
                  <Alert
                    variant="info"
                    title="Included Sides"
                    description={`Each main includes: ${includedSideOptions
                      .map((side) => side.name)
                      .join(', ')}`}
                    className="mb-4"
                  />
                )}

                {sundayLunchItems.map((item, index) => (
                  <Card key={index} className="mb-4">
                    <h3 className="font-medium mb-3">Guest {index + 1}</h3>
                    
                    <div className="space-y-3">
                      <FormGroup label="Guest Name (Optional)">
                        <Input
                          type="text"
                          value={item.guest_name}
                          onChange={(e) => {
                            const newItems = [...sundayLunchItems];
                            newItems[index] = {
                              ...newItems[index],
                              guest_name: e.target.value,
                            };
                            setSundayLunchItems(newItems);
                          }}
                          placeholder={`Guest ${index + 1}`}
                        />
                      </FormGroup>
                      
                      <FormGroup label="Main Course *">
                        <Select
                          value={item.main_course_id}
                          onChange={(e) => {
                            const newItems = [...sundayLunchItems];
                            newItems[index] = {
                              ...newItems[index],
                              main_course_id: e.target.value,
                            };
                            setSundayLunchItems(newItems);
                          }}
                          required
                        >
                          <option value="">Select main course</option>
                          {menuData.mains.map((main) => (
                            <option key={main.id} value={main.id}>
                              {`${main.name} - £${main.price.toFixed(2)}`}
                            </option>
                          ))}
                        </Select>
                      </FormGroup>
                      
                      <FormGroup label="Optional Extras">
                        {extraSideOptions.length === 0 ? (
                          <p className="text-sm text-gray-500">No paid extras available for this date.</p>
                        ) : (
                          <div className="space-y-2">
                            {extraSideOptions.map((side) => (
                              <Checkbox
                                key={side.id}
                                checked={item.extra_side_ids.includes(side.id)}
                                onChange={(e) => {
                                  const newItems = [...sundayLunchItems];
                                  const updatedExtras = e.target.checked
                                    ? Array.from(
                                        new Set([
                                          ...newItems[index].extra_side_ids,
                                          side.id,
                                        ])
                                      )
                                    : newItems[index].extra_side_ids.filter((id) => id !== side.id);
                                  newItems[index] = {
                                    ...newItems[index],
                                    extra_side_ids: updatedExtras,
                                  };
                                  setSundayLunchItems(newItems);
                                }}
                                label={`${side.name} - £${side.price.toFixed(2)}`}
                              />
                            ))}
                          </div>
                        )}
                      </FormGroup>
                    </div>
                  </Card>
                ))}

                <Alert
                  variant="warning"
                  description='Main course pricing updates automatically based on your selections. "Optional extras" are added per guest.'
                  className="mt-2"
                />
              </>
            )}
          </Section>
        )}

        {/* Submit Buttons */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={!selectedTime || checkingAvailability}
            loading={submitting}
          >
            {bookingType === 'sunday_lunch'
              ? cashPaymentReceived
                ? 'Create Booking'
                : 'Create & Request Payment'
              : 'Create Booking'}
          </Button>
          
          <LinkButton
            href="/table-bookings"
            variant="secondary"
          >
            Cancel
          </LinkButton>
        </div>
      </Form>
    </PageLayout>
  );
}

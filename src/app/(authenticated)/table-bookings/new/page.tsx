'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { createTableBooking } from '@/app/actions/table-bookings';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { CreateTableBookingSchema, type CreateTableBookingInput } from '@/lib/schemas/table-bookings';

// UI Components
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

// Types
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

// Helpers
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
  
  // Local State
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState<string | null>(null);
  const [menuData, setMenuData] = useState<SundayLunchMenuData | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [sundayLunchItems, setSundayLunchItems] = useState<SundayLunchGuestSelection[]>([]);
  const [existingCustomer, setExistingCustomer] = useState<any>(null);

  const canCreate = hasPermission('table_bookings', 'create');

  // Form Setup
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    setError,
    clearErrors,
  } = useForm<CreateTableBookingInput>({
    resolver: zodResolver(CreateTableBookingSchema) as any,
    defaultValues: {
      booking_date: format(new Date(), 'yyyy-MM-dd'),
      party_size: 2,
      booking_type: 'regular',
      duration_minutes: 120,
      source: 'phone',
      customer_sms_opt_in: true,
      // Initialize optional fields to undefined or empty strings to avoid uncontrolled/controlled warnings if mapped to inputs
      customer_first_name: '',
      customer_last_name: '',
      customer_email: '',
      special_requirements: '',
    },
  });

  // Watchers
  const bookingDate = watch('booking_date');
  const bookingType = watch('booking_type');
  const partySize = watch('party_size');
  const phoneNumber = watch('customer_mobile_number');
  const selectedTime = watch('booking_time');
  const paymentMethod = watch('payment_method');

  // Derived State for Menu
  const includedSideOptions = useMemo(
    () => (menuData?.sides || []).filter((item) => item.included),
    [menuData]
  );
  const extraSideOptions = useMemo(
    () => (menuData?.sides || []).filter((item) => !item.included && item.price > 0),
    [menuData]
  );
  const sundayLunchCutoffDisplay = useMemo(() => {
    if (!menuData?.cutoffTime) return null;
    try {
      return format(new Date(menuData.cutoffTime), 'EEEE d MMM yyyy, h:mmaaa');
    } catch (err) {
      return null;
    }
  }, [menuData]);

  // 1. Check Availability
  useEffect(() => {
    // Prevent running if critical dependencies are missing
    if (!bookingDate || !partySize || partySize < 1) {
      setAvailableSlots([]);
      // Only reset time if we had one and inputs became invalid
      if (selectedTime) setValue('booking_time', '');
      setAvailabilityNotice(null);
      return;
    }

    let isActive = true;
    const check = async () => {
      try {
        console.log('Checking availability for:', { bookingDate, partySize, bookingType });
        setCheckingAvailability(true);
        clearErrors('booking_time'); // Clear manual errors
        setAvailabilityNotice(null);

        if (bookingType === 'sunday_lunch') {
          const selectedDay = new Date(bookingDate).getDay();
          if (selectedDay !== 0) {
            setError('booking_date', { message: 'Sunday lunch bookings are only available on Sundays' });
            setAvailableSlots([]);
            setValue('booking_time', '');
            setCheckingAvailability(false);
            return;
          } else {
            clearErrors('booking_date');
          }
        }

        const availabilityOptions = bookingType === 'sunday_lunch'
          ? { allowSundayLunchCutoffOverride: true }
          : undefined;

        const result = await checkAvailability(
          bookingDate,
          partySize,
          bookingType,
          undefined,
          availabilityOptions
        );

        if (!isActive) return;

        if (result.error) {
           console.error('Availability check error:', result.error);
           setAvailableSlots([]);
           setAvailabilityNotice(result.error); // Show as notice instead of field error potentially
        } else if (result.data) {
          console.log('Availability check success:', result.data);
          setAvailableSlots(result.data.time_slots);
          setAvailabilityNotice(result.data.special_notes || null);
          
          // Check if current selected time is still valid
          if (selectedTime && !result.data.time_slots.some(s => s.time === selectedTime)) {
             setValue('booking_time', '');
          }
        }
      } catch (err) {
        console.error('Unexpected error in availability check:', err);
        // Do not reset booking_type here, just show error
        setAvailabilityNotice('Failed to check availability. Please try again.');
      } finally {
        if (isActive) setCheckingAvailability(false);
      }
    };

    check();
    return () => { isActive = false; };
  }, [bookingDate, partySize, bookingType, setValue, setError, clearErrors, selectedTime]);

  // 2. Customer Search
  useEffect(() => {
    const searchCustomer = async () => {
        if (!phoneNumber || phoneNumber.length < 10) {
            setExistingCustomer(null);
            return;
        }

        try {
            const standardizedPhone = formatPhoneForStorage(phoneNumber);
            const phoneVariants = Array.from(new Set([...generatePhoneVariants(standardizedPhone), standardizedPhone]));
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

            if (!error && data && data.length > 0) {
                const match = data[0] as any; // Explicit cast to allow property access
                setExistingCustomer(match);
                setValue('customer_id', match.id);
                setValue('customer_first_name', match.first_name);
                setValue('customer_last_name', match.last_name || '');
                setValue('customer_email', match.email || '');
                setValue('customer_sms_opt_in', match.sms_opt_in);
            } else {
                setExistingCustomer(null);
                setValue('customer_id', undefined);
                // Do not clear name/email fields as user might be typing new customer
            }
        } catch (err) {
            setExistingCustomer(null);
        }
    };

    const debounce = setTimeout(searchCustomer, 500);
    return () => clearTimeout(debounce);
  }, [phoneNumber, supabase, setValue]);

  // 3. Load Sunday Lunch Menu
  useEffect(() => {
    if (bookingType !== 'sunday_lunch') {
      setMenuData(null);
      setMenuError(null);
      return;
    }

    let isActive = true;
    const loadMenu = async () => {
        try {
            setMenuLoading(true);
            setMenuError(null);
            const targetMenuDate = resolveMenuDate(bookingDate);
            const response = await fetch(`/api/table-bookings/menu/sunday-lunch?date=${format(targetMenuDate, 'yyyy-MM-dd')}`);
            const result = await response.json();

            if (!isActive) return;

            if (!response.ok || result?.success === false) {
                throw new Error(result?.error?.message || 'Failed to load menu');
            }

            const menuPayload = result.data;
            const cutoffDate = new Date(targetMenuDate);
            cutoffDate.setDate(targetMenuDate.getDate() - 1);
            cutoffDate.setHours(13, 0, 0, 0);

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
            if (isActive) setMenuError(err.message);
        } finally {
            if (isActive) setMenuLoading(false);
        }
    };

    loadMenu();
    return () => { isActive = false; };
  }, [bookingType, bookingDate]);

  // 4. Manage Sunday Lunch Selections State
  useEffect(() => {
    if (bookingType !== 'sunday_lunch') {
        setSundayLunchItems([]);
        return;
    }
    
    setSundayLunchItems(prev => {
        const next = Array.from({ length: partySize || 0 }, (_, index) => {
            return prev[index] || {
                guest_name: `Guest ${index + 1}`,
                main_course_id: '',
                extra_side_ids: [],
            };
        });
        return next;
    });
  }, [partySize, bookingType]);

  // Ensure payment fields stay in sync with booking type and selection
  useEffect(() => {
    if (bookingType !== 'sunday_lunch') {
      setValue('payment_method', undefined);
      setValue('payment_status', undefined);
      return;
    }

    // Default to payment link for Sunday lunch if nothing selected
    if (!paymentMethod) {
      setValue('payment_method', 'payment_link');
      setValue('payment_status', 'pending');
    } else if (paymentMethod === 'cash') {
      setValue('payment_status', 'completed');
    } else {
      setValue('payment_status', 'pending');
    }
  }, [bookingType, paymentMethod, setValue]);


  const onSubmit = async (data: CreateTableBookingInput) => {
    // Validate Sunday Lunch Selections
    let finalMenuItems: NonNullable<CreateTableBookingInput['menu_items']> | undefined = undefined;

    if (data.booking_type === 'sunday_lunch') {
        if (!menuData) {
            setMenuError('Menu data missing');
            return;
        }

        const mainsById = new Map(menuData.mains.map((item) => [item.id, item]));
        const extrasById = new Map(menuData.sides.map((item) => [item.id, item]));

        finalMenuItems = [];

        for (let i = 0; i < sundayLunchItems.length; i++) {
            const item = sundayLunchItems[i];
            if (!item.main_course_id) {
                setError('root', { message: `Please select a main course for Guest ${i + 1}` });
                return;
            }
            const main = mainsById.get(item.main_course_id);
            if (main) {
                finalMenuItems!.push({
                    custom_item_name: main.name,
                    item_type: 'main',
                    quantity: 1,
                    guest_name: item.guest_name,
                    price_at_booking: main.price,
                });
            }

            item.extra_side_ids.forEach(sideId => {
                const side = extrasById.get(sideId);
                if (side) {
                     finalMenuItems!.push({
                        custom_item_name: side.name,
                        item_type: 'extra',
                        quantity: 1,
                        guest_name: item.guest_name,
                        price_at_booking: side.price,
                    });
                }
            });
        }
        data.menu_items = finalMenuItems;
    }

    // Ensure payment fields are aligned before submit
    if (data.booking_type === 'sunday_lunch') {
      if (!data.payment_method) {
        setError('root', { message: 'Please select how the deposit will be collected' });
        return;
      }
      data.payment_status = data.payment_method === 'cash' ? 'completed' : 'pending';
    } else {
      data.payment_method = undefined;
      data.payment_status = undefined;
    }

    const result = await createTableBooking(data);

    if (result.error) {
        setError('root', { message: result.error });
    } else if (result.data) {
        if (result.data.status === 'pending_payment' && result.data.booking_reference) {
            router.push(`/table-booking/${result.data.booking_reference}/payment`);
        } else {
            router.push(`/table-bookings/${result.data.id}`);
        }
    }
  };

  if (!canCreate) {
    return (
      <PageLayout title="New Table Booking" subtitle="Access Denied" backButton={{ label: 'Back', href: '/table-bookings' }}>
        <Card><Alert variant="error" title="Access Denied" description="You do not have permission." /></Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="New Table Booking"
      subtitle="Create a new restaurant table reservation"
      backButton={{ label: 'Back to Table Bookings', href: '/table-bookings' }}
    >
      {errors.root && <Alert variant="error" title="Error" description={errors.root.message} className="mb-4" />}
      {availabilityNotice && !errors.root && <Alert variant="info" title="Availability Notice" description={availabilityNotice} className="mb-4" />}

      <Form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        
        {/* Type Selection */}
        <Card>
            <FormGroup label="Booking Type">
                <div className="flex gap-4">
                    <label className="flex items-center">
                        <input type="radio" value="regular" {...register('booking_type')} className="mr-2" />
                        Regular Dining
                    </label>
                    <label className="flex items-center">
                        <input type="radio" value="sunday_lunch" {...register('booking_type')} className="mr-2" />
                        Sunday Lunch
                    </label>
                </div>
                {bookingType === 'sunday_lunch' && (
                     <Alert variant="warning" description="Sunday lunch bookings require pre-order and payment." className="mt-2" />
                )}
            </FormGroup>
        </Card>

        {/* Date & Size */}
        <Card>
            <div className="grid grid-cols-2 gap-4">
                <FormGroup label="Date" error={errors.booking_date?.message}>
                    <Input type="date" {...register('booking_date')} min={format(new Date(), 'yyyy-MM-dd')} />
                </FormGroup>
                <FormGroup label="Party Size" error={errors.party_size?.message}>
                    <Input type="number" {...register('party_size', { valueAsNumber: true })} min={1} max={20} />
                </FormGroup>
            </div>
        </Card>

        {/* Time Slots */}
        <Card>
            <FormGroup label="Time Slot" error={errors.booking_time?.message}>
                {checkingAvailability ? (
                     <div className="flex items-center gap-2 text-gray-600"><Spinner size="sm" /> Checking...</div>
                ) : availableSlots.length === 0 ? (
                    <p className="text-gray-500">No available slots</p>
                ) : (
                    <div className="grid grid-cols-4 gap-2">
                        {availableSlots.map(slot => (
                             <label key={slot.time} className={`border rounded-md p-2 text-center cursor-pointer transition-colors ${selectedTime === slot.time ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-50'}`}>
                                <input type="radio" value={slot.time} {...register('booking_time')} className="sr-only" />
                                <div>{slot.time}</div>
                                <div className="text-xs opacity-75">{slot.available_capacity} seats</div>
                             </label>
                        ))}
                    </div>
                )}
            </FormGroup>
        </Card>

        {/* Customer */}
        <Section title="Customer Information">
            <Card>
                <FormGroup label="Phone Number" error={errors.customer_mobile_number?.message}>
                    <Input type="tel" {...register('customer_mobile_number')} placeholder="07700900000" />
                    {existingCustomer && <p className="text-sm text-green-600 mt-1">✓ Existing customer found</p>}
                </FormGroup>
                <div className="grid grid-cols-2 gap-4">
                    <FormGroup label="First Name" error={errors.customer_first_name?.message}>
                        <Input {...register('customer_first_name')} disabled={!!existingCustomer} />
                    </FormGroup>
                    <FormGroup label="Last Name">
                         <Input {...register('customer_last_name')} disabled={!!existingCustomer} />
                    </FormGroup>
                </div>
                <FormGroup label="Email (Optional)" error={errors.customer_email?.message}>
                    <Input type="email" {...register('customer_email')} disabled={!!existingCustomer} />
                </FormGroup>
                <Controller
                    name="customer_sms_opt_in"
                    control={control}
                    render={({ field }) => (
                        <Checkbox checked={field.value} onChange={field.onChange} disabled={!!existingCustomer} label="Customer consents to SMS notifications" />
                    )}
                />
            </Card>
        </Section>

        {/* Details */}
        <Section title="Additional Details">
            <Card>
                <FormGroup label="Special Requirements">
                    <Textarea {...register('special_requirements')} rows={2} placeholder="High chair, etc." />
                </FormGroup>
                <FormGroup label="Dietary Requirements">
                    <Input placeholder="Vegetarian, etc." onChange={(e) => setValue('dietary_requirements', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])} />
                </FormGroup>
                <FormGroup label="Allergies">
                     <Input placeholder="Nuts, etc." onChange={(e) => setValue('allergies', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])} />
                </FormGroup>
                <FormGroup label="Celebration">
                    <Select {...register('celebration_type')}>
                        <option value="">None</option>
                        <option value="birthday">Birthday</option>
                        <option value="anniversary">Anniversary</option>
                        <option value="engagement">Engagement</option>
                        <option value="other">Other</option>
                    </Select>
                </FormGroup>
            </Card>
        </Section>
        
        {/* Payment for Sunday Lunch */}
        {bookingType === 'sunday_lunch' && (
          <Section title="Payment">
            <Card>
              <Controller
                name="payment_method"
                control={control}
                render={({ field }) => {
                  const selectOption = (value: 'payment_link' | 'cash') => {
                    field.onChange(value);
                    setValue('payment_status', value === 'cash' ? 'completed' : 'pending');
                  };
                  const optionClass = (active: boolean) =>
                    `w-full rounded-lg border px-4 py-3 text-left transition ${
                      active
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`

                  return (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-700">
                        Choose how you’ll collect the £5/guest deposit.
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          className={optionClass(field.value !== 'cash')}
                          onClick={() => selectOption('payment_link')}
                        >
                          <div className="font-medium text-gray-900">Send payment link</div>
                          <div className="text-sm text-gray-600">
                            Customer receives an SMS payment link; booking stays pending until paid.
                          </div>
                        </button>
                        <button
                          type="button"
                          className={optionClass(field.value === 'cash')}
                          onClick={() => selectOption('cash')}
                        >
                          <div className="font-medium text-gray-900">Cash collected</div>
                          <div className="text-sm text-gray-600">
                            Mark deposit as paid now and confirm the booking immediately.
                          </div>
                        </button>
                      </div>
                    </div>
                  )
                }}
              />
            </Card>
          </Section>
        )}

        {/* Sunday Lunch Menu */}
        {bookingType === 'sunday_lunch' && selectedTime && (
            <Section title="Sunday Lunch Pre-Order">
                {menuLoading && <Card><Spinner size="sm" /> Loading menu...</Card>}
                {menuError && <Card><Alert variant="error" title="Menu Error" description={menuError} /></Card>}
                {!menuLoading && menuData && (
                    <>
                        {sundayLunchCutoffDisplay && <Alert variant="warning" title="Pre-order deadline" description={sundayLunchCutoffDisplay} className="mb-4" />}
                        {includedSideOptions.length > 0 && <Alert variant="info" title="Included Sides" description={includedSideOptions.map(s => s.name).join(', ')} className="mb-4" />}
                        
                        {sundayLunchItems.map((item, index) => (
                            <Card key={index} className="mb-4">
                                <h3 className="font-medium mb-3">Guest {index + 1}</h3>
                                <div className="space-y-3">
                                    <FormGroup label="Guest Name">
                                        <Input value={item.guest_name} onChange={(e) => {
                                            const newItems = [...sundayLunchItems];
                                            newItems[index] = { ...newItems[index], guest_name: e.target.value };
                                            setSundayLunchItems(newItems);
                                        }} />
                                    </FormGroup>
                                    <FormGroup label="Main Course *">
                                        <Select value={item.main_course_id} onChange={(e) => {
                                            const newItems = [...sundayLunchItems];
                                            newItems[index] = { ...newItems[index], main_course_id: e.target.value };
                                            setSundayLunchItems(newItems);
                                        }} required>
                                            <option value="">Select main course</option>
                                            {menuData.mains.map(main => (
                                                <option key={main.id} value={main.id}>{`${main.name} - £${main.price.toFixed(2)}`}</option>
                                            ))}
                                        </Select>
                                    </FormGroup>
                                    <FormGroup label="Optional Extras">
                                        <div className="space-y-2">
                                            {extraSideOptions.map(side => (
                                                <Checkbox key={side.id} checked={item.extra_side_ids.includes(side.id)} onChange={(e) => {
                                                     const newItems = [...sundayLunchItems];
                                                     if (e.target.checked) {
                                                         newItems[index].extra_side_ids = [...newItems[index].extra_side_ids, side.id];
                                                     } else {
                                                         newItems[index].extra_side_ids = newItems[index].extra_side_ids.filter(id => id !== side.id);
                                                     }
                                                     setSundayLunchItems(newItems);
                                                }} label={`${side.name} - £${side.price.toFixed(2)}`} />
                                            ))}
                                        </div>
                                    </FormGroup>
                                </div>
                            </Card>
                        ))}
                    </>
                )}
            </Section>
        )}

        <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting || !selectedTime} loading={isSubmitting}>
                {bookingType === 'sunday_lunch' && paymentMethod !== 'cash' ? 'Create & Request Payment' : 'Create Booking'}
            </Button>
            <LinkButton href="/table-bookings" variant="secondary">Cancel</LinkButton>
        </div>
      </Form>
    </PageLayout>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, addDays } from 'date-fns';
import { createTableBooking } from '@/app/actions/table-bookings';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { generatePhoneVariants } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
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

export default function NewTableBookingPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [bookingType, setBookingType] = useState<'regular' | 'sunday_lunch'>('regular');
  const [bookingDate, setBookingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [partySize, setPartySize] = useState(2);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState('');
  
  // Sunday lunch menu state
  const [sundayLunchItems, setSundayLunchItems] = useState<Array<{
    guest_name: string;
    main_course: string;
    sides: string[];
  }>>([]);
  
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
    let total = 0;
    
    sundayLunchItems.forEach(item => {
      // Add main course price
      switch (item.main_course) {
        case 'roasted_chicken':
          total += 14.99;
          break;
        case 'lamb_shank':
          total += 15.49;
          break;
        case 'pork_belly':
          total += 15.99;
          break;
        case 'beetroot_wellington':
          total += 15.49;
          break;
        case 'kids_chicken':
          total += 9.99;
          break;
      }
      
      // Add extra for cauliflower cheese if selected
      if (item.sides.includes('Cauliflower Cheese (£3.99 extra)')) {
        total += 3.99;
      }
    });
    
    return total.toFixed(2);
  }

  useEffect(() => {
    if (bookingDate && partySize) {
      checkBookingAvailability();
    }
  }, [bookingDate, partySize, bookingType]);

  // Initialize Sunday lunch items when party size changes
  useEffect(() => {
    if (bookingType === 'sunday_lunch') {
      const newItems = Array(partySize).fill(null).map((_, index) => ({
        guest_name: `Guest ${index + 1}`,
        main_course: '',
        sides: []
      }));
      setSundayLunchItems(newItems);
    }
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

  async function checkBookingAvailability() {
    try {
      setCheckingAvailability(true);
      setError(null);
      
      // Validate Sunday lunch bookings
      if (bookingType === 'sunday_lunch') {
        const selectedDay = new Date(bookingDate).getDay();
        if (selectedDay !== 0) { // 0 is Sunday
          setError('Sunday lunch bookings are only available on Sundays');
          setAvailableSlots([]);
          return;
        }
      }
      
      const result = await checkAvailability(bookingDate, partySize, bookingType);
      
      if (result.error) {
        setError(result.error);
        setAvailableSlots([]);
      } else if (result.data) {
        setAvailableSlots(result.data.time_slots);
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

  async function searchCustomer() {
    try {
      const phoneVariants = generatePhoneVariants(phoneNumber);
      const { data } = await supabase
        .from('customers')
        .select('*')
        .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
        .single();
        
      if (data) {
        setExistingCustomer(data);
        setFirstName(data.first_name);
        setLastName(data.last_name);
        setEmail(data.email || '');
        setSmsOptIn(data.sms_opt_in);
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
    
    // Validate Sunday lunch selections
    if (bookingType === 'sunday_lunch') {
      for (let i = 0; i < sundayLunchItems.length; i++) {
        const item = sundayLunchItems[i];
        if (!item.main_course) {
          setError(`Please select a main course for Guest ${i + 1}`);
          return;
        }
        
        // Cauliflower cheese is optional, no validation needed
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
      if (dietaryRequirements) formData.append('dietary_requirements', JSON.stringify(dietaryRequirements.split(',').map(s => s.trim())));
      if (allergies) formData.append('allergies', JSON.stringify(allergies.split(',').map(s => s.trim())));
      if (celebrationType) formData.append('celebration_type', celebrationType);
      
      // Sunday lunch menu items
      if (bookingType === 'sunday_lunch') {
        const menuItems = sundayLunchItems.flatMap((item, index) => {
          const items = [];
          
          // Main course with correct pricing
          let mainPrice = 0;
          let mainName = '';
          switch (item.main_course) {
            case 'roasted_chicken':
              mainPrice = 14.99;
              mainName = 'Roasted Chicken';
              break;
            case 'lamb_shank':
              mainPrice = 15.49;
              mainName = 'Slow-Cooked Lamb Shank';
              break;
            case 'pork_belly':
              mainPrice = 15.99;
              mainName = 'Crispy Pork Belly';
              break;
            case 'beetroot_wellington':
              mainPrice = 15.49;
              mainName = 'Beetroot & Butternut Squash Wellington';
              break;
            case 'kids_chicken':
              mainPrice = 9.99;
              mainName = 'Kids Roasted Chicken';
              break;
          }
          
          items.push({
            custom_item_name: mainName,
            item_type: 'main',
            quantity: 1,
            guest_name: item.guest_name || `Guest ${index + 1}`,
            price_at_booking: mainPrice
          });
          
          // Sides
          item.sides.forEach(side => {
            const isCauliflowerExtra = side.includes('£3.99 extra');
            items.push({
              custom_item_name: side.replace(' (£3.99 extra)', ''),
              item_type: isCauliflowerExtra ? 'extra' : 'side',
              quantity: 1,
              guest_name: item.guest_name || `Guest ${index + 1}`,
              price_at_booking: isCauliflowerExtra ? 3.99 : 0
            });
          });
          
          return items;
        });
        
        formData.append('menu_items', JSON.stringify(menuItems));
      }
      
      const result = await createTableBooking(formData);
      
      if (result.error) {
        setError(result.error);
      } else if (bookingType === 'sunday_lunch' && result.data) {
        // For Sunday lunch, redirect to payment page using booking reference
        router.push(`/table-booking/${result.data.booking_reference}/payment`);
      } else {
        // For regular bookings, go to booking details
        router.push(`/table-bookings/${result.data?.id}`);
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
      <PageWrapper>
        <PageHeader 
          title="New Table Booking"
          subtitle="Create a new restaurant table reservation"
          backButton={{
            label: "Back to Table Bookings",
            href: "/table-bookings"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" 
              title="Access Denied" 
              description="You do not have permission to create bookings." 
            />
          </Card>
        </PageContent>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="New Table Booking"
        subtitle="Create a new restaurant table reservation"
        backButton={{
          label: "Back to Table Bookings",
          href: "/table-bookings"
        }}
      />
      <PageContent>
        {error && (
          <Alert variant="error" title="Error" description={error} />
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
                value={partySize}
                onChange={(e) => setPartySize(parseInt(e.target.value))}
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
                  required
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

        {/* Sunday Lunch Menu Selection */}
        {bookingType === 'sunday_lunch' && selectedTime && (
          <Section 
            title="Sunday Lunch Pre-Order"
            description="Please select main course and sides for each guest. Payment will be required to confirm the booking."
          >
            
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
                        newItems[index].guest_name = e.target.value;
                        setSundayLunchItems(newItems);
                      }}
                      placeholder={`Guest ${index + 1}`}
                    />
                  </FormGroup>
                  
                  <FormGroup label="Main Course *">
                    <Select
                      value={item.main_course}
                      onChange={(e) => {
                        const newItems = [...sundayLunchItems];
                        newItems[index].main_course = e.target.value;
                        setSundayLunchItems(newItems);
                      }}
                      required
                    >
                      <option value="">Select main course</option>
                      <option value="roasted_chicken">Roasted Chicken - £14.99</option>
                      <option value="lamb_shank">Slow-Cooked Lamb Shank - £15.49</option>
                      <option value="pork_belly">Crispy Pork Belly - £15.99</option>
                      <option value="beetroot_wellington">Beetroot & Butternut Squash Wellington (VG) - £15.49</option>
                      <option value="kids_chicken">Kids Roasted Chicken - £9.99</option>
                    </Select>
                  </FormGroup>
                  
                  <FormGroup label="Optional Extra">
                    <div className="space-y-2">
                      {['Cauliflower Cheese (£3.99 extra)'].map(side => (
                        <Checkbox
                          key={side}
                          checked={item.sides.includes(side)}
                          onChange={(e) => {
                            const newItems = [...sundayLunchItems];
                            if (e.target.checked) {
                              newItems[index].sides = [side];
                            } else {
                              newItems[index].sides = [];
                            }
                            setSundayLunchItems(newItems);
                          }}
                          label={side}
                        />
                      ))}
                    </div>
                  </FormGroup>
                </div>
              </Card>
            ))}
            
            <Alert variant="info"
              title={`Total to pay: £${calculateSundayLunchTotal()}`}
              description="Prices vary by main course selection. Includes main course and two sides. Additional extras may apply."
            />
          </Section>
        )}

        {/* Submit Buttons */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={!selectedTime || checkingAvailability}
            loading={submitting}
          >
            {bookingType === 'sunday_lunch' ? 'Create & Request Payment' : 'Create Booking'}
          </Button>
          
          <LinkButton
            href="/table-bookings"
            variant="secondary"
          >
            Cancel
          </LinkButton>
        </div>
      </Form>
      </PageContent>
    </PageWrapper>
  );
}
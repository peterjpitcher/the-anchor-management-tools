'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { Button } from '@/components/ui-v2/forms/Button';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { toast } from '@/components/ui-v2/feedback/Toast';
import type { BookingTimeSlot } from '@/types/table-bookings';
import { updateTimeSlotCapacity } from '@/app/actions/table-configuration';

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type EditableSlot = BookingTimeSlot & {
  editableMaxCovers: number;
};

export default function TimeSlotSettingsPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [slots, setSlots] = useState<EditableSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterDay, setFilterDay] = useState<number | 'all'>('all');
  const [newSlot, setNewSlot] = useState({
    dayOfWeek: 0,
    slotTime: '12:00',
    bookingType: 'regular' as 'regular' | 'sunday_lunch',
    maxCovers: 20,
  });

  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canManage) {
      void loadSlots();
    } else {
      setLoading(false);
    }
  }, [canManage]);

  async function loadSlots() {
    try {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('booking_time_slots')
        .select('*')
        .order('day_of_week', { ascending: true })
        .order('slot_time', { ascending: true });

      if (error) {
        throw error;
      }

      const slotsData = (data ?? []) as BookingTimeSlot[];

      setSlots(
        slotsData.map((slot) => ({
          ...slot,
          editableMaxCovers: slot.max_covers,
        })),
      );
    } catch (err: any) {
      console.error('Error loading time slots:', err);
      setError(err.message || 'Failed to load time slots');
    } finally {
      setLoading(false);
    }
  }

  const filteredSlots = useMemo(() => {
    if (filterDay === 'all') {
      return slots;
    }
    return slots.filter((slot) => slot.day_of_week === filterDay);
  }, [filterDay, slots]);

  async function handleSave(slot: EditableSlot) {
    try {
      setProcessingId(slot.id);
      const result = await updateTimeSlotCapacity(
        slot.day_of_week,
        slot.slot_time,
        Number(slot.editableMaxCovers),
        slot.booking_type || undefined,
      );

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success('Time slot updated');
      await loadSlots();
    } catch (err: any) {
      console.error('Failed to update slot:', err);
      toast.error(err.message || 'Failed to update time slot');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleCreateSlot(event: React.FormEvent) {
    event.preventDefault();

    try {
      setProcessingId('new-slot');
      const result = await updateTimeSlotCapacity(
        newSlot.dayOfWeek,
        `${newSlot.slotTime}:00`,
        Number(newSlot.maxCovers),
        newSlot.bookingType,
      );

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success('Time slot created');
      await loadSlots();
    } catch (err: any) {
      console.error('Failed to create slot:', err);
      toast.error(err.message || 'Failed to create time slot');
    } finally {
      setProcessingId(null);
    }
  }

  if (!canManage) {
    return (
      <PageLayout
        title="Time Slot Management"
        subtitle="Configure capacity limits for booking time slots"
        backButton={{
          label: 'Back to Table Bookings',
          href: '/table-bookings',
        }}
      >
        <Card>
          <Alert
            variant="error"
            title="Access Denied"
            description="You do not have permission to manage table booking time slots."
          />
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Time Slot Management"
      subtitle="Configure capacity limits for booking time slots"
      backButton={{
        label: 'Back to Table Booking Settings',
        href: '/table-bookings/settings',
      }}
      loading={loading}
      loadingLabel="Loading time slot configuration..."
    >
      {error && (
        <Alert variant="error" title="Error" description={error} className="mb-4" />
      )}

      <Section title="Create Time Slot" className="mb-6">
        <Card>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-4" onSubmit={handleCreateSlot}>
            <FormGroup label="Day">
              <Select
                value={newSlot.dayOfWeek.toString()}
                onChange={(event) =>
                  setNewSlot((prev) => ({
                    ...prev,
                    dayOfWeek: Number(event.target.value),
                  }))
                }
                required
              >
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Time">
              <Input
                type="time"
                value={newSlot.slotTime}
                onChange={(event) =>
                  setNewSlot((prev) => ({
                    ...prev,
                    slotTime: event.target.value,
                  }))
                }
                required
              />
            </FormGroup>

            <FormGroup label="Booking Type">
              <Select
                value={newSlot.bookingType}
                onChange={(event) =>
                  setNewSlot((prev) => ({
                    ...prev,
                    bookingType: event.target.value as 'regular' | 'sunday_lunch',
                  }))
                }
              >
                <option value="regular">Regular</option>
                <option value="sunday_lunch">Sunday Lunch</option>
              </Select>
            </FormGroup>

            <FormGroup label="Max Covers">
              <Input
                type="number"
                min={0}
                value={newSlot.maxCovers}
                onChange={(event) =>
                  setNewSlot((prev) => ({
                    ...prev,
                    maxCovers: Number(event.target.value),
                  }))
                }
                required
              />
            </FormGroup>

            <div className="md:col-span-4 flex justify-end">
              <Button
                type="submit"
                loading={processingId === 'new-slot'}
                disabled={processingId === 'new-slot'}
              >
                Add Time Slot
              </Button>
            </div>
          </form>
        </Card>
      </Section>

      <Section
        title="Existing Time Slots"
        description="Adjust capacity limits or deactivate slots as needed"
      >
        <Card>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <FormGroup label="Filter by day" className="md:w-64">
              <Select
                value={filterDay === 'all' ? 'all' : filterDay.toString()}
                onChange={(event) => {
                  const value = event.target.value;
                  setFilterDay(value === 'all' ? 'all' : Number(value));
                }}
              >
                <option value="all">All days</option>
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <Button variant="secondary" onClick={() => void loadSlots()}>
              Refresh
            </Button>
          </div>

          {filteredSlots.length === 0 ? (
            <Alert
              variant="info"
              title="No time slots configured"
              description="Create a time slot above to manage capacity limits."
            />
          ) : (
            <div className="space-y-4">
              {filteredSlots.map((slot) => (
                <Card key={`${slot.day_of_week}-${slot.slot_time}-${slot.booking_type}`} variant="bordered">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-sm text-gray-500">
                        {DAY_LABELS[slot.day_of_week]} • {slot.slot_time.slice(0, 5)} •{' '}
                        {slot.booking_type ? slot.booking_type.replace('_', ' ') : 'Any'}
                      </p>
                      <p className="text-lg font-semibold">
                        Max covers: {slot.max_covers}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min={0}
                        value={slot.editableMaxCovers}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          setSlots((previous) =>
                            previous.map((item) =>
                              item.id === slot.id
                                ? { ...item, editableMaxCovers: nextValue }
                                : item,
                            ),
                          );
                        }}
                        className="w-24"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => void handleSave(slot)}
                        loading={processingId === slot.id}
                        disabled={
                          processingId === slot.id ||
                          Number(slot.editableMaxCovers) === slot.max_covers
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </Section>
    </PageLayout>
  );
}

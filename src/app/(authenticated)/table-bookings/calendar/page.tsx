'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import Link from 'next/link';
import { 
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import { TableBooking } from '@/types/table-bookings';
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

interface DayBookings {
  date: string;
  bookings: TableBooking[];
  totalCovers: number;
  hasAvailability: boolean;
}

export default function TableBookingsCalendarPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [bookingsByDay, setBookingsByDay] = useState<Record<string, DayBookings>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const canView = hasPermission('table_bookings', 'view');

  useEffect(() => {
    if (canView) {
      loadMonthBookings();
    }
  }, [currentMonth, canView]);

  async function loadMonthBookings() {
    try {
      setLoading(true);
      setError(null);

      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);

      // Get all bookings for the month
      const { data: bookings, error: bookingsError } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(id, first_name, last_name, mobile_number, sms_opt_in, email)
        `)
        .gte('booking_date', format(monthStart, 'yyyy-MM-dd'))
        .lte('booking_date', format(monthEnd, 'yyyy-MM-dd'))
        .in('status', ['confirmed', 'pending_payment'])
        .order('booking_time', { ascending: true });

      if (bookingsError) {
        throw bookingsError;
      }

      // Group bookings by day
      const grouped: Record<string, DayBookings> = {};
      
      eachDayOfInterval({ start: monthStart, end: monthEnd }).forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayBookings = bookings?.filter((b: any) => b.booking_date === dateStr) || [];
        
        grouped[dateStr] = {
          date: dateStr,
          bookings: dayBookings,
          totalCovers: dayBookings.reduce((sum: number, b: any) => sum + b.party_size, 0),
          hasAvailability: true // This could be calculated based on capacity
        };
      });

      setBookingsByDay(grouped);
    } catch (err: any) {
      console.error('Error loading calendar:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function previousMonth() {
    setCurrentMonth(subMonths(currentMonth, 1));
  }

  function nextMonth() {
    setCurrentMonth(addMonths(currentMonth, 1));
  }

  function goToToday() {
    setCurrentMonth(new Date());
    setSelectedDate(new Date());
  }

  if (!canView) {
    return (
      <PageLayout
        title="Table Bookings Calendar"
        subtitle="View all bookings in calendar format"
        backButton={{
          label: 'Back to Table Bookings',
          href: '/table-bookings',
        }}
      >
        <Card>
          <Alert variant="error" title="Access Denied" description="You do not have permission to view the calendar." />
        </Card>
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout
        title="Table Bookings Calendar"
        subtitle="View all bookings in calendar format"
        backButton={{
          label: 'Back to Table Bookings',
          href: '/table-bookings',
        }}
        loading
        loadingLabel="Loading calendar..."
      />
    );
  }

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 }); // Monday
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <PageLayout
      title="Table Bookings Calendar"
      subtitle="View all bookings in calendar format"
      backButton={{
        label: 'Back to Table Bookings',
        href: '/table-bookings',
      }}
    >
      {error && (
        <Alert variant="error" title="Error" description={error} />
      )}

      <Card>
        {/* Calendar Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={previousMonth}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            
            <div className="text-lg font-medium min-w-[200px] text-center">
              {format(currentMonth, 'MMMM yyyy')}
            </div>
            
            <button
              onClick={nextMonth}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
          
          <Button
            onClick={goToToday}
            size="sm"
          >
            Today
          </Button>
        </div>

        {/* Calendar Grid */}
        <div className="p-6">
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-px mb-2">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div key={day} className="text-center text-sm font-medium text-gray-700 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-px bg-gray-200">
            {calendarDays.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayData = bookingsByDay[dateStr];
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isSunday = day.getDay() === 0;

              return (
                <Link
                  key={dateStr}
                  href={`/table-bookings?date=${dateStr}`}
                  className={`
                    bg-white p-2 min-h-[100px] hover:bg-gray-50 transition-colors
                    ${!isCurrentMonth ? 'opacity-50' : ''}
                    ${isToday ? 'ring-2 ring-blue-500' : ''}
                    ${isSelected ? 'bg-blue-50' : ''}
                  `}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`
                      text-sm font-medium
                      ${isToday ? 'text-blue-600' : ''}
                      ${isSunday ? 'text-orange-600' : ''}
                    `}>
                      {format(day, 'd')}
                    </span>
                    {isSunday && isCurrentMonth && (
                      <span className="text-xs text-orange-600 font-medium">
                        Sunday Lunch
                      </span>
                    )}
                  </div>
                  
                  {dayData && dayData.bookings.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-xs">
                        <UserGroupIcon className="h-3 w-3 text-gray-500" />
                        <span className="font-medium">{dayData.bookings.length}</span>
                        <span className="text-gray-500">bookings</span>
                      </div>
                      <div className="text-xs text-gray-600">
                        {dayData.totalCovers} covers
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="px-6 py-4 border-t flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 ring-2 ring-blue-500"></div>
            <span>Today</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-100"></div>
            <span>Sunday (Lunch Pre-orders)</span>
          </div>
          <div className="flex items-center gap-2">
            <UserGroupIcon className="h-4 w-4 text-gray-500" />
            <span>Bookings Count</span>
          </div>
        </div>
      </Card>
    </PageLayout>
  );
}

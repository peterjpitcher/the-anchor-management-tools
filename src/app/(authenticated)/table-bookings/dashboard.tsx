'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, startOfDay, endOfDay, addDays, startOfWeek, endOfWeek, addWeeks, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import Link from 'next/link';
import { 
  CalendarIcon, 
  ClockIcon, 
  UserGroupIcon,
  CurrencyPoundIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ArrowLeftIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';
import { TableBooking } from '@/types/table-bookings';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';

interface DashboardStats {
  todayBookings: number;
  todayCovers: number;
  upcomingArrivals: number;
  pendingPayments: number;
  todayRevenue: number;
  tomorrowBookings: number;
}

export default function TableBookingsDashboard() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'next-month'>('week');
  const [bookings, setBookings] = useState<TableBooking[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    todayBookings: 0,
    todayCovers: 0,
    upcomingArrivals: 0,
    pendingPayments: 0,
    todayRevenue: 0,
    tomorrowBookings: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = hasPermission('table_bookings', 'view');
  const canCreate = hasPermission('table_bookings', 'create');
  const canEdit = hasPermission('table_bookings', 'edit');
  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canView) {
      loadDashboardData();
    }
  }, [selectedDate, viewMode, canView]);

  async function loadDashboardData() {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(*),
          table_booking_items(*),
          table_booking_payments(*)
        `)
        .in('status', ['confirmed', 'pending_payment']); // Exclude cancelled bookings

      // Apply date filter based on view mode
      if (viewMode === 'day') {
        query = query.eq('booking_date', format(selectedDate, 'yyyy-MM-dd'));
      } else if (viewMode === 'week') {
        // Week view - get current week (starting Monday)
        const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
        query = query
          .gte('booking_date', format(weekStart, 'yyyy-MM-dd'))
          .lte('booking_date', format(weekEnd, 'yyyy-MM-dd'));
      } else if (viewMode === 'month') {
        // This month view
        const monthStart = startOfMonth(new Date());
        const monthEnd = endOfMonth(new Date());
        query = query
          .gte('booking_date', format(monthStart, 'yyyy-MM-dd'))
          .lte('booking_date', format(monthEnd, 'yyyy-MM-dd'));
      } else if (viewMode === 'next-month') {
        // Next month view
        const nextMonth = addMonths(new Date(), 1);
        const monthStart = startOfMonth(nextMonth);
        const monthEnd = endOfMonth(nextMonth);
        query = query
          .gte('booking_date', format(monthStart, 'yyyy-MM-dd'))
          .lte('booking_date', format(monthEnd, 'yyyy-MM-dd'));
      }

      const { data: todayBookings, error: bookingsError } = await query
        .order('booking_date', { ascending: true })
        .order('booking_time', { ascending: true });
      
      if (bookingsError) {
        throw bookingsError;
      }

      setBookings(todayBookings || []);

      // Calculate stats
      const now = new Date();
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const twoHoursFromNow = addDays(now, 0);
      twoHoursFromNow.setHours(now.getHours() + 2);

      // Get today's stats
      const { data: todayStats } = await supabase
        .from('table_bookings')
        .select('party_size, status, booking_time, table_booking_payments(amount, status)')
        .gte('booking_date', format(todayStart, 'yyyy-MM-dd'))
        .lte('booking_date', format(todayEnd, 'yyyy-MM-dd'))
        .in('status', ['confirmed', 'pending_payment']);

      // Get tomorrow's count
      const tomorrow = addDays(todayStart, 1);
      const { data: tomorrowData } = await supabase
        .from('table_bookings')
        .select('id')
        .eq('booking_date', format(tomorrow, 'yyyy-MM-dd'))
        .in('status', ['confirmed', 'pending_payment']);

      // Calculate stats
      const stats: DashboardStats = {
        todayBookings: todayStats?.length || 0,
        todayCovers: todayStats?.reduce((sum: number, b: any) => sum + b.party_size, 0) || 0,
        upcomingArrivals: todayStats?.filter((b: any) => {
          const bookingTime = new Date(`${format(now, 'yyyy-MM-dd')} ${b.booking_time}`);
          return bookingTime >= now && bookingTime <= twoHoursFromNow;
        }).length || 0,
        pendingPayments: todayStats?.filter((b: any) => b.status === 'pending_payment').length || 0,
        todayRevenue: todayStats?.reduce((sum: number, b: any) => {
          const payment = b.table_booking_payments?.find((p: any) => p.status === 'completed');
          return sum + (payment?.amount || 0);
        }, 0) || 0,
        tomorrowBookings: tomorrowData?.length || 0,
      };

      setStats(stats);
    } catch (err: any) {
      console.error('Error loading dashboard:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Format time from HH:mm:ss to 12-hour format (e.g., 7:30pm, 8am)
  const formatBookingTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'pm' : 'am';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    
    // If minutes are 0, just show the hour (e.g., "7pm" instead of "7:00pm")
    if (minutes === 0) {
      return `${displayHours}${period}`;
    }
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`;
  };

  if (!canView) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Table Bookings"
          subtitle="Manage restaurant table reservations"
          backButton={{
            label: "Back to Dashboard",
            href: "/"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" 
              title="Access Denied" 
              description="You do not have permission to view table bookings." 
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
          title="Table Bookings"
          subtitle="Manage restaurant table reservations"
          backButton={{
            label: "Back to Dashboard",
            href: "/"
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

  if (error) {
    return (
      <PageWrapper>
        <PageHeader 
          title="Table Bookings"
          subtitle="Manage restaurant table reservations"
          backButton={{
            label: "Back to Dashboard",
            href: "/"
          }}
        />
        <PageContent>
          <Card>
            <Alert variant="error" title="Error" description={`Error loading dashboard: ${error}`} />
          </Card>
        </PageContent>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Table Bookings"
        subtitle="Manage restaurant table reservations"
        backButton={{
          label: "Back to Dashboard",
          href: "/"
        }}
        actions={
          <NavGroup>
            {canCreate && (
              <NavLink href="/table-bookings/new">
                Add Booking
              </NavLink>
            )}
            <NavLink href="/table-bookings/calendar">
              Calendar View
            </NavLink>
            {canManage && (
              <NavLink href="/table-bookings/settings">
                Settings
              </NavLink>
            )}
          </NavGroup>
        }
      />
      
      <PageContent className="space-y-4 sm:space-y-6 px-0 sm:px-6">
        {/* Stats Grid - Hidden on mobile */}
        <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Stat label="Today's Bookings"
            value={stats.todayBookings}
            icon={<CalendarIcon />}
          />
          <Stat label="Today's Covers"
            value={stats.todayCovers}
            icon={<UserGroupIcon />}
          />
          <Stat label="Next 2 Hours"
            value={stats.upcomingArrivals}
            icon={<ClockIcon />}
          />
          <Stat label="Pending Payment"
            value={stats.pendingPayments}
            icon={<ExclamationCircleIcon />}
          />
          <Stat label="Today's Revenue"
            value={`£${stats.todayRevenue.toFixed(2)}`}
            icon={<CurrencyPoundIcon />}
          />
          <Stat label="Tomorrow"
            value={stats.tomorrowBookings}
            icon={<CalendarIcon />}
          />
        </div>

      {/* Date Selector */}
      <div className="px-2 sm:px-0">
        <Card className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <label className="font-medium hidden sm:block">View:</label>
            
            {/* View Mode Toggle */}
            <div className="flex bg-gray-100 rounded-md p-1 w-full sm:w-auto">
              <button
                onClick={() => setViewMode('day')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${
                  viewMode === 'day'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${
                  viewMode === 'month'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                This Month
              </button>
              <button
                onClick={() => setViewMode('next-month')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${
                  viewMode === 'next-month'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Next Month
              </button>
            </div>
            
            {/* Date Navigation - Only show for day and week views */}
            {(viewMode === 'day' || viewMode === 'week') && (
              <div className="flex items-center gap-2 sm:ml-4 justify-center sm:justify-start">
                <button
                  onClick={() => {
                    if (viewMode === 'day') {
                      setSelectedDate(addDays(selectedDate, -1));
                    } else if (viewMode === 'week') {
                      setSelectedDate(addWeeks(selectedDate, -1));
                    }
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
                
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => setSelectedDate(new Date(e.target.value))}
                  className="border rounded px-3 py-1 text-sm"
                />
                
                <button
                  onClick={() => {
                    if (viewMode === 'day') {
                      setSelectedDate(addDays(selectedDate, 1));
                    } else if (viewMode === 'week') {
                      setSelectedDate(addWeeks(selectedDate, 1));
                    }
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
              </div>
            )}
            
            <button
              onClick={() => setSelectedDate(new Date())}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              Today
            </button>
          </div>
          
          <Button
            onClick={loadDashboardData}
            variant="secondary"
            size="sm"
          >
            <ArrowPathIcon className="h-5 w-5" />
          </Button>
        </div>
      </Card>
      </div>

      {/* Bookings Timeline */}
      <div className="px-2 sm:px-0">
      <Section
        title={
          viewMode === 'day' 
            ? `Bookings for ${format(selectedDate, 'EEEE, d MMMM yyyy')}`
            : viewMode === 'week'
            ? `Bookings for week of ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'd MMM')} - ${format(endOfWeek(selectedDate, { weekStartsOn: 1 }), 'd MMM yyyy')}`
            : viewMode === 'month'
            ? `Bookings for ${format(new Date(), 'MMMM yyyy')}`
            : `Bookings for ${format(addMonths(new Date(), 1), 'MMMM yyyy')}`
        }
        className="w-full"
      >
        <Card className="w-full">
          <div className={viewMode === 'week' || viewMode === 'month' || viewMode === 'next-month' ? '' : 'divide-y'}>
            {bookings.length === 0 ? (
              <EmptyState
                title={`No bookings for ${
                  viewMode === 'day' ? 'this date' 
                  : viewMode === 'week' ? 'this week'
                  : viewMode === 'month' ? 'this month'
                  : 'next month'
                }`}
              />
            ) : viewMode !== 'day' ? (
            // Group bookings by date for week view
            Object.entries(
              bookings.reduce((groups, booking) => {
                const date = booking.booking_date;
                if (!groups[date]) groups[date] = [];
                groups[date].push(booking);
                return groups;
              }, {} as Record<string, TableBooking[]>)
            ).map(([date, dayBookings]) => (
              <div key={date} className="border-b last:border-b-0">
                <div className="bg-gray-50 px-4 py-2 font-medium text-sm">
                  {format(new Date(date), 'EEEE, d MMMM')} - {dayBookings.length} bookings
                </div>
                <div className="divide-y">
                  {dayBookings.map((booking) => (
                    <Link
                      key={booking.id}
                      href={`/table-bookings/${booking.id}`}
                      className="block p-4 hover:bg-gray-50 transition-colors"
                    >
                      {/* Top row: Time, Duration, Reference, Status */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-1 sm:gap-2">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="text-lg font-bold">{formatBookingTime(booking.booking_time)}</div>
                          <div className="text-sm text-gray-500">{booking.duration_minutes} mins</div>
                          <div className="text-sm text-gray-500 hidden sm:inline">Ref: {booking.booking_reference}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-gray-500 sm:hidden">Ref: {booking.booking_reference}</div>
                          {booking.status === 'confirmed' && (
                            <Badge variant="success" size="sm">
                              Confirmed
                            </Badge>
                          )}
                          {booking.status === 'pending_payment' && (
                            <Badge variant="warning" size="sm">
                              Payment Due
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      {/* Customer details */}
                      <div className="space-y-1">
                        <div className="font-medium">
                          {booking.customer?.first_name} {booking.customer?.last_name}
                        </div>
                        <div className="text-sm text-gray-600">
                          Party of {booking.party_size} • {booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular'}
                        </div>
                        
                        {/* Full width notes */}
                        {booking.special_requirements && (
                          <div className="text-sm text-orange-600 mt-2 w-full">
                            <span className="font-medium">Notes:</span> {booking.special_requirements}
                          </div>
                        )}
                        
                        {/* Full width allergies */}
                        {booking.allergies && booking.allergies.length > 0 && (
                          <div className="text-sm text-red-600 mt-2 w-full">
                            ⚠️ <span className="font-medium">Allergies:</span> {booking.allergies.join(', ')}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Day view - flat list
            bookings.map((booking) => (
              <Link
                key={booking.id}
                href={`/table-bookings/${booking.id}`}
                className="block p-4 hover:bg-gray-50 transition-colors"
              >
                {/* Top row: Time, Duration, Reference, Status */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="text-2xl font-bold">{formatBookingTime(booking.booking_time)}</div>
                    <div className="text-sm text-gray-500">{booking.duration_minutes} mins</div>
                    <div className="text-sm text-gray-500 hidden sm:inline">Ref: {booking.booking_reference}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-500 sm:hidden">Ref: {booking.booking_reference}</div>
                    {booking.status === 'confirmed' && (
                      <Badge variant="success" size="sm" icon={<CheckCircleIcon className="h-4 w-4" />}>
                        Confirmed
                      </Badge>
                    )}
                    {booking.status === 'pending_payment' && (
                      <Badge variant="warning" size="sm" icon={<ExclamationCircleIcon className="h-4 w-4" />}>
                        Awaiting Payment
                      </Badge>
                    )}
                    {booking.status === 'cancelled' && (
                      <Badge variant="error" size="sm" icon={<XCircleIcon className="h-4 w-4" />}>
                        Cancelled
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Customer details */}
                <div className="space-y-1">
                  <div className="font-medium">
                    {booking.customer?.first_name} {booking.customer?.last_name}
                  </div>
                  <div className="text-sm text-gray-600">
                    Party of {booking.party_size} • {booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular'}
                  </div>
                  
                  {/* Full width notes/special requirements */}
                  {booking.special_requirements && (
                    <div className="text-sm text-orange-600 mt-2 w-full">
                      <span className="font-medium">Notes:</span> {booking.special_requirements}
                    </div>
                  )}
                  
                  {/* Full width allergies */}
                  {booking.allergies && booking.allergies.length > 0 && (
                    <div className="text-sm text-red-600 mt-2 w-full">
                      ⚠️ <span className="font-medium">Allergies:</span> {booking.allergies.join(', ')}
                    </div>
                  )}
                </div>
              </Link>
            ))
          )}
          </div>
        </Card>
      </Section>
      </div>

      {/* Quick Actions */}
      <div className="px-2 sm:px-0">
      <Section title="Quick Actions">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Link
            href="/table-bookings/search"
            className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-center"
          >
            <h3 className="font-medium mb-2">Search Bookings</h3>
            <p className="text-sm text-gray-600">Find by name, phone, or reference</p>
          </Link>
          
          <Link
            href="/table-bookings/reports"
            className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-center"
          >
            <h3 className="font-medium mb-2">Reports</h3>
            <p className="text-sm text-gray-600">Analytics and insights</p>
          </Link>
          
          <Link
            href="/table-bookings/settings"
            className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-center"
          >
            <h3 className="font-medium mb-2">Settings</h3>
            <p className="text-sm text-gray-600">Tables, policies, and templates</p>
          </Link>
          
          <Link
            href="/settings/business-hours"
            className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-center"
          >
            <h3 className="font-medium mb-2">Kitchen Hours</h3>
            <p className="text-sm text-gray-600">Manage availability</p>
          </Link>
          
          {canManage && (
            <Link
              href="/table-bookings/monitoring"
              className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow text-center"
            >
              <h3 className="font-medium mb-2">System Monitoring</h3>
              <p className="text-sm text-gray-600">Health checks and alerts</p>
            </Link>
          )}
        </div>
      </Section>
      </div>
      </PageContent>
    </PageWrapper>
  );
}
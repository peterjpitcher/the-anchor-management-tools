'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, startOfDay, endOfDay, addDays, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
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
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
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
      } else {
        // Week view - get current week (starting Monday)
        const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
        query = query
          .gte('booking_date', format(weekStart, 'yyyy-MM-dd'))
          .lte('booking_date', format(weekEnd, 'yyyy-MM-dd'));
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
        todayCovers: todayStats?.reduce((sum, b) => sum + b.party_size, 0) || 0,
        upcomingArrivals: todayStats?.filter(b => {
          const bookingTime = new Date(`${format(now, 'yyyy-MM-dd')} ${b.booking_time}`);
          return bookingTime >= now && bookingTime <= twoHoursFromNow;
        }).length || 0,
        pendingPayments: todayStats?.filter(b => b.status === 'pending_payment').length || 0,
        todayRevenue: todayStats?.reduce((sum, b) => {
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
      
      <PageContent>
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="font-medium">View:</label>
            
            {/* View Mode Toggle */}
            <div className="flex bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('day')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  viewMode === 'day'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Week
              </button>
            </div>
            
            {/* Date Navigation */}
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => {
                  if (viewMode === 'day') {
                    setSelectedDate(addDays(selectedDate, -1));
                  } else {
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
                  } else {
                    setSelectedDate(addWeeks(selectedDate, 1));
                  }
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
            
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

      {/* Bookings Timeline */}
      <Section
        title={
          viewMode === 'day' 
            ? `Bookings for ${format(selectedDate, 'EEEE, d MMMM yyyy')}`
            : `Bookings for week of ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'd MMM')} - ${format(endOfWeek(selectedDate, { weekStartsOn: 1 }), 'd MMM yyyy')}`
        }
      >
        <Card>
          <div className={viewMode === 'week' ? '' : 'divide-y'}>
            {bookings.length === 0 ? (
              <EmptyState
                title={`No bookings for this ${viewMode === 'day' ? 'date' : 'week'}`}
              />
            ) : viewMode === 'week' ? (
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
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <div className="text-xl font-bold">{booking.booking_time}</div>
                            <div className="text-sm text-gray-500">{booking.duration_minutes} mins</div>
                          </div>
                          <div>
                            <div className="font-medium">
                              {booking.customer?.first_name} {booking.customer?.last_name}
                            </div>
                            <div className="text-sm text-gray-600">
                              Party of {booking.party_size} • {booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular'}
                            </div>
                            {booking.special_requirements && (
                              <div className="text-sm text-orange-600 mt-1">
                                {booking.special_requirements}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-sm text-gray-500">Ref: {booking.booking_reference}</div>
                            <div className="text-sm">
                              {booking.status === 'confirmed' && (
                                <Badge variant="success" size="sm">
                                  <CheckCircleIcon className="h-4 w-4 mr-1" />
                                  Confirmed
                                </Badge>
                              )}
                              {booking.status === 'pending_payment' && (
                                <Badge variant="warning" size="sm">
                                  <ExclamationCircleIcon className="h-4 w-4 mr-1" />
                                  Awaiting Payment
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{booking.booking_time}</div>
                      <div className="text-sm text-gray-500">{booking.duration_minutes} mins</div>
                    </div>
                    <div>
                      <div className="font-medium">
                        {booking.customer?.first_name} {booking.customer?.last_name}
                      </div>
                      <div className="text-sm text-gray-600">
                        Party of {booking.party_size} • {booking.booking_type === 'sunday_lunch' ? 'Sunday Lunch' : 'Regular'}
                      </div>
                      {booking.special_requirements && (
                        <div className="text-sm text-orange-600 mt-1">
                          {booking.special_requirements}
                        </div>
                      )}
                      {booking.allergies && booking.allergies.length > 0 && (
                        <div className="text-sm text-red-600 mt-1">
                          ⚠️ Allergies: {booking.allergies.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Ref: {booking.booking_reference}</div>
                      <div className="text-sm">
                        {booking.status === 'confirmed' && (
                          <Badge variant="success" size="sm">
                            <CheckCircleIcon className="h-4 w-4 mr-1" />
                            Confirmed
                          </Badge>
                        )}
                        {booking.status === 'pending_payment' && (
                          <Badge variant="warning" size="sm">
                            <ExclamationCircleIcon className="h-4 w-4 mr-1" />
                            Awaiting Payment
                          </Badge>
                        )}
                        {booking.status === 'cancelled' && (
                          <Badge variant="error" size="sm">
                            <XCircleIcon className="h-4 w-4 mr-1" />
                            Cancelled
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
          </div>
        </Card>
      </Section>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
      </PageContent>
    </PageWrapper>
  );
}
'use client'

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import { usePermissions } from '@/contexts/PermissionContext';
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { ChartBarIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';

// UI v2 Components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { Button } from '@/components/ui-v2/forms/Button';
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup';
import { NavLink } from '@/components/ui-v2/navigation/NavLink';
import { Input } from '@/components/ui-v2/forms/Input';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Stat } from '@/components/ui-v2/display/Stat';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Badge } from '@/components/ui-v2/display/Badge';
import { TabNav } from '@/components/ui-v2/navigation/TabNav';

interface ReportData {
  totalBookings: number;
  totalCovers: number;
  totalRevenue: number;
  averagePartySize: number;
  noShowRate: number;
  cancellationRate: number;
  sundayLunchBookings: number;
  regularBookings: number;
  bookingsByDay: Record<string, number>;
  bookingsByHour: Record<string, number>;
  topCustomers: Array<{
    customer_id: string;
    customer_name: string;
    booking_badge: number;
    total_covers: number;
  }>;
  revenueByType: {
    sunday_lunch: number;
    regular: number;
  };
}

export default function TableBookingReportsPage() {
  const supabase = useSupabase();
  const { hasPermission } = usePermissions();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });
  const [reportType, setReportType] = useState<'month' | 'week' | 'custom'>('month');

  const canView = hasPermission('table_bookings', 'view');
  const canManage = hasPermission('table_bookings', 'manage');

  useEffect(() => {
    if (canView) {
      loadReportData();
    }
  }, [dateRange, canView]);

  async function loadReportData() {
    try {
      setLoading(true);
      setError(null);

      // Get all bookings in date range
      const { data: bookings, error: bookingsError } = await supabase
        .from('table_bookings')
        .select(`
          *,
          customer:customers(id, first_name, last_name),
          table_booking_payments(amount, status)
        `)
        .gte('booking_date', dateRange.start)
        .lte('booking_date', dateRange.end);

      if (bookingsError) throw bookingsError;

      // Calculate metrics
      const totalBookings = bookings?.length || 0;
      const confirmedBookings = bookings?.filter((b: any) => b.status === 'confirmed' || b.status === 'completed') || [];
      const cancelledBookings = bookings?.filter((b: any) => b.status === 'cancelled') || [];
      const noShowBookings = bookings?.filter((b: any) => b.status === 'no_show') || [];
      
      const totalCovers = confirmedBookings.reduce((sum: number, b: any) => sum + b.party_size, 0);
      const averagePartySize = confirmedBookings.length > 0 ? totalCovers / confirmedBookings.length : 0;
      const noShowRate = totalBookings > 0 ? (noShowBookings.length / totalBookings) * 100 : 0;
      const cancellationRate = totalBookings > 0 ? (cancelledBookings.length / totalBookings) * 100 : 0;
      
      const sundayLunchBookings = confirmedBookings.filter((b: any) => b.booking_type === 'sunday_lunch').length;
      const regularBookings = confirmedBookings.filter((b: any) => b.booking_type === 'regular').length;

      // Calculate revenue
      let totalRevenue = 0;
      let sundayLunchRevenue = 0;
      bookings?.forEach((booking: any) => {
        const payment = booking.table_booking_payments?.find((p: any) => p.status === 'completed');
        if (payment) {
          totalRevenue += payment.amount;
          if (booking.booking_type === 'sunday_lunch') {
            sundayLunchRevenue += payment.amount;
          }
        }
      });

      // Bookings by day of week
      const bookingsByDay: Record<string, number> = {
        'Monday': 0,
        'Tuesday': 0,
        'Wednesday': 0,
        'Thursday': 0,
        'Friday': 0,
        'Saturday': 0,
        'Sunday': 0,
      };
      
      confirmedBookings.forEach((booking: any) => {
        const dayName = format(new Date(booking.booking_date), 'EEEE');
        bookingsByDay[dayName]++;
      });

      // Bookings by hour
      const bookingsByHour: Record<string, number> = {};
      confirmedBookings.forEach((booking: any) => {
        const hour = booking.booking_time.split(':')[0];
        bookingsByHour[hour] = (bookingsByHour[hour] || 0) + 1;
      });

      // Top customers
      const customerBookings: Record<string, any> = {};
      confirmedBookings.forEach((booking: any) => {
        if (booking.customer) {
          const customerId = booking.customer.id;
          if (!customerBookings[customerId]) {
            customerBookings[customerId] = {
              customer_id: customerId,
              customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
              booking_badge: 0,
              total_covers: 0,
            };
          }
          customerBookings[customerId].booking_badge++;
          customerBookings[customerId].total_covers += booking.party_size;
        }
      });
      
      const topCustomers = Object.values(customerBookings)
        .sort((a, b) => b.booking_badge - a.booking_badge)
        .slice(0, 10);

      setReportData({
        totalBookings: confirmedBookings.length,
        totalCovers,
        totalRevenue,
        averagePartySize,
        noShowRate,
        cancellationRate,
        sundayLunchBookings,
        regularBookings,
        bookingsByDay,
        bookingsByHour,
        topCustomers,
        revenueByType: {
          sunday_lunch: sundayLunchRevenue,
          regular: totalRevenue - sundayLunchRevenue,
        },
      });
    } catch (err: any) {
      console.error('Error loading report data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDateRangeChange(type: 'month' | 'week' | 'custom') {
    setReportType(type);
    const now = new Date();
    
    switch (type) {
      case 'month':
        setDateRange({
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
        });
        break;
      case 'week':
        setDateRange({
          start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        });
        break;
    }
  }

  async function downloadReport() {
    if (!reportData) return;
    
    const csvContent = [
      ['Table Booking Report', `${dateRange.start} to ${dateRange.end}`],
      [],
      ['Metric', 'Value'],
      ['Total Bookings', reportData.totalBookings],
      ['Total Covers', reportData.totalCovers],
      ['Total Revenue', `£${reportData.totalRevenue.toFixed(2)}`],
      ['Average Party Size', reportData.averagePartySize.toFixed(1)],
      ['No-Show Rate', `${reportData.noShowRate.toFixed(1)}%`],
      ['Cancellation Rate', `${reportData.cancellationRate.toFixed(1)}%`],
      ['Sunday Lunch Bookings', reportData.sundayLunchBookings],
      ['Regular Bookings', reportData.regularBookings],
      [],
      ['Bookings by Day'],
      ...Object.entries(reportData.bookingsByDay).map(([day, count]) => [day, count]),
      [],
      ['Bookings by Hour'],
      ...Object.entries(reportData.bookingsByHour).sort().map(([hour, count]) => [`${hour}:00`, count]),
      [],
      ['Top Customers'],
      ['Name', 'Bookings', 'Total Covers'],
      ...reportData.topCustomers.map(c => [c.customer_name, c.booking_badge, c.total_covers]),
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-bookings-report-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const layoutProps = {
    title: 'Table Booking Reports',
    subtitle: 'Analytics and insights for table bookings',
    backButton: { label: 'Back to Table Bookings', href: '/table-bookings' },
  };

  if (!canView) {
    return (
      <PageLayout {...layoutProps}>
        <Alert variant="error" description="You do not have permission to view reports." />
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout {...layoutProps} loading loadingLabel="Loading table booking reports...">
        {null}
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout {...layoutProps}>
        <Alert variant="error" description={`Error loading report: ${error}`} />
      </PageLayout>
    );
  }

  const tabs = [
    { key: 'week', label: 'This Week', active: reportType === 'week' },
    { key: 'month', label: 'This Month', active: reportType === 'month' },
    { key: 'custom', label: 'Custom Range', active: reportType === 'custom' },
  ];

  const topCustomerColumns = [
    { 
      key: 'customer_name', 
      header: 'Customer', 
      cell: (row: any) => row.customer_name 
    },
    { 
      key: 'booking_count', 
      header: 'Bookings', 
      align: 'center' as const, 
      cell: (row: any) => row.booking_count 
    },
    { 
      key: 'total_covers', 
      header: 'Total Covers', 
      align: 'center' as const, 
      cell: (row: any) => row.total_covers 
    },
  ];

  const navActions = (
    <NavGroup>
      <NavLink
        onClick={!reportData ? undefined : downloadReport}
        disabled={!reportData}
        className="font-semibold"
      >
        <ArrowDownTrayIcon className="h-5 w-5" />
        Download CSV
      </NavLink>
    </NavGroup>
  );

  return (
    <PageLayout
      {...layoutProps}
      navActions={navActions}
    >
      <div className="space-y-6">
        {/* Date Range Selector */}
        <Card>
        <TabNav
          tabs={tabs}
          onChange={(id) => handleDateRangeChange(id as 'month' | 'week' | 'custom')}
        />
        
        {reportType === 'custom' && (
          <div className="flex items-center gap-2 mt-4">
            <Input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
            <span className="text-gray-500">to</span>
            <Input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
            <Button onClick={loadReportData} variant="secondary">
              Update
            </Button>
          </div>
        )}
      </Card>

      {reportData && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <Section title="Key Metrics">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat
                label="Total Bookings"
                value={reportData.totalBookings}
              />
              <Stat
                label="Total Covers"
                value={reportData.totalCovers}
              />
              <Stat
                label="Total Revenue"
                value={`£${reportData.totalRevenue.toFixed(2)}`}
                color="success"
              />
              <Stat
                label="Avg Party Size"
                value={reportData.averagePartySize.toFixed(1)}
              />
            </div>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            {/* Booking Types */}
            <Section title="Booking Types">
              <Card>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>Regular Dining</span>
                    <span className="font-medium">{reportData.regularBookings}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Sunday Lunch</span>
                    <span className="font-medium">{reportData.sundayLunchBookings}</span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between items-center">
                      <span>Sunday Lunch Revenue</span>
                      <span className="font-medium">£{reportData.revenueByType.sunday_lunch.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Section>

            {/* Performance Metrics */}
            <Section title="Performance Metrics">
              <Card>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span>No-Show Rate</span>
                    <Badge variant={reportData.noShowRate > 10 ? 'error' : 'success'}>
                      {reportData.noShowRate.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Cancellation Rate</span>
                    <Badge variant={reportData.cancellationRate > 20 ? 'error' : 'success'}>
                      {reportData.cancellationRate.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
              </Card>
            </Section>
          </div>

          {/* Bookings by Day */}
          <Section title="Bookings by Day of Week">
            <Card>
              <div className="grid grid-cols-7 gap-4">
                {Object.entries(reportData.bookingsByDay).map(([day, count]) => (
                  <div key={day} className="text-center">
                    <div className="text-sm text-gray-600 mb-1">{day.slice(0, 3)}</div>
                    <div className="text-2xl font-bold">{count}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Section>

          {/* Bookings by Hour */}
          <Section title="Bookings by Hour">
            <Card>
              <div className="space-y-2">
                {Object.entries(reportData.bookingsByHour)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([hour, count]) => (
                    <div key={hour} className="flex items-center gap-4">
                      <span className="w-16 text-sm">{hour}:00</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                        <div
                          className="bg-blue-600 h-full rounded-full"
                          style={{
                            width: `${(count / Math.max(...Object.values(reportData.bookingsByHour))) * 100}%`
                          }}
                        />
                      </div>
                      <span className="w-12 text-sm text-right">{count}</span>
                    </div>
                  ))}
              </div>
            </Card>
          </Section>

          {/* Top Customers */}
          <Section title="Top Customers">
            <Card>
              <DataTable
                data={reportData.topCustomers}
                columns={topCustomerColumns}
                getRowKey={(item) => item.customer_id}
              />
            </Card>
          </Section>
        </div>
      )}
      </div>
    </PageLayout>
  );
}

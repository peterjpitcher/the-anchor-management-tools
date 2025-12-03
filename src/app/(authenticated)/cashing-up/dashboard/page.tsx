import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { getDashboardDataAction } from '@/app/actions/cashing-up';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { createClient } from '@/lib/supabase/server';

export default async function CashupDashboardPage({ searchParams }: { searchParams: Promise<{ year?: string; compareYear?: string }> }) {
  const { year: paramYear, compareYear: paramCompareYear } = await searchParams;
  const currentYear = new Date().getFullYear();
  const year = paramYear ? parseInt(paramYear) : currentYear;
  const compareYear = paramCompareYear ? parseInt(paramCompareYear) : null;

  // Calculate date ranges
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;

  const supabase = await createClient();
  const { data: site } = await supabase.from('sites').select('id').limit(1).single();
  const siteId = site?.id;

  // Fetch main data
  const res = await getDashboardDataAction(siteId, fromDate, toDate);
  const data = res.data;

  // Fetch comparison data if requested
  let comparisonData = null;
  if (compareYear && siteId) {
    const compareFrom = `${compareYear}-01-01`;
    let compareTo = `${compareYear}-12-31`;

    // If we are viewing the current year, limit the comparison year to the same date (YTD)
    if (year === currentYear) {
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      compareTo = `${compareYear}-${month}-${day}`;
    }

    const compareRes = await getDashboardDataAction(siteId, compareFrom, compareTo);
    comparisonData = compareRes.data;
  }

  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
    { label: 'Insights', href: '/cashing-up/insights' },
    { label: 'Import History', href: '/cashing-up/import' },
  ];

  if (!data) {
    return (
        <PageLayout title="Cashing Up" navItems={navItems} error={res.error || 'Access Denied'} />
    );
  }

  // Map data for charts
  const weeklyTakingsMap = new Map<string, { totalTakings: number; target: number }>();

  data.charts.dailyTakings.forEach(t => {
    const date = parseISO(t.date);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    const monday = new Date(date);
    monday.setDate(diff);
    const key = format(monday, 'yyyy-MM-dd');

    const current = weeklyTakingsMap.get(key) || { totalTakings: 0, target: 0 };
    weeklyTakingsMap.set(key, {
        totalTakings: current.totalTakings + t.totalTakings,
        target: current.target + (t.target || 0)
    });
  });

  const sortedWeeks = Array.from(weeklyTakingsMap.keys()).sort();
  
  const takingsData = sortedWeeks.map(weekStart => {
      const d = weeklyTakingsMap.get(weekStart)!;
      return {
          label: format(parseISO(weekStart), 'dd MMM'),
          value: d.totalTakings,
          color: d.totalTakings >= d.target ? '#10B981' : '#EF4444',
          targetLineValue: d.target, // Add target value for the watermark line
      };
  });

  // Aggregate Variance Data by Month
  const monthlyVariance = new Array(12).fill(0);

  data.charts.dailyVariance.forEach(v => {
    const monthIndex = parseInt(v.date.substring(5, 7)) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      monthlyVariance[monthIndex] += v.totalVariance;
    }
  });

  const varianceData = monthlyVariance.map((total, index) => ({
    label: new Date(year, index, 1).toLocaleString('default', { month: 'short' }),
    value: total,
    color: total >= 0 ? '#10B981' : '#EF4444'
  }));

  // Helper for formatting
  const fmt = (num: number) => num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Generate Year Options (e.g., from 2019 to current year)
  const START_YEAR = 2019;
  const yearOptions = Array.from({ length: currentYear - START_YEAR + 1 }, (_, i) => START_YEAR + i);

  return (
    <PageLayout title="Cashing Up" navItems={navItems}>
      
      {/* Filter Controls */}
      <div className="mb-6 flex gap-4 items-end bg-white p-4 rounded-lg shadow-sm border">
        <form className="flex gap-4 items-end">
            <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Year</label>
                <select name="year" defaultValue={year} className="border rounded p-2 text-sm min-w-[100px]">
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Compare To</label>
                <select name="compareYear" defaultValue={compareYear || ''} className="border rounded p-2 text-sm min-w-[100px]">
                    <option value="">None</option>
                    {yearOptions.filter(y => y !== year).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <button type="submit" className="bg-gray-800 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">Update</button>
        </form>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Total Takings</h3>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold mt-2">£{fmt(data.kpis.totalTakings)}</p>
            {comparisonData && (
                <div className={`text-sm font-medium mb-1 ${data.kpis.totalTakings >= comparisonData.kpis.totalTakings ? 'text-green-600' : 'text-red-600'}`}>
                    {data.kpis.totalTakings >= comparisonData.kpis.totalTakings ? '↑' : '↓'} 
                    {comparisonData.kpis.totalTakings > 0 ? Math.abs(((data.kpis.totalTakings - comparisonData.kpis.totalTakings) / comparisonData.kpis.totalTakings) * 100).toFixed(1) : 0}%
                </div>
            )}
          </div>
          <div className="mt-1">
             <p className="text-xs text-gray-500">Target: £{fmt(data.kpis.totalTarget)}</p>
             {data.kpis.totalTarget > 0 && (
                 <p className={`text-xs font-medium ${data.kpis.totalTakings >= data.kpis.totalTarget ? 'text-green-600' : 'text-red-600'}`}>
                     {data.kpis.totalTakings >= data.kpis.totalTarget ? '+' : ''}
                     {((data.kpis.totalTakings - data.kpis.totalTarget) / data.kpis.totalTarget * 100).toFixed(1)}% vs Target
                 </p>
             )}
          </div>
          {comparisonData && <p className="text-xs text-gray-400 mt-1">vs £{fmt(comparisonData.kpis.totalTakings)} ({compareYear})</p>}
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Total Variance</h3>
          <p className={`text-3xl font-bold mt-2 ${data.kpis.totalVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>
            £{fmt(data.kpis.totalVariance)}
          </p>
           {comparisonData && <p className="text-xs text-gray-400 mt-1">vs £{fmt(comparisonData.kpis.totalVariance)} ({compareYear})</p>}
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Sessions Submitted</h3>
          <p className="text-3xl font-bold mt-2">{data.kpis.daysWithSubmittedSessions}</p>
           {comparisonData && <p className="text-xs text-gray-400 mt-1">vs {comparisonData.kpis.daysWithSubmittedSessions} ({compareYear})</p>}
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Avg Daily Takings</h3>
          <p className="text-3xl font-bold mt-2">£{fmt(data.kpis.averageDailyTakings)}</p>
           {comparisonData && <p className="text-xs text-gray-400 mt-1">vs £{fmt(comparisonData.kpis.averageDailyTakings)} ({compareYear})</p>}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="font-semibold mb-4">Weekly Takings Performance</h3>
          <div className="h-64">
            {takingsData.length > 0 ? (
              <BarChart data={takingsData} formatType="currency" />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No data available</div>
            )}
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="font-semibold mb-4">Monthly Variance Trend</h3>
          <div className="h-64">
             {varianceData.length > 0 ? (
                <BarChart data={varianceData} formatType="currency" />
             ) : (
                <div className="h-full flex items-center justify-center text-gray-400">No data available</div>
             )}
          </div>
        </div>
      </div>

      {/* Variance Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b">
            <h3 className="font-semibold">Recent Variance & Discrepancies</h3>
        </div>
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 w-80">Date</th>
              <th className="px-6 py-3 text-right">Cash Total</th>
              <th className="px-6 py-3 text-right">Card Total</th>
              <th className="px-6 py-3 text-right">Stripe Total</th>
              <th className="px-6 py-3 text-right">Total Takings</th>
              <th className="px-6 py-3 text-right">Total Variance</th>
              <th className="px-6 py-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.tables.variance.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-4 text-center">No records found</td></tr>
            ) : (
                data.tables.variance.map((row, idx) => (
                    <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                        <td className="px-6 py-4 w-80">
                            <Link 
                                href={`/cashing-up/daily?date=${row.sessionDate}&siteId=${row.siteId}`}
                                className="text-blue-600 hover:underline font-medium"
                                title="View/Edit Daily Entry"
                            >
                                {format(parseISO(row.sessionDate), 'EEEE, MMMM d, yyyy')}
                            </Link>
                        </td>
                        <td className="px-6 py-4 text-right font-mono">£{fmt(row.cashTotal)}</td>
                        <td className="px-6 py-4 text-right font-mono">£{fmt(row.cardTotal)}</td>
                        <td className="px-6 py-4 text-right font-mono">£{fmt(row.stripeTotal)}</td>
                        <td className="px-6 py-4 text-right font-mono">£{fmt(row.totalTakings)}</td>
                        <td className={`px-6 py-4 text-right font-mono font-bold ${row.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            £{fmt(row.variance)}
                        </td>
                        <td className="px-6 py-4 text-gray-400 italic">{row.notes || '-'}</td>
                    </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}

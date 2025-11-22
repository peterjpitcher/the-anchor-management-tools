import { getDashboardDataAction } from '@/app/actions/cashing-up';
import { LineChart } from '@/components/charts/LineChart';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';

export default async function CashupDashboardPage() {
  const res = await getDashboardDataAction();
  const data = res.data;

  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
  ];

  if (!data) {
    return (
        <PageLayout title="Cashing Up" navItems={navItems} error={res.error || 'Access Denied'} />
    );
  }

  // Map data for charts
  const takingsData = data.charts.dailyTakings.map(t => ({
    date: t.date,
    value: t.totalTakings
  }));

  return (
    <PageLayout title="Cashing Up" navItems={navItems}>
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Total Takings</h3>
          <p className="text-3xl font-bold mt-2">£{data.kpis.totalTakings.toFixed(2)}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Total Variance</h3>
          <p className={`text-3xl font-bold mt-2 ${data.kpis.totalVariance < 0 ? 'text-red-600' : 'text-green-600'}`}>
            £{data.kpis.totalVariance.toFixed(2)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Sessions Submitted</h3>
          <p className="text-3xl font-bold mt-2">{data.kpis.daysWithSubmittedSessions}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="text-gray-500 text-sm font-medium uppercase">Avg Daily Takings</h3>
          <p className="text-3xl font-bold mt-2">£{data.kpis.averageDailyTakings.toFixed(2)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="font-semibold mb-4">Daily Takings Trend</h3>
          <div className="h-64">
            {takingsData.length > 0 ? (
              <LineChart data={takingsData} label="Takings (£)" />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No data available</div>
            )}
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border">
          <h3 className="font-semibold mb-4">Daily Variance Trend</h3>
           {/* Placeholder for Variance Chart until BarChart supports negative values */}
           <div className="h-64 flex items-center justify-center text-gray-400 italic">
             (Chart not available for negative values)
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
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Site</th>
              <th className="px-6 py-3 text-right">Takings</th>
              <th className="px-6 py-3 text-right">Variance</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.tables.variance.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-4 text-center">No records found</td></tr>
            ) : (
                data.tables.variance.map((row, idx) => (
                    <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                        <td className="px-6 py-4">{row.sessionDate}</td>
                        <td className="px-6 py-4">{row.siteName || 'Site'}</td>
                        <td className="px-6 py-4 text-right font-mono">£{row.totalTakings.toFixed(2)}</td>
                        <td className={`px-6 py-4 text-right font-mono font-bold ${row.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            £{row.variance.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 capitalize">{row.status}</td>
                    </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}

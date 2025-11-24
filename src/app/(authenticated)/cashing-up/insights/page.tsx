import { getInsightsDataAction } from '@/app/actions/cashing-up';
import { BarChart } from '@/components/charts/BarChart';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { InsightsYearFilter } from '@/components/features/cashing-up/InsightsYearFilter'; // Import new client component

export default async function CashupInsightsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: paramYear } = await searchParams;
  const currentYear = new Date().getFullYear();
  const selectedYear = paramYear ? parseInt(paramYear) : undefined; // undefined means "Last 12 Months"

  const res = await getInsightsDataAction(undefined, selectedYear); // Pass selectedYear to action
  const data = res.data;

  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
    { label: 'Insights', href: '/cashing-up/insights' },
    { label: 'Import History', href: '/cashing-up/import' },
  ];

  // Generate Year Options for the InsightsYearFilter component
  const START_YEAR = 2019; // Define START_YEAR here

  if (!data) {
    return (
        <PageLayout title="Cashing Up Insights" navItems={navItems} error={res.error || 'Access Denied'} />
    );
  }

  // Prepare Chart Data
  const dayTakingsData = data.dayOfWeek.map(d => ({
    label: d.dayName.substring(0, 3),
    value: d.avgTakings,
    color: '#3B82F6' // Blue
  }));

  const dayVarianceData = data.dayOfWeek.map(d => ({
    label: d.dayName.substring(0, 3),
    value: d.avgVariance,
    color: d.avgVariance >= 0 ? '#10B981' : '#EF4444' // Green/Red (BarChart might not support per-bar color in logic perfectly if not passed in data array, but my interface update suggests it does)
  }));

  const mixData = data.paymentMix.map(d => ({
    label: d.label,
    value: d.value,
    color: d.color
  }));

  const growthData = data.monthlyGrowth.map(d => ({
    label: d.monthLabel,
    value: d.totalTakings,
    color: '#6366F1' // Indigo
  }));

  return (
    <PageLayout title="Cashing Up Insights" navItems={navItems}>
      <div className="space-y-8">
        
        {/* Filter Controls (Client Component) */}
        <InsightsYearFilter currentYear={currentYear} selectedYear={selectedYear} startYear={START_YEAR} />

        {/* Day of Week Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="font-semibold mb-4 text-gray-700">Average Takings by Day</h3>
                <div className="h-64">
                    <BarChart data={dayTakingsData} height={250} formatType="currency" />
                </div>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="font-semibold mb-4 text-gray-700">Average Variance by Day</h3>
                <div className="h-64">
                    <BarChart data={dayVarianceData} height={250} formatType="currency" />
                </div>
                <p className="text-xs text-gray-400 mt-2 text-center">Positive = Over, Negative = Short</p>
            </div>
        </div>

        {/* Payment Mix & Growth */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="font-semibold mb-4 text-gray-700">Payment Method Mix ({selectedYear ? selectedYear : 'Last 12 Months'})</h3>
                <div className="h-64">
                    <BarChart data={mixData} height={250} horizontal formatType="currency" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                    {data.paymentMix.map((mix, i) => (
                        <div key={i} className="flex justify-between text-sm">
                            <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: mix.color }}></span>
                                {mix.label}
                            </span>
                            <span className="font-medium">{mix.percentage.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow border">
                <h3 className="font-semibold mb-4 text-gray-700">Monthly Growth (Takings)</h3>
                <div className="h-64">
                    <BarChart data={growthData} height={250} formatType="shorthandCurrency" />
                </div>
            </div>
        </div>

      </div>
    </PageLayout>
  );
}

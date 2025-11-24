import { getWeeklyDataAction } from '@/app/actions/cashing-up';
import { createClient } from '@/lib/supabase/server';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';

export default async function WeeklyCashupPage({ searchParams }: { searchParams: Promise<{ siteId?: string; week?: string }> }) {
  const { week: paramWeek } = await searchParams;
  const supabase = await createClient();
  const { data: site } = await supabase.from('sites').select('id, name').limit(1).single();
  
  const siteId = site?.id;
  
  // Default to this week's Monday
  const today = new Date();
  const day = today.getDay() || 7; 
  const d = new Date();
  const dayOfWeek = d.getDay();
  const diffToMon = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // adjust when day is sunday
  const monday = new Date(d.setDate(diffToMon));
  const defaultWeek = monday.toISOString().split('T')[0];
  
  const weekStart = paramWeek || defaultWeek;
  
  let weeklyData: any[] = [];
  if (siteId) {
    const res = await getWeeklyDataAction(siteId, weekStart);
    if (res.data) weeklyData = res.data;
  }

  const navItems = [
    { label: 'Dashboard', href: '/cashing-up/dashboard' },
    { label: 'Daily Entry', href: '/cashing-up/daily' },
    { label: 'Weekly Breakdown', href: '/cashing-up/weekly' },
    { label: 'Insights', href: '/cashing-up/insights' },
    { label: 'Import History', href: '/cashing-up/import' },
  ];

  if (!siteId) {
     return <PageLayout title="Cashing Up" navItems={navItems} error="No site configured." />;
  }

  return (
    <PageLayout title="Cashing Up" navItems={navItems}>
      {/* Filter Form */}
      <form className="flex gap-4 mb-8 items-end">
        <input type="hidden" name="siteId" value={siteId} />
        <div>
          <label className="block text-sm font-medium mb-1">Week Commencing</label>
          <input type="date" name="week" defaultValue={weekStart} className="border rounded p-2 h-10" />
        </div>
        <button type="submit" className="bg-gray-800 text-white px-6 py-2 rounded hover:bg-gray-700 h-10">Load</button>
        
        {weeklyData.length > 0 && (
          <a 
            href={`/api/cashup/weekly/print?siteId=${siteId}&weekStartDate=${weekStart}`} 
            target="_blank"
            className="bg-white border border-gray-300 text-gray-700 px-6 py-2 rounded hover:bg-gray-50 h-10 flex items-center"
          >
            Print PDF
          </a>
        )}
      </form>

      {/* Table */}
      <div className="overflow-x-auto border rounded-lg shadow bg-white">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3">Date</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Target</th>
              <th className="px-6 py-3 text-right">Counted</th>
              <th className="px-6 py-3 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {weeklyData.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-4 text-center">No data found for this week</td></tr>
            ) : (
              weeklyData.map((row: any) => (
                <tr key={row.session_date} className="bg-white border-b hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{row.session_date}</td>
                  <td className="px-6 py-4 capitalize">
                    <span className={`px-2 py-1 rounded text-xs ${
                      row.status === 'approved' ? 'bg-green-100 text-green-800' :
                      row.status === 'submitted' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-mono">£{row.target_amount?.toFixed(2) || '0.00'}</td>
                  <td className="px-6 py-4 text-right font-mono">£{row.total_counted_amount?.toFixed(2)}</td>
                  <td className={`px-6 py-4 text-right font-mono font-bold ${row.variance_vs_target < 0 ? 'text-red-600' : row.variance_vs_target > 0 ? 'text-green-600' : 'text-gray-600'}`}>
                    £{row.variance_vs_target?.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageLayout>
  );
}

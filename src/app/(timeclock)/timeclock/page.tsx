import { createAdminClient } from '@/lib/supabase/admin';
import { getOpenSessions } from '@/app/actions/timeclock';
import TimeclockKiosk from './TimeclockKiosk';
import { Toaster } from 'react-hot-toast';

export const dynamic = 'force-dynamic';

export default async function TimeclockPage() {
  const supabase = createAdminClient();

  // Fetch active employees using admin client (public page, no auth session)
  const [{ data: employees }, sessionsResult] = await Promise.all([
    supabase
      .from('employees')
      .select('employee_id, first_name, last_name')
      .eq('status', 'Active')
      .order('first_name')
      .order('last_name'),
    getOpenSessions(),
  ]);

  const activeEmployees = (employees ?? []) as { employee_id: string; first_name: string | null; last_name: string | null }[];
  const openSessions = sessionsResult.success ? sessionsResult.data : [];

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' },
        }}
      />
      <TimeclockKiosk employees={activeEmployees} openSessions={openSessions} />
    </>
  );
}

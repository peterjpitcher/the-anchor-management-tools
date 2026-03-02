import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import LeaveRequestForm from '../LeaveRequestForm';

export const dynamic = 'force-dynamic';

export default async function NewLeaveRequestPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, first_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!employee) redirect('/portal/leave');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Request Holiday</h2>
        <p className="text-sm text-gray-500 mt-1">Select the dates you&apos;d like to request off.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <LeaveRequestForm employeeId={employee.employee_id} />
      </div>
    </div>
  );
}

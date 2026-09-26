import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/ds';
import { StandalonePageHeader } from '@/components/shells/StandaloneShell';
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
    .in('status', ['Active', 'Started Separation'])
    .single();

  if (!employee) redirect('/portal/leave');

  return (
    <>
      <StandalonePageHeader
        title="Request Holiday"
        subtitle="Select the dates you'd like to request off"
        backButton={{ label: 'Back to My Holiday', href: '/portal/leave' }}
      />

      <Card>
        <CardHeader title="Holiday Dates" />
        <CardBody>
          <LeaveRequestForm employeeId={employee.employee_id} />
        </CardBody>
      </Card>
    </>
  );
}

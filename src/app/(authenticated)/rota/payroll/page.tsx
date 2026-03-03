import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { createClient } from '@/lib/supabase/server';
import { getPayrollMonthData, getOrCreatePayrollPeriod } from '@/app/actions/payroll';
import type { PayrollMonthApproval, PayrollPeriod } from '@/app/actions/payroll';
import { getRotaWeekDayInfo } from '@/app/actions/rota-day-info';
import PayrollClient from './PayrollClient';

export const dynamic = 'force-dynamic';

interface PayrollPageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const [canView, canApprove, canSend, canExport] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('payroll', 'approve'),
    checkUserPermission('payroll', 'send'),
    checkUserPermission('payroll', 'export'),
  ]);
  if (!canView) redirect('/');

  const resolvedParams = await Promise.resolve(searchParams ?? {});
  const params = resolvedParams as { year?: string; month?: string };

  const today = new Date();
  // Default to current month
  const year = params.year ? parseInt(params.year) : today.getFullYear();
  const month = params.month ? parseInt(params.month) : today.getMonth() + 1;

  const supabase = await createClient();

  // Fetch period first — its start/end dates define the range for day info.
  // getOrCreatePayrollPeriod may insert a row so it runs sequentially first.
  const payrollPeriod = await getOrCreatePayrollPeriod(year, month) as PayrollPeriod;

  const [payrollResult, approvalResult] = await Promise.all([
    getPayrollMonthData(year, month),
    supabase
      .from('payroll_month_approvals')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .single(),
  ]);
  const dayInfo = await getRotaWeekDayInfo(payrollPeriod.period_start, payrollPeriod.period_end);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  });

  // Build month navigation options (current year + last year)
  const monthOptions: { label: string; value: string }[] = [];
  for (let y = today.getFullYear(); y >= today.getFullYear() - 1; y--) {
    for (let m = 12; m >= 1; m--) {
      const d = new Date(y, m - 1, 1);
      if (d > today) continue;
      monthOptions.push({
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        value: `?year=${y}&month=${m}`,
      });
    }
  }

  const approval = approvalResult.data as PayrollMonthApproval | null;

  return (
    <PageLayout
      title="Payroll"
      subtitle={monthLabel}
      navItems={[
        { label: 'Rota', href: '/rota', active: false },
        { label: 'Leave', href: '/rota/leave' },
        { label: 'Timeclock', href: '/rota/timeclock' },
        { label: 'Labour Costs', href: '/rota/dashboard' },
        { label: 'Payroll', href: '/rota/payroll' },
      ]}
    >
      <Section
        title={`${monthLabel} Payroll`}
        description="Review planned vs actual hours per employee. Salaried staff are excluded. Approve to lock the snapshot, then download the Excel or email the accountant."
      >
        <Card>
          {payrollResult.success ? (
            <PayrollClient
              year={year}
              month={month}
              rows={payrollResult.data}
              employees={payrollResult.employees}
              approval={approval}
              period={payrollPeriod}
              canApprove={canApprove}
              canSend={canSend}
              canExport={canExport}
              monthOptions={monthOptions}
              dayInfo={dayInfo}
            />
          ) : (
            <p className="text-sm text-red-600">{payrollResult.error}</p>
          )}
        </Card>
      </Section>
    </PageLayout>
  );
}

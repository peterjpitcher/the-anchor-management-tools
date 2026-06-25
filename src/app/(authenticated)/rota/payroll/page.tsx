import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { Card } from '@/ds';
import { Section } from '@/ds';
import { createClient } from '@/lib/supabase/server';
import { ensurePayrollPeriodsAhead, getPayrollMonthData, getOrCreatePayrollPeriod } from '@/app/actions/payroll';
import type { PayrollMonthApproval, PayrollPeriod } from '@/app/actions/payroll';
import { getRotaWeekDayInfo } from '@/app/actions/rota-day-info';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { buildPayrollMonthOptions } from '@/lib/rota/payroll-periods';
import PayrollClient from './PayrollClient';
import { rotaNavItems } from '../nav';

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

  const todayIso = getTodayIsoDate();
  const availablePeriods = await ensurePayrollPeriodsAhead(todayIso);
  const defaultPeriod = availablePeriods[0];
  const year = params.year ? parseInt(params.year) : defaultPeriod.year;
  const month = params.month ? parseInt(params.month) : defaultPeriod.month;

  const supabase = await createClient();

  // Fetch period first — its start/end dates define the range for day info.
  // getOrCreatePayrollPeriod may insert a row so it runs sequentially first.
  const payrollPeriod = (
    availablePeriods.find(period => period.year === year && period.month === month)
    ?? await getOrCreatePayrollPeriod(year, month)
  ) as PayrollPeriod;

  const [payrollResult, approvalResult] = await Promise.all([
    getPayrollMonthData(year, month),
    supabase
      .from('payroll_month_approvals')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
  ]);
  const dayInfo = await getRotaWeekDayInfo(payrollPeriod.period_start, payrollPeriod.period_end);

  const monthLabel = formatDateInLondon(`${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`, {
    month: 'long',
    year: 'numeric',
  });

  const monthOptions = buildPayrollMonthOptions(defaultPeriod);

  const approval = approvalResult.data as PayrollMonthApproval | null;

  return (
    <PageLayout
      title="Payroll"
      subtitle={monthLabel}
      navItems={rotaNavItems}
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

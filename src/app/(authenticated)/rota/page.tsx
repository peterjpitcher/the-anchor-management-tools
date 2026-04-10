import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { generateRotaFeedToken } from '@/lib/portal/calendar-token';
import { createClient } from '@/lib/supabase/server';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import RotaFeedButton from './RotaFeedButton';
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
} from '@/app/actions/rota';
import { getShiftTemplates } from '@/app/actions/rota-templates';
import { getDepartmentBudgets, getDepartments } from '@/app/actions/budgets';
import { getRotaWeekDayInfo } from '@/app/actions/rota-day-info';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import RotaGrid from './RotaGrid';

export const dynamic = 'force-dynamic';

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun — use UTC to avoid BST midnight-shift
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00Z'); // Z = UTC, avoids BST off-by-one
  const e = new Date(end + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

interface RotaPageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function RotaPage({ searchParams }: RotaPageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const [canView, canEdit, canPublish, canManageSettings] = await Promise.all([
    checkUserPermission('rota', 'view', user.id),
    checkUserPermission('rota', 'edit', user.id),
    checkUserPermission('rota', 'publish', user.id),
    checkUserPermission('settings', 'manage', user.id),
  ]);
  if (!canView) redirect('/');

  const resolvedParams = await Promise.resolve(searchParams ?? {});
  const weekParam = (resolvedParams as { week?: string })?.week;

  // Resolve weekStart to a Monday
  const weekStart = (() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      return getMondayOfWeek(new Date(weekParam + 'T00:00:00Z')).toISOString().split('T')[0];
    }
    return getMondayOfWeek(new Date()).toISOString().split('T')[0];
  })();

  // Build Mon–Sun date array — use UTC to avoid BST midnight-shift duplicates
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  const weekEnd = days[6];

  const [weekResult, employeesResult, shiftsResult, templatesResult, leaveDaysResult, budgetsResult, dayInfoResult, deptResult] =
    await Promise.all([
      getOrCreateRotaWeek(weekStart),
      getActiveEmployeesForRota(weekStart),
      getWeekShifts(weekStart),
      getShiftTemplates(),
      getLeaveDaysForWeek(weekStart),
      getDepartmentBudgets(parseInt(weekStart.split('-')[0])),
      getRotaWeekDayInfo(weekStart, weekEnd),
      getDepartments(),
    ]);

  const rotaNavItems = [
    { label: 'Rota', href: '/rota' },
    { label: 'Leave', href: '/rota/leave' },
    { label: 'Timeclock', href: '/rota/timeclock' },
    { label: 'Labour Costs', href: '/rota/dashboard' },
    { label: 'Payroll', href: '/rota/payroll' },
  ];

  if (!weekResult.success) {
    return (
      <PageLayout
        title="Rota"
        subtitle="Weekly rota planning"
        navItems={rotaNavItems}
        error={weekResult.error ?? 'Failed to load rota data. Please try again.'}
      />
    );
  }

  const week = weekResult.data;
  const employees = employeesResult.success ? employeesResult.data : [];
  const shifts = shiftsResult.success ? shiftsResult.data : [];
  const templates = templatesResult.success ? templatesResult.data.filter(t => t.is_active) : [];
  const leaveDays = leaveDaysResult.success ? leaveDaysResult.data : [];
  const budgets = budgetsResult.success ? budgetsResult.data : [];
  const departments = deptResult.success ? deptResult.data : [];
  const dayInfo: Record<string, RotaDayInfo> = dayInfoResult ?? {};

  // Per-user HMAC token — no global secret reaches the browser
  const feedToken = generateRotaFeedToken(user.id);
  const feedUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/rota/feed?token=${feedToken}&uid=${user.id}`;

  return (
    <PageLayout
      title="Weekly Rota"
      navItems={rotaNavItems}
      headerActions={
        <div className="flex items-center gap-2">
          <RotaFeedButton feedUrl={feedUrl} showCalendarSync={Boolean(process.env.GOOGLE_CALENDAR_ROTA_ID)} />
          <LinkButton href="/rota/templates" size="sm" variant="secondary" leftIcon={<Cog6ToothIcon className="h-4 w-4" />}>
            Templates
          </LinkButton>
          {canManageSettings && (
            <>
              <LinkButton href="/settings/rota" variant="secondary" size="sm">Rota Settings</LinkButton>
              <LinkButton href="/settings/pay-bands" variant="secondary" size="sm">Pay Bands</LinkButton>
              <LinkButton href="/settings/budgets" variant="secondary" size="sm">Budgets</LinkButton>
            </>
          )}
        </div>
      }
    >
      <RotaGrid
        key={weekStart}
        week={week}
        shifts={shifts}
        employees={employees}
        templates={templates}
        leaveDays={leaveDays}
        weekStart={weekStart}
        days={days}
        canEdit={canEdit}
        canPublish={canPublish}
        budgets={budgets}
        departments={departments}
        dayInfo={dayInfo}
      />
    </PageLayout>
  );
}

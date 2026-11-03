import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getAllBirthdays } from '@/app/actions/employee-birthdays'
import { checkUserPermission } from '@/app/actions/rbac'
import { displayName } from '@/lib/employees/display-name'
import { formatDateInLondon, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { Alert, Badge, Card, CardHeader, Empty, Icon, PageLayout } from '@/ds'
import SendBirthdayRemindersButton from '@/components/features/employees/SendBirthdayRemindersButton'
import { EMPLOYEES_NAV } from '../_shared/nav'
import { birthdayCountdownTone } from '../_shared/status-ui'

export const dynamic = 'force-dynamic'

interface EmployeeBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  job_title: string | null;
  date_of_birth: string;
  email_address: string | null;
  days_until_birthday: number;
  turning_age: number;
}

export default async function EmployeeBirthdaysPage() {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'manage')
  ])

  if (!canView) {
    redirect('/unauthorized')
  }

  const result = await getAllBirthdays()

  if (result.error) {
    console.error('[EmployeeBirthdaysPage] Error:', result.error)
  }

  const birthdays = result.birthdays || []

  // Count from the London date, as getUpcomingBirthday does, so the page and the helper agree
  // about the day. The host clock is UTC on the server, still yesterday from 00:00 to 00:59 BST.
  const todayIso = getTodayIsoDate();
  const getUpcomingBirthdayDate = (daysUntil: number) => {
    return shiftIsoDate(todayIso, daysUntil) ?? todayIso;
  };

  const getCountdownText = (days: number) => {
    if (days === 0) return 'Today! 🎉';
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return `In ${days} days`;
    if (days <= 30) return `In ${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''}`;
    return `In ${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''}`;
  };

  // Group by the month and year each next birthday falls in. Grouping by month alone put a
  // birthday from earlier this month (next due in eleven months' time) at the top, under this
  // month, beside the ones still to come. The list arrives soonest first, so the groups come out
  // in date order; the year is in the title because this month can appear twice, a year apart.
  const sortedMonths: Array<[string, { birthdays: EmployeeBirthday[] }]> = [];
  const monthGroups = new Map<string, { birthdays: EmployeeBirthday[] }>();
  for (const birthday of [...birthdays].sort((a, b) => a.days_until_birthday - b.days_until_birthday)) {
    const birthdayDate = getUpcomingBirthdayDate(birthday.days_until_birthday);
    const monthKey = birthdayDate.slice(0, 7);
    let group = monthGroups.get(monthKey);
    if (!group) {
      group = { birthdays: [] };
      monthGroups.set(monthKey, group);
      sortedMonths.push([formatDateInLondon(`${monthKey}-01`, { month: 'long', year: 'numeric' }), group]);
    }
    group.birthdays.push(birthday);
  }

  const headerActions = canManage ? <SendBirthdayRemindersButton /> : undefined;

  return (
    <PageLayout
      title="Employees"
      subtitle="Birthdays: every employee birthday, month by month"
      navItems={EMPLOYEES_NAV}
      headerActions={headerActions}
    >
      {/* Matches the code: the cron in vercel.json runs at 09:00 UTC (9am GMT, 10am BST) and the
          email goes to MANAGER_EMAIL. No address is named here, so the page cannot go stale. */}
      <Alert tone="info" title="Automatic Birthday Reminders" icon={<Icon name="alertTriangle" size={16} />}>
        Every morning at 9am (10am in British Summer Time), a reminder is emailed to the manager&apos;s email address for anyone whose birthday is exactly 7 days away.
      </Alert>

      {/* A failed load says so; it is never shown as an empty list. */}
      {result.error ? (
        <Alert tone="danger" title="Could not load birthdays">
          {result.error}
        </Alert>
      ) : birthdays.length === 0 ? (
        <Card>
          <Empty
            size="sm"
            icon={<Icon name="cake" size={40} />}
            title="No birthdays yet"
            description="No active employees have a date of birth recorded."
          />
        </Card>
      ) : (
        sortedMonths.map(([monthName, { birthdays: monthBirthdays }]) => (
          <Card key={monthName}>
            <CardHeader
              title={monthName}
              subtitle={`${monthBirthdays.length} birthday${monthBirthdays.length !== 1 ? 's' : ''}`}
            />
            <ul className="divide-y divide-border">
              {monthBirthdays.map((birthday) => (
                <li key={birthday.employee_id} className="px-pad-card py-3 hover:bg-surface-hover">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/employees/${birthday.employee_id}`}
                          className="truncate text-sm font-medium text-primary hover:underline"
                        >
                          {displayName(birthday)}
                        </Link>
                        {birthday.days_until_birthday === 0 && (
                          <span className="text-base" aria-hidden="true">🎉</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-text-muted sm:text-sm">{birthday.job_title || 'No title'}</p>
                    </div>
                    <div className="flex items-center justify-between sm:block sm:text-right">
                      <div className="flex items-center gap-2 sm:justify-end">
                        <span className="text-xs font-medium text-text sm:text-sm">
                          {formatDateInLondon(birthday.date_of_birth, { month: 'short', day: 'numeric' })}
                        </span>
                        <Badge tone={birthdayCountdownTone(birthday.days_until_birthday)}>
                          {getCountdownText(birthday.days_until_birthday)}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-muted sm:mt-1">
                        Turning {birthday.turning_age}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </PageLayout>
  );
}

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getAllBirthdays } from '@/app/actions/employee-birthdays'
import { checkUserPermission } from '@/app/actions/rbac'
import { displayName } from '@/lib/employees/display-name'
import {
  CakeIcon,
  ExclamationTriangleIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'
import { formatDateInLondon, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Badge } from '@/ds'
import { Alert } from '@/ds'
import { EmptyState } from '@/ds'
import SendBirthdayRemindersButton from '@/components/features/employees/SendBirthdayRemindersButton'

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

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

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
    // In a server component we can't use toast directly.
    // We'll just render the empty state or an error message.
    console.error('[EmployeeBirthdaysPage] Error:', result.error)
  }

  const birthdays = result.birthdays || []

  // Count from the London date, as getUpcomingBirthday does, so the page and the helper agree
  // about the day. The host clock is UTC on the server, still yesterday from 00:00 to 00:59 BST.
  const todayIso = getTodayIsoDate();
  const monthIndexOf = (isoDate: string) => Number(isoDate.slice(5, 7)) - 1;
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

  const getCountdownBadgeVariant = (days: number) => {
    if (days === 0) return 'error';
    if (days <= 7) return 'warning';
    if (days <= 30) return 'info';
    return 'default';
  };

  // Group birthdays by month
  const groupedByMonth = birthdays.reduce((acc, birthday) => {
    const birthdayDate = getUpcomingBirthdayDate(birthday.days_until_birthday);
    const monthIndex = monthIndexOf(birthdayDate);
    const monthName = monthNames[monthIndex];

    if (!acc[monthName]) {
      acc[monthName] = {
        monthIndex,
        birthdays: []
      };
    }

    acc[monthName].birthdays.push(birthday);
    return acc;
  }, {} as Record<string, { monthIndex: number; birthdays: EmployeeBirthday[] }>);

  // Sort months in chronological order starting from current month
  const currentMonth = monthIndexOf(todayIso);
  const sortedMonths = Object.entries(groupedByMonth)
    .sort(([, a], [, b]) => {
      const aIndex = a.monthIndex >= currentMonth ? a.monthIndex : a.monthIndex + 12;
      const bIndex = b.monthIndex >= currentMonth ? b.monthIndex : b.monthIndex + 12;
      return aIndex - bIndex;
    });

  const headerActions = canManage ? <SendBirthdayRemindersButton /> : undefined;

  return (
    <PageLayout
      title="Employee Birthdays"
      subtitle="All employee birthdays throughout the year"
      navItems={[
        { label: 'Employees', href: '/employees' },
        { label: 'Birthdays', href: '/employees/birthdays' },
      ]}
      headerActions={headerActions}
    >
      <section id="overview" className="space-y-4">
        <Alert variant="info" icon={<ExclamationTriangleIcon className="h-4 w-4 sm:h-5 sm:w-5" />}>
          <div>
            <h3 className="text-xs sm:text-sm font-medium">Automatic Birthday Reminders</h3>
            <p className="mt-1 sm:mt-2 text-xs sm:text-sm">
              Birthday reminders are automatically sent to manager@the-anchor.pub every morning at 8 AM for employees with birthdays exactly 1 week away.
            </p>
          </div>
        </Alert>
      </section>

      <section id="birthdays">
        {birthdays.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CakeIcon className="h-12 w-12" />}
              title="No birthdays found"
              description="No active employees have birthdays recorded."
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {sortedMonths.map(([monthName, { birthdays: monthBirthdays }]) => (
              <Card key={monthName}>
                <div className="bg-surface-2 px-3 sm:px-4 py-2 sm:py-3 border-b border-border -m-6 mb-6">
                  <h2 className="text-base sm:text-lg font-medium text-text flex flex-wrap items-center">
                    <CalendarIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2 text-text-subtle" />
                    <span>{monthName}</span>
                    <span className="ml-2 text-xs sm:text-sm text-text-muted">({monthBirthdays.length} birthday{monthBirthdays.length !== 1 ? 's' : ''})</span>
                  </h2>
                </div>
                <ul className="divide-y divide-border">
                  {monthBirthdays.map((birthday) => (
                    <li key={birthday.employee_id} className="px-3 sm:px-4 py-3 sm:py-4 hover:bg-surface-hover">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <Link
                              href={`/employees/${birthday.employee_id}`}
                              className="text-sm font-medium text-primary hover:underline truncate"
                            >
                              {displayName(birthday)}
                            </Link>
                            {birthday.days_until_birthday === 0 && (
                              <span className="ml-1.5 sm:ml-2 text-base sm:text-xl">🎉</span>
                            )}
                          </div>
                          <p className="text-xs sm:text-sm text-text-muted truncate">{birthday.job_title || 'No title'}</p>
                        </div>
                        <div className="flex sm:block items-center justify-between sm:text-right sm:ml-4">
                          <div className="flex items-center sm:justify-end space-x-1.5 sm:space-x-2">
                            <span className="text-xs sm:text-sm font-medium text-text">
                              {formatDateInLondon(birthday.date_of_birth, { month: 'short', day: 'numeric' }, 'en-US')}
                            </span>
                            <Badge
                              variant={getCountdownBadgeVariant(birthday.days_until_birthday) as 'default' | 'info' | 'warning' | 'error'}
                              className="text-xs px-1.5 py-0.5 sm:px-2 sm:py-1"
                            >
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
            ))}
          </div>
        )}
      </section>
    </PageLayout>
  );
}

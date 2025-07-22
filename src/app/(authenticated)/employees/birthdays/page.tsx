'use client';

import { useState, useEffect } from 'react';
import { getAllBirthdays, sendBirthdayReminders } from '@/app/actions/employee-birthdays';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  CakeIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';
import { format, getMonth, addDays } from 'date-fns';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';
import { Skeleton } from '@/components/ui-v2/feedback/Skeleton';

interface EmployeeBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
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

export default function EmployeeBirthdaysPage() {
  const { hasPermission } = usePermissions();
  const [birthdays, setBirthdays] = useState<EmployeeBirthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const loadBirthdays = async () => {
      setLoading(true);
      try {
        const result = await getAllBirthdays();
        if (result.error) {
          toast.error(result.error);
        } else if (result.birthdays) {
          setBirthdays(result.birthdays);
        }
      } catch (error) {
        toast.error('Failed to load birthdays');
      } finally {
        setLoading(false);
      }
    };
    
    loadBirthdays();
  }, []);

  const handleSendReminders = async () => {
    if (!hasPermission('employees', 'manage')) {
      toast.error('You do not have permission to send reminders');
      return;
    }

    setSending(true);
    try {
      const result = await sendBirthdayReminders();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(result.message || 'Birthday reminders sent');
      }
    } catch (error) {
      toast.error('Failed to send reminders');
    } finally {
      setSending(false);
    }
  };

  const getUpcomingBirthdayDate = (daysUntil: number) => {
    return addDays(new Date(), daysUntil);
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
    const monthIndex = getMonth(birthdayDate);
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
  const currentMonth = getMonth(new Date());
  const sortedMonths = Object.entries(groupedByMonth)
    .sort(([, a], [, b]) => {
      const aIndex = a.monthIndex >= currentMonth ? a.monthIndex : a.monthIndex + 12;
      const bIndex = b.monthIndex >= currentMonth ? b.monthIndex : b.monthIndex + 12;
      return aIndex - bIndex;
    });

  if (!hasPermission('employees', 'view')) {
    return (
      <Page title="Employee Birthdays">
        <Card>
          <div className="text-center py-12">
            <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Employee Birthdays"
      description="All employee birthdays throughout the year"
      actions={
        <div className="flex items-center gap-2">
          <LinkButton
            href="/employees"
            variant="secondary"
            size="sm"
          >
            <ArrowLeftIcon className="h-4 w-4 -ml-1 mr-1.5" />
            Back
          </LinkButton>
          {hasPermission('employees', 'manage') && (
            <Button
              onClick={handleSendReminders}
              disabled={sending}
              variant="primary"
              size="sm"
            >
              <EnvelopeIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 -ml-0.5 mr-1.5 sm:mr-2" />
              <span className="hidden sm:inline">{sending ? 'Sending...' : 'Send Weekly Reminders'}</span>
              <span className="sm:hidden">{sending ? 'Sending...' : 'Send Reminders'}</span>
            </Button>
          )}
        </div>
      }
    >

      <Alert variant="info" icon={<ExclamationTriangleIcon className="h-4 w-4 sm:h-5 sm:w-5" />}>
        <div>
          <h3 className="text-xs sm:text-sm font-medium">Automatic Birthday Reminders</h3>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm">
            Birthday reminders are automatically sent to manager@the-anchor.pub every morning at 8 AM for employees with birthdays exactly 1 week away.
          </p>
        </div>
      </Alert>

      {loading ? (
        <Card>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </Card>
      ) : birthdays.length === 0 ? (
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
              <div className="bg-gray-50 px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 -m-6 mb-6">
                <h2 className="text-base sm:text-lg font-medium text-gray-900 flex flex-wrap items-center">
                  <CalendarIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2 text-gray-400" />
                  <span>{monthName}</span>
                  <span className="ml-2 text-xs sm:text-sm text-gray-500">({monthBirthdays.length} birthday{monthBirthdays.length !== 1 ? 's' : ''})</span>
                </h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {monthBirthdays.map((birthday) => {
                  return (
                    <li key={birthday.employee_id} className="px-3 sm:px-4 py-3 sm:py-4 hover:bg-gray-50">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <Link
                              href={`/employees/${birthday.employee_id}`}
                              className="text-sm font-medium text-blue-600 hover:text-blue-700 truncate"
                            >
                              {birthday.first_name} {birthday.last_name}
                            </Link>
                            {birthday.days_until_birthday === 0 && (
                              <span className="ml-1.5 sm:ml-2 text-base sm:text-xl">🎉</span>
                            )}
                          </div>
                          <p className="text-xs sm:text-sm text-gray-500 truncate">{birthday.job_title || 'No title'}</p>
                        </div>
                        <div className="flex sm:block items-center justify-between sm:text-right sm:ml-4">
                          <div className="flex items-center sm:justify-end space-x-1.5 sm:space-x-2">
                            <span className="text-xs sm:text-sm font-medium text-gray-900">
                              {format(new Date(birthday.date_of_birth), 'MMM d')}
                            </span>
                            <Badge 
                              variant={getCountdownBadgeVariant(birthday.days_until_birthday) as 'default' | 'info' | 'warning' | 'error'}
                              className="text-xs px-1.5 py-0.5 sm:px-2 sm:py-1"
                            >
                              {getCountdownText(birthday.days_until_birthday)}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500 sm:mt-1">
                            Turning {birthday.turning_age}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
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
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Badge';

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
      } catch {
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
    } catch {
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
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center space-x-3 sm:space-x-4">
              <Link
                href="/employees"
                className="text-gray-400 hover:text-gray-500"
              >
                <ArrowLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
              <div>
                <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 flex items-center">
                  <CakeIcon className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 mr-1.5 sm:mr-2 text-pink-500" />
                  Employee Birthdays
                </h1>
                <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-gray-500">
                  All employee birthdays throughout the year
                </p>
              </div>
            </div>
            {hasPermission('employees', 'manage') && (
              <button
                onClick={handleSendReminders}
                disabled={sending}
                className="inline-flex items-center px-3 py-2 sm:px-4 border border-transparent text-xs sm:text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
              >
                <EnvelopeIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                <span className="hidden sm:inline">{sending ? 'Sending...' : 'Send Weekly Reminders'}</span>
                <span className="sm:hidden">{sending ? 'Sending...' : 'Send Reminders'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <ExclamationTriangleIcon className="h-4 w-4 sm:h-5 sm:w-5 text-blue-400" />
          </div>
          <div className="ml-2 sm:ml-3">
            <h3 className="text-xs sm:text-sm font-medium text-blue-800">Automatic Birthday Reminders</h3>
            <div className="mt-1 sm:mt-2 text-xs sm:text-sm text-blue-700">
              <p>Birthday reminders are automatically sent to manager@the-anchor.pub every morning at 8 AM for employees with birthdays exactly 1 week away.</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white shadow sm:rounded-lg p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      ) : birthdays.length === 0 ? (
        <div className="bg-white shadow sm:rounded-lg text-center py-12">
          <CakeIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No birthdays found</h3>
          <p className="mt-1 text-sm text-gray-500">
            No active employees have birthdays recorded.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedMonths.map(([monthName, { birthdays: monthBirthdays }]) => (
            <div key={monthName} className="bg-white shadow sm:rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200">
                <h2 className="text-base sm:text-lg font-medium text-gray-900 flex flex-wrap items-center">
                  <CalendarIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2 text-gray-400" />
                  <span>{monthName}</span>
                  <span className="ml-2 text-xs sm:text-sm text-gray-500">({monthBirthdays.length} birthday{monthBirthdays.length !== 1 ? 's' : ''})</span>
                </h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {monthBirthdays.map((birthday) => {
                  const birthdayDate = getUpcomingBirthdayDate(birthday.days_until_birthday);
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
                              variant={getCountdownBadgeVariant(birthday.days_until_birthday) as any}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
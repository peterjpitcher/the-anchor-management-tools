'use client';

import { useState, useEffect } from 'react';
import { getUpcomingBirthdays, sendBirthdayReminders } from '@/app/actions/employee-birthdays';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import { 
  CakeIcon,
  EnvelopeIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
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

export default function EmployeeBirthdaysPage() {
  const { hasPermission } = usePermissions();
  const [birthdays, setBirthdays] = useState<EmployeeBirthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [daysAhead, setDaysAhead] = useState(30);

  useEffect(() => {
    const loadBirthdays = async () => {
      setLoading(true);
      try {
        const result = await getUpcomingBirthdays(daysAhead);
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
  }, [daysAhead]);


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

  const getUpcomingBirthdayDate = (dob: string, daysUntil: number) => {
    const today = new Date();
    const birthdayDate = new Date(today);
    birthdayDate.setDate(today.getDate() + daysUntil);
    return birthdayDate;
  };


  const groupedBirthdays = birthdays.reduce((acc, birthday) => {
    const key = birthday.days_until_birthday === 0 ? 'today' :
               birthday.days_until_birthday <= 7 ? 'thisWeek' :
               birthday.days_until_birthday <= 14 ? 'nextWeek' :
               'later';
    
    if (!acc[key]) acc[key] = [];
    acc[key].push(birthday);
    return acc;
  }, {} as Record<string, EmployeeBirthday[]>);

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
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link
                href="/employees"
                className="text-gray-400 hover:text-gray-500"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                  <CakeIcon className="h-8 w-8 mr-2 text-pink-500" />
                  Employee Birthdays
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  Upcoming birthdays and reminder management
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <select
                value={daysAhead}
                onChange={(e) => setDaysAhead(Number(e.target.value))}
                className="rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              >
                <option value={7}>Next 7 days</option>
                <option value={14}>Next 14 days</option>
                <option value={30}>Next 30 days</option>
                <option value={60}>Next 60 days</option>
                <option value={90}>Next 90 days</option>
              </select>
              {hasPermission('employees', 'manage') && (
                <button
                  onClick={handleSendReminders}
                  disabled={sending}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  <EnvelopeIcon className="h-4 w-4 mr-2" />
                  {sending ? 'Sending...' : 'Send Weekly Reminders'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <ExclamationTriangleIcon className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Automatic Birthday Reminders</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>Birthday reminders are automatically sent to manager@the-anchor.pub every morning at 8 AM for employees with birthdays exactly 1 week away.</p>
              <p className="mt-1">Use the &quot;Send Weekly Reminders&quot; button to manually trigger reminders for testing.</p>
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
          <h3 className="mt-2 text-sm font-medium text-gray-900">No upcoming birthdays</h3>
          <p className="mt-1 text-sm text-gray-500">
            No employee birthdays in the next {daysAhead} days.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Today's Birthdays */}
          {groupedBirthdays.today && (
            <div className="bg-white shadow sm:rounded-lg overflow-hidden">
              <div className="bg-red-600 px-4 py-3">
                <h2 className="text-lg font-medium text-white flex items-center">
                  <CakeIcon className="h-5 w-5 mr-2" />
                  Today&apos;s Birthdays! 🎉
                </h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {groupedBirthdays.today.map((birthday) => (
                  <li key={birthday.employee_id} className="px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-lg font-medium text-gray-900">
                          {birthday.first_name} {birthday.last_name}
                        </p>
                        <p className="text-sm text-gray-500">{birthday.job_title || 'No title'}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="error">Today!</Badge>
                        <p className="text-sm text-gray-500 mt-1">Turning {birthday.turning_age}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* This Week */}
          {groupedBirthdays.thisWeek && (
            <div className="bg-white shadow sm:rounded-lg overflow-hidden">
              <div className="bg-yellow-100 px-4 py-3">
                <h2 className="text-lg font-medium text-yellow-800">This Week</h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {groupedBirthdays.thisWeek.map((birthday) => (
                  <li key={birthday.employee_id} className="px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Link
                          href={`/employees/${birthday.employee_id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          {birthday.first_name} {birthday.last_name}
                        </Link>
                        <p className="text-sm text-gray-500">{birthday.job_title || 'No title'}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="warning">
                          {birthday.days_until_birthday === 1 ? 'Tomorrow' : `In ${birthday.days_until_birthday} days`}
                        </Badge>
                        <p className="text-sm text-gray-500 mt-1">
                          {format(getUpcomingBirthdayDate(birthday.date_of_birth, birthday.days_until_birthday), 'EEEE, MMM d')}
                        </p>
                        <p className="text-xs text-gray-400">Turning {birthday.turning_age}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next Week */}
          {groupedBirthdays.nextWeek && (
            <div className="bg-white shadow sm:rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-4 py-3">
                <h2 className="text-lg font-medium text-blue-800">Next Week</h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {groupedBirthdays.nextWeek.map((birthday) => (
                  <li key={birthday.employee_id} className="px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Link
                          href={`/employees/${birthday.employee_id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          {birthday.first_name} {birthday.last_name}
                        </Link>
                        <p className="text-sm text-gray-500">{birthday.job_title || 'No title'}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="info">In {birthday.days_until_birthday} days</Badge>
                        <p className="text-sm text-gray-500 mt-1">
                          {format(getUpcomingBirthdayDate(birthday.date_of_birth, birthday.days_until_birthday), 'EEEE, MMM d')}
                        </p>
                        <p className="text-xs text-gray-400">Turning {birthday.turning_age}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Later */}
          {groupedBirthdays.later && (
            <div className="bg-white shadow sm:rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3">
                <h2 className="text-lg font-medium text-gray-700">Later This Month</h2>
              </div>
              <ul className="divide-y divide-gray-200">
                {groupedBirthdays.later.map((birthday) => (
                  <li key={birthday.employee_id} className="px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Link
                          href={`/employees/${birthday.employee_id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          {birthday.first_name} {birthday.last_name}
                        </Link>
                        <p className="text-sm text-gray-500">{birthday.job_title || 'No title'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">
                          {format(getUpcomingBirthdayDate(birthday.date_of_birth, birthday.days_until_birthday), 'EEEE, MMM d')}
                        </p>
                        <p className="text-xs text-gray-400">
                          In {birthday.days_until_birthday} days • Turning {birthday.turning_age}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
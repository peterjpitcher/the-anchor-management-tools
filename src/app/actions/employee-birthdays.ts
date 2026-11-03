'use server';

import { createClient } from '@/lib/supabase/server';
import { getUpcomingBirthday, calculateAge } from '@/lib/employeeUtils';
import { sendBirthdayRemindersInternal, type BirthdayReminderResult, type EmployeeWithBirthday } from '@/lib/employees/birthday-reminders';
import { checkUserPermission } from './rbac';

/**
 * Send today's birthday reminder from the Birthdays page, for birthdays exactly `daysAhead` days
 * away. The sender itself lives in src/lib/employees/birthday-reminders.ts, outside this
 * 'use server' file, because every export here is callable from the browser: it used to be
 * exported from here too, with no permission check.
 */
export async function sendBirthdayReminders(daysAhead: number = 7): Promise<BirthdayReminderResult> {
  const hasPermission = await checkUserPermission('employees', 'manage');
  if (!hasPermission) {
    return { error: 'You do not have permission to send birthday reminders' };
  }

  return sendBirthdayRemindersInternal(daysAhead);
}

/**
 * Get upcoming birthdays without sending emails (for preview)
 */
async function getUpcomingBirthdays(daysAhead: number = 30) {
  try {
    const supabase = await createClient();
    
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view employee birthdays' };
    }

    // Get all active employees with date of birth
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name, job_title, date_of_birth, email_address')
      .in('status', ['Active', 'Started Separation'])
      .not('date_of_birth', 'is', null);

    if (error) {
      return { error: 'Failed to fetch employees' };
    }

    if (!employees || employees.length === 0) {
      return { success: true, birthdays: [] };
    }

    // Find employees with upcoming birthdays
    const upcomingBirthdays: EmployeeWithBirthday[] = [];
    
    for (const employee of employees) {
      const birthday = getUpcomingBirthday(employee.date_of_birth, daysAhead);
      
      if (birthday.isUpcoming) {
        const age = calculateAge(employee.date_of_birth);
        upcomingBirthdays.push({
          ...employee,
          days_until_birthday: birthday.daysUntil,
          turning_age: (age || 0) + 1
        });
      }
    }

    // Sort by days until birthday
    upcomingBirthdays.sort((a, b) => a.days_until_birthday - b.days_until_birthday);

    return { success: true, birthdays: upcomingBirthdays };
  } catch (error) {
    console.error('Error getting upcoming birthdays:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get all employee birthdays sorted by upcoming date
 */
export async function getAllBirthdays() {
  try {
    const supabase = await createClient();
    
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view employee birthdays' };
    }

    // Get all active employees with date of birth
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name, job_title, date_of_birth, email_address')
      .in('status', ['Active', 'Started Separation'])
      .not('date_of_birth', 'is', null);

    if (error) {
      return { error: 'Failed to fetch employees' };
    }

    if (!employees || employees.length === 0) {
      return { success: true, birthdays: [] };
    }

    // Calculate upcoming birthday for all employees
    const allBirthdays: EmployeeWithBirthday[] = [];
    
    for (const employee of employees) {
      const birthday = getUpcomingBirthday(employee.date_of_birth, 365); // Look ahead full year
      const age = calculateAge(employee.date_of_birth);
      
      allBirthdays.push({
        ...employee,
        days_until_birthday: birthday.daysUntil,
        turning_age: birthday.daysUntil === 0 ? (age || 0) : (age || 0) + 1
      });
    }

    // Sort by days until birthday
    allBirthdays.sort((a, b) => a.days_until_birthday - b.days_until_birthday);

    return { success: true, birthdays: allBirthdays };
  } catch (error) {
    console.error('Error getting all birthdays:', error);
    return { error: 'An unexpected error occurred' };
  }
}

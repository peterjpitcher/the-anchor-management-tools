'use server';

import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/emailService';
import { getUpcomingBirthday, calculateAge } from '@/lib/employeeUtils';
import { format } from 'date-fns';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';
import { syncBirthdayCalendarEvent, deleteBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays';

interface EmployeeWithBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  date_of_birth: string;
  email_address: string | null;
  days_until_birthday: number;
  turning_age: number;
}

/**
 * Check for employees with upcoming birthdays and send reminder emails
 * This can be called manually or via a cron job
 */
export async function sendBirthdayReminders(daysAhead: number = 7) {
  try {
    const supabase = await createClient();
    
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to send birthday reminders' };
    }

    // Get all active employees with date of birth
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, job_title, date_of_birth, email_address')
      .eq('status', 'Active')
      .not('date_of_birth', 'is', null);

    if (error) {
      console.error('Error fetching employees:', error);
      return { error: 'Failed to fetch employees' };
    }

    if (!employees || employees.length === 0) {
      return { success: true, sent: 0, message: 'No active employees with birthdays found' };
    }

    // Find employees with upcoming birthdays
    const upcomingBirthdays: EmployeeWithBirthday[] = [];
    
    for (const employee of employees) {
      const birthday = getUpcomingBirthday(employee.date_of_birth, daysAhead);
      
      if (birthday.isUpcoming && birthday.daysUntil === 7) { // Exactly 1 week away
        const age = calculateAge(employee.date_of_birth);
        upcomingBirthdays.push({
          ...employee,
          days_until_birthday: birthday.daysUntil,
          turning_age: (age || 0) + 1 // They'll be turning this age
        });
      }
    }

    if (upcomingBirthdays.length === 0) {
      return { success: true, sent: 0, message: 'No birthdays exactly 1 week away' };
    }

    // Prepare email content
    const emailBody = generateBirthdayReminderEmail(upcomingBirthdays);
    
    // Send email to manager
    const managerEmail = 'manager@the-anchor.pub';
    const result = await sendEmail({
      to: managerEmail,
      subject: `Birthday Reminder: ${upcomingBirthdays.length} upcoming birthday${upcomingBirthdays.length > 1 ? 's' : ''} next week`,
      html: emailBody,
      text: generatePlainTextEmail(upcomingBirthdays)
    });

    if (!result.success) {
      return { error: 'Failed to send birthday reminder email' };
    }

    // Log the action
    await logAuditEvent({
      operation_type: 'send_birthday_reminders',
      resource_type: 'employee',
      operation_status: 'success',
      additional_info: {
        employees_count: upcomingBirthdays.length,
        sent_to: managerEmail,
        employee_names: upcomingBirthdays.map(e => `${e.first_name} ${e.last_name}`).join(', ')
      }
    });

    return { 
      success: true, 
      sent: upcomingBirthdays.length,
      message: `Birthday reminder sent for ${upcomingBirthdays.length} employee${upcomingBirthdays.length > 1 ? 's' : ''}`
    };
  } catch (error) {
    console.error('Error sending birthday reminders:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Get upcoming birthdays without sending emails (for preview)
 */
export async function getUpcomingBirthdays(daysAhead: number = 30) {
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
      .select('employee_id, first_name, last_name, job_title, date_of_birth, email_address')
      .eq('status', 'Active')
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

function generateBirthdayReminderEmail(birthdays: EmployeeWithBirthday[]): string {
  const birthdayList = birthdays
    .map(emp => {
      const birthdayDate = new Date(emp.date_of_birth);
      birthdayDate.setFullYear(new Date().getFullYear());
      if (birthdayDate < new Date()) {
        birthdayDate.setFullYear(birthdayDate.getFullYear() + 1);
      }
      
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
            <strong>${emp.first_name} ${emp.last_name}</strong><br>
            <span style="color: #6b7280; font-size: 14px;">${emp.job_title || 'No title'}</span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            ${format(birthdayDate, 'EEEE, MMMM d')}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            Turning ${emp.turning_age}
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Birthday Reminder</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 32px;">
          <h1 style="color: #111827; font-size: 24px; margin-top: 0;">🎂 Upcoming Birthday Reminder</h1>
          
          <p style="color: #4b5563; margin: 20px 0;">
            The following employee${birthdays.length > 1 ? 's have birthdays' : ' has a birthday'} coming up next week:
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f3f4f6;">
                <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Employee</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Birthday</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Age</th>
              </tr>
            </thead>
            <tbody>
              ${birthdayList}
            </tbody>
          </table>
          
          <div style="margin-top: 32px; padding: 16px; background-color: #fef3c7; border-radius: 6px;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Reminder:</strong> Consider organizing a celebration or sending a birthday card to make their day special!
            </p>
          </div>
          
          <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;">
          
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            This is an automated reminder from The Anchor Management System.<br>
            To manage birthday notifications, please visit the employee settings.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generatePlainTextEmail(birthdays: EmployeeWithBirthday[]): string {
  let text = `Birthday Reminder\n\n`;
  text += `The following employee${birthdays.length > 1 ? 's have birthdays' : ' has a birthday'} coming up next week:\n\n`;
  
  birthdays.forEach(emp => {
    const birthdayDate = new Date(emp.date_of_birth);
    birthdayDate.setFullYear(new Date().getFullYear());
    if (birthdayDate < new Date()) {
      birthdayDate.setFullYear(birthdayDate.getFullYear() + 1);
    }
    
    text += `• ${emp.first_name} ${emp.last_name} (${emp.job_title || 'No title'})\n`;
    text += `  Birthday: ${format(birthdayDate, 'EEEE, MMMM d')}\n`;
    text += `  Turning: ${emp.turning_age}\n\n`;
  });
  
  text += `\nReminder: Consider organizing a celebration or sending a birthday card to make their day special!\n\n`;
  text += `--\nThis is an automated reminder from The Anchor Management System.`;
  
  return text;
}
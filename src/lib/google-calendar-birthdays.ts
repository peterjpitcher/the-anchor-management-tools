import { google } from 'googleapis';
import { isCalendarConfigured, getOAuth2Client } from './google-calendar';
import type { Employee } from '@/types/database';
import { format, getYear } from 'date-fns';

// Minimal employee type for birthday sync
interface EmployeeBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  date_of_birth: string | null;
  email_address: string | null;
}

// Initialize the calendar API
const calendar = google.calendar('v3');

// Generate a unique event ID for an employee's birthday
function generateBirthdayEventId(employeeId: string): string {
  // Use a predictable ID so we can find and update existing events
  // Remove year from ID since this will be a recurring event
  return `birthday-${employeeId}`.replace(/[^a-z0-9]/g, '');
}

// Create or update a birthday calendar event
export async function syncBirthdayCalendarEvent(employee: EmployeeBirthday | Employee): Promise<string | null> {
  console.log('[Birthday Calendar] Starting calendar sync for employee:', {
    employeeId: employee.employee_id,
    name: `${employee.first_name} ${employee.last_name}`,
    hasDOB: !!employee.date_of_birth,
    isConfigured: isCalendarConfigured()
  });

  try {
    if (!isCalendarConfigured()) {
      console.warn('[Birthday Calendar] Not configured. Skipping calendar sync.');
      return null;
    }

    if (!employee.date_of_birth) {
      console.warn('[Birthday Calendar] Employee has no date of birth:', employee.employee_id);
      return null;
    }

    console.log('[Birthday Calendar] Getting auth client...');
    const auth = await getOAuth2Client();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    console.log('[Birthday Calendar] Using calendar ID:', calendarId);
    
    // Parse date of birth
    const dob = new Date(employee.date_of_birth);
    const eventId = generateBirthdayEventId(employee.employee_id);
    
    // Calculate the start date for the recurring event
    // If the birthday has already passed this year, start from next year
    const currentYear = getYear(new Date());
    const currentYearBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startYear: number;
    if (currentYearBirthday >= today) {
      startYear = currentYear;
    } else {
      startYear = currentYear + 1;
    }
    
    const startDate = new Date(startYear, dob.getMonth(), dob.getDate());
    const birthYear = dob.getFullYear();
    
    const event = {
      id: eventId,
      summary: `🎂 ${employee.first_name} ${employee.last_name}'s Birthday`,
      description: [
        `${employee.first_name} ${employee.last_name}`,
        `Born: ${format(dob, 'MMMM d, yyyy')}`,
        employee.job_title ? `Job Title: ${employee.job_title}` : '',
        employee.email_address ? `Email: ${employee.email_address}` : '',
        '',
        'Remember to wish them a happy birthday! 🎉'
      ].filter(Boolean).join('\n'),
      start: {
        date: format(startDate, 'yyyy-MM-dd'),
        timeZone: 'Europe/London'
      },
      end: {
        date: format(startDate, 'yyyy-MM-dd'),
        timeZone: 'Europe/London'
      },
      recurrence: [
        `RRULE:FREQ=YEARLY;BYMONTH=${dob.getMonth() + 1};BYMONTHDAY=${dob.getDate()}`
      ],
      colorId: '5', // Yellow color for birthdays
      transparency: 'transparent', // Show as free time
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 0 }, // At the start of the day
          { method: 'email', minutes: 7 * 24 * 60 } // 1 week before
        ]
      }
    };
    
    console.log('[Birthday Calendar] Event object prepared:', {
      summary: event.summary,
      eventId: eventId,
      startDate: format(startDate, 'yyyy-MM-dd'),
      recurrence: event.recurrence
    });

    let response;
    
    try {
      // Try to get existing event
      console.log('[Birthday Calendar] Checking for existing event:', eventId);
      const existingEvent = await calendar.events.get({
        auth: auth as any,
        calendarId,
        eventId
      });
      
      // Update existing event
      console.log('[Birthday Calendar] Updating existing event:', eventId);
      response = await calendar.events.update({
        auth: auth as any,
        calendarId,
        eventId,
        requestBody: event
      });
      console.log('[Birthday Calendar] Event updated successfully:', response.data.id);
    } catch (error: any) {
      if (error.code === 404) {
        // Create new event
        console.log('[Birthday Calendar] Creating new event...');
        response = await calendar.events.insert({
          auth: auth as any,
          calendarId,
          requestBody: event
        });
        console.log('[Birthday Calendar] Event created successfully:', {
          id: response.data.id,
          link: response.data.htmlLink
        });
      } else {
        throw error;
      }
    }
    
    return response.data.id || null;
  } catch (error: any) {
    // Provide more detailed error information
    console.error('[Birthday Calendar] Sync failed:', {
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.errors,
      stack: error.stack
    });
    
    if (error.message?.includes('authentication')) {
      console.error('[Birthday Calendar] Authentication error:', error.message);
      console.error('Please check your Google Calendar configuration in environment variables.');
    } else if (error.code === 404) {
      console.error('[Birthday Calendar] Calendar not found. Please check GOOGLE_CALENDAR_ID:', process.env.GOOGLE_CALENDAR_ID);
      console.error('Ensure the calendar exists and is accessible by the service account.');
    } else if (error.code === 403) {
      console.error('[Birthday Calendar] Permission denied. Service account email:', error.email);
      console.error('Please ensure the service account has been granted access to the calendar.');
      console.error('1. Go to Google Calendar settings');
      console.error('2. Find the calendar and click "Settings and sharing"');
      console.error('3. Under "Share with specific people", add the service account email');
      console.error('4. Grant "Make changes to events" permission');
    } else if (error.code === 400) {
      console.error('[Birthday Calendar] Bad request. Check the event data format.');
      console.error('Error details:', error.errors);
    } else {
      console.error('[Birthday Calendar] Unexpected error:', error.message || error);
    }
    
    // Don't throw the error, just return null to allow the operation to proceed
    return null;
  }
}

// Delete birthday calendar events for an employee
export async function deleteBirthdayCalendarEvent(employeeId: string): Promise<boolean> {
  try {
    if (!isCalendarConfigured()) {
      console.warn('[Birthday Calendar] Not configured. Skipping calendar delete.');
      return true;
    }

    const auth = await getOAuth2Client();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const eventId = generateBirthdayEventId(employeeId);
    
    try {
      await calendar.events.delete({
        auth: auth as any,
        calendarId,
        eventId
      });
      
      console.log('[Birthday Calendar] Deleted birthday event:', eventId);
      return true;
    } catch (error: any) {
      if (error.code === 404 || error.code === 410) {
        // Event not found or already deleted - that's okay
        console.log('[Birthday Calendar] Event not found (may not exist):', eventId);
        return false;
      } else {
        console.error('[Birthday Calendar] Error deleting event:', error.message);
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[Birthday Calendar] Delete failed:', error.message);
    return false;
  }
}

// Sync all employee birthdays to calendar
export async function syncAllBirthdaysToCalendar(): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}> {
  try {
    if (!isCalendarConfigured()) {
      return {
        success: false,
        synced: 0,
        failed: 0,
        errors: ['Google Calendar is not configured']
      };
    }

    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    
    // Get all active employees with birthdays
    const { data: employees, error } = await supabase
      .from('employees')
      .select('employee_id, first_name, last_name, job_title, date_of_birth, email_address')
      .eq('status', 'Active')
      .not('date_of_birth', 'is', null);

    if (error) {
      throw error;
    }

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const employee of employees || []) {
      try {
        const eventId = await syncBirthdayCalendarEvent(employee);
        if (eventId) {
          synced++;
        } else {
          failed++;
          errors.push(`Failed to sync ${employee.first_name} ${employee.last_name}`);
        }
      } catch (error: any) {
        failed++;
        errors.push(`Error syncing ${employee.first_name} ${employee.last_name}: ${error.message}`);
      }
    }
    
    return {
      success: failed === 0,
      synced,
      failed,
      errors
    };
  } catch (error: any) {
    return {
      success: false,
      synced: 0,
      failed: 0,
      errors: [error.message]
    };
  }
}
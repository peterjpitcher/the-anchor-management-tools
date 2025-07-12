import { google } from 'googleapis';
import { isCalendarConfigured } from './google-calendar';
import type { Employee } from '@/types/database';

// Minimal employee type for birthday sync
interface EmployeeBirthday {
  employee_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  date_of_birth: string | null;
  email_address: string | null;
}
import { format, getYear } from 'date-fns';

// Initialize the calendar API
const calendar = google.calendar('v3');

// Get OAuth2 client (copied from google-calendar.ts to reuse)
async function getOAuth2Client() {
  try {
    // Check for OAuth2 configuration first
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URL
    );

    // Use service account if available (recommended for server-to-server)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      
      // Fix escaped newlines in private key if needed
      if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
        if (serviceAccount.private_key.includes('\\n') && !serviceAccount.private_key.includes('\n')) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
      }
      
      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/calendar']
      });
      
      return await auth.getClient();
    }

    // Otherwise use OAuth2 with refresh token
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      });
      return oauth2Client;
    }

    throw new Error('Google Calendar authentication not configured');
  } catch (error) {
    console.error('Error in getOAuth2Client:', error);
    throw error;
  }
}

// Generate a unique event ID for an employee's birthday
function generateBirthdayEventId(employeeId: string, year: number): string {
  // Use a predictable ID so we can find and update existing events
  return `birthday-${employeeId}-${year}`.replace(/[^a-z0-9]/g, '');
}

// Create or update a birthday calendar event
export async function syncBirthdayCalendarEvent(employee: EmployeeBirthday | Employee): Promise<string | null> {
  try {
    if (!isCalendarConfigured()) {
      console.warn('[Birthday Calendar] Not configured. Skipping calendar sync.');
      return null;
    }

    if (!employee.date_of_birth) {
      console.warn('[Birthday Calendar] Employee has no date of birth:', employee.employee_id);
      return null;
    }

    const auth = await getOAuth2Client();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    // Calculate this year's and next year's birthday
    const currentYear = getYear(new Date());
    const dob = new Date(employee.date_of_birth);
    const currentYearBirthday = new Date(currentYear, dob.getMonth(), dob.getDate());
    const nextYearBirthday = new Date(currentYear + 1, dob.getMonth(), dob.getDate());
    
    // Determine which year's birthday to create/update
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let birthdayDate: Date;
    let year: number;
    
    // If this year's birthday hasn't passed yet, create for this year
    // Otherwise, create for next year
    if (currentYearBirthday >= today) {
      birthdayDate = currentYearBirthday;
      year = currentYear;
    } else {
      birthdayDate = nextYearBirthday;
      year = currentYear + 1;
    }
    
    const eventId = generateBirthdayEventId(employee.employee_id, year);
    const age = year - dob.getFullYear();
    
    const event = {
      id: eventId,
      summary: `🎂 ${employee.first_name} ${employee.last_name}'s Birthday (${age})`,
      description: [
        `${employee.first_name} ${employee.last_name} turns ${age}`,
        employee.job_title ? `Job Title: ${employee.job_title}` : '',
        employee.email_address ? `Email: ${employee.email_address}` : '',
        '',
        'Remember to wish them a happy birthday! 🎉'
      ].filter(Boolean).join('\n'),
      start: {
        date: format(birthdayDate, 'yyyy-MM-dd'),
        timeZone: 'Europe/London'
      },
      end: {
        date: format(birthdayDate, 'yyyy-MM-dd'),
        timeZone: 'Europe/London'
      },
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
    
    try {
      // Try to get existing event
      const existingEvent = await calendar.events.get({
        auth: auth as any,
        calendarId,
        eventId
      });
      
      // Update existing event
      const response = await calendar.events.update({
        auth: auth as any,
        calendarId,
        eventId,
        requestBody: event
      });
      
      console.log('[Birthday Calendar] Updated birthday event:', eventId);
      return response.data.id || null;
    } catch (error: any) {
      if (error.code === 404) {
        // Create new event
        const response = await calendar.events.insert({
          auth: auth as any,
          calendarId,
          requestBody: event
        });
        
        console.log('[Birthday Calendar] Created birthday event:', eventId);
        return response.data.id || null;
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error('[Birthday Calendar] Sync failed:', error.message);
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
    const currentYear = getYear(new Date());
    
    // Try to delete this year's and next year's events
    const years = [currentYear, currentYear + 1];
    let deletedAny = false;
    
    for (const year of years) {
      const eventId = generateBirthdayEventId(employeeId, year);
      
      try {
        await calendar.events.delete({
          auth: auth as any,
          calendarId,
          eventId
        });
        
        console.log('[Birthday Calendar] Deleted birthday event:', eventId);
        deletedAny = true;
      } catch (error: any) {
        if (error.code === 404 || error.code === 410) {
          // Event not found or already deleted - that's okay
          console.log('[Birthday Calendar] Event not found (may not exist):', eventId);
        } else {
          console.error('[Birthday Calendar] Error deleting event:', error.message);
        }
      }
    }
    
    return deletedAny;
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
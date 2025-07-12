#!/usr/bin/env tsx
/**
 * Migration script to convert existing individual birthday calendar events
 * to recurring annual events.
 * 
 * This script will:
 * 1. Delete all existing year-specific birthday events
 * 2. Re-sync all active employees to create recurring birthday events
 */

import { config } from 'dotenv';
import { google } from 'googleapis';
import { createClient } from '@/lib/supabase/server';
import { syncAllBirthdaysToCalendar } from '@/lib/google-calendar-birthdays';
import { format } from 'date-fns';

// Load environment variables
config({ path: '.env.local' });

const calendar = google.calendar('v3');

// Get OAuth2 client (copied from google-calendar.ts)
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

async function deleteOldBirthdayEvents() {
  try {
    console.log('🔍 Searching for existing birthday events to delete...');
    
    const auth = await getOAuth2Client();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    // Search for all birthday events (they have a specific pattern in the ID)
    const response = await calendar.events.list({
      auth: auth as any,
      calendarId,
      q: 'Birthday', // Search for events with "Birthday" in the title
      maxResults: 500,
      singleEvents: true
    });

    const events = response.data.items || [];
    const birthdayEvents = events.filter(event => 
      event.id && event.id.startsWith('birthday-') && 
      event.id.match(/birthday-[a-z0-9]+-\d{4}/) // Old pattern: birthday-{employeeId}-{year}
    );

    console.log(`Found ${birthdayEvents.length} old birthday events to delete`);

    let deletedCount = 0;
    for (const event of birthdayEvents) {
      try {
        await calendar.events.delete({
          auth: auth as any,
          calendarId,
          eventId: event.id!
        });
        console.log(`✅ Deleted: ${event.summary} (${event.id})`);
        deletedCount++;
      } catch (error: any) {
        if (error.code === 404 || error.code === 410) {
          console.log(`⚠️  Already deleted: ${event.summary}`);
        } else {
          console.error(`❌ Failed to delete ${event.summary}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Deleted ${deletedCount} old birthday events`);
    return deletedCount;
  } catch (error) {
    console.error('Error deleting old birthday events:', error);
    throw error;
  }
}

async function main() {
  console.log('🎂 Birthday Events Migration Script');
  console.log('===================================\n');

  try {
    // Check if Google Calendar is configured
    if (!process.env.GOOGLE_CALENDAR_ID) {
      console.error('❌ Google Calendar is not configured. Please set GOOGLE_CALENDAR_ID in .env.local');
      process.exit(1);
    }

    // Step 1: Delete old year-specific birthday events
    console.log('Step 1: Cleaning up old birthday events...');
    const deletedCount = await deleteOldBirthdayEvents();
    console.log();

    // Step 2: Re-sync all birthdays to create recurring events
    console.log('Step 2: Creating new recurring birthday events...');
    const result = await syncAllBirthdaysToCalendar();
    
    if (result.success) {
      console.log(`\n✅ Migration completed successfully!`);
      console.log(`   - Deleted ${deletedCount} old events`);
      console.log(`   - Created ${result.synced} recurring events`);
      if (result.failed > 0) {
        console.log(`   - Failed to sync ${result.failed} employees`);
        result.errors.forEach(error => console.log(`     ⚠️  ${error}`));
      }
    } else {
      console.error('\n❌ Migration failed:');
      result.errors.forEach(error => console.error(`   - ${error}`));
      process.exit(1);
    }

    // Step 3: Verify the new events
    console.log('\nStep 3: Verifying new recurring events...');
    const auth = await getOAuth2Client();
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    const verifyResponse = await calendar.events.list({
      auth: auth as any,
      calendarId,
      q: 'Birthday',
      maxResults: 10,
      singleEvents: false // This will show recurring events
    });

    const newEvents = verifyResponse.data.items || [];
    const recurringEvents = newEvents.filter(event => event.recurrence);
    
    console.log(`\n✅ Found ${recurringEvents.length} recurring birthday events`);
    recurringEvents.slice(0, 5).forEach(event => {
      console.log(`   - ${event.summary} (ID: ${event.id})`);
    });
    
    if (recurringEvents.length > 5) {
      console.log(`   ... and ${recurringEvents.length - 5} more`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📌 Note: The new recurring events will automatically appear on the calendar');
    console.log('   every year on the employee\'s birthday without needing manual updates.');
    
  } catch (error) {
    console.error('\n❌ Migration error:', error);
    process.exit(1);
  }
}

// Run the migration
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
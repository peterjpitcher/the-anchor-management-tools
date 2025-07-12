'use server';

import { checkUserPermission } from './rbac';
import { syncAllBirthdaysToCalendar } from '@/lib/google-calendar-birthdays';

export async function syncBirthdays() {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'manage');
    if (!hasPermission) {
      return {
        error: 'You do not have permission to sync birthdays'
      };
    }

    const result = await syncAllBirthdaysToCalendar();
    
    return {
      success: result.success,
      synced: result.synced,
      failed: result.failed,
      errors: result.errors
    };
  } catch (error) {
    console.error('Error in syncBirthdays action:', error);
    return {
      error: 'An unexpected error occurred',
      success: false,
      synced: 0,
      failed: 0,
      errors: ['An unexpected error occurred']
    };
  }
}
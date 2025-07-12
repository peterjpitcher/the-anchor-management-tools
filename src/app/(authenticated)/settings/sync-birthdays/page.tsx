'use client';

import { useState } from 'react';
import { syncBirthdays } from '@/app/actions/sync-birthdays';
import { usePermissions } from '@/contexts/PermissionContext';
import Link from 'next/link';
import {
  CalendarIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

export default function SyncBirthdaysPage() {
  const { hasPermission } = usePermissions();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    synced: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const handleSync = async () => {
    if (!hasPermission('employees', 'manage')) {
      toast.error('You do not have permission to sync birthdays');
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    
    try {
      const result = await syncBirthdays();
      
      if ('error' in result && typeof result.error === 'string') {
        toast.error(result.error);
        setSyncResult({
          success: false,
          synced: 0,
          failed: 0,
          errors: [result.error]
        });
        return;
      }
      
      setSyncResult(result);
      
      if (result.success) {
        toast.success(`Successfully synced ${result.synced} birthdays`);
      } else if (result.synced > 0) {
        toast.success(`Synced ${result.synced} birthdays with ${result.failed} failures`);
      } else {
        toast.error('Failed to sync birthdays');
      }
    } catch (error) {
      toast.error('An error occurred while syncing');
      setSyncResult({
        success: false,
        synced: 0,
        failed: 0,
        errors: ['An unexpected error occurred']
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!hasPermission('employees', 'manage')) {
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
          <div className="flex items-center space-x-4">
            <Link
              href="/settings"
              className="text-gray-400 hover:text-gray-500"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center">
                <CalendarIcon className="h-8 w-8 mr-2 text-blue-500" />
                Sync Employee Birthdays to Calendar
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Sync all active employee birthdays to Google Calendar
              </p>
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
            <h3 className="text-sm font-medium text-blue-800">About Birthday Calendar Sync</h3>
            <div className="mt-2 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li>Creates all-day calendar events for each active employee&apos;s birthday</li>
                <li>Events are created for the current year (or next year if birthday has passed)</li>
                <li>Birthday events are automatically removed when employees become former employees</li>
                <li>Events include the employee&apos;s name, age they&apos;re turning, and job title</li>
                <li>Reminders are set for the day of and 1 week before</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Button */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="text-center">
            <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Sync Birthday Events</h3>
            <p className="mt-1 text-sm text-gray-500">
              This will create or update calendar events for all active employees with birthdays.
            </p>
            <div className="mt-6">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {syncing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Syncing...
                  </>
                ) : (
                  <>
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    Sync All Birthdays
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {syncResult && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Sync Results</h3>
            
            <div className="space-y-3">
              {/* Success Count */}
              {syncResult.synced > 0 && (
                <div className="flex items-center text-green-600">
                  <CheckCircleIcon className="h-5 w-5 mr-2" />
                  <span>{syncResult.synced} birthdays synced successfully</span>
                </div>
              )}
              
              {/* Failure Count */}
              {syncResult.failed > 0 && (
                <div className="flex items-center text-red-600">
                  <XCircleIcon className="h-5 w-5 mr-2" />
                  <span>{syncResult.failed} birthdays failed to sync</span>
                </div>
              )}
              
              {/* Error Details */}
              {syncResult.errors.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Errors:</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {syncResult.errors.map((error, index) => (
                      <li key={index} className="text-sm text-red-600">
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Next Steps</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
          <li>Birthday events will appear in your Google Calendar</li>
          <li>New employees will have their birthdays automatically added when created</li>
          <li>Birthday events are automatically removed when employees leave</li>
          <li>Email reminders will still be sent weekly to manager@the-anchor.pub</li>
        </ol>
      </div>
    </div>
  );
}
'use client';

import { useState } from 'react';
import { syncBirthdays } from '@/app/actions/sync-birthdays';
import { usePermissions } from '@/contexts/PermissionContext';
import {
  CalendarIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { Page } from '@/components/ui-v2/layout/Page';
import { Card, CardTitle } from '@/components/ui-v2/layout/Card';
import { Button } from '@/components/ui-v2/forms/Button';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Section } from '@/components/ui-v2/layout/Section';

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
    <Page
      title="Sync Employee Birthdays to Calendar"
      description="Sync all active employee birthdays to Google Calendar"
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Sync Birthdays' }
      ]}
    >
      {/* Info Banner */}
      <Alert
        variant="info"
        title="About Birthday Calendar Sync"
      >
        <ul className="list-disc list-inside space-y-1">
          <li>Creates all-day calendar events for each active employee&apos;s birthday</li>
          <li>Events are created for the current year (or next year if birthday has passed)</li>
          <li>Birthday events are automatically removed when employees become former employees</li>
          <li>Events include the employee&apos;s name, age they&apos;re turning, and job title</li>
          <li>Reminders are set for the day of and 1 week before</li>
        </ul>
      </Alert>

      {/* Sync Button */}
      <Card className="text-center">
        <CalendarIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">Sync Birthday Events</h3>
        <p className="mt-1 text-sm text-gray-500">
          This will create or update calendar events for all active employees with birthdays.
        </p>
        <div className="mt-6">
          <Button onClick={handleSync}
            disabled={syncing}
            loading={syncing}
            leftIcon={!syncing && <CalendarIcon className="h-4 w-4" />}
            variant="primary"
          >
            {syncing ? 'Syncing...' : 'Sync All Birthdays'}
          </Button>
        </div>
      </Card>

      {/* Results */}
      {syncResult && (
        <Card
          header={
            <CardTitle>Sync Results</CardTitle>
          }
        >
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
        </Card>
      )}

      {/* Instructions */}
      <Section
        variant="gray"
        title="Next Steps"
      >
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
          <li>Birthday events will appear in your Google Calendar</li>
          <li>New employees will have their birthdays automatically added when created</li>
          <li>Birthday events are automatically removed when employees leave</li>
          <li>Email reminders will still be sent weekly to manager@the-anchor.pub</li>
        </ol>
      </Section>
    </Page>
  );
}
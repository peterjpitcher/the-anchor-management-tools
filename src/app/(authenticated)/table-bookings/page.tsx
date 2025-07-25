import { Suspense } from 'react';
import TableBookingsDashboard from './dashboard';
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';

export default function TableBookingsPage() {
  return (
    <Suspense fallback={
      <div>
        <PageHeader title="Loading..." />
        <div className="flex items-center justify-center h-64">
          <Spinner size="lg" />
        </div>
      </div>
    }>
      <TableBookingsDashboard />
    </Suspense>
  );
}
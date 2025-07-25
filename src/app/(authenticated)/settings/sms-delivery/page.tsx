'use client'

import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { getSmsDeliveryStats, getDeliveryFailureReport } from '@/app/actions/customerSmsActions';
import Link from 'next/link';
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
// New UI components
import { Page } from '@/components/ui-v2/layout/Page';
import { Card } from '@/components/ui-v2/layout/Card';
import { Section } from '@/components/ui-v2/layout/Section';
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Stat, StatGroup } from '@/components/ui-v2/display/Stat';
import { DataTable } from '@/components/ui-v2/display/DataTable';
import { Spinner } from '@/components/ui-v2/feedback/Spinner';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { EmptyState } from '@/components/ui-v2/display/EmptyState';

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
interface SmsStats {
  messages: {
    total: number;
    byStatus: Record<string, number>;
    totalCost: string;
    deliveryRate: string;
  };
  customers: {
    active: number;
    inactive: number;
    total: number;
  };
}

interface FailedCustomer {
  id: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  sms_delivery_failures: number;
  last_sms_failure_reason: string | null;
  sms_deactivation_reason: string | null;
  sms_opt_in: boolean;
}

export default function SmsDeliveryStatsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<SmsStats | null>(null);
  const [failedCustomers, setFailedCustomers] = useState<FailedCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        
        // Load overall stats
        const statsResult = await getSmsDeliveryStats();
        if ('error' in statsResult && statsResult.error) {
          setError(statsResult.error);
          return;
        }
        setStats(statsResult as SmsStats);

        // Load failed deliveries
        const failureResult = await getDeliveryFailureReport();
        if ('error' in failureResult && failureResult.error) {
          setError(failureResult.error);
          return;
        }
        setFailedCustomers(failureResult.customers || []);
        
      } catch (err) {
        setError('Failed to load SMS delivery statistics');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <Page title="SMS Delivery Statistics">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading SMS delivery statistics...</p>
          </div>
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="SMS Delivery Statistics">
        <Card>
          <Alert
            variant="error"
            title="Error loading statistics"
            
          />
        </Card>
      </Page>
    );
  }

  const statusVariants: Record<string, 'success' | 'info' | 'error' | 'warning'> = {
    delivered: 'success',
    sent: 'info',
    failed: 'error',
    undelivered: 'error',
    queued: 'warning',
    sending: 'warning'
  };

  return (
    <Page
      title="SMS Delivery Statistics"
      description="Monitor SMS delivery performance and manage customer messaging preferences"
      actions={
        <LinkButton
          href="/settings"
          variant="secondary"
          size="sm"
        >
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
        </LinkButton>
      }
    >

      {/* Overview Statistics */}
      <Card>
        <StatGroup>
          <Stat
            label="Total Messages (30d)"
            value={stats?.messages.total || 0}
          />
          <Stat
            label="Delivery Rate"
            value={`${stats?.messages.deliveryRate || 0}%`}
          />
          <Stat
            label="Total Cost (30d)"
            value={`$${stats?.messages.totalCost || '0.00'}`}
          />
          <Stat
            label="Active Customers"
            value={`${stats?.customers.active || 0} / ${stats?.customers.total || 0}`}
          />
        </StatGroup>
      </Card>

      {/* Message Status Breakdown */}
      {stats?.messages.byStatus && Object.keys(stats.messages.byStatus).length > 0 && (
        <Section title="Message Status Breakdown (Last 30 Days)">
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(stats.messages.byStatus).map(([status, count]) => (
                <div key={status} className="text-center">
                  <Badge variant={statusVariants[status] || 'info'} size="sm">
                    {status}
                  </Badge>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{count}</p>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {/* Failed Deliveries */}
      {failedCustomers.length > 0 && (
        <Section title="Customers with Delivery Issues">
          <Card>
            <DataTable
              data={failedCustomers}
              getRowKey={(customer) => customer.id}
              columns={[
                {
                  key: 'name',
                  header: 'Customer',
                  cell: (customer: FailedCustomer) => (
                    <span className="font-medium text-gray-900">
                      {customer.first_name} {customer.last_name}
                    </span>
                  ),
                },
                {
                  key: 'mobile_number',
                  header: 'Mobile Number',
                  cell: (customer: FailedCustomer) => customer.mobile_number,
                },
                {
                  key: 'sms_delivery_failures',
                  header: 'Failures',
                  cell: (customer: FailedCustomer) => customer.sms_delivery_failures,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (customer: FailedCustomer) => (
                    <Badge variant={customer.sms_opt_in ? 'success' : 'error'} size="sm">
                      {customer.sms_opt_in ? 'Active' : 'Deactivated'}
                    </Badge>
                  ),
                },
                {
                  key: 'reason',
                  header: 'Reason',
                  cell: (customer: FailedCustomer) => (
                    customer.sms_deactivation_reason || customer.last_sms_failure_reason || '-'
                  ),
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (customer: FailedCustomer) => (
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      View
                    </Link>
                  ),
                },
              ]}
            />
          </Card>
        </Section>
      )}

      {/* Webhook Configuration Info */}
      <Card>
        <Alert variant="info"
          title="Twilio Webhook Configuration"
          icon={<ExclamationTriangleIcon className="h-5 w-5" />}
        >
          <p>
            To enable delivery tracking, configure your Twilio webhook URL to:
          </p>
          <code className="mt-1 block bg-blue-100 rounded px-2 py-1 text-xs">
            {process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/api/webhooks/twilio
          </code>
        
            {error}</Alert>
      </Card>
    </Page>
  );
}
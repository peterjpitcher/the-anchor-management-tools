'use client'

import { useEffect, useState } from 'react';
import { getSmsDeliveryStats, getDeliveryFailureReport } from '@/app/actions/customerSmsActions';
import Link from 'next/link';
import { ArrowLeftIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading SMS delivery statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Error: {error}</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    delivered: 'bg-green-100 text-green-800',
    sent: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    undelivered: 'bg-red-100 text-red-800',
    queued: 'bg-yellow-100 text-yellow-800',
    sending: 'bg-yellow-100 text-yellow-800'
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">SMS Delivery Statistics</h1>
            <Link
              href="/settings"
              className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-500"
            >
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back to Settings
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Monitor SMS delivery performance and manage customer messaging preferences
          </p>
        </div>
      </div>

      {/* Overview Statistics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <dt className="text-sm font-medium text-gray-500 truncate">Total Messages (30d)</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats?.messages.total || 0}</dd>
          </div>
        </div>
        
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <dt className="text-sm font-medium text-gray-500 truncate">Delivery Rate</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats?.messages.deliveryRate || 0}%</dd>
          </div>
        </div>
        
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <dt className="text-sm font-medium text-gray-500 truncate">Total Cost (30d)</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">${stats?.messages.totalCost || '0.00'}</dd>
          </div>
        </div>
        
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <dt className="text-sm font-medium text-gray-500 truncate">Active Customers</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">
              {stats?.customers.active || 0} / {stats?.customers.total || 0}
            </dd>
          </div>
        </div>
      </div>

      {/* Message Status Breakdown */}
      {stats?.messages.byStatus && Object.keys(stats.messages.byStatus).length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Message Status Breakdown (Last 30 Days)
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(stats.messages.byStatus).map(([status, count]) => (
                <div key={status} className="text-center">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
                    {status}
                  </span>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{count}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Failed Deliveries */}
      {failedCustomers.length > 0 && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Customers with Delivery Issues
            </h3>
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Mobile Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Failures
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reason
                    </th>
                    <th className="relative px-6 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {failedCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {customer.first_name} {customer.last_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {customer.mobile_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {customer.sms_delivery_failures}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          customer.sms_opt_in ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {customer.sms_opt_in ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {customer.sms_deactivation_reason || customer.last_sms_failure_reason || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Configuration Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <ExclamationTriangleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Twilio Webhook Configuration</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                To enable delivery tracking, configure your Twilio webhook URL to:
              </p>
              <code className="mt-1 block bg-blue-100 rounded px-2 py-1 text-xs">
                {process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'}/api/webhooks/twilio
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
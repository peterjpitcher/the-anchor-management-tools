'use client';

import type { EmployeeFinancialDetails } from '@/types/database';

interface FinancialDetailsTabProps {
  financialDetails: EmployeeFinancialDetails | null;
}

const DetailItem = ({ label, value }: { label: string; value: string | undefined | null }) => (
  <div className="py-3 sm:grid sm:grid-cols-4 sm:gap-4">
    <dt className="text-sm font-medium text-gray-500">{label}</dt>
    <dd className="mt-1 text-sm text-gray-900 sm:col-span-3 sm:mt-0">{value || 'N/A'}</dd>
  </div>
);

export default function FinancialDetailsTab({ financialDetails }: FinancialDetailsTabProps) {
  const details = [
    { label: 'NI Number', value: financialDetails?.ni_number },
    { label: 'Account Name(s)', value: financialDetails?.payee_name },
    { label: 'Bank / Building Society', value: financialDetails?.bank_name },
    { label: 'Sort Code', value: financialDetails?.bank_sort_code },
    { label: 'Account Number', value: financialDetails?.bank_account_number },
    { label: 'Branch Address', value: financialDetails?.branch_address },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Financial Details</h3>
          <p className="mt-1 text-sm text-gray-600">
            Confidential financial and payment information.
          </p>
        </div>
        {/* Placeholder for future "Edit" button */}
      </div>
      
      <dl className="sm:divide-y sm:divide-gray-200">
        {details.map(item => <DetailItem key={item.label} {...item} />)}
      </dl>
    </div>
  );
} 

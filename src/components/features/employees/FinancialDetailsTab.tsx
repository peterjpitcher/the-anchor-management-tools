'use client';

import type { EmployeeFinancialDetails } from '@/types/database';
import { Card, CardBody, CardHeader, DescriptionList, LinkButton } from '@/ds';

interface FinancialDetailsTabProps {
  employeeId: string;
  financialDetails: EmployeeFinancialDetails | null;
  canEdit: boolean;
}

export default function FinancialDetailsTab({ employeeId, financialDetails, canEdit }: FinancialDetailsTabProps) {
  const details = [
    { key: 'ni_number', label: 'NI Number', value: financialDetails?.ni_number },
    { key: 'payee_name', label: 'Account Name(s)', value: financialDetails?.payee_name },
    { key: 'bank_name', label: 'Bank / Building Society', value: financialDetails?.bank_name },
    { key: 'bank_sort_code', label: 'Sort Code', value: financialDetails?.bank_sort_code },
    { key: 'bank_account_number', label: 'Account Number', value: financialDetails?.bank_account_number },
    { key: 'branch_address', label: 'Branch Address', value: financialDetails?.branch_address, span: 2 as const },
  ].map((item) => ({ ...item, value: item.value || 'N/A' }));

  return (
    <Card>
      <CardHeader
        title="Financial Details"
        subtitle="Confidential financial and payment information"
        action={canEdit ? (
          <LinkButton href={`/employees/${employeeId}/edit?tab=financial`} variant="secondary" size="sm">
            Edit
          </LinkButton>
        ) : undefined}
      />
      <CardBody>
        <DescriptionList items={details} />
      </CardBody>
    </Card>
  );
}

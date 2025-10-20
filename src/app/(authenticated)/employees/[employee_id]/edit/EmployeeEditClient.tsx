'use client'

import EmployeeForm from '@/components/EmployeeForm'
import FinancialDetailsForm from '@/components/FinancialDetailsForm'
import HealthRecordsForm from '@/components/HealthRecordsForm'
import { updateEmployee } from '@/app/actions/employeeActions'
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

interface EmployeeEditClientProps {
  employee: Employee
  financialDetails: EmployeeFinancialDetails | null
  healthRecord: EmployeeHealthRecord | null
}

export default function EmployeeEditClient({
  employee,
  financialDetails,
  healthRecord
}: EmployeeEditClientProps) {
  const tabs = [
    {
      key: 'personal',
      label: 'Personal Details',
      content: (
        <EmployeeForm
          employee={employee}
          formAction={updateEmployee}
          initialFormState={null}
          showTitle={false}
          showCancel={false}
        />
      )
    },
    {
      key: 'financial',
      label: 'Financial Details',
      content: (
        <FinancialDetailsForm
          employeeId={employee.employee_id}
          financialDetails={financialDetails}
        />
      )
    },
    {
      key: 'health',
      label: 'Health Records',
      content: (
        <HealthRecordsForm
          employeeId={employee.employee_id}
          healthRecord={healthRecord}
        />
      )
    }
  ]

  const navItems: HeaderNavItem[] = [
    { label: 'Personal', href: '#personal' },
    { label: 'Financial', href: '#financial' },
    { label: 'Health', href: '#health' },
  ]

  return (
    <PageLayout
      title={`Edit: ${employee.first_name} ${employee.last_name}`}
      subtitle="Update employee details"
      backButton={{
        label: 'Back to Employee',
        href: `/employees/${employee.employee_id}`
      }}
      navItems={navItems}
      headerActions={
        <LinkButton href={`/employees/${employee.employee_id}`} variant="secondary" size="sm">
          Cancel
        </LinkButton>
      }
    >
      <Card id="personal">
        <Tabs items={tabs} />
      </Card>
    </PageLayout>
  )
}

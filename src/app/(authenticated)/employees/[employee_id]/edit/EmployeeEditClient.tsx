'use client'

import EmployeeForm from '@/components/EmployeeForm'
import FinancialDetailsForm from '@/components/FinancialDetailsForm'
import HealthRecordsForm from '@/components/HealthRecordsForm'
import { updateEmployee } from '@/app/actions/employeeActions'
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord } from '@/types/database'
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { NavGroup } from '@/components/ui-v2/navigation/NavGroup'
import { NavLink } from '@/components/ui-v2/navigation/NavLink'

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

  return (
    <PageWrapper>
      <PageHeader
        title={`Edit: ${employee.first_name} ${employee.last_name}`}
        subtitle="Update employee details"
        backButton={{
          label: 'Back to Employee',
          href: `/employees/${employee.employee_id}`
        }}
        actions={
          <NavGroup>
            <NavLink href={`/employees/${employee.employee_id}`}>
              Cancel
            </NavLink>
          </NavGroup>
        }
      />

      <PageContent>
        <Card>
          <Tabs items={tabs} />
        </Card>
      </PageContent>
    </PageWrapper>
  )
}

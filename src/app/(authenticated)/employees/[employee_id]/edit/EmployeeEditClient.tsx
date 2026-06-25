'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EmployeeForm from '@/components/features/employees/EmployeeForm'
import FinancialDetailsForm from '@/components/features/employees/FinancialDetailsForm'
import HealthRecordsForm from '@/components/features/employees/HealthRecordsForm'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import { updateEmployee } from '@/app/actions/employeeActions'
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord, EmployeeRightToWork } from '@/types/database'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Tabs } from '@/ds'
import { LinkButton } from '@/ds'

interface EmployeeEditClientProps {
  employee: Employee
  financialDetails: EmployeeFinancialDetails | null
  healthRecord: EmployeeHealthRecord | null
  rightToWork: EmployeeRightToWork | null
  canViewDocuments: boolean
}

export default function EmployeeEditClient({
  employee,
  financialDetails,
  healthRecord,
  rightToWork,
  canViewDocuments
}: EmployeeEditClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tabKeys = useMemo(() => ['personal', 'financial', 'health', 'right_to_work'], [])
  const [activeTab, setActiveTab] = useState(tabKeys.includes(requestedTab ?? '') ? requestedTab! : 'personal')

  useEffect(() => {
    if (requestedTab && tabKeys.includes(requestedTab)) {
      setActiveTab(requestedTab)
    }
  }, [requestedTab, tabKeys])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.replace(`/employees/${employee.employee_id}/edit?tab=${tab}`, { scroll: false })
  }

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
    },
    {
      key: 'right_to_work',
      label: 'Right to Work',
      content: (
        <RightToWorkTab
          employeeId={employee.employee_id}
          rightToWork={rightToWork}
          canEdit={true}
          canViewDocuments={canViewDocuments}
        />
      )
    }
  ]

  return (
    <PageLayout
      title={`Edit: ${employee.first_name} ${employee.last_name}`}
      subtitle="Update employee details"
      backButton={{
        label: 'Back to Employee',
        href: `/employees/${employee.employee_id}`
      }}
      headerActions={
        <LinkButton href={`/employees/${employee.employee_id}`} variant="secondary" size="sm">
          Cancel
        </LinkButton>
      }
    >
      <Card id="personal">
        <Tabs items={tabs} activeKey={activeTab} onChange={handleTabChange} />
      </Card>
    </PageLayout>
  )
}

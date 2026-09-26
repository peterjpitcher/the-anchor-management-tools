'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EmployeeForm from '@/components/features/employees/EmployeeForm'
import FinancialDetailsForm from '@/components/features/employees/FinancialDetailsForm'
import HealthRecordsForm from '@/components/features/employees/HealthRecordsForm'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import { updateEmployee } from '@/app/actions/employeeActions'
import type { Employee, EmployeeFinancialDetails, EmployeeHealthRecord, EmployeeRightToWork } from '@/types/database'
import { displayName } from '@/lib/employees/display-name'
import { PageLayout, Tabs } from '@/ds'
import { employeePageTitle } from '../../_shared/employee-title'

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

  // Every form ends with its own Cancel, back to the employee.
  const employeeHref = `/employees/${employee.employee_id}`

  const tabs = [
    {
      id: 'personal',
      label: 'Personal Details',
      content: (
        <EmployeeForm
          employee={employee}
          formAction={updateEmployee}
          initialFormState={null}
          cancelHref={employeeHref}
        />
      )
    },
    {
      id: 'financial',
      label: 'Financial Details',
      content: (
        <FinancialDetailsForm
          employeeId={employee.employee_id}
          financialDetails={financialDetails}
          cancelHref={employeeHref}
        />
      )
    },
    {
      id: 'health',
      label: 'Health Records',
      content: (
        <HealthRecordsForm
          employeeId={employee.employee_id}
          healthRecord={healthRecord}
          cancelHref={employeeHref}
        />
      )
    },
    {
      id: 'right_to_work',
      label: 'Right to Work',
      content: (
        <RightToWorkTab
          employeeId={employee.employee_id}
          rightToWork={rightToWork}
          canEdit={true}
          canViewDocuments={canViewDocuments}
          cancelHref={employeeHref}
        />
      )
    }
  ]

  return (
    <PageLayout
      title={`Edit ${displayName(employee, employee.email_address)}`}
      subtitle="Update employee details"
      // Back to the employee's page, named as that page is titled.
      backButton={{ label: `Back to ${employeePageTitle(employee)}`, href: employeeHref }}
      containerSize="md"
    >
      <Tabs aria-label="Employee details" tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
    </PageLayout>
  )
}

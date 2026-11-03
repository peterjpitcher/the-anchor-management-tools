import { notFound, redirect } from 'next/navigation'
import { getEmployeeEditData } from '@/app/actions/employeeDetails'
import { PageLayout } from '@/ds'
import EmployeeEditClient from './EmployeeEditClient'

export const dynamic = 'force-dynamic'

type EditEmployeePageProps = {
  params: Promise<{
    employee_id: string
  }>
}

export default async function EditEmployeePage({ params }: EditEmployeePageProps) {
  const resolvedParams = await Promise.resolve(params)
  const employeeId = resolvedParams.employee_id

  if (!employeeId) {
    notFound()
  }

  const result = await getEmployeeEditData(employeeId)

  if (result.unauthorized) {
    redirect('/unauthorized')
  }

  // A failed load is checked before "not found": it carries no data either, so checking data
  // first showed a 404 for an employee who exists whenever the database read failed.
  if (result.error) {
    return (
      <PageLayout
        title="Edit Employee"
        backButton={{ label: 'Back to employee', href: `/employees/${employeeId}` }}
        containerSize="md"
        // The cause is logged by getEmployeeEditData; staff see a plain message.
        error="This employee could not be loaded, so they cannot be edited right now. Please try again."
      />
    )
  }

  if (result.notFound || !result.data) {
    notFound()
  }

  return (
    <EmployeeEditClient
      employee={result.data.employee}
      financialDetails={result.data.financialDetails}
      healthRecord={result.data.healthRecord}
      rightToWork={result.data.rightToWork}
      canViewDocuments={result.data.canViewDocuments}
      canUploadDocuments={result.data.canUploadDocuments}
      canDeleteDocuments={result.data.canDeleteDocuments}
    />
  )
}

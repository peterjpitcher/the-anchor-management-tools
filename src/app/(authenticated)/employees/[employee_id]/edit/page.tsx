import { notFound, redirect } from 'next/navigation'
import { getEmployeeEditData } from '@/app/actions/employeeDetails'
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

  if (result.notFound || !result.data) {
    notFound()
  }

  if (result.error) {
    throw new Error(result.error)
  }

  return (
    <EmployeeEditClient
      employee={result.data.employee}
      financialDetails={result.data.financialDetails}
      healthRecord={result.data.healthRecord}
    />
  )
}

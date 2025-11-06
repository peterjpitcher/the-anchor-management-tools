import { notFound, redirect } from 'next/navigation'
import { formatDate } from '@/lib/dateUtils'
import { calculateLengthOfService } from '@/lib/employeeUtils'
import { StatusBadge } from '@/components/ui-v2/display/Badge'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { Badge } from '@/components/ui-v2/display/Badge'
import DeleteEmployeeButton from '@/components/DeleteEmployeeButton'
import EmployeeNotesList from '@/components/EmployeeNotesList'
import AddEmployeeNoteForm from '@/components/AddEmployeeNoteForm'
import EmployeeAttachmentsList from '@/components/EmployeeAttachmentsList'
import AddEmployeeAttachmentForm from '@/components/AddEmployeeAttachmentForm'
import EmergencyContactsTab from '@/components/EmergencyContactsTab'
import FinancialDetailsTab from '@/components/FinancialDetailsTab'
import HealthRecordsTab from '@/components/HealthRecordsTab'
import RightToWorkTab from '@/components/RightToWorkTab'
import OnboardingChecklistTab from '@/components/OnboardingChecklistTab'
import { EmployeeAuditTrail } from '@/components/EmployeeAuditTrail'
import { EmployeeRecentChanges } from '@/components/EmployeeRecentChanges'
import { getEmployeeDetailData } from '@/app/actions/employeeDetails'
import { LinkButton } from '@/components/ui-v2/navigation/LinkButton'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

export const dynamic = 'force-dynamic'

interface EmployeeDetailPageProps {
  params: Promise<{
    employee_id: string
  }>
}

export default async function EmployeeDetailPage({ params }: EmployeeDetailPageProps) {
  const resolvedParams = await Promise.resolve(params)
  const employeeId = resolvedParams?.employee_id

  if (!employeeId) {
    notFound()
  }

  const result = await getEmployeeDetailData(employeeId)

  if (result.unauthorized) {
    redirect('/unauthorized')
  }

  if (result.notFound || !result.data) {
    notFound()
  }

  if (result.error) {
    throw new Error(result.error)
  }

  const {
    employee,
    financialDetails,
    healthRecord,
    notes,
    attachments,
    attachmentCategories,
    emergencyContacts,
    rightToWork,
    auditLogs,
    permissions
  } = result.data

  const attachmentCategoryMap = attachmentCategories.reduce<Record<string, string>>((acc, category) => {
    acc[category.category_id] = category.category_name
    return acc
  }, {})

  const displayFields = [
    { label: 'Full Name', value: `${employee.first_name} ${employee.last_name}` },
    { label: 'Email Address', value: employee.email_address, isEmail: true },
    { label: 'Job Title', value: employee.job_title },
    { label: 'Employment Status', value: employee.status, isBadge: true },
    { label: 'Start Date', value: employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A' },
    { label: 'End Date', value: employee.employment_end_date ? formatDate(employee.employment_end_date) : 'N/A' },
    { label: 'Date of Birth', value: employee.date_of_birth ? formatDate(employee.date_of_birth) : 'N/A' },
    { label: 'Phone Number', value: employee.phone_number || 'N/A', isPhone: true },
    { label: 'Address', value: employee.address || 'N/A', isFullWidth: true }
  ]

  const tabs = [
    {
      key: 'details',
      label: 'Details',
      content: (
        <dl className="divide-y divide-gray-200">
          {displayFields.map((field, index) => (
            <div
              key={index}
              className={`py-3 flex flex-col sm:grid sm:grid-cols-4 sm:gap-4 ${field.isFullWidth ? 'sm:grid-cols-1' : ''}`}
            >
              <dt className="text-sm font-medium text-gray-500 mb-1 sm:mb-0">{field.label}</dt>
              <dd className={`text-sm text-gray-900 ${field.isFullWidth ? '' : 'sm:col-span-3'}`}>
                {field.isBadge ? (
                  <Badge
                    variant={
                      employee.status === 'Active'
                        ? 'success'
                        : employee.status === 'Prospective'
                          ? 'info'
                          : 'error'
                    }
                  >
                    {employee.status}
                  </Badge>
                ) : field.isEmail ? (
                  <a href={`mailto:${field.value}`} className="text-blue-600 hover:text-blue-700">
                    {field.value}
                  </a>
                ) : field.isPhone ? (
                  <a href={`tel:${field.value}`} className="text-blue-600 hover:text-blue-700">
                    {field.value}
                  </a>
                ) : (
                  field.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )
    },
    {
      key: 'financial',
      label: 'Financial',
      content: <FinancialDetailsTab financialDetails={financialDetails} />
    },
    {
      key: 'health',
      label: 'Health',
      content: <HealthRecordsTab healthRecord={healthRecord} />
    },
    {
      key: 'contacts',
      label: 'Emergency Contacts',
      content: (
        <EmergencyContactsTab
          employeeId={employee.employee_id}
          contacts={emergencyContacts}
          canEdit={permissions.canEdit}
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
          canEdit={permissions.canEdit}
          canViewDocuments={permissions.canViewDocuments}
        />
      )
    },
    {
      key: 'onboarding',
      label: 'Onboarding Checklist',
      content: (
        <OnboardingChecklistTab
          employeeId={employee.employee_id}
          canEdit={permissions.canEdit}
        />
      )
    }
  ]

  const navItems: HeaderNavItem[] = [
    { label: 'Overview', href: '#overview' },
    { label: 'Details', href: '#details' },
    { label: 'Notes', href: '#notes' },
    { label: 'Documents', href: '#documents' },
    { label: 'Audit Trail', href: '#audit' },
  ]

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {permissions.canEdit && (
        <LinkButton href={`/employees/${employee.employee_id}/edit`} size="sm" variant="primary">
          Edit Employee
        </LinkButton>
      )}
      {permissions.canDelete && (
        <DeleteEmployeeButton
          employeeId={employee.employee_id}
          employeeName={`${employee.first_name} ${employee.last_name}`}
        />
      )}
    </div>
  )

  return (
    <PageLayout
      title={`${employee.first_name} ${employee.last_name}`}
      subtitle={employee.job_title}
      backButton={{ label: 'Back to Employees', href: '/employees' }}
      navItems={navItems}
      headerActions={headerActions}
      containerSize="2xl"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section id="overview">
            <Card>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                  <p className="text-sm text-gray-500">Employment</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {employee.status} • Started {employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {calculateLengthOfService(employee.employment_start_date)}
                  </p>
                </div>
                <StatusBadge
                  status={
                    employee.status === 'Active'
                      ? 'success'
                      : employee.status === 'Prospective'
                        ? 'pending'
                        : 'inactive'
                  }
                >
                  {employee.status}
                </StatusBadge>
              </div>
            </Card>
          </section>

          <section id="details">
            <Card>
              <Tabs items={tabs} />
            </Card>
          </section>

          <Section
            id="notes"
            title="Notes"
            description="Track key updates and conversations related to this employee."
            className="bg-white shadow-md ring-1 ring-black/5"
          >
            <div className="space-y-6">
              {permissions.canEdit && (
                <div className="border-b border-gray-200 pb-6">
                  <AddEmployeeNoteForm employeeId={employee.employee_id} />
                </div>
              )}

              <EmployeeNotesList notes={notes} />
            </div>
          </Section>

          <Section
            id="documents"
            title="Documents"
            description={
              permissions.canViewDocuments
                ? 'Manage employee documents and files.'
                : 'You do not have permission to view employee documents.'
            }
            className="bg-white shadow-md ring-1 ring-black/5"
          >
            <div className="space-y-6">
              {permissions.canViewDocuments ? (
                <EmployeeAttachmentsList
                  employeeId={employee.employee_id}
                  attachments={attachments}
                  categoryLookup={attachmentCategoryMap}
                  canDelete={permissions.canDeleteDocuments}
                />
              ) : (
                <div className="text-sm text-gray-500">
                  Document visibility requires `employees:view_documents`.
                </div>
              )}

              {permissions.canUploadDocuments && (
                <div className="border-t border-gray-200 pt-6">
                  <AddEmployeeAttachmentForm
                    employeeId={employee.employee_id}
                    categories={attachmentCategories}
                  />
                </div>
              )}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <section id="audit">
            <Card>
              <EmployeeAuditTrail
                employeeId={employee.employee_id}
                employeeName={`${employee.first_name} ${employee.last_name}`}
                auditLogs={auditLogs}
                notes={notes}
                canViewAudit={permissions.canView}
              />
            </Card>
          </section>

          <Card>
            <EmployeeRecentChanges employeeId={employee.employee_id} />
          </Card>
        </div>
      </div>
    </PageLayout>
  )
}

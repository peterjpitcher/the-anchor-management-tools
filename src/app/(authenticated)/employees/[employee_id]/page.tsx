import { notFound, redirect } from 'next/navigation'
import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'
import { calculateAge, calculateLengthOfService } from '@/lib/employeeUtils'
import { Badge } from '@/ds'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { EmployeeDetailTabs } from './_components/EmployeeDetailTabs'
import { EmployeeHeaderActions } from './_components/EmployeeHeaderActions'
import { Alert } from '@/ds'
import DeleteEmployeeButton from '@/components/features/employees/DeleteEmployeeButton'
import EmployeeNotesList from '@/components/features/employees/EmployeeNotesList'
import AddEmployeeNoteForm from '@/components/features/employees/AddEmployeeNoteForm'
import EmployeeAttachmentsList from '@/components/features/employees/EmployeeAttachmentsList'
import AddEmployeeAttachmentForm from '@/components/features/employees/AddEmployeeAttachmentForm'
import EmergencyContactsTab from '@/components/features/employees/EmergencyContactsTab'
import FinancialDetailsTab from '@/components/features/employees/FinancialDetailsTab'
import HealthRecordsTab from '@/components/features/employees/HealthRecordsTab'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import OnboardingChecklistTab from '@/components/features/employees/OnboardingChecklistTab'
import { EmployeeAuditTrail } from '@/components/features/employees/EmployeeAuditTrail'
import { EmployeeRecentChanges } from '@/components/features/employees/EmployeeRecentChanges'
import EmployeeStatusActions from '@/components/features/employees/EmployeeStatusActions'
import { getEmployeeDetailData } from '@/app/actions/employeeDetails'
import { LinkButton } from '@/ds'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import EmployeePayTab from '@/components/features/employees/EmployeePayTab'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import EmployeeReliabilityTab from '@/components/features/employees/EmployeeReliabilityTab'
import { getEmployeePaySettings, getEmployeeRateOverrides } from '@/app/actions/pay-bands'
import { getHourlyRate } from '@/lib/rota/pay-calculator'
import { getLeaveRequests } from '@/app/actions/leave'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEmployeeReliabilityData } from '@/services/employee-reliability'

export const dynamic = 'force-dynamic'

interface EmployeeDetailPageProps {
  params: Promise<{
    employee_id: string
  }>
}

function statusBadgeVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'Active': return 'success'
    case 'Onboarding': return 'info'
    case 'Started Separation': return 'warning'
    case 'Former': return 'error'
    default: return 'default'
  }
}

export default async function EmployeeDetailPage({ params }: EmployeeDetailPageProps) {
  const resolvedParams = await Promise.resolve(params)
  const employeeId = resolvedParams?.employee_id

  if (!employeeId) {
    notFound()
  }

  const [
    result,
    paySettingsResult,
    rateOverridesResult,
    leaveRequestsResult,
    rotaSettings,
    canCreateLeave,
    reliabilityData,
  ] = await Promise.all([
    getEmployeeDetailData(employeeId),
    getEmployeePaySettings(employeeId),
    getEmployeeRateOverrides(employeeId),
    getLeaveRequests({ employeeId }),
    getRotaSettings(),
    checkUserPermission('leave', 'create'),
    getEmployeeReliabilityData(employeeId),
  ])

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

  const paySettings = paySettingsResult.success ? paySettingsResult.data : null
  const rateOverrides = rateOverridesResult.success ? rateOverridesResult.data : []
  const leaveRequests = leaveRequestsResult.success ? leaveRequestsResult.data : []

  // Resolve current rate for display (today's date in London timezone)
  const today = getTodayIsoDate()
  const currentRate = await getHourlyRate(employeeId, today)

  const attachmentCategoryMap = attachmentCategories.reduce<Record<string, string>>((acc, category) => {
    acc[category.category_id] = category.category_name
    return acc
  }, {})

  const isOnboarding = employee.status === 'Onboarding'
  const displayName = employee.first_name && employee.last_name
    ? `${employee.first_name} ${employee.last_name}`
    : employee.email_address
  const age = calculateAge(employee.date_of_birth ?? null)

  const displayFields = [
    { label: 'Full Name', value: employee.first_name && employee.last_name ? `${employee.first_name} ${employee.last_name}` : '—' },
    { label: 'Email Address', value: employee.email_address, isEmail: true },
    { label: 'Job Title', value: employee.job_title ?? '—' },
    { label: 'Employment Status', value: employee.status, isBadge: true },
    { label: 'First Shift Date', value: employee.first_shift_date ? formatDate(employee.first_shift_date) : 'N/A' },
    { label: 'Start Date', value: employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A' },
    { label: 'End Date', value: employee.employment_end_date ? formatDate(employee.employment_end_date) : 'N/A' },
    {
      label: 'Date of Birth',
      value: employee.date_of_birth
        ? `${formatDate(employee.date_of_birth)}${age === null ? '' : ` (${age} years old)`}`
        : 'N/A',
    },
    { label: 'Telephone', value: employee.phone_number || 'N/A', isPhone: true },
    { label: 'Mobile', value: employee.mobile_number || 'N/A', isPhone: true },
    { label: 'Post Code', value: employee.post_code || 'N/A' },
    { label: 'Uniform Preference', value: employee.uniform_preference || 'N/A' },
    { label: 'Keyholder', value: employee.keyholder_status ? 'Yes' : 'No' },
    { label: 'Address', value: employee.address || 'N/A', isFullWidth: true },
  ]

  const setupMissingItems = isOnboarding ? [] : [
    ...(emergencyContacts.length === 0 ? ['Emergency contacts'] : []),
    ...(!financialDetails ? ['Bank details'] : []),
    ...(!healthRecord ? ['Health information'] : []),
    ...(!rightToWork ? ['Right to Work'] : []),
    ...(!employee.post_code ? ['Post code'] : []),
    ...(!employee.mobile_number && !employee.phone_number ? ['Telephone/mobile number'] : []),
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
                  <Badge variant={statusBadgeVariant(employee.status)}>
                    {employee.status}
                  </Badge>
                ) : field.isEmail ? (
                  <a href={`mailto:${field.value}`} className="text-blue-600 hover:text-blue-700">
                    {field.value}
                  </a>
                ) : field.isPhone ? (
                  field.value === 'N/A' ? (
                    field.value
                  ) : (
                    <a href={`tel:${field.value}`} className="text-blue-600 hover:text-blue-700">
                      {field.value}
                    </a>
                  )
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
      content: (
        <FinancialDetailsTab
          employeeId={employee.employee_id}
          financialDetails={financialDetails}
          canEdit={permissions.canEdit}
        />
      )
    },
    {
      key: 'health',
      label: 'Health',
      content: (
        <HealthRecordsTab
          employeeId={employee.employee_id}
          healthRecord={healthRecord}
          canEdit={permissions.canEdit}
        />
      )
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
    },
    {
      key: 'pay',
      label: 'Pay',
      content: (
        <EmployeePayTab
          employeeId={employee.employee_id}
          canEdit={permissions.canEdit}
          initialPaySettings={paySettings}
          initialOverrides={rateOverrides}
          currentRate={currentRate}
        />
      )
    },
    {
      key: 'holidays',
      label: 'Holidays',
      content: (
        <EmployeeHolidaysTab
          employeeId={employee.employee_id}
          canCreateLeave={canCreateLeave}
          leaveRequests={leaveRequests}
          paySettings={paySettings}
          rotaSettings={rotaSettings}
        />
      )
    },
    {
      key: 'reliability',
      label: 'Reliability',
      content: <EmployeeReliabilityTab reliability={reliabilityData} />
    }
  ]

  const editAction = permissions.canEdit ? (
    <LinkButton href={`/employees/${employee.employee_id}/edit`} size="sm" variant="primary">
      Edit Employee
    </LinkButton>
  ) : undefined

  const secondaryActions = [
    !isOnboarding ? (
      <LinkButton
        key="starter-pack"
        href={`/api/employees/${employee.employee_id}/starter-pack`}
        size="sm"
        variant="secondary"
        target="_blank"
        leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
      >
        New Starter PDF
      </LinkButton>
    ) : null,
    !isOnboarding ? (
      <LinkButton
        key="contract"
        href={`/api/employees/${employee.employee_id}/employment-contract`}
        size="sm"
        variant="secondary"
        target="_blank"
        leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
      >
        Casual Worker Agreement
      </LinkButton>
    ) : null,
    <EmployeeStatusActions
      key="status"
      employeeId={employee.employee_id}
      status={employee.status}
      canEdit={permissions.canEdit}
    />,
    permissions.canDelete ? (
      <DeleteEmployeeButton
        key="delete"
        employeeId={employee.employee_id}
        employeeName={displayName}
      />
    ) : null,
  ].filter(Boolean)

  const headerActions = (
    <EmployeeHeaderActions primary={editAction} secondary={secondaryActions} />
  )

  return (
    <PageLayout
      title={displayName}
      subtitle={isOnboarding ? 'Onboarding — profile not yet complete' : (employee.job_title ?? undefined)}
      backButton={{ label: 'Back to Employees', href: '/employees' }}
      headerActions={headerActions}
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <section id="overview">
            <Card>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                  <p className="text-sm text-gray-500">Employment</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {employee.status}{employee.employment_start_date ? ` • Started ${formatDate(employee.employment_start_date)}` : ''}
                  </p>
                  {employee.employment_start_date && (
                    <p className="text-sm text-gray-500">
                      {calculateLengthOfService(employee.employment_start_date)}
                    </p>
                  )}
                </div>
                <Badge variant={statusBadgeVariant(employee.status)} dot>
                  {employee.status}
                </Badge>
              </div>
            </Card>
          </section>

          {isOnboarding && (
            <Alert variant="info" title="Onboarding in progress">
              This employee has been invited but has not yet completed their profile. Use the &ldquo;Resend Invite&rdquo; button to send them a new invite link.
            </Alert>
          )}

          {setupMissingItems.length > 0 && (
            <Alert variant="warning" title="Setup incomplete">
              <ul className="list-disc pl-5 space-y-1">
                {setupMissingItems.map((item) => (
                  <li key={item}>{item} missing</li>
                ))}
              </ul>
            </Alert>
          )}

          <section id="details">
            <Card>
              <EmployeeDetailTabs tabs={tabs} />
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

        <div className="min-w-0 space-y-6">
          <section id="audit">
            <Card>
              <EmployeeAuditTrail
                employeeId={employee.employee_id}
                employeeName={displayName}
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

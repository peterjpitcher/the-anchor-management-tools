import { notFound, redirect } from 'next/navigation'
import { formatDate, getTodayIsoDate } from '@/lib/dateUtils'
import { calculateAge, calculateLengthOfService } from '@/lib/employeeUtils'
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageLayout, Stat } from '@/ds'
import { EmployeeDetailTabs } from './_components/EmployeeDetailTabs'
import { EmployeeHeaderActions } from './_components/EmployeeHeaderActions'
import { QuickAddNoteSheet } from './_components/QuickAddNoteSheet'
import { EMPLOYEES_BACK_TO_LIST } from '../_shared/nav'
import { employeePageTitle } from '../_shared/employee-title'
import { employmentStatusTone } from '../_shared/status-ui'
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
import { getEmployeeDetailData } from '@/app/actions/employeeDetails'
import EmployeePayTab from '@/components/features/employees/EmployeePayTab'
import EmployeeHolidaysTab from '@/components/features/employees/EmployeeHolidaysTab'
import EmployeeReliabilityTab from '@/components/features/employees/EmployeeReliabilityTab'
import { getEmployeePaySettings, getEmployeeRateOverrides } from '@/app/actions/pay-bands'
import { getHourlyRate } from '@/lib/rota/pay-calculator'
import { getEmployeeLeaveDays, getLeaveRequests } from '@/app/actions/leave'
import { getRotaSettings } from '@/app/actions/rota-settings'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEmployeeReliabilityData } from '@/services/employee-reliability'

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

  const [
    result,
    paySettingsResult,
    rateOverridesResult,
    leaveRequestsResult,
    leaveDaysResult,
    rotaSettings,
    canCreateLeave,
    reliabilityData,
  ] = await Promise.all([
    getEmployeeDetailData(employeeId),
    getEmployeePaySettings(employeeId),
    getEmployeeRateOverrides(employeeId),
    getLeaveRequests({ employeeId }),
    getEmployeeLeaveDays(employeeId),
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
  const leaveDays = leaveDaysResult.success ? leaveDaysResult.data : []
  // A failed load is shown on its tab as an error, never as an empty list of rates or holidays.
  // The Holidays tab also needs the pay settings, which hold the employee's own allowance.
  const paySettingsError = paySettingsResult.success ? null : paySettingsResult.error
  const payLoadError = paySettingsError ?? (rateOverridesResult.success ? null : rateOverridesResult.error)
  const holidaysLoadError =
    (leaveRequestsResult.success ? null : leaveRequestsResult.error) ??
    (leaveDaysResult.success ? null : leaveDaysResult.error) ??
    paySettingsError

  // Resolve current rate for display (today's date in London timezone)
  const today = getTodayIsoDate()
  const currentRate = await getHourlyRate(employeeId, today)

  const attachmentCategoryMap = attachmentCategories.reduce<Record<string, string>>((acc, category) => {
    acc[category.category_id] = category.category_name
    return acc
  }, {})

  const isOnboarding = employee.status === 'Onboarding'
  // The record's name (preferred, then legal in brackets), or the email address before onboarding.
  const headerName = employeePageTitle(employee)
  const age = calculateAge(employee.date_of_birth ?? null)

  // Missing values fall back to the DS dash; the rest keep their own "N/A" or "No".
  const phoneValue = (value: string | null | undefined) =>
    value ? (
      <a href={`tel:${value}`} className="text-primary hover:underline">
        {value}
      </a>
    ) : 'N/A'

  const detailItems = [
    {
      key: 'full_name',
      label: 'Full Name',
      value: employee.first_name && employee.last_name ? `${employee.first_name} ${employee.last_name}` : null,
    },
    {
      key: 'email_address',
      label: 'Email Address',
      value: (
        <a href={`mailto:${employee.email_address}`} className="text-primary hover:underline">
          {employee.email_address}
        </a>
      ),
    },
    { key: 'job_title', label: 'Job Title', value: employee.job_title ?? null },
    {
      key: 'status',
      label: 'Employment Status',
      value: <Badge tone={employmentStatusTone(employee.status)}>{employee.status}</Badge>,
    },
    { key: 'first_shift_date', label: 'First Shift Date', value: employee.first_shift_date ? formatDate(employee.first_shift_date) : 'N/A' },
    { key: 'employment_start_date', label: 'Start Date', value: employee.employment_start_date ? formatDate(employee.employment_start_date) : 'N/A' },
    { key: 'employment_end_date', label: 'End Date', value: employee.employment_end_date ? formatDate(employee.employment_end_date) : 'N/A' },
    {
      key: 'date_of_birth',
      label: 'Date of Birth',
      value: employee.date_of_birth
        ? `${formatDate(employee.date_of_birth)}${age === null ? '' : ` (${age} years old)`}`
        : 'N/A',
    },
    { key: 'phone_number', label: 'Telephone', value: phoneValue(employee.phone_number) },
    { key: 'mobile_number', label: 'Mobile', value: phoneValue(employee.mobile_number) },
    { key: 'post_code', label: 'Post Code', value: employee.post_code || 'N/A' },
    { key: 'uniform_preference', label: 'Uniform Preference', value: employee.uniform_preference || 'N/A' },
    { key: 'keyholder_status', label: 'Keyholder', value: employee.keyholder_status ? 'Yes' : 'No' },
    { key: 'address', label: 'Address', value: employee.address || 'N/A', span: 2 as const },
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
        <Card>
          <CardBody>
            <DescriptionList items={detailItems} />
          </CardBody>
        </Card>
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
          loadError={payLoadError}
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
          leaveDays={leaveDays}
          paySettings={paySettings}
          rotaSettings={rotaSettings}
          loadError={holidaysLoadError}
        />
      )
    },
    {
      key: 'reliability',
      label: 'Reliability',
      content: <EmployeeReliabilityTab reliability={reliabilityData} />
    }
  ]

  // The same title and header in every state of the page.
  const layoutProps = {
    title: headerName,
    subtitle: isOnboarding ? 'Onboarding, profile not yet complete' : (employee.job_title ?? undefined),
    backButton: EMPLOYEES_BACK_TO_LIST,
    headerActions: (
      <EmployeeHeaderActions
        employeeId={employee.employee_id}
        employeeName={headerName}
        status={employee.status}
        employmentStartDate={employee.employment_start_date}
        canEdit={permissions.canEdit}
        canDelete={permissions.canDelete}
      />
    ),
  }

  return (
    <PageLayout {...layoutProps}>
      {/* Phones: add a note from the top without scrolling down to Notes */}
      {permissions.canEdit && (
        <div className="shell:hidden">
          <QuickAddNoteSheet employeeId={employee.employee_id} className="w-full" />
        </div>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Stat
                label="Employment"
                value={`${employee.status}${employee.employment_start_date ? ` • Started ${formatDate(employee.employment_start_date)}` : ''}`}
                hint={employee.employment_start_date ? calculateLengthOfService(employee.employment_start_date) : undefined}
              />
              <Badge tone={employmentStatusTone(employee.status)} dot>
                {employee.status}
              </Badge>
            </CardBody>
          </Card>

          {isOnboarding && (
            <Alert tone="info" title="Onboarding in progress">
              This employee has been invited but has not yet completed their profile. Use the &ldquo;Resend Invite&rdquo; button to send them a new invite link.
            </Alert>
          )}

          {setupMissingItems.length > 0 && (
            <Alert tone="warning" title="Setup incomplete">
              <ul className="list-disc pl-5 space-y-1">
                {setupMissingItems.map((item) => (
                  <li key={item}>{item} missing</li>
                ))}
              </ul>
            </Alert>
          )}

          <EmployeeDetailTabs tabs={tabs} />

          <Card>
            <CardHeader title="Notes" subtitle="Track key updates and conversations related to this employee" />
            <CardBody className="space-y-4">
              {permissions.canEdit && (
                <div className="border-b border-border pb-4">
                  <AddEmployeeNoteForm employeeId={employee.employee_id} />
                </div>
              )}

              <EmployeeNotesList notes={notes} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              subtitle={
                permissions.canViewDocuments
                  ? 'Manage employee documents and files'
                  : 'You do not have permission to view employee documents'
              }
            />
            <CardBody className="space-y-4">
              {permissions.canViewDocuments ? (
                <EmployeeAttachmentsList
                  employeeId={employee.employee_id}
                  attachments={attachments}
                  categoryLookup={attachmentCategoryMap}
                  canDelete={permissions.canDeleteDocuments}
                />
              ) : (
                <p className="text-sm text-text-muted">
                  Document visibility requires `employees:view_documents`.
                </p>
              )}

              {permissions.canUploadDocuments && (
                <div className="border-t border-border pt-4">
                  <AddEmployeeAttachmentForm
                    employeeId={employee.employee_id}
                    categories={attachmentCategories}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <EmployeeAuditTrail
            employeeId={employee.employee_id}
            employeeName={headerName}
            auditLogs={auditLogs}
            notes={notes}
            canViewAudit={permissions.canView}
          />

          <EmployeeRecentChanges employeeId={employee.employee_id} />
        </div>
      </div>
    </PageLayout>
  )
}

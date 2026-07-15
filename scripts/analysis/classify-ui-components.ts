import fs from 'node:fs'
import path from 'node:path'

type Decision = 'KEEP' | 'MERGE' | 'RETIRE'
type FutureScope =
  | 'route-boundary'
  | 'route-local'
  | 'public-ds'
  | 'internal-ds'
  | 'shared-domain'
  | 'internal-domain'
  | 'infrastructure'
  | 'removed'

interface IndexRow {
  path: string
  line: string
  component: string
  layer: string
  visibility: string
  same_name_count: string
  initial_status: string
}

interface Classification {
  decision: Decision
  futureScope: FutureScope
  target: string
  reason: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
}

const root = process.cwd()
const indexPath = path.join(root, 'tasks/ui-component-index.csv')
const outputPath = path.join(root, 'tasks/ui-component-consolidation-register.csv')

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      result.push(current)
      current = ''
    } else {
      current += character
    }
  }
  result.push(current)
  return result
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

const lines = fs.readFileSync(indexPath, 'utf8').trim().split('\n')
const headers = parseCsvLine(lines[0])
const rows = lines.slice(1).map((line) => {
  const values = parseCsvLine(line)
  return Object.fromEntries(headers.map((header, index) => [header, values[index]])) as unknown as IndexRow
})

const publicDs = new Set([
  'Accordion', 'Alert', 'AppShell', 'Avatar', 'AvatarStack', 'Badge', 'Button',
  'Card', 'CardBody', 'CardFooter', 'CardHeader', 'Checkbox', 'ConfirmDialog',
  'DataTable', 'DateTimePicker', 'DescriptionList', 'Drawer', 'Dropdown', 'DropdownItem', 'Empty',
  'Field', 'FileUpload', 'FormSubmitButton', 'Icon', 'IconButton', 'Input', 'LinkButton', 'Modal',
  'PageLayout', 'PageLoading', 'Pagination', 'Popover', 'ProgressBar', 'Radio',
  'RevenueChart', 'RowActions', 'SearchInput', 'Section', 'SectionNav', 'Segmented', 'Select',
  'Sparkline', 'Spinner', 'Stat', 'Stepper', 'Switch', 'Table', 'TableBody',
  'TableCell', 'TableHead', 'TableHeader', 'TableRow', 'Tabs', 'Textarea',
  'Tooltip',
])

const dsMergeTargets = new Map<string, string>([
  ['src/ds/composites/PageHeader.tsx#PageHeader', 'PageLayout'],
  ['src/ds/composites/PageLayout.tsx#HeaderNav', 'SectionNav'],
  ['src/ds/composites/Table.tsx#TablePagination', 'Pagination'],
  ['src/ds/primitives/Button.tsx#Spinner', 'Spinner'],
  ['src/ds/primitives/Drawer.tsx#CloseIcon', 'Icon'],
  ['src/ds/primitives/FileUpload.tsx#UploadIcon', 'Icon'],
  ['src/ds/primitives/SearchInput.tsx#SearchIcon', 'Icon'],
  ['src/ds/primitives/SearchInput.tsx#ClearIcon', 'Icon'],
  ['src/ds/primitives/Stepper.tsx#CheckIcon', 'Icon'],
])

const sharedMergeTargets = new Map<string, string>([
  ['src/components/charts/BarChart.tsx#BarChart', 'DS Chart'],
  ['src/components/features/employees/AddEmployeeAttachmentForm.tsx#SubmitAttachmentButton', 'FormSubmitButton'],
  ['src/components/features/employees/AddEmployeeNoteForm.tsx#SubmitNoteButton', 'FormSubmitButton'],
  ['src/components/features/employees/DeleteEmployeeButton.tsx#SubmitDeleteButton', 'FormSubmitButton'],
  ['src/components/features/employees/EmergencyContactsTab.tsx#ConfirmDeleteButton', 'FormSubmitButton'],
  ['src/components/features/employees/EmergencyContactsTab.tsx#DeleteContactButton', 'ConfirmedServerActionButton'],
  ['src/components/features/employees/EmployeeAttachmentsList.tsx#DeleteAttachmentButton', 'ConfirmedServerActionButton'],
  ['src/components/features/employees/EmployeeForm.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/features/employees/FinancialDetailsForm.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/features/employees/FinancialDetailsTab.tsx#DetailItem', 'DescriptionList'],
  ['src/components/features/employees/HealthRecordsForm.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/features/employees/HealthRecordsTab.tsx#DetailItem', 'DescriptionList'],
  ['src/components/features/employees/RightToWorkTab.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/features/events/EventCategoryFormGrouped.tsx#CollapsibleSection', 'Accordion'],
  ['src/components/features/invoices/VendorDeleteButton.tsx#VendorDeleteButton', 'ConfirmedServerActionButton'],
  ['src/components/features/private-bookings/VenueSpaceDeleteButton.tsx#VenueSpaceDeleteButton', 'ConfirmedServerActionButton'],
  ['src/components/features/shared/GuestSubmitButton.tsx#GuestSubmitButton', 'FormSubmitButton'],
  ['src/components/modals/AddEmergencyContactModal.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/modals/AddEmergencyContactModal.tsx#AddEmergencyContactModal', 'EmergencyContactModal'],
  ['src/components/modals/EditEmergencyContactModal.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/modals/EditEmergencyContactModal.tsx#EditEmergencyContactModal', 'EmergencyContactModal'],
  ['src/components/private-bookings/SmsQueueActionForm.tsx#SubmitButton', 'FormSubmitButton'],
  ['src/components/private-bookings/WorkflowPanels.tsx#StatusBadge', 'Badge'],
])

const retireShared = new Set([
  'src/app/(authenticated)/users/components/UserList.tsx#UserList',
  'src/components/SpinnerTemp.tsx#Spinner',
  'src/components/SpinnerTemp.tsx#SpinnerOverlay',
  'src/components/SpinnerTemp.tsx#SpinnerButton',
])

const routeMergeTargets = new Map<string, string>([
  ['src/app/(authenticated)/customers/_components/CustomersClient.tsx#PlusIcon', 'Icon'],
  ['src/app/(authenticated)/customers/_components/CustomersClient.tsx#PencilIcon', 'Icon'],
  ['src/app/(authenticated)/customers/_components/CustomersClient.tsx#TrashIcon', 'Icon'],
  ['src/app/(authenticated)/customers/_components/CustomersClient.tsx#MessageIcon', 'Icon'],
  ['src/app/(authenticated)/expenses/_components/ExpensesClient.tsx#CheckIcon', 'Icon'],
  ['src/app/(authenticated)/expenses/_components/ExpensesClient.tsx#CrossIcon', 'Icon'],
  ['src/app/(authenticated)/feedback-inbox/FeedbackInboxClient.tsx#StarRating', 'shared StarRating with read-only mode'],
  ['src/app/(authenticated)/parking/_components/RefundDialog.tsx#RefundDialog', 'shared finance RefundDialog'],
  ['src/app/(authenticated)/parking/_components/RefundHistoryTable.tsx#RefundHistoryTable', 'shared finance RefundHistoryTable'],
  ['src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx#PlusIcon', 'Icon'],
  ['src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx#AddItemModal', 'PrivateBookingItemModal'],
  ['src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx#EditItemModal', 'PrivateBookingItemModal'],
  ['src/app/(authenticated)/private-bookings/[id]/items/page.tsx#AddItemModal', 'PrivateBookingItemModal'],
  ['src/app/(authenticated)/private-bookings/[id]/items/page.tsx#EditItemModal', 'PrivateBookingItemModal'],
  ['src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx#Field', 'Field'],
  ['src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx#SubmitButton', 'Button'],
  ['src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx#DetailItem', 'DescriptionList'],
  ['src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx#StatusBadge', 'Badge'],
])

const retireRoute = new Set([
  'src/app/(authenticated)/invoices/InvoicesClient.tsx#InvoicesClient',
])

const internalDomain = new Set([
  'RoleCard', 'BookingActions', 'BookingBadges', 'LaneRow', 'ScorePanel', 'Metric',
  'CountsGrid', 'KeywordField', 'SupplierModal', 'ComplaintRow', 'EntryBlock',
  'ScheduleCalendarList', 'ScheduleCalendarMonth', 'ScheduleCalendarWeek',
])

const internalDs = new Set([
  'BarWithTargetLine', 'ChartTooltipContent', 'DeltaArrow', 'FohClockBand',
  'MobileTopbar', 'MobileBottomNav', 'MobileDrawer', 'NavCountsProvider', 'Sidebar',
  'SidebarNav', 'Topbar', 'UserFooter',
])

const compatTargets: Record<string, string> = {
  BackButton: 'LinkButton or IconButton',
  BackLink: 'LinkButton',
  MobileBackButton: 'LinkButton',
  ArrowLeft: 'Icon',
  ChevronLeft: 'Icon',
  CardTitle: 'CardHeader',
  CardDescription: 'CardHeader',
  ConfirmModal: 'ConfirmDialog',
  AlertModal: 'ConfirmDialog',
  Container: 'PageLayout or Section',
  DrawerActions: 'Drawer footer',
  EmptyState: 'Empty',
  EmptyStateSearch: 'Empty',
  EmptyStateError: 'Empty',
  FilterPanel: 'FilterBar',
  QuickFilters: 'FilterBar',
  Form: 'native form plus Field',
  FormSection: 'Section',
  FormActions: 'responsive form footer',
  FormGroup: 'Field',
  FormGroupSet: 'Fieldset pattern',
  InlineFormGroup: 'Field layout',
  ModalActions: 'Modal footer',
  PopoverHeader: 'Popover composition',
  PopoverContent: 'Popover composition',
  RadioGroup: 'Field plus Radio',
  SortArrow: 'DataTable sorting',
  SortableHeader: 'DataTable sorting',
  StatGroup: 'responsive Stat grid',
  TabNav: 'Tabs or SectionNav',
  VerticalTabNav: 'Tabs or SectionNav',
  Toggle: 'Switch',
}

function classify(row: IndexRow): Classification {
  const key = `${row.path}#${row.component}`

  if (retireRoute.has(key)) {
    return {
      decision: 'RETIRE',
      futureScope: 'removed',
      target: 'invoices/_components/InvoicesClient',
      reason: 'Test-only stale implementation; the live route uses the _components version.',
      priority: 'P0',
    }
  }

  const routeMergeTarget = routeMergeTargets.get(key)
  if (routeMergeTarget) {
    return {
      decision: 'MERGE',
      futureScope: 'removed',
      target: routeMergeTarget,
      reason: 'Page-local copy of a repeated visual or interaction pattern.',
      priority: 'P1',
    }
  }

  if (row.layer === 'ds-compat') {
    return {
      decision: 'RETIRE',
      futureScope: 'removed',
      target: compatTargets[row.component] ?? 'canonical DS component',
      reason: 'Deprecated compatibility implementation; keeping it preserves a second standard.',
      priority: 'P0',
    }
  }

  if (retireShared.has(key)) {
    return {
      decision: 'RETIRE',
      futureScope: 'removed',
      target: row.component === 'UserList' ? 'live users/_components/UsersClient' : 'Spinner or PageLoading',
      reason: row.component === 'UserList'
        ? 'Test-only stale implementation; the live route uses a different client.'
        : 'Unused temporary spinner implementation.',
      priority: 'P0',
    }
  }

  const dsMergeTarget = dsMergeTargets.get(key)
  if (dsMergeTarget) {
    return {
      decision: 'MERGE',
      futureScope: 'removed',
      target: dsMergeTarget,
      reason: 'Overlaps a canonical design-system component and should not remain a separate choice.',
      priority: 'P1',
    }
  }

  const sharedMergeTarget = sharedMergeTargets.get(key)
  if (sharedMergeTarget) {
    return {
      decision: 'MERGE',
      futureScope: sharedMergeTarget === 'EmergencyContactModal' ? 'shared-domain' : 'removed',
      target: sharedMergeTarget,
      reason: 'Repeated interaction or rendering pattern that should have one maintained implementation.',
      priority: 'P1',
    }
  }

  if (key === 'src/ds/primitives/Toast.tsx#Toast') {
    return {
      decision: 'RETIRE',
      futureScope: 'removed',
      target: 'toast API',
      reason: 'Unused second toast renderer; the exported toast API uses react-hot-toast.',
      priority: 'P0',
    }
  }

  if (key === 'src/ds/composites/CustomerLink.tsx#CustomerLink') {
    return {
      decision: 'KEEP',
      futureScope: 'shared-domain',
      target: 'components/features/customers/CustomerLink',
      reason: 'Useful shared customer behaviour, but it is domain-specific and does not belong in the generic DS.',
      priority: 'P2',
    }
  }

  if (row.layer === 'ds-shell') {
    const isPublic = row.component === 'AppShell'
    return {
      decision: 'KEEP',
      futureScope: isPublic ? 'public-ds' : 'internal-ds',
      target: isPublic ? 'AppShell' : `AppShell internal ${row.component}`,
      reason: isPublic
        ? 'Single application shell entry point.'
        : 'Required shell building block; keep it out of the public component choice list.',
      priority: isPublic ? 'P1' : 'P2',
    }
  }

  if (row.layer.startsWith('ds-')) {
    const isPublic = publicDs.has(row.component)
    return {
      decision: 'KEEP',
      futureScope: isPublic ? 'public-ds' : 'internal-ds',
      target: row.component,
      reason: isPublic
        ? 'Distinct canonical design-system job; strengthen this implementation and migrate consumers to it.'
        : 'Private implementation detail; it does not add a public UI standard.',
      priority: isPublic ? 'P1' : 'P3',
    }
  }

  if (key === 'src/components/providers/SupabaseProvider.tsx#SupabaseProvider') {
    return {
      decision: 'KEEP',
      futureScope: 'infrastructure',
      target: 'SupabaseProvider',
      reason: 'Application provider, not a visual component standard.',
      priority: 'P3',
    }
  }

  if (row.layer === 'route-entry') {
    return {
      decision: 'KEEP',
      futureScope: 'route-boundary',
      target: row.component === 'Loading' ? 'route wrapper using PageLoading' : row.component,
      reason: row.component === 'Loading'
        ? 'Next.js requires the route file; keep the boundary but share the loading presentation.'
        : 'Next.js route boundary, not a reusable UI choice.',
      priority: row.component === 'Loading' ? 'P1' : 'P3',
    }
  }

  if (row.layer === 'route-local') {
    return {
      decision: 'KEEP',
      futureScope: 'route-local',
      target: row.component,
      reason: 'Page-specific behaviour; keep local and compose it only from canonical shared controls.',
      priority: 'P3',
    }
  }

  const isInternal = row.visibility === 'internal' || internalDomain.has(row.component)
  return {
    decision: 'KEEP',
    futureScope: isInternal ? 'internal-domain' : 'shared-domain',
    target: row.component,
    reason: isInternal
      ? 'Private business rendering helper; keep local and build it from canonical DS controls.'
      : 'Distinct reusable business behaviour; keep it domain-owned and standardise its UI foundations.',
    priority: isInternal ? 'P3' : 'P2',
  }
}

const classified = rows.map((row) => ({ ...row, ...classify(row) }))
const outputHeaders = [
  'path', 'line', 'component', 'current_layer', 'current_visibility',
  'decision', 'future_scope', 'target', 'reason', 'priority',
]

const output = [
  outputHeaders.map(csv).join(','),
  ...classified.map((row) => [
    row.path,
    row.line,
    row.component,
    row.layer,
    row.visibility,
    row.decision,
    row.futureScope,
    row.target,
    row.reason,
    row.priority,
  ].map(csv).join(',')),
].join('\n') + '\n'

fs.writeFileSync(outputPath, output)

const decisionCounts = classified.reduce<Record<string, number>>((result, row) => {
  result[row.decision] = (result[row.decision] ?? 0) + 1
  return result
}, {})
const futureScopeCounts = classified.reduce<Record<string, number>>((result, row) => {
  result[row.futureScope] = (result[row.futureScope] ?? 0) + 1
  return result
}, {})

console.log(JSON.stringify({ reviewed: classified.length, decisionCounts, futureScopeCounts }, null, 2))

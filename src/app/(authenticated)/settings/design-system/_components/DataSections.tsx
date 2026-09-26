'use client'

import { useMemo, useState } from 'react'

import {
  BarChart,
  Badge,
  Button,
  CHART_COLOURS,
  ComboChart,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Drawer,
  Dropdown,
  DropdownItem,
  DropdownLabel,
  Field,
  Icon,
  IconButton,
  LineChart,
  Modal,
  Popover,
  RevenueChart,
  RowActions,
  Section,
  Segmented,
  Select,
  Sparkline,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  Tabs,
  Textarea,
  Tooltip,
  formatChartValue,
  toast,
  usePopoverClose,
  type Column,
  type DataTableSortDirection,
  type TableSortDirection,
} from '@/ds'

import { Example, ReferenceCard, TableCard } from './reference-ui'

const SECTION_CLASS = 'scroll-mt-6'

/* ------------------------------------------------------------------ */
/*  Tables                                                             */
/* ------------------------------------------------------------------ */

interface StaffRow {
  id: string
  name: string
  role: string
  hours: number
  active: boolean
}

const STAFF: readonly StaffRow[] = [
  { id: 'a', name: 'Alice Johnson', role: 'Manager', hours: 38, active: true },
  { id: 'b', name: 'Bob Smith', role: 'Bar', hours: 22, active: true },
  { id: 'c', name: 'Carol Davis', role: 'Kitchen', hours: 30, active: false },
  { id: 'd', name: 'Dan Wilson', role: 'Front of House', hours: 16, active: true },
]

type StaffKey = 'name' | 'role' | 'hours'

function sortStaff(rows: readonly StaffRow[], key: StaffKey | null, direction: 'asc' | 'desc'): StaffRow[] {
  if (!key) return [...rows]
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))) * sign
  })
}

/** A plain Table whose headers sort: the caller owns the state and decides the next direction. */
function SortableTableExample(): React.JSX.Element {
  const [sort, setSort] = useState<{ key: StaffKey; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' })
  const rows = sortStaff(STAFF, sort.key, sort.direction)

  const headProps = (key: StaffKey): { sortable: true; sortDirection: TableSortDirection; onSort: () => void } => ({
    sortable: true,
    sortDirection: sort.key === key ? sort.direction : null,
    onSort: () =>
      setSort((current) =>
        current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
      ),
  })

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead {...headProps('name')}>Name</TableHead>
          <TableHead {...headProps('role')}>Role</TableHead>
          <TableHead {...headProps('hours')} align="right">
            Hours
          </TableHead>
          <TableHead>Status</TableHead>
          <TableHead align="right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.role}</TableCell>
            <TableCell align="right">{row.hours}</TableCell>
            <TableCell>
              <Badge tone={row.active ? 'success' : 'neutral'} dot>
                {row.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
            <TableCell align="right">
              <RowActions
                label={`Actions for ${row.name}`}
                actions={[
                  { key: 'edit', label: `Edit ${row.name}`, icon: <Icon name="edit" size={16} />, onSelect: () => toast.info(`Edit ${row.name}`) },
                  { key: 'delete', label: `Delete ${row.name}`, icon: <Icon name="trash" size={16} />, tone: 'danger', onSelect: () => toast.info(`Delete ${row.name}`) },
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const STAFF_COLUMNS: Column<StaffRow>[] = [
  { key: 'name', header: 'Name', sortable: true, cell: (row) => row.name },
  { key: 'role', header: 'Role', sortable: true, cell: (row) => row.role },
  { key: 'hours', header: 'Hours', sortable: true, align: 'right', cell: (row) => row.hours },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (row) => (
      <RowActions
        label={`Actions for ${row.name}`}
        mode="menu"
        actions={[
          { key: 'view', label: 'View', onSelect: () => toast.info(`View ${row.name}`) },
          { key: 'edit', label: 'Edit', onSelect: () => toast.info(`Edit ${row.name}`) },
          { key: 'rota', label: 'Open Rota', onSelect: () => toast.info(`Rota for ${row.name}`) },
          { key: 'archive', label: 'Archive', tone: 'danger', onSelect: () => toast.info(`Archive ${row.name}`) },
        ]}
      />
    ),
  },
]

/** A DataTable with controlled sorting, as for a list the server sorts and pages. */
function ControlledDataTableExample(): React.JSX.Element {
  const [sortKey, setSortKey] = useState<StaffKey | null>('hours')
  const [sortDirection, setSortDirection] = useState<DataTableSortDirection>('desc')
  const [page, setPage] = useState(1)
  // Stands in for the server: the rows arrive already sorted.
  const rows = useMemo(() => sortStaff(STAFF, sortKey, sortDirection), [sortKey, sortDirection])

  return (
    <TableCard
      title="DataTable With Controlled Sorting"
      subtitle="sortKey, sortDirection and onSortChange for a list the server sorts and pages. Three or more RowActions become a menu"
    >
      <DataTable
        data={rows}
        columns={STAFF_COLUMNS}
        getRowKey={(row) => row.id}
        bordered={false}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={(key, direction) => {
          setSortKey(key as StaffKey)
          setSortDirection(direction)
          setPage(1)
        }}
      />
      <TablePagination page={page} totalPages={5} onPageChange={setPage} pageSize={4} totalItems={18} />
    </TableCard>
  )
}

export function TablesSection(): React.JSX.Element {
  return (
    <Section
      id="tables"
      title="Tables"
      description="Table for a hand-built table, DataTable for sorting, empty rows and phone cards. One pager: TablePagination"
      className={SECTION_CLASS}
    >
      <div className="space-y-6">
        <TableCard
          title="Table With Sortable Headers"
          subtitle="TableHead sortable, sortDirection and onSort: a real button with aria-sort. RowActions shows up to two actions as icons"
        >
          <SortableTableExample />
        </TableCard>
        <ControlledDataTableExample />
        <TableCard title="Empty DataTable" subtitle="An empty list shows its emptyMessage in the table, never a blank box">
          <DataTable
            data={[] as StaffRow[]}
            columns={STAFF_COLUMNS}
            getRowKey={(row) => row.id}
            bordered={false}
            emptyMessage="No staff on this rota"
            emptyDescription="Add a shift to put someone on it."
          />
        </TableCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

export function NavigationSection(): React.JSX.Element {
  const [tab, setTab] = useState('upcoming')
  const [view, setView] = useState('list')

  return (
    <Section
      id="navigation"
      title="Tabs and Views"
      description="The section tab row is PageLayout's navItems (see Page Anatomy). Inside a page: Tabs switch panels, Segmented switches the view of the same data"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Tabs" subtitle="Panels inside one page. Name the strip with aria-label">
          <Tabs
            aria-label="Booking lists"
            activeTab={tab}
            onTabChange={setTab}
            tabs={[
              { id: 'upcoming', label: 'Upcoming', count: 12, content: <p className="pt-3 text-sm text-text">The next 14 days.</p> },
              { id: 'past', label: 'Past', content: <p className="pt-3 text-sm text-text">Everything before today.</p> },
              { id: 'cancelled', label: 'Cancelled', count: 2, content: <p className="pt-3 text-sm text-text">Cancelled bookings.</p> },
            ]}
          />
        </ReferenceCard>
        <ReferenceCard title="Segmented" subtitle="The same data, another view: list or calendar, 7 or 30 days">
          <Segmented
            aria-label="Booking view"
            value={view}
            onChange={setView}
            options={[
              { id: 'list', label: 'List' },
              { id: 'calendar', label: 'Calendar' },
            ]}
          />
          <p className="text-sm text-text">Showing the {view} view.</p>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Overlays                                                           */
/* ------------------------------------------------------------------ */

/** Closes the popover it sits in: usePopoverClose from a component inside the panel. */
function ApplyFilterButton({ onApply }: { onApply: () => void }): React.JSX.Element {
  const close = usePopoverClose()
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={() => {
        onApply()
        close()
      }}
    >
      Apply
    </Button>
  )
}

export function OverlaysSection(): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)
  const [area, setArea] = useState('all')
  const [note, setNote] = useState('')

  return (
    <Section
      id="overlays"
      title="Overlays"
      description="Modal, Drawer, ConfirmDialog, Dropdown and Popover. Menus and popovers are portalled, so a scrolling table or a clipped card never hides them"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Modal and Drawer" subtitle="The description prop shows under the title and is read with it">
          <Example title="Open One">
            <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
          </Example>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Edit Day Note"
            description="Shown to staff on the rota for this day"
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setModalOpen(false)
                    toast.success('Note saved (example only)')
                  }}
                >
                  Save Note
                </Button>
              </>
            }
          >
            <Textarea label="Note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Modal>
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="Booking Details"
            description="Read only: changes happen on the booking page"
          >
            <DescriptionList
              columns={1}
              items={[
                { key: 'guest', label: 'Guest', value: 'Jane Smith' },
                { key: 'party', label: 'Party Size', value: '6' },
                { key: 'when', label: 'When', value: 'Sat 3 Oct, 19:30' },
              ]}
            />
          </Drawer>
        </ReferenceCard>

        <ReferenceCard
          title="ConfirmDialog"
          subtitle="tone danger only for destructive actions (delete, cancel a booking, revoke, void); everything else primary"
        >
          <Example title="Tones">
            <Button onClick={() => setPublishOpen(true)}>Publish Rota</Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete Shift
            </Button>
          </Example>
          <ConfirmDialog
            open={publishOpen}
            onClose={() => setPublishOpen(false)}
            onConfirm={() => toast.success('Published (example only)')}
            title="Publish Rota"
            message="Staff will see these shifts straight away."
            confirmLabel="Publish"
            tone="primary"
          />
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => toast.success('Deleted (example only)')}
            title="Delete Shift"
            message="This cannot be undone."
            confirmLabel="Delete"
            tone="danger"
          />
        </ReferenceCard>

        <ReferenceCard title="Dropdown" subtitle="DropdownLabel heads a group; closeOnSelect false keeps the menu open for a toggle">
          <Dropdown
            align="left"
            trigger={<Button iconRight={<Icon name="chevronDown" size={14} />}>Options</Button>}
          >
            <DropdownLabel>Export</DropdownLabel>
            <DropdownItem icon={<Icon name="download" size={14} />} onClick={() => toast.info('CSV (example only)')}>
              Download CSV
            </DropdownItem>
            <DropdownItem icon={<Icon name="printer" size={14} />} onClick={() => toast.info('Print (example only)')}>
              Print
            </DropdownItem>
            <DropdownLabel>View</DropdownLabel>
            <DropdownItem
              icon={<Icon name={showCancelled ? 'check' : 'circle'} size={14} />}
              closeOnSelect={false}
              onClick={() => setShowCancelled((shown) => !shown)}
            >
              Show Cancelled
            </DropdownItem>
            <DropdownItem danger icon={<Icon name="trash" size={14} />} onClick={() => toast.info('Delete (example only)')}>
              Delete All
            </DropdownItem>
          </Dropdown>
          <p className="text-sm text-text">Cancelled bookings are {showCancelled ? 'shown' : 'hidden'}.</p>
        </ReferenceCard>

        <ReferenceCard
          title="Popover and Tooltip"
          subtitle="Popover: placement, width, and children as ({ close }) or usePopoverClose() to close it from inside"
        >
          <Example title="Popover">
            <Popover
              placement="bottom-start"
              width="sm"
              label="Filter bookings"
              trigger={<Button icon={<Icon name="filter" size={14} />}>Filter</Button>}
            >
              {({ close }) => (
                <div className="space-y-3">
                  <Field label="Area">
                    <Select
                      value={area}
                      onChange={(event) => setArea(event.target.value)}
                      options={[
                        { value: 'all', label: 'Everywhere' },
                        { value: 'inside', label: 'Inside' },
                        { value: 'garden', label: 'Garden' },
                      ]}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={close}>
                      Cancel
                    </Button>
                    <ApplyFilterButton onApply={() => toast.info(`Filtered to ${area} (example only)`)} />
                  </div>
                </div>
              )}
            </Popover>
          </Example>
          <Example title="Tooltip">
            <Tooltip content="Refresh the list" side="bottom">
              <IconButton icon={<Icon name="refresh" size={16} />} label="Refresh" />
            </Tooltip>
          </Example>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Charts                                                             */
/* ------------------------------------------------------------------ */

const BAR_DATA = [
  { label: 'Mon', value: 42 },
  { label: 'Tue', value: 38 },
  { label: 'Wed', value: 55, targetLineValue: 50 },
  { label: 'Thu', value: 61 },
  { label: 'Fri', value: 94 },
  { label: 'Sat', value: 120 },
  { label: 'Sun', value: 88 },
]

const WEEKLY = [
  { week: 'W1', covers: 410, bookings: 96, revenue: 11800, margin: 64 },
  { week: 'W2', covers: 455, bookings: 104, revenue: 12950, margin: 66 },
  { week: 'W3', covers: 390, bookings: 88, revenue: 11200, margin: 61 },
  { week: 'W4', covers: 520, bookings: 121, revenue: 14800, margin: 68 },
  { week: 'W5', covers: 498, bookings: 115, revenue: 14100, margin: 67 },
]

const REVENUE = [
  { day: 'Mon', amount: 820, target: 900 },
  { day: 'Tue', amount: 760, target: 900 },
  { day: 'Wed', amount: 1040, target: 900 },
  { day: 'Thu', amount: 1180, target: 1000 },
  { day: 'Fri', amount: 1820, target: 1600 },
  { day: 'Sat', amount: 2240, target: 2000 },
  { day: 'Sun', amount: 1510, target: 1600 },
]

export function ChartsSection(): React.JSX.Element {
  return (
    <Section
      id="charts"
      title="Charts"
      description="The DS charts only: series take the chart tokens in order and numbers print through formatChartValue. Never recharts or a hand-drawn SVG in page code"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="BarChart" subtitle="One series; a dashed marker where a bar has a target">
          <BarChart data={BAR_DATA} height={240} seriesLabel="Covers" ariaLabel="Covers by day, example data" />
        </ReferenceCard>
        <ReferenceCard title="LineChart" subtitle="Several series over time">
          <LineChart
            data={WEEKLY}
            xKey="week"
            height={240}
            showLegend
            ariaLabel="Covers and bookings by week, example data"
            series={[
              { key: 'covers', label: 'Covers' },
              { key: 'bookings', label: 'Bookings', dashed: true },
            ]}
          />
        </ReferenceCard>
        <ReferenceCard title="ComboChart" subtitle="Bars and a line, with a second axis">
          <ComboChart
            data={WEEKLY}
            xKey="week"
            height={240}
            showLegend
            ariaLabel="Revenue and margin by week, example data"
            leftAxis={{ format: 'shorthandCurrency' }}
            rightAxis={{ format: 'percent' }}
            series={[
              { key: 'revenue', label: 'Revenue', type: 'bar', format: 'currency' },
              { key: 'margin', label: 'Margin', type: 'line', axis: 'right', format: 'percent' },
            ]}
          />
        </ReferenceCard>
        <ReferenceCard title="RevenueChart and Sparkline" subtitle="The compact charts: a day's takings against target, a trend in a row">
          <div role="figure" aria-label="Takings by day against target, example data">
            <RevenueChart data={REVENUE} valueFormatter={(value) => formatChartValue(value, 'currency')} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div role="figure" aria-label="Covers trend, example data">
              <Sparkline data={WEEKLY.map((row) => row.covers)} />
            </div>
            <div role="figure" aria-label="Margin trend, example data">
              <Sparkline data={WEEKLY.map((row) => row.margin)} color={CHART_COLOURS[1]} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHART_COLOURS.map((colour, index) => (
              <span key={colour} className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colour }} />
                chart-{index + 1}
              </span>
            ))}
          </div>
        </ReferenceCard>
      </div>
    </Section>
  )
}

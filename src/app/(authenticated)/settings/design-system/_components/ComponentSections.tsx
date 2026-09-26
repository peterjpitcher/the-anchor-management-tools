'use client'

import { useState } from 'react'

import {
  Accordion,
  Alert,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  CustomerLink,
  DateTimePicker,
  DescriptionList,
  Empty,
  Field,
  Fieldset,
  FileButton,
  FileUpload,
  FormFooter,
  FormSubmitButton,
  Icon,
  IconButton,
  Input,
  LinkButton,
  PageLoading,
  ProgressBar,
  Radio,
  SearchInput,
  Section,
  Segmented,
  Select,
  Spinner,
  Stat,
  StatGrid,
  Stepper,
  SubHeading,
  Switch,
  Textarea,
  Tooltip,
  toast,
} from '@/ds'

import { Code, CodeBlock, Example, ReferenceCard } from './reference-ui'

const SECTION_CLASS = 'scroll-mt-6'

const BADGE_TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const
const TONE_LABEL: Record<(typeof BADGE_TONES)[number], string> = {
  neutral: 'Neutral',
  primary: 'Primary',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
}
const ALERT_TONES = [
  { tone: 'info', title: 'Information', body: 'The rota for next week is ready to review.' },
  { tone: 'success', title: 'Saved', body: 'Your changes have been saved.' },
  { tone: 'warning', title: 'Check This', body: 'This booking is outside the kitchen hours.' },
  { tone: 'danger', title: 'Could Not Save', body: 'The server did not answer. Try again in a moment.' },
] as const

/** Names a list of picked files for a toast. */
function describeFiles(files: File[]): string {
  return files.length === 1 ? files[0].name : `${files.length} files`
}

/* ------------------------------------------------------------------ */
/*  Buttons and links                                                  */
/* ------------------------------------------------------------------ */

export function ButtonsSection(): React.JSX.Element {
  return (
    <Section
      id="buttons"
      title="Buttons and Links"
      description="Title Case labels. In a header or a footer: secondary first, primary last"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Button">
          <Example title="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
          </Example>
          <Example title="Sizes" note="Header actions are size sm">
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </Example>
          <Example title="Icons and States">
            <Button variant="primary" icon={<Icon name="plus" size={14} />}>
              New Booking
            </Button>
            <Button iconRight={<Icon name="chevronDown" size={14} />}>Options</Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button disabled>Disabled</Button>
          </Example>
          <Example
            title="FormSubmitButton"
            note="The submit button of a form: it shows the spinner and blocks repeat presses while the form is pending"
          >
            <FormSubmitButton pending pendingLabel="Saving">
              Save Changes
            </FormSubmitButton>
          </Example>
        </ReferenceCard>

        <ReferenceCard title="IconButton, LinkButton and FileButton">
          <Example title="IconButton" note="Always has a label, read out by screen readers">
            <IconButton icon={<Icon name="edit" size={16} />} label="Edit" />
            <IconButton icon={<Icon name="trash" size={16} />} label="Delete" variant="danger" />
            <IconButton icon={<Icon name="moreHorizontal" size={16} />} label="More options" variant="ghost" />
            <IconButton icon={<Icon name="refresh" size={16} />} label="Refresh" size="sm" />
          </Example>
          <Example title="LinkButton" note="A link that looks like a button, for navigation">
            <LinkButton href="/settings" variant="secondary">
              Settings
            </LinkButton>
            <LinkButton href="/settings" icon={<Icon name="arrowRight" size={14} />}>
              Open Settings
            </LinkButton>
          </Example>
          <Example
            title="LinkButton download"
            note={
              <>
                <Code>download</Code> saves the file instead of opening it: <Code>true</Code> keeps the server&apos;s
                file name, a string sets it
              </>
            }
          >
            <LinkButton href="/robots.txt" download="example.txt" variant="secondary" icon={<Icon name="download" size={14} />}>
              Download Example
            </LinkButton>
          </Example>
          <Example
            title="FileButton"
            note="A DS Button over a hidden file input, for a picker that is not a drop zone. capture opens the camera on a phone"
          >
            <FileButton onFiles={(files) => toast.success(`Picked ${describeFiles(files)}`)} icon={<Icon name="upload" size={14} />}>
              Choose File
            </FileButton>
            <FileButton
              onFiles={(files) => toast.success(`Picked ${describeFiles(files)}`)}
              accept="image/*"
              capture="environment"
              multiple
              variant="primary"
              icon={<Icon name="image" size={14} />}
            >
              Take Photos
            </FileButton>
          </Example>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Forms                                                              */
/* ------------------------------------------------------------------ */

export function FormsSection(): React.JSX.Element {
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('2026-10-03')
  const [time, setTime] = useState('19:30')
  const [dateTime, setDateTime] = useState('2026-10-03T19:30')
  const [reminders, setReminders] = useState(true)
  const [marketing, setMarketing] = useState(false)
  const [seating, setSeating] = useState('inside')
  const [smsOn, setSmsOn] = useState(true)
  const [emailOn, setEmailOn] = useState(false)
  const [channel, setChannel] = useState('')

  return (
    <Section
      id="forms"
      title="Forms"
      description="Labels come from Field or the label prop of Input, Select and Textarea. Validation lives in the server action (Zod)"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Text Fields">
          <Input
            label="Customer Name"
            placeholder="Jane Smith"
            hint="As it should appear on the booking"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input label="Deposit" type="number" defaultValue="60" icon={<Icon name="pound" size={14} />} rightElement="GBP" />
          <Input label="Email" type="email" defaultValue="jane@" error="Enter a full email address" />
          <Input
            label="Event Date"
            type="date"
            defaultValue="2026-09-01"
            warning="This date is in the past. You can still save it"
          />
          <Select
            label="Department"
            placeholder="Choose a department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            options={[
              { value: 'kitchen', label: 'Kitchen' },
              { value: 'bar', label: 'Bar' },
              { value: 'front', label: 'Front of House' },
            ]}
          />
          <Textarea
            label="Notes"
            placeholder="Anything the team should know"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </ReferenceCard>

        <ReferenceCard title="Choices">
          <Fieldset legend="Reminders" hint="Checkbox rows are 44px tall on a touch screen, no wrapper needed">
            <Checkbox label="Send a reminder the day before" checked={reminders} onChange={setReminders} />
            <Checkbox
              label="Marketing emails"
              description="Only if the customer agreed at booking"
              checked={marketing}
              onChange={setMarketing}
            />
            <Checkbox label="Part of a group" indeterminate checked={false} onChange={() => undefined} />
            <Checkbox label="Locked" disabled checked onChange={() => undefined} />
          </Fieldset>
          <Fieldset legend="Seating" required>
            {['inside', 'garden', 'either'].map((option) => (
              <Radio
                key={option}
                name="ds-seating"
                value={option}
                label={option === 'either' ? 'Either is fine' : option === 'inside' ? 'Inside' : 'Garden'}
                checked={seating === option}
                onChange={setSeating}
              />
            ))}
          </Fieldset>
          <Fieldset legend="Channels" error={channel ? undefined : 'Pick how the customer hears from us'}>
            <div className="flex flex-wrap gap-2">
              {['SMS', 'Email'].map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={channel === option ? 'primary' : 'secondary'}
                  aria-pressed={channel === option}
                  onClick={() => setChannel(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </Fieldset>
          <div className="space-y-3">
            <Switch label="Text messages" checked={smsOn} onChange={setSmsOn} />
            <Switch label="Emails" checked={emailOn} onChange={setEmailOn} size="sm" />
          </div>
        </ReferenceCard>

        <ReferenceCard title="Field, Search, Dates and Files">
          <Field label="Reference" hint="Field names any control: it wires the label, hint and error to it" required>
            <Input placeholder="INV-001" />
          </Field>
          <Field label="Search Customers" hint="Name, phone or email">
            <SearchInput value={search} onChange={setSearch} placeholder="Search" />
          </Field>
          <SearchInput value={search} onChange={setSearch} placeholder="Search bookings" aria-label="Search bookings" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <DateTimePicker type="date" value={date} onChange={setDate} />
            </Field>
            <Field label="Time">
              <DateTimePicker type="time" value={time} onChange={setTime} />
            </Field>
          </div>
          <Field label="Date and Time">
            <DateTimePicker type="datetime-local" value={dateTime} onChange={setDateTime} />
          </Field>
          <Field label="Receipt" hint="PDF or image, up to 10 MB">
            <FileUpload
              accept="application/pdf,image/*"
              maxSize={10 * 1024 * 1024}
              onFiles={(files) => toast.success(`Picked ${describeFiles(files)}`)}
            />
          </Field>
        </ReferenceCard>

        <ReferenceCard title="FormFooter" subtitle="Every form ends with one: secondary first, primary last">
          <p className="text-sm text-text">
            Right-aligned on desktop. On a phone the buttons go full width with the primary on top, where the thumb is.
            <Code>start</Code> holds a note or a total.
          </p>
          <FormFooter start="Total £120.00">
            <Button variant="secondary">Cancel</Button>
            <Button variant="primary">Save Changes</Button>
          </FormFooter>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Status and feedback                                                */
/* ------------------------------------------------------------------ */

export function StatusSection(): React.JSX.Element {
  const [showRouteLoading, setShowRouteLoading] = useState(false)

  return (
    <Section
      id="status"
      title="Status and Feedback"
      description="Each status has one tone map in its domain's status-ui file. Toasts are transient; a lasting result is an inline Alert"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Badge">
          <Example title="Tones">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {TONE_LABEL[tone]}
              </Badge>
            ))}
          </Example>
          <Example title="Dot, Icon and Small">
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone} dot>
                {TONE_LABEL[tone]}
              </Badge>
            ))}
            <Badge tone="success" icon={<Icon name="check" size={12} />}>
              Paid
            </Badge>
            <Badge tone="info" size="sm">
              Small
            </Badge>
          </Example>
        </ReferenceCard>

        <ReferenceCard title="Toast and ProgressBar" subtitle="toast from @/ds; one Toaster, in the root layout">
          <Example title="Kinds">
            <Button size="sm" onClick={() => toast.success('Booking saved')}>
              Success
            </Button>
            <Button size="sm" onClick={() => toast.error('Could not save the booking')}>
              Error
            </Button>
            <Button size="sm" onClick={() => toast.warning('This booking is outside the kitchen hours')}>
              Warning
            </Button>
            <Button size="sm" onClick={() => toast.info('Two new bookings')}>
              Info
            </Button>
          </Example>
          <Example title="ProgressBar" stacked>
            <ProgressBar value={25} label="Primary progress" />
            <ProgressBar value={50} tone="success" label="Success progress" />
            <ProgressBar value={75} tone="warning" label="Warning progress" size="sm" />
            <ProgressBar value={100} tone="danger" label="Danger progress" size="sm" />
          </Example>
        </ReferenceCard>

        <ReferenceCard title="Alert" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {ALERT_TONES.map(({ tone, title, body }) => (
              <Alert key={tone} tone={tone} title={title}>
                {body}
              </Alert>
            ))}
            <Alert tone="info" size="sm" role="status">
              A compact banner (size sm), announced politely (role status).
            </Alert>
            <Alert tone="success" title="Dismissable" closable>
              closable adds a Dismiss button.
            </Alert>
          </div>
        </ReferenceCard>

        <ReferenceCard title="Empty">
          <Empty
            icon="search"
            title="No bookings match"
            description="Try another date or clear the filters."
            action={<Button size="sm">Clear Filters</Button>}
          />
          <Empty size="sm" variant="dashed" icon="inbox" title="No messages yet" />
        </ReferenceCard>

        <ReferenceCard title="Spinner and PageLoading">
          <Example title="Spinner Sizes">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </Example>
          <Example title="PageLoading inline" note="A block still fetching, under a header that stays put">
            <div className="w-full rounded-lg border border-border">
              <PageLoading inline label="Loading the example block" />
            </div>
          </Example>
          <Example
            title="PageLoading (route)"
            note={
              <>
                Every section&apos;s <Code>loading.tsx</Code> renders <Code>{'<PageLoading />'}</Code>: half the screen
                tall, centred
              </>
            }
          >
            <Button size="sm" onClick={() => setShowRouteLoading((shown) => !shown)} aria-expanded={showRouteLoading}>
              {showRouteLoading ? 'Hide Route Loading' : 'Show Route Loading'}
            </Button>
            {showRouteLoading ? (
              <div className="w-full rounded-lg border border-border">
                <PageLoading label="Loading the example page" />
              </div>
            ) : null}
          </Example>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Figures                                                            */
/* ------------------------------------------------------------------ */

const STAT_FIXTURES = [
  { label: 'Covers', value: '892', delta: 12.5, hint: 'vs last week' },
  { label: 'Food Cost', value: '31%', delta: 2.1, deltaGood: 'down', tone: 'warning', hint: 'Above its target' },
  { label: 'No-Shows', value: '3', delta: -40, deltaGood: 'down', hint: 'vs last week' },
  { label: 'Overdue', value: '£1,240', tone: 'danger', hint: '4 invoices' },
  { label: 'Deposits Paid', value: '18', tone: 'success', hint: 'This month' },
  { label: 'Average Spend', value: '£38.50', delta: 0, hint: 'vs last week' },
] as const

type StatColumns = 2 | 3 | 4 | 5 | 6

export function FiguresSection(): React.JSX.Element {
  const [columns, setColumns] = useState<StatColumns>(4)

  return (
    <Section
      id="figures"
      title="Figures"
      description="StatGrid with Stat children. Never a hand-built stat tile"
      className={SECTION_CLASS}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            aria-label="StatGrid columns"
            size="sm"
            value={String(columns)}
            onChange={(id) => setColumns(Number(id) as StatColumns)}
            options={[2, 3, 4, 5, 6].map((n) => ({ id: String(n), label: `${n} Columns` }))}
          />
        </div>
        <StatGrid columns={columns}>
          {STAT_FIXTURES.slice(0, columns).map((stat) => (
            <Stat
              key={stat.label}
              label={stat.label}
              value={stat.value}
              delta={'delta' in stat ? stat.delta : undefined}
              deltaGood={'deltaGood' in stat ? stat.deltaGood : undefined}
              tone={'tone' in stat ? stat.tone : undefined}
              hint={stat.hint}
            />
          ))}
        </StatGrid>
        <ReferenceCard title="Stat Props">
          <ul className="list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              <Code>tone</Code> (<Code>success</Code>, <Code>warning</Code>, <Code>danger</Code>) colours the figure
              when the figure itself is good or bad news: overdue money, a missed target.
            </li>
            <li>
              <Code>delta</Code> is the change in percent. A rise shows green and a fall red, unless{' '}
              <Code>deltaGood=&quot;down&quot;</Code>, for figures where a fall is good (costs, no-shows, wastage).
            </li>
            <li>
              <Code>StatGrid columns</Code> takes 2 to 6: one column on a phone, two on a small screen, the full count
              on a wide one. Never override its grid classes.
            </li>
          </ul>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Layout and content                                                 */
/* ------------------------------------------------------------------ */

export function LayoutSection(): React.JSX.Element {
  return (
    <Section
      id="layout"
      title="Cards and Content"
      description="Panels are Card. A heading over a group of cards is Section, like this one"
      className={SECTION_CLASS}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="A Card With a Long Title That Wraps Rather Than Being Cut Off"
            subtitle="CardHeader: title, subtitle and action. On a narrow card the action drops under the title"
            action={
              <>
                <Button size="sm">Export</Button>
                <Button size="sm" variant="primary">
                  Add Item
                </Button>
              </>
            }
          />
          <CardBody className="space-y-4">
            <p className="text-sm text-text">
              CardBody holds the content, spaced with <Code>space-y-4</Code>. Side-by-side fields use{' '}
              <Code>grid gap-4 sm:grid-cols-2</Code>.
            </p>
            <SubHeading>SubHeading</SubHeading>
            <p className="text-sm text-text">
              The h4 for a part of a long card body. Tables sit in <Code>{'<Card padding="none">'}</Code>.
            </p>
          </CardBody>
          <CardFooter>
            <p className="text-xs text-text-muted">CardFooter: a quiet line or secondary actions.</p>
          </CardFooter>
        </Card>

        <ReferenceCard title="Section">
          <p className="text-sm text-text">
            A <Code>Section</Code> is the h2 over a group of cards: <Code>title</Code>, <Code>description</Code> and{' '}
            <Code>actions</Code>. A default Section adds no padding, so its cards line up with every other card.
          </p>
          <CodeBlock
            code={`<Section title="Upcoming" description="The next 14 days" actions={<Button size="sm">Export</Button>}>
  <Card padding="none">...</Card>
</Section>`}
          />
        </ReferenceCard>

        <ReferenceCard title="DescriptionList">
          <DescriptionList
            items={[
              { key: 'guest', label: 'Guest', value: 'Jane Smith' },
              { key: 'party', label: 'Party Size', value: '6' },
              { key: 'when', label: 'When', value: 'Sat 3 Oct, 19:30' },
              { key: 'notes', label: 'Notes', value: '', span: 2 },
            ]}
          />
          <p className="text-xs text-text-muted">An empty value shows a dash.</p>
        </ReferenceCard>

        <ReferenceCard title="Accordion">
          <Accordion
            variant="bordered"
            items={[
              { key: 'tokens', title: 'Where do the tokens live?', content: <p className="text-sm text-text">In the @theme static block of src/app/globals.css.</p> },
              { key: 'components', title: 'Where do the components live?', content: <p className="text-sm text-text">In src/ds, imported from @/ds.</p> },
            ]}
          />
        </ReferenceCard>

        <ReferenceCard title="Stepper, Avatar and Tooltip">
          <Example title="Stepper">
            <Stepper
              steps={[
                { label: 'Details', status: 'done' },
                { label: 'Deposit', status: 'active' },
                { label: 'Confirm', status: 'upcoming' },
              ]}
            />
          </Example>
          <Example title="Avatar and AvatarStack">
            <Avatar name="Alice Jones" size="sm" />
            <Avatar name="Bob Smith" size="md" />
            <Avatar name="Carol Davis" size="lg" />
            <Avatar name="Dan Wilson" size="xl" />
            <AvatarStack names={['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Fay']} max={4} />
          </Example>
          <Example title="Tooltip" note="A short hint on hover and focus. Never the only place a fact appears">
            <Tooltip content="Shown to staff only">
              <IconButton icon={<Icon name="info" size={16} />} label="About staff notes" variant="ghost" />
            </Tooltip>
          </Example>
        </ReferenceCard>

        <ReferenceCard title="CustomerLink">
          <p className="text-sm text-text">
            Links a name to <Code>/customers/[id]</Code>. With no id it prints the name, or the fallback, as plain text:
          </p>
          <p className="text-sm text-text">
            <CustomerLink name={null} fallback="Walk-in guest" />
          </p>
          <CodeBlock code={`<CustomerLink customerId={booking.customerId} name={booking.customerName} />`} />
        </ReferenceCard>
      </div>
    </Section>
  )
}

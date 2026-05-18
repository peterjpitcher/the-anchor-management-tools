import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/ds/composites'

import {
  Button,
  Badge,
  Avatar,
  AvatarStack,
  Alert,
  Stat,
  Input,
  Select,
  Textarea,
  Checkbox,
  Radio,
  Switch,
  Field,
  ProgressBar,
  Spinner,
  SearchInput,
  Skeleton,
  Empty,
  IconButton,
} from '@/ds/primitives'

import { Icon, iconPaths } from '@/ds'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ANCHOR_LINKS = [
  { id: 'colours', label: 'Colours' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'icons', label: 'Icons' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'badges', label: 'Badges' },
  { id: 'avatars', label: 'Avatars' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'cards', label: 'Cards' },
  { id: 'tables', label: 'Tables' },
  { id: 'form-controls', label: 'Form Controls' },
  { id: 'modals', label: 'Modals & Drawers' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'data-display', label: 'Data Display' },
]

const BRAND_COLORS = [
  { shade: '50', hex: '#ecfdf5' },
  { shade: '100', hex: '#d1fae5' },
  { shade: '200', hex: '#a7f3d0' },
  { shade: '300', hex: '#6ee7b7' },
  { shade: '400', hex: '#34d399' },
  { shade: '500', hex: '#10b981' },
  { shade: '600', hex: '#006A4E' },
  { shade: '700', hex: '#064e3b' },
  { shade: '800', hex: '#043927' },
  { shade: '900', hex: '#022c1a' },
]

const SEMANTIC_COLORS = [
  { name: 'surface', cssVar: '--color-surface', hex: '#ffffff' },
  { name: 'surface-2', cssVar: '--color-surface-2', hex: '#fafaf9' },
  { name: 'border', cssVar: '--color-border', hex: '#ececea' },
  { name: 'text', cssVar: '--color-text', hex: '#1c1917' },
  { name: 'text-muted', cssVar: '--color-text-muted', hex: '#57534e' },
  { name: 'text-subtle', cssVar: '--color-text-subtle', hex: '#a8a29e' },
  { name: 'primary', cssVar: '--color-primary', hex: '#006A4E' },
  { name: 'primary-fg', cssVar: '--color-primary-fg', hex: '#ffffff' },
]

const STATUS_COLORS = [
  { name: 'Success', cssVar: '--color-success', hex: '#16a34a', softHex: '#f0fdf4' },
  { name: 'Warning', cssVar: '--color-warning', hex: '#d97706', softHex: '#fffbeb' },
  { name: 'Danger', cssVar: '--color-danger', hex: '#dc2626', softHex: '#fef2f2' },
  { name: 'Info', cssVar: '--color-info', hex: '#0284c7', softHex: '#f0f9ff' },
]

const SPACING_SCALE = [
  { name: '0.5', px: 2 },
  { name: '1', px: 4 },
  { name: '2', px: 8 },
  { name: '3', px: 12 },
  { name: '4', px: 16 },
  { name: '6', px: 24 },
  { name: '8', px: 32 },
  { name: '12', px: 48 },
  { name: '16', px: 64 },
]

/* ------------------------------------------------------------------ */
/*  Section helper                                                     */
/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-text-strong mb-4 pb-2 border-b border-border">
        {title}
      </h2>
      {children}
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="bg-surface-2 border border-border rounded-default p-3 text-xs font-mono text-text overflow-x-auto">
      <code>{code}</code>
    </pre>
  )
}

/* ------------------------------------------------------------------ */
/*  Page component (Server Component)                                  */
/* ------------------------------------------------------------------ */

export default function DesignSystemPage() {
  const iconNames = Object.keys(iconPaths) as (keyof typeof iconPaths)[]

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Design System' },
        ]}
        title="Design System"
        subtitle="Component library, colours, typography, and spacing reference"
      />

      {/* ---- Sticky anchor nav ---- */}
      <nav className="sticky top-0 z-20 bg-bg border-b border-border -mx-6 px-6 py-2 mb-8">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {ANCHOR_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className="px-3 py-1.5 text-xs font-medium text-text-muted rounded-default hover:bg-surface-hover hover:text-text transition-colors whitespace-nowrap"
            >
              {link.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-12">
        {/* ============================================================ */}
        {/* 1. COLOURS                                                    */}
        {/* ============================================================ */}
        <Section id="colours" title="Colours">
          <SubSection title="Brand Palette">
            <div className="flex flex-wrap gap-3">
              {BRAND_COLORS.map((c) => (
                <div key={c.shade} className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-16 h-16 rounded-lg border border-border shadow-xs"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-xs font-semibold text-text-strong">{c.shade}</span>
                  <span className="text-[10px] font-mono text-text-muted">{c.hex}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="Semantic Colours">
            <div className="flex flex-wrap gap-3">
              {SEMANTIC_COLORS.map((c) => (
                <div key={c.name} className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-16 h-16 rounded-lg border border-border shadow-xs"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-xs font-semibold text-text-strong">{c.name}</span>
                  <span className="text-[10px] font-mono text-text-muted">{c.hex}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="Status Colours">
            {STATUS_COLORS.map((s) => (
              <div key={s.name} className="flex items-center gap-3 mb-3">
                <div
                  className="w-16 h-16 rounded-lg border border-border shadow-xs"
                  style={{ backgroundColor: s.hex }}
                />
                <div
                  className="w-16 h-16 rounded-lg border border-border shadow-xs"
                  style={{ backgroundColor: s.softHex }}
                />
                <div>
                  <span className="text-sm font-semibold text-text-strong">{s.name}</span>
                  <div className="text-[10px] font-mono text-text-muted">
                    {s.hex} / {s.softHex}
                  </div>
                </div>
              </div>
            ))}
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 2. TYPOGRAPHY                                                 */}
        {/* ============================================================ */}
        <Section id="typography" title="Typography">
          <SubSection title="Headings">
            <div className="space-y-4">
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-3xl font-bold</span>
                <h1 className="text-3xl font-bold text-text-strong">Heading 1</h1>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-2xl font-semibold</span>
                <h2 className="text-2xl font-semibold text-text-strong">Heading 2</h2>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-xl font-semibold</span>
                <h3 className="text-xl font-semibold text-text-strong">Heading 3</h3>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-lg font-semibold</span>
                <h4 className="text-lg font-semibold text-text-strong">Heading 4</h4>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-base font-semibold</span>
                <h5 className="text-base font-semibold text-text-strong">Heading 5</h5>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-sm font-semibold</span>
                <h6 className="text-sm font-semibold text-text-strong">Heading 6</h6>
              </div>
            </div>
          </SubSection>

          <SubSection title="Body Text">
            <div className="space-y-3">
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-sm (regular)</span>
                <p className="text-sm text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-sm font-medium</span>
                <p className="text-sm font-medium text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-sm font-semibold</span>
                <p className="text-sm font-semibold text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-[13px]</span>
                <p className="text-[13px] text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-xs</span>
                <p className="text-xs text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
            </div>
          </SubSection>

          <SubSection title="Monospace">
            <div className="flex items-baseline gap-4">
              <span className="text-xs font-mono text-text-muted w-40 shrink-0">text-sm font-mono</span>
              <p className="text-sm font-mono text-text">const greeting = &apos;Hello, world!&apos;</p>
            </div>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 3. SPACING                                                    */}
        {/* ============================================================ */}
        <Section id="spacing" title="Spacing">
          <div className="space-y-3">
            {SPACING_SCALE.map((s) => (
              <div key={s.name} className="flex items-center gap-4">
                <span className="text-xs font-mono text-text-muted w-16 text-right shrink-0">
                  {s.name} ({s.px}px)
                </span>
                <div
                  className="h-5 bg-primary rounded-sm"
                  style={{ width: `${s.px}px` }}
                />
              </div>
            ))}
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 4. ICONS                                                      */}
        {/* ============================================================ */}
        <Section id="icons" title="Icons">
          <p className="text-sm text-text-muted mb-4">{iconNames.length} icons available. All render at 24px below.</p>
          <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-4">
            {iconNames.map((name) => (
              <div
                key={name}
                className="flex flex-col items-center gap-1.5 p-2 rounded-default hover:bg-surface-hover transition-colors"
              >
                <Icon name={name} size={24} className="text-text" />
                <span className="text-[10px] font-mono text-text-muted text-center leading-tight">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 5. BUTTONS                                                    */}
        {/* ============================================================ */}
        <Section id="buttons" title="Buttons">
          <SubSection title="Variants">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
          </SubSection>

          <SubSection title="Sizes">
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" size="md">Medium</Button>
              <Button variant="primary" size="lg">Large</Button>
            </div>
          </SubSection>

          <SubSection title="With Icons">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="primary" icon={<Icon name="plus" size={14} />}>
                Add Item
              </Button>
              <Button variant="secondary" icon={<Icon name="download" size={14} />}>
                Download
              </Button>
              <Button variant="primary" loading>Loading</Button>
              <Button variant="secondary" disabled>Disabled</Button>
            </div>
          </SubSection>

          <SubSection title="Icon Buttons">
            <div className="flex items-center gap-3">
              <IconButton icon={<Icon name="edit" size={14} />} label="Edit" />
              <IconButton icon={<Icon name="trash" size={14} />} label="Delete" />
              <IconButton icon={<Icon name="moreHorizontal" size={14} />} label="More options" />
            </div>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 6. BADGES                                                     */}
        {/* ============================================================ */}
        <Section id="badges" title="Badges">
          <SubSection title="Tones">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="primary">Primary</Badge>
              <Badge tone="success">Success</Badge>
              <Badge tone="warning">Warning</Badge>
              <Badge tone="danger">Danger</Badge>
              <Badge tone="info">Info</Badge>
            </div>
          </SubSection>

          <SubSection title="With Dot">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge tone="neutral" dot>Neutral</Badge>
              <Badge tone="primary" dot>Primary</Badge>
              <Badge tone="success" dot>Success</Badge>
              <Badge tone="warning" dot>Warning</Badge>
              <Badge tone="danger" dot>Danger</Badge>
              <Badge tone="info" dot>Info</Badge>
            </div>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 7. AVATARS                                                    */}
        {/* ============================================================ */}
        <Section id="avatars" title="Avatars">
          <SubSection title="Sizes">
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <Avatar name="Alice Jones" size="sm" />
                <span className="text-xs text-text-muted">sm</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Avatar name="Bob Smith" size="md" />
                <span className="text-xs text-text-muted">md</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Avatar name="Carol Davis" size="lg" />
                <span className="text-xs text-text-muted">lg</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Avatar name="Dan Wilson" size="xl" />
                <span className="text-xs text-text-muted">xl</span>
              </div>
            </div>
          </SubSection>

          <SubSection title="Avatar Stack">
            <AvatarStack
              names={['Alice', 'Bob', 'Carol', 'Dan', 'Eve']}
              max={4}
            />
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 8. ALERTS                                                     */}
        {/* ============================================================ */}
        <Section id="alerts" title="Alerts">
          <div className="space-y-3">
            <Alert tone="info" title="Information">
              This is an informational alert for general messages and announcements.
            </Alert>
            <Alert tone="success" title="Success">
              Your changes have been saved successfully.
            </Alert>
            <Alert tone="warning" title="Warning">
              Please review the settings before proceeding with this action.
            </Alert>
            <Alert tone="danger" title="Error">
              An error occurred while processing your request. Please try again.
            </Alert>
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 9. CARDS                                                      */}
        {/* ============================================================ */}
        <Section id="cards" title="Cards">
          <div className="max-w-lg">
            <Card>
              <CardHeader
                title="Card Title"
                subtitle="Optional subtitle with extra context"
                action={<Button variant="secondary" size="sm">Action</Button>}
              />
              <CardBody>
                <p className="text-sm text-text">
                  Cards provide a consistent container for grouping related content.
                  They include an optional header with title, subtitle, and action area,
                  a body for the main content, and a footer for secondary actions.
                </p>
              </CardBody>
              <CardFooter>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm">Cancel</Button>
                  <Button variant="primary" size="sm">Save</Button>
                </div>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 10. TABLES                                                    */}
        {/* ============================================================ */}
        <Section id="tables" title="Tables">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Alice Johnson</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell><Badge tone="success" dot>Active</Badge></TableCell>
                  <TableCell align="right">
                    <Button variant="ghost" size="sm">Edit</Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Bob Smith</TableCell>
                  <TableCell>Staff</TableCell>
                  <TableCell><Badge tone="success" dot>Active</Badge></TableCell>
                  <TableCell align="right">
                    <Button variant="ghost" size="sm">Edit</Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Carol Davis</TableCell>
                  <TableCell>Staff</TableCell>
                  <TableCell><Badge tone="neutral" dot>Inactive</Badge></TableCell>
                  <TableCell align="right">
                    <Button variant="ghost" size="sm">Edit</Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </Section>

        {/* ============================================================ */}
        {/* 11. FORM CONTROLS                                             */}
        {/* ============================================================ */}
        <Section id="form-controls" title="Form Controls">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <SubSection title="Input">
                <Field label="Full Name" hint="Enter your first and last name">
                  <Input placeholder="John Smith" />
                </Field>
              </SubSection>

              <SubSection title="Input with Icon">
                <Field label="Search">
                  <Input
                    placeholder="Search..."
                    icon={<Icon name="search" size={14} className="text-text-muted" />}
                  />
                </Field>
              </SubSection>

              <SubSection title="Select">
                <Field label="Department">
                  <Select
                    options={[
                      { value: 'kitchen', label: 'Kitchen' },
                      { value: 'bar', label: 'Bar' },
                      { value: 'front', label: 'Front of House' },
                    ]}
                    placeholder="Choose a department"
                  />
                </Field>
              </SubSection>

              <SubSection title="Textarea">
                <Field label="Notes">
                  <Textarea placeholder="Enter notes here..." rows={3} />
                </Field>
              </SubSection>

              <SubSection title="Search Input">
                <SearchInput
                  placeholder="Search items..."
                  value=""
                  onChange={() => undefined}
                />
              </SubSection>
            </div>

            <div className="space-y-4">
              <SubSection title="Checkbox">
                <div className="space-y-2">
                  <Checkbox label="Option A" checked onChange={() => undefined} />
                  <Checkbox label="Option B" onChange={() => undefined} />
                  <Checkbox label="Disabled" disabled onChange={() => undefined} />
                </div>
              </SubSection>

              <SubSection title="Radio">
                <div className="space-y-2">
                  <Radio name="ds-radio" label="Choice 1" value="1" checked onChange={() => undefined} />
                  <Radio name="ds-radio" label="Choice 2" value="2" onChange={() => undefined} />
                  <Radio name="ds-radio" label="Choice 3" value="3" onChange={() => undefined} />
                </div>
              </SubSection>

              <SubSection title="Switch">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Switch checked onChange={() => undefined} />
                    <span className="text-sm text-text">Enabled</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={false} onChange={() => undefined} />
                    <span className="text-sm text-text">Disabled</span>
                  </div>
                </div>
              </SubSection>

              <SubSection title="Field with Error">
                <Field label="Email" error="Please enter a valid email address" required>
                  <Input placeholder="you@example.com" defaultValue="invalid" />
                </Field>
              </SubSection>
            </div>
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 12. MODALS & DRAWERS                                          */}
        {/* ============================================================ */}
        <Section id="modals" title="Modals & Drawers">
          <div className="space-y-6">
            <SubSection title="Modal">
              <p className="text-sm text-text-muted mb-3">
                Modals render as centered overlays with a backdrop. They trap focus and close on Escape.
              </p>
              <CodeBlock
                code={`<Modal
  open={isOpen}
  onClose={() => setIsOpen(false)}
  title="Confirm Action"
>
  <p>Are you sure you want to proceed?</p>
  <div className="flex justify-end gap-2 mt-4">
    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
    <Button variant="primary" onClick={handleConfirm}>Confirm</Button>
  </div>
</Modal>`}
              />
            </SubSection>

            <SubSection title="Drawer">
              <p className="text-sm text-text-muted mb-3">
                Drawers slide in from the right edge. Used for detail views and edit forms.
              </p>
              <CodeBlock
                code={`<Drawer
  open={isOpen}
  onClose={() => setIsOpen(false)}
  title="Edit Item"
>
  <form className="space-y-4">
    <Field label="Name"><Input /></Field>
    <Field label="Description"><Textarea /></Field>
    <Button variant="primary" type="submit">Save</Button>
  </form>
</Drawer>`}
              />
            </SubSection>

            <SubSection title="Confirm Dialog">
              <p className="text-sm text-text-muted mb-3">
                A pre-built modal pattern for confirmation prompts with configurable tone.
              </p>
              <CodeBlock
                code={`<ConfirmDialog
  open={showConfirm}
  onClose={() => setShowConfirm(false)}
  onConfirm={handleDelete}
  title="Delete Item"
  message="This action cannot be undone."
  confirmLabel="Delete"
  tone="danger"
/>`}
              />
            </SubSection>
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 13. NAVIGATION                                                */}
        {/* ============================================================ */}
        <Section id="navigation" title="Navigation">
          <SubSection title="Page Header">
            <Card>
              <CardBody>
                <PageHeader
                  breadcrumbs={[
                    { label: 'Home', href: '/' },
                    { label: 'Events', href: '/events' },
                    { label: 'Summer Party' },
                  ]}
                  title="Summer Party"
                  subtitle="Annual company celebration event"
                  actions={
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm">Edit</Button>
                      <Button variant="primary" size="sm">Publish</Button>
                    </div>
                  }
                />
              </CardBody>
            </Card>
          </SubSection>

          <SubSection title="SectionNav, Tabs, and Segmented">
            <p className="text-sm text-text-muted mb-3">
              These navigation components require client-side state management (&apos;use client&apos;).
              They are rendered via interactive wrappers in their respective pages.
            </p>
            <CodeBlock
              code={`// SectionNav — pill-style sub-page navigation
<SectionNav
  items={[{ id: 'overview', label: 'Overview' }, { id: 'details', label: 'Details' }]}
  activeId={activeSection}
  onSelect={(id) => setActiveSection(id)}
/>

// Tabs — underline-style tab navigation
<Tabs
  tabs={[{ id: 'all', label: 'All', count: 42 }, { id: 'active', label: 'Active' }]}
  activeTab={activeTab}
  onTabChange={(id) => setActiveTab(id)}
/>

// Segmented — inline button group toggle
<Segmented
  options={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]}
  value={view}
  onChange={(id) => setView(id)}
/>`}
            />
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 14. DATA DISPLAY                                              */}
        {/* ============================================================ */}
        <Section id="data-display" title="Data Display">
          <SubSection title="Stats">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Revenue" value="12,450" delta={8.2} hint="vs last month" />
              <Stat label="Bookings" value="156" delta={-3.1} hint="vs last month" />
              <Stat label="Covers" value="892" delta={12.5} hint="vs last month" />
              <Stat label="Avg Spend" value="38.50" delta={0} hint="vs last month" />
            </div>
          </SubSection>

          <SubSection title="Progress Bars">
            <div className="space-y-3 max-w-md">
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Primary (25%)</span>
                </div>
                <ProgressBar value={25} tone="primary" />
              </div>
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Success (50%)</span>
                </div>
                <ProgressBar value={50} tone="success" />
              </div>
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Warning (75%)</span>
                </div>
                <ProgressBar value={75} tone="warning" />
              </div>
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Danger (100%)</span>
                </div>
                <ProgressBar value={100} tone="danger" />
              </div>
            </div>
          </SubSection>

          <SubSection title="Skeleton Loading">
            <div className="space-y-3 max-w-md">
              <Skeleton width="100%" height="20px" />
              <Skeleton width="80%" height="20px" />
              <Skeleton width="60%" height="20px" />
              <div className="flex gap-3">
                <Skeleton width="40px" height="40px" rounded="full" />
                <div className="space-y-2 flex-1">
                  <Skeleton width="60%" height="14px" />
                  <Skeleton width="40%" height="14px" />
                </div>
              </div>
            </div>
          </SubSection>

          <SubSection title="Empty State">
            <Card>
              <CardBody>
                <Empty
                  icon={<Icon name="search" size={48} />}
                  title="No results found"
                  description="Try adjusting your search or filter to find what you are looking for."
                  action={<Button variant="secondary" size="sm">Clear filters</Button>}
                />
              </CardBody>
            </Card>
          </SubSection>

          <SubSection title="Spinner">
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <Spinner size="sm" />
                <span className="text-xs text-text-muted">sm</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Spinner size="md" />
                <span className="text-xs text-text-muted">md</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Spinner size="lg" />
                <span className="text-xs text-text-muted">lg</span>
              </div>
            </div>
          </SubSection>
        </Section>
      </div>
    </div>
  )
}

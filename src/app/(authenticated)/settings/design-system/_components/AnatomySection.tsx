'use client'

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Icon,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { cn } from '@/lib/utils'

import { Code, CodeBlock, ReferenceCard } from './reference-ui'

/** PageLayout's props, in the order a page usually passes them. */
const PAGE_LAYOUT_PROPS: readonly { prop: string; marker?: number; does: string; rule: string }[] = [
  {
    prop: 'title',
    marker: 1,
    does: 'The page h1.',
    rule: 'The sidebar label; on a tab row, the label of the sidebar entry that owns the row; a record\'s name on a detail page; the action on a new or edit page ("New Invoice"); the tile\'s label for a page opened from Settings. The same title while loading, on error and when loaded.',
  },
  {
    prop: 'subtitle',
    marker: 2,
    does: 'One line under the title.',
    rule: 'Short, sentence case, no full stop. On a tab page it may name the tab.',
  },
  {
    prop: 'headerActions',
    marker: 3,
    does: 'The page\'s actions: beside the title on a desktop, in the row under it on a phone.',
    rule: 'size="sm", secondary first, the primary action (the main "New X") last. Refresh, Export and view switchers go here too.',
  },
  {
    prop: 'navItems',
    marker: 4,
    does: 'The section\'s tab row. The active tab comes from the path (longest matching prefix).',
    rule: 'One constant in <section>/_shared/nav.ts, the same tabs (same permission filtering, badges on all or none) on every page of the row. Child pages (detail, new, edit) do not show it.',
  },
  {
    prop: 'backButton',
    marker: 5,
    does: '{ label, href }: a back button at the right of the header, after the actions (an arrow before the title on a phone).',
    rule: '"Back to <the parent page\'s title>", pointing at that parent. Every page below its section\'s top level; never on a top-level page. No breadcrumbs anywhere.',
  },
  {
    prop: 'containerSize',
    does: 'The body\'s width.',
    rule: 'Leave it at "full", except a page that is one form with no table: "md".',
  },
  {
    prop: 'loading',
    does: 'The header stays and the body shows PageLoading inline.',
    rule: 'For a page still fetching on the client. A route shows loading.tsx instead.',
  },
  {
    prop: 'error, onRetry',
    does: 'The header stays and the body shows a danger Alert, with a retry button when onRetry is set.',
    rule: 'A failed load is never shown as an empty list.',
  },
]

/** A numbered callout on the illustration, matching the table below it. */
function Marker({ n }: { n: number }): React.JSX.Element {
  return (
    <Badge tone="info" size="sm">
      {n}
    </Badge>
  )
}

/** A drawing of the section tab row, in SectionNav's own classes. It is a picture, not navigation. */
function TabRowDrawing({ tabs }: { tabs: readonly string[] }): React.JSX.Element {
  return (
    <div className="flex items-end gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab, index) => (
        <span
          key={tab}
          className={cn(
            'inline-flex h-9 items-center whitespace-nowrap rounded-t-default border border-b-0 px-3.5 text-ui font-medium',
            index === 0 ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text-muted',
          )}
        >
          {tab}
        </span>
      ))}
    </div>
  )
}

/** A drawing of the page title, in PageLayout's own classes. */
function TitleDrawing({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-2xl font-bold tracking-tight text-text-strong">{title}</p>
      <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
    </div>
  )
}

/**
 * Two page headers drawn from DS pieces. A page renders PageLayout only once, so these are
 * pictures: inert, so their buttons never take focus or clicks.
 */
function Illustrations(): React.JSX.Element {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="A Page in a Tab Row" subtitle="Top level of its section: tab row, no back button" />
        <CardBody>
          <div inert className="space-y-4 rounded-lg border border-border bg-bg p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <TitleDrawing title="Invoices" subtitle="Money owed to Orange Jelly" />
                <Marker n={1} />
                <Marker n={2} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Marker n={3} />
                <Button size="sm">Export</Button>
                <Button size="sm" variant="primary" icon={<Icon name="plus" size={14} />}>
                  New Invoice
                </Button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TabRowDrawing tabs={['Invoices', 'Quotes', 'Recurring', 'Catalog', 'Vendors', 'Export']} />
              </div>
              <Marker n={4} />
            </div>
            <div className="h-16 rounded-lg border border-dashed border-border-strong" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="A Child Page" subtitle="Detail, new or edit: back button, no section tab row" />
        <CardBody>
          <div inert className="space-y-4 rounded-lg border border-border bg-bg p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <TitleDrawing title="New Invoice" subtitle="Create a new invoice" />
                <Marker n={1} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Marker n={5} />
                <Button variant="ghost" icon={<Icon name="chevronLeft" size={16} />}>
                  Back to Invoices
                </Button>
              </div>
            </div>
            <div className="h-16 max-w-screen-md rounded-lg border border-dashed border-border-strong" />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export function AnatomySection(): React.JSX.Element {
  return (
    <Section
      id="anatomy"
      title="Page Anatomy"
      description="Every staff page renders PageLayout once, as its outermost element. It owns the header, the tab row and the page spacing"
      className="scroll-mt-6"
    >
      <div className="space-y-6">
        <Illustrations />

        <Card padding="none">
          <CardHeader title="PageLayout Props" subtitle="The numbers match the drawings above" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prop</TableHead>
                <TableHead>What It Does</TableHead>
                <TableHead>Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PAGE_LAYOUT_PROPS.map((row) => (
                <TableRow key={row.prop}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {row.marker ? <Marker n={row.marker} /> : null}
                      <Code>{row.prop}</Code>
                    </span>
                  </TableCell>
                  <TableCell>{row.does}</TableCell>
                  <TableCell className="text-text-muted">{row.rule}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReferenceCard title="One Set of Props for Every State">
            <p className="text-sm text-text">
              Build one <Code>layoutProps</Code> object and spread it into the loading, error and loaded states, so the
              title and tabs never jump.
            </p>
            <CodeBlock
              code={`const layoutProps = {
  title: 'Invoices',
  subtitle: 'Money owed to Orange Jelly',
  navItems: FINANCE_NAV,
  headerActions: <LinkButton href="/invoices/new" size="sm">New Invoice</LinkButton>,
}

if (error) return <PageLayout {...layoutProps} error={error} onRetry={reload} />
return (
  <PageLayout {...layoutProps} loading={loading}>
    <StatGrid columns={3}>...</StatGrid>
    <Card padding="none"><DataTable ... /></Card>
  </PageLayout>
)`}
            />
          </ReferenceCard>
          <ReferenceCard title="The Body">
            <ul className="list-disc space-y-2 pl-5 text-sm text-text">
              <li>
                Children sit 24px apart (<Code>space-y-6</Code>). Pass blocks straight in: no margins between them, no
                extra stack.
              </li>
              <li>
                Never pass <Code>className</Code>, <Code>headerClassName</Code> or <Code>contentClassName</Code>, and
                never wrap PageLayout in padding, a max width or <Code>min-h-screen</Code>. The only{' '}
                <Code>{'<main>'}</Code> is the app shell&apos;s.
              </li>
              <li>
                Every section has a <Code>loading.tsx</Code> that renders <Code>{'<PageLoading />'}</Code>.
              </li>
              <li>
                The FOH manager iPad kiosk keeps its dark header (<Code>headerVariant=&quot;dark&quot;</Code>): the one
                exception.
              </li>
            </ul>
          </ReferenceCard>
        </div>
      </div>
    </Section>
  )
}

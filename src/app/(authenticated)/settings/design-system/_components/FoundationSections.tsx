'use client'

import { Icon, iconPaths, Section, SubHeading, type IconName } from '@/ds'
import { cn } from '@/lib/utils'

import {
  Code,
  CodeBlock,
  CopyClass,
  Example,
  MeasureTable,
  ReferenceCard,
  Swatch,
  SwatchRow,
  TableCard,
  TokenValue,
  ValueTable,
  useTokenValue,
} from './reference-ui'
import {
  AVATAR_COUNT,
  CATEGORY_NAMES,
  CHART_COUNT,
  CHROME_COLOURS,
  FONTS,
  NEUTRAL_COLOURS,
  ON_DARK_COLOURS,
  OTHER_TOKENS,
  PRIMARY_COLOURS,
  RADII,
  SHADOWS,
  SHELL_TOKENS,
  SIZE_TOKENS,
  STATUSES,
  STATUS_SET,
  TYPE_SCALE,
  type ScaleToken,
} from './tokens'

const SECTION_CLASS = 'scroll-mt-6'

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

export function RulesSection(): React.JSX.Element {
  return (
    <Section id="rules" title="Rules" description="The short version of docs/standards/UI_UX.md" className={SECTION_CLASS}>
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard title="Tokens Only">
          <ul className="list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              Colours, sizes, radii and shadows come from the tokens on this page. No hex, no raw Tailwind palette
              colours, no <Code>white</Code> or <Code>black</Code>: the guard <Code>tests/guards/design-tokens.test.ts</Code>{' '}
              fails on new ones.
            </li>
            <li>
              Text on white needs 4.5:1 contrast: <Code>text-text</Code>, <Code>text-text-muted</Code>,{' '}
              <Code>text-text-soft</Code> or a status <Code>-fg</Code> colour. Base status colours are for icons, dots
              and fills.
            </li>
            <li>
              Nothing smaller than <Code>text-2xs</Code> (10px). The FOH, BOH, timeclock and voucher screens keep 44px
              targets with <Code>min-h-touch</Code>.
            </li>
            <li>
              Disabled controls use <Code>disabled:opacity-50</Code>. Light theme only: no dark-mode variants.
            </li>
            <li>
              Guest pages use the guest tokens inside GuestShell; staff screens never do. Emails and PDFs take literal
              colours from <Code>src/lib/brand/palette.ts</Code>.
            </li>
          </ul>
        </ReferenceCard>
        <ReferenceCard title="Page Contract">
          <ul className="list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              Every staff page renders <Code>PageLayout</Code> once, as its outermost element. No breadcrumbs, and no
              other page header (see Page Anatomy below).
            </li>
            <li>
              Build from <Code>@/ds</Code> before writing markup: no raw buttons, inputs, selects, labels, tables or
              headings. The guard <Code>tests/guards/page-contract.test.ts</Code> fails on new ones.
            </li>
            <li>
              Each status has one tone map in its domain&apos;s <Code>status-ui</Code> file, used everywhere it shows.
              Never pick a tone at the call site.
            </li>
          </ul>
          <Example title="Focus">
            <div className="w-full">
              <CodeBlock
                code={`// Buttons, links, tabs and other controls
focus-visible:outline-hidden focus-visible:shadow-ring
// ...inside a container that clips (accordions, tab strips, table headers)
focus-visible:outline-hidden focus-visible:shadow-ring-inset
// Text fields
focus:border-border-focus focus:shadow-ring`}
              />
            </div>
          </Example>
        </ReferenceCard>
        <ReferenceCard title="Wording" subtitle="The same action has the same words and the same look on every page">
          <ul className="list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              &quot;New X&quot; starts a record and opens a page or dialog titled &quot;New X&quot;. Its submit is
              &quot;Create X&quot;, or &quot;Add X&quot; for something added to the record on screen (a line item, a
              note).
            </li>
            <li>
              An edit form saves with &quot;Save Changes&quot;; a form in sections names the section (&quot;Save
              Opening Hours&quot;). Never &quot;Update X&quot;. A detail page&apos;s edit action is &quot;Edit&quot;,
              secondary.
            </li>
            <li>
              &quot;Delete&quot; is danger and opens &quot;Delete &lt;Thing&gt;&quot;, which confirms with
              &quot;Delete&quot;. Cancelling a booking is &quot;Cancel Booking&quot;, kept with &quot;Keep
              Booking&quot;.
            </li>
            <li>
              Retry is &quot;Try Again&quot; (secondary, sm). &quot;Export CSV&quot;, &quot;Download PDF&quot;,
              &quot;Email Invoice&quot;. A working button keeps its label and shows its spinner.
            </li>
            <li>
              Empty titles are short and sentence case (&quot;No X yet&quot;, &quot;No X match these
              filters&quot;, &quot;No X for this period&quot;); icon-only buttons are named in sentence case.
            </li>
          </ul>
        </ReferenceCard>
        <ReferenceCard title="Headers and Dialogs">
          <ul className="list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              A tab page&apos;s subtitle reads &quot;&lt;Tab&gt;: &lt;what this page is for&gt;&quot;. A record&apos;s
              status is a Badge in its first card, never in the header.
            </li>
            <li>
              Filters sit above the data they filter, never in the header. Destructive actions on a detail page go in
              the header, not a danger-zone card. More than three header actions: the extras go in a labelled
              &quot;More&quot; Dropdown.
            </li>
            <li>
              A Modal&apos;s buttons go in its <Code>footer</Code> (a form in the body links its submit button with{' '}
              <Code>form</Code>); <Code>FormFooter</Code> never sits in a Modal.
            </li>
            <li>
              A yes/no question is a <Code>ConfirmDialog</Code>, and a dialog title never ends in a question mark.
            </li>
          </ul>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

function CategorySample({ index, label }: { index: number; label: string }): React.JSX.Element {
  const n = index + 1
  return (
    <div className="flex w-28 flex-col items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium"
        style={{
          backgroundColor: `var(--color-cat-${n}-soft)`,
          color: `var(--color-cat-${n}-fg)`,
          borderColor: `var(--color-cat-${n}-soft)`,
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(--color-cat-${n})` }} />
        {label}
      </span>
      <span className="text-xs font-semibold text-text-strong">cat-{n}</span>
      <TokenValue token={`--color-cat-${n}`} />
      <span className="text-center text-2xs text-text-soft">with -soft and -fg</span>
    </div>
  )
}

function AvatarSample({ index }: { index: number }): React.JSX.Element {
  const n = index + 1
  return (
    <div className="flex w-28 flex-col items-center gap-1.5">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-on-dark"
        style={{ backgroundColor: `var(--color-avatar-${n})` }}
      >
        AB
      </span>
      <span className="text-xs font-semibold text-text-strong">avatar-{n}</span>
      <TokenValue token={`--color-avatar-${n}`} />
    </div>
  )
}

export function ColoursSection(): React.JSX.Element {
  return (
    <Section
      id="colours"
      title="Colours"
      description="Each swatch is painted from its token and its value is read from the live stylesheet. Press a class to copy it."
      className={SECTION_CLASS}
    >
      <div className="space-y-6">
        <ReferenceCard
          title="Neutrals"
          subtitle="Text-colour tokens repeat the prefix: the class for text-muted is text-text-muted"
        >
          <SwatchRow>
            {NEUTRAL_COLOURS.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </SwatchRow>
        </ReferenceCard>

        <ReferenceCard title="Primary" subtitle="The Orange Jelly orange: buttons, the active tab, links">
          <SwatchRow>
            {PRIMARY_COLOURS.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </SwatchRow>
        </ReferenceCard>

        <ReferenceCard
          title="Status"
          subtitle="Messages use soft, fg and border together, as Alert and Badge do. The base colour is for icons, dots and fills"
        >
          <div className="space-y-4">
            {STATUSES.map((status) => (
              <SwatchRow key={status}>
                {STATUS_SET.map(({ suffix, usage, note }) => (
                  <Swatch key={suffix} token={{ name: `${status}${suffix}`, usage: [usage], note }} />
                ))}
              </SwatchRow>
            ))}
          </div>
        </ReferenceCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReferenceCard
            title="Categories"
            subtitle="Fixed app categories (departments, dish groups, booking types). Colours staff pick and save stay data"
          >
            <SwatchRow>
              {CATEGORY_NAMES.map((label, index) => (
                <CategorySample key={label} index={index} label={label} />
              ))}
            </SwatchRow>
          </ReferenceCard>

          <ReferenceCard title="Charts and Avatars" subtitle="Chart series take chart-1 to chart-6 in order">
            <SwatchRow>
              {Array.from({ length: CHART_COUNT }, (_, index) => (
                <Swatch key={`chart-${index}`} token={{ name: `chart-${index + 1}`, usage: ['fill'] }} />
              ))}
            </SwatchRow>
            <SwatchRow>
              {Array.from({ length: AVATAR_COUNT }, (_, index) => (
                <AvatarSample key={`avatar-${index}`} index={index} />
              ))}
            </SwatchRow>
          </ReferenceCard>
        </div>

        <ReferenceCard title="On Dark Surfaces" subtitle="Text and fills on a dark or brand background">
          <SwatchRow className="rounded-lg bg-primary p-4">
            {ON_DARK_COLOURS.map((token) => (
              <Swatch key={token.name} token={token} onDark />
            ))}
          </SwatchRow>
        </ReferenceCard>

        <ReferenceCard
          title="App Chrome Only"
          subtitle="The brand ramp and the sidebar set belong to the app shell and the FOH kiosk header. Staff pages use primary, primary-soft or the on-dark tokens"
        >
          <SwatchRow>
            {CHROME_COLOURS.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </SwatchRow>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Type                                                               */
/* ------------------------------------------------------------------ */

/** The page's heading ladder, drawn with the exact classes each component uses. */
const HEADING_LADDER: readonly { level: string; component: string; classes: string; sample: string }[] = [
  { level: 'h1', component: 'PageLayout title (text-lg on a phone)', classes: 'text-2xl font-bold tracking-tight text-text-strong', sample: 'Design System' },
  { level: 'h2', component: 'Section title', classes: 'text-base font-semibold leading-6 text-text-strong', sample: 'Type' },
  { level: 'h3', component: 'CardHeader title', classes: 'text-sm font-semibold text-text-strong', sample: 'Heading Ladder' },
  { level: 'h4', component: 'SubHeading', classes: 'text-sm font-semibold text-text-strong', sample: 'Inside a card body' },
]

function TypeRow({ entry }: { entry: ScaleToken }): React.JSX.Element {
  const value = useTokenValue(entry.token)
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="w-44 shrink-0 font-mono text-xs text-text-muted">
        {entry.cls} {value ? `(${value})` : ''}
      </span>
      <p className={cn(entry.cls, 'text-text')}>The quick brown fox jumps over the lazy dog.</p>
      {entry.note && <span className="text-xs text-text-soft">{entry.note}</span>}
    </div>
  )
}

export function TypeSection(): React.JSX.Element {
  return (
    <Section id="type" title="Type" description="Sizes, fonts and the heading ladder" className={SECTION_CLASS}>
      <div className="space-y-6">
        <ReferenceCard title="Type Scale" subtitle="Field labels and table headers are uppercased by the components">
          <div className="space-y-3">
            {TYPE_SCALE.map((entry) => (
              <TypeRow key={entry.token} entry={entry} />
            ))}
          </div>
        </ReferenceCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReferenceCard
            title="Heading Ladder"
            subtitle="This page is built on it: the title above is the h1, each block title an h2, each card title an h3"
          >
            <div className="space-y-3">
              {HEADING_LADDER.map((rung) => (
                <div key={rung.level} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="w-44 shrink-0 font-mono text-xs text-text-muted">
                    {rung.level}: {rung.component}
                  </span>
                  <span className={rung.classes}>{rung.sample}</span>
                </div>
              ))}
            </div>
            <SubHeading>A Real SubHeading</SubHeading>
            <p className="text-sm text-text">
              The h4 above is a live <Code>SubHeading</Code>. Use <Code>as=&quot;h3&quot;</Code> in a card with no
              CardHeader. No other heading styles in page code.
            </p>
          </ReferenceCard>

          <ReferenceCard title="Fonts and Weights">
            {FONTS.map((font) => (
              <div key={font.token} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {font.cls && <CopyClass className={font.cls} />}
                  <span className="text-xs text-text-soft">{font.note}</span>
                </div>
                <p className={cn(font.cls, 'text-sm text-text')}>Invoice INV-003VM, 12 covers at 19:30</p>
              </div>
            ))}
            <div className="space-y-1">
              <p className="text-sm font-normal text-text">font-normal: body text</p>
              <p className="text-sm font-medium text-text">font-medium: labels, links, tab names</p>
              <p className="text-sm font-semibold text-text">font-semibold: section and card titles, buttons</p>
              <p className="text-sm font-bold text-text">font-bold: the page title and Stat figures</p>
            </div>
          </ReferenceCard>
        </div>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Shape                                                              */
/* ------------------------------------------------------------------ */

/** `--radius-md` becomes `rounded-md`. Derived, so the page never applies the DS-only class itself. */
const radiusClass = (token: string): string => `rounded-${token.replace('--radius-', '')}`

export function ShapeSection(): React.JSX.Element {
  return (
    <Section id="shape" title="Radius and Shadows" className={SECTION_CLASS}>
      <div className="grid gap-6 lg:grid-cols-2">
        <ReferenceCard
          title="Radius"
          subtitle="These six and rounded-full (circles only) are the whole scale. The 10px step is for src/ds only: pages use lg, default or sm"
        >
          <div className="flex flex-wrap gap-4">
            {RADII.map((radius) => (
              <div key={radius.token} className="flex w-32 flex-col items-center gap-1.5">
                <div
                  className="h-16 w-16 border border-border-strong bg-primary-soft"
                  style={{ borderRadius: `var(${radius.token})` }}
                />
                <CopyClass className={radiusClass(radius.token)} />
                <TokenValue token={radius.token} />
                <span className="text-center text-2xs text-text-soft">{radius.note}</span>
              </div>
            ))}
          </div>
        </ReferenceCard>

        <ReferenceCard title="Shadows" subtitle="These six are the whole scale">
          <div className="flex flex-wrap gap-6">
            {SHADOWS.map((shadow) => (
              <div key={shadow.token} className="flex w-32 flex-col items-center gap-1.5">
                <div className={cn('h-16 w-24 rounded-lg bg-surface', shadow.cls)} />
                {shadow.cls && <CopyClass className={shadow.cls} />}
                <span className="text-center text-2xs text-text-soft">{shadow.note}</span>
              </div>
            ))}
          </div>
        </ReferenceCard>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Sizes and spacing                                                  */
/* ------------------------------------------------------------------ */

export function SizesSection(): React.JSX.Element {
  return (
    <Section
      id="sizes"
      title="Sizes and Spacing"
      description="Spacing between blocks is the Tailwind 4px scale: gap-4 inside cards, space-y-6 and gap-6 between blocks"
      className={SECTION_CLASS}
    >
      <div className="space-y-6">
        <TableCard title="Named Sizes" subtitle="Controls grow for thumbs below the shell breakpoint">
          <MeasureTable entries={SIZE_TOKENS} />
        </TableCard>
        <div className="grid gap-6 lg:grid-cols-2">
          <TableCard title="App Shell" subtitle="PageLayout and AppShell use these; pages never do">
            <MeasureTable entries={SHELL_TOKENS} />
          </TableCard>
          <TableCard title="Breakpoint and Easing">
            <ValueTable entries={OTHER_TOKENS} />
          </TableCard>
        </div>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

export function IconsSection(): React.JSX.Element {
  const names = Object.keys(iconPaths) as IconName[]
  return (
    <Section
      id="icons"
      title="Icons"
      description="The DS Icon is the only icon set. Add a missing glyph to src/ds/icons/paths.tsx"
      className={SECTION_CLASS}
    >
      <ReferenceCard title={`All ${names.length} Glyphs`} subtitle="Shown at 24px; the default is 16px">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
          {names.map((name) => (
            <div key={name} className="flex flex-col items-center gap-1.5 rounded-default p-2 hover:bg-surface-hover">
              <Icon name={name} size={24} className="text-text" />
              <span className="break-all text-center font-mono text-2xs leading-tight text-text-muted">{name}</span>
            </div>
          ))}
        </div>
      </ReferenceCard>
    </Section>
  )
}

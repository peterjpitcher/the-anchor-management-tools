'use client'

import { useEffect, useState } from 'react'

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
  SectionNav,
  Tabs,
  Segmented,
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
  Empty,
  IconButton,
} from '@/ds/primitives'

import { Icon, iconPaths, getToken } from '@/ds'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ANCHOR_LINKS = [
  { id: 'rules', label: 'Rules' },
  { id: 'colours', label: 'Colours' },
  { id: 'typography', label: 'Typography' },
  { id: 'shape', label: 'Radius & Shadows' },
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

/** A colour token (the name after `--color-`) and the utility prefixes it is used with. */
interface ColourToken {
  name: string
  usage: readonly string[]
  note?: string
}

const NEUTRAL_COLOURS: readonly ColourToken[] = [
  { name: 'bg', usage: ['bg'], note: 'Page background' },
  { name: 'surface', usage: ['bg'], note: 'Cards, panels, fields' },
  { name: 'surface-2', usage: ['bg'], note: 'Table headers, sunk panels' },
  { name: 'surface-hover', usage: ['hover:bg'] },
  { name: 'border', usage: ['border', 'divide'] },
  { name: 'border-strong', usage: ['border'] },
  { name: 'border-focus', usage: ['focus:border'] },
  { name: 'overlay', usage: ['bg'], note: 'Dialog backdrop' },
  { name: 'text-strong', usage: ['text'], note: 'Headings' },
  { name: 'text', usage: ['text'], note: 'Body text' },
  { name: 'text-muted', usage: ['text'], note: 'Secondary text, labels' },
  { name: 'text-soft', usage: ['text'], note: 'Hints' },
  { name: 'text-subtle', usage: ['placeholder:text'], note: 'Placeholders and icons, never text' },
]

const BRAND_COLOURS: readonly ColourToken[] = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map(
  (shade) => ({ name: `brand-${shade}`, usage: ['bg'] }),
)

const PRIMARY_COLOURS: readonly ColourToken[] = [
  { name: 'primary', usage: ['bg', 'text', 'border'], note: 'Buttons, links, active tabs' },
  { name: 'primary-hover', usage: ['hover:bg'] },
  { name: 'primary-soft', usage: ['bg'], note: 'Soft highlights' },
  { name: 'primary-soft-fg', usage: ['text'], note: 'Text on primary-soft' },
  { name: 'primary-fg', usage: ['text'], note: 'Text on primary' },
]

const STATUSES = ['success', 'warning', 'danger', 'info'] as const

/** Each status comes as a set: the base for icons, dots and fills, then soft, fg and border. */
const STATUS_SET: readonly { suffix: string; usage: string }[] = [
  { suffix: '', usage: 'bg' },
  { suffix: '-soft', usage: 'bg' },
  { suffix: '-fg', usage: 'text' },
  { suffix: '-border', usage: 'border' },
]

const ON_DARK_COLOURS: readonly ColourToken[] = [
  { name: 'sidebar', usage: ['bg'], note: 'The app shell only' },
  { name: 'on-dark', usage: ['text'] },
  { name: 'on-dark-muted', usage: ['text'] },
  { name: 'on-dark-subtle', usage: ['text'], note: 'Decoration only' },
  { name: 'on-dark-hover', usage: ['hover:bg'] },
  { name: 'on-dark-active', usage: ['bg'] },
  { name: 'on-dark-border', usage: ['border'] },
]

const CATEGORY_NAMES = ['Sky', 'Indigo', 'Violet', 'Pink', 'Orange', 'Amber', 'Teal', 'Stone'] as const
const CHART_COUNT = 6
const AVATAR_COUNT = 6

const GUEST_COLOURS: readonly ColourToken[] = [
  'anchor-green', 'anchor-green-deep', 'anchor-green-light', 'anchor-gold', 'anchor-gold-dark',
  'anchor-gold-deep', 'anchor-gold-bright', 'anchor-cream', 'anchor-cream-text', 'anchor-charcoal',
  'anchor-grey-500', 'anchor-sand', 'anchor-success', 'anchor-danger', 'guest-bg', 'guest-surface',
  'guest-sunk', 'guest-border', 'guest-border-strong', 'guest-text', 'guest-text-strong',
  'guest-text-muted', 'guest-accent-text',
].map((name) => ({ name, usage: [] }))

const TYPE_SCALE = [
  { cls: 'text-2xs', token: '--text-2xs', note: 'The smallest size on any staff screen' },
  { cls: 'text-meta', token: '--text-meta', note: 'Meta lines and counts' },
  { cls: 'text-xs', token: '--text-xs', note: 'Labels, table headers' },
  { cls: 'text-ui', token: '--text-ui', note: 'Table cells, dense controls' },
  { cls: 'text-sm', token: '--text-sm', note: 'Body text' },
  { cls: 'text-base', token: '--text-base' },
  { cls: 'text-lg', token: '--text-lg' },
  { cls: 'text-xl', token: '--text-xl' },
  { cls: 'text-2xl', token: '--text-2xl' },
  { cls: 'text-3xl', token: '--text-3xl' },
] as const

const RADII = [
  { cls: 'rounded-sm', token: '--radius-sm', note: 'Small chips' },
  { cls: 'rounded-default', token: '--radius-default', note: 'Buttons, fields' },
  { cls: 'rounded-md', token: '--radius-md', note: '10px here, not the Tailwind 6px' },
  { cls: 'rounded-lg', token: '--radius-lg', note: 'Cards, dialogs' },
  { cls: 'rounded-xl', token: '--radius-xl', note: 'Large panels' },
  { cls: 'rounded-pill', token: '--radius-pill', note: 'Badges, pills' },
] as const

const SHADOWS = [
  { cls: 'shadow-xs', token: '--shadow-xs', note: 'Buttons' },
  { cls: 'shadow-sm', token: '--shadow-sm', note: 'Cards, tables' },
  { cls: 'shadow-default', token: '--shadow-default', note: 'Raised panels' },
  { cls: 'shadow-lg', token: '--shadow-lg', note: 'Dialogs, drawers, menus, toasts' },
  { cls: 'shadow-ring', token: '--shadow-ring', note: 'Focus ring' },
  { cls: 'shadow-ring-inset', token: '--shadow-ring-inset', note: 'Focus ring inside clipped containers' },
] as const

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

const SPACING_TOKENS = [
  { cls: 'py-cell-y', token: '--spacing-cell-y', note: 'Table cell padding' },
  { cls: 'p-pad-card', token: '--spacing-pad-card', note: 'Card padding' },
  { cls: 'h-btn-h-sm', token: '--spacing-btn-h-sm', note: 'Small button' },
  { cls: 'h-btn-h', token: '--spacing-btn-h', note: 'Button' },
  { cls: 'h-input-h', token: '--spacing-input-h', note: 'Field' },
  { cls: 'h-btn-h-lg', token: '--spacing-btn-h-lg', note: 'Large button' },
  { cls: 'min-h-touch', token: '--spacing-touch', note: 'Touch target on the FOH, BOH and kiosk screens' },
  { cls: 'h-topbar', token: '--spacing-topbar', note: 'Top bar' },
  { cls: 'w-sidebar-collapsed', token: '--spacing-sidebar-collapsed', note: 'Sidebar, collapsed' },
  { cls: 'w-sidebar-expanded', token: '--spacing-sidebar-expanded', note: 'Sidebar, open' },
] as const

/** Every token the page prints a value for; read from the live stylesheet, never copied here. */
const LIVE_TOKENS: readonly string[] = [
  ...[...NEUTRAL_COLOURS, ...BRAND_COLOURS, ...PRIMARY_COLOURS, ...ON_DARK_COLOURS, ...GUEST_COLOURS].map(
    (token) => `--color-${token.name}`,
  ),
  ...STATUSES.flatMap((status) => STATUS_SET.map(({ suffix }) => `--color-${status}${suffix}`)),
  ...CATEGORY_NAMES.flatMap((_, index) => ['', '-soft', '-fg'].map((suffix) => `--color-cat-${index + 1}${suffix}`)),
  ...Array.from({ length: CHART_COUNT }, (_, index) => `--color-chart-${index + 1}`),
  ...Array.from({ length: AVATAR_COUNT }, (_, index) => `--color-avatar-${index + 1}`),
  ...[...TYPE_SCALE, ...RADII, ...SPACING_TOKENS].map((entry) => entry.token),
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

// Derives the real Tailwind utility class(es) for a colour token. Tailwind v4
// appends the token suffix (the part after `--color-`) to each prefix, so
// `--color-text-muted` used as a text colour becomes `text-text-muted`.
function utilityClasses(cssVar: string, prefixes: readonly string[]): string[] {
  const suffix = cssVar.replace('--color-', '')
  return prefixes.map((prefix) => `${prefix}-${suffix}`)
}

/**
 * The computed value of every live token, read from :root once the page has mounted. Tailwind's
 * own sizes are in rem, so those are shown in px like ours.
 */
function useTokenValues(): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const inPx = (value: string) => (/^[\d.]+rem$/.test(value) ? `${parseFloat(value) * rootPx}px` : value)
    setValues(Object.fromEntries(LIVE_TOKENS.map((name) => [name, inPx(getToken(name))])))
  }, [])
  return values
}

// Click-to-copy chip showing a usable utility class.
function CopyableClass({ className }: { className: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard
      ?.writeText(className)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => undefined)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy "${className}"`}
      aria-label={`Copy class ${className}`}
      className="font-mono text-2xs leading-none text-text-muted hover:text-text bg-surface-2 hover:bg-surface-hover border border-border rounded-sm px-1.5 py-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:shadow-ring"
    >
      {copied ? 'copied!' : className}
    </button>
  )
}

/** One colour token: a swatch painted from the token itself, its classes and its live value. */
function Swatch({
  token,
  values,
  onDark = false,
}: {
  token: ColourToken
  values: Record<string, string>
  onDark?: boolean
}) {
  const cssVar = `--color-${token.name}`
  return (
    <div className="flex w-28 flex-col items-center gap-1.5">
      <div
        className={cn('h-16 w-16 rounded-lg border shadow-xs', onDark ? 'border-on-dark-border' : 'border-border')}
        style={{ backgroundColor: `var(${cssVar})` }}
      />
      <span className={cn('text-center text-xs font-semibold', onDark ? 'text-on-dark' : 'text-text-strong')}>
        {token.name}
      </span>
      {token.usage.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          {utilityClasses(cssVar, token.usage).map((cls) => (
            <CopyableClass key={cls} className={cls} />
          ))}
        </div>
      )}
      <span className={cn('font-mono text-2xs', onDark ? 'text-on-dark-muted' : 'text-text-muted')}>
        {values[cssVar] ?? ''}
      </span>
      {token.note && (
        <span className={cn('text-center text-2xs', onDark ? 'text-on-dark-muted' : 'text-text-soft')}>
          {token.note}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page component (a client component: copying and tabs need state)   */
/* ------------------------------------------------------------------ */

export default function DesignSystemPage() {
  const iconNames = Object.keys(iconPaths) as (keyof typeof iconPaths)[]
  const values = useTokenValues()
  const [section, setSection] = useState('overview')
  const [tab, setTab] = useState('all')
  const [view, setView] = useState('list')

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Design System' },
        ]}
        title="Design System"
        subtitle="Tokens and components, read live from the app stylesheet"
      />

      {/* ---- Sticky anchor nav ---- */}
      <nav className="sticky top-0 z-20 bg-bg border-b border-border -mx-6 px-6 py-2 mb-8">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {ANCHOR_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className="px-3 py-1.5 text-xs font-medium text-text-muted rounded-default hover:bg-surface-hover hover:text-text transition-colors whitespace-nowrap focus-visible:outline-hidden focus-visible:shadow-ring-inset"
            >
              {link.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-12">
        {/* ============================================================ */}
        {/* 0. RULES                                                      */}
        {/* ============================================================ */}
        <Section id="rules" title="Rules">
          <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm text-text">
            <li>
              Colours, sizes, radii and shadows come from the tokens on this page. No hex values and no
              raw Tailwind palette colours (gray, blue, emerald and the rest); the guard{' '}
              <code className="font-mono">tests/guards/design-tokens.test.ts</code> fails on new ones, and{' '}
              <code className="font-mono">docs/standards/UI_UX.md</code> lists what is not allowed.
            </li>
            <li>
              Text on white needs 4.5:1 contrast: use <code className="font-mono">text-text</code>,{' '}
              <code className="font-mono">text-text-muted</code>, <code className="font-mono">text-text-soft</code>{' '}
              or a status <code className="font-mono">-fg</code> colour. Base status colours are for icons,
              dots and fills.
            </li>
            <li>
              Nothing smaller than <code className="font-mono">text-2xs</code> (10px). Touch screens (FOH,
              BOH, timeclock, vouchers) keep 44px targets with <code className="font-mono">min-h-touch</code>.
            </li>
            <li>
              Disabled controls use <code className="font-mono">disabled:opacity-50</code>. Light theme only:
              no dark-mode variants.
            </li>
            <li>
              Guest pages use the <code className="font-mono">anchor-*</code> and{' '}
              <code className="font-mono">guest-*</code> tokens inside GuestShell; staff screens never do.
              Emails and PDFs take literal colours from <code className="font-mono">@/lib/brand/palette</code>.
            </li>
          </ul>
          <div className="mt-4 max-w-3xl">
            <SubSection title="Focus">
              <CodeBlock
                code={`// Buttons, links, tabs and other controls
focus-visible:outline-hidden focus-visible:shadow-ring
// ...inside a container that clips (accordions, tab strips, table headers)
focus-visible:outline-hidden focus-visible:shadow-ring-inset
// Text fields
focus:border-border-focus focus:shadow-ring`}
              />
            </SubSection>
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 1. COLOURS                                                    */}
        {/* ============================================================ */}
        <Section id="colours" title="Colours">
          <p className="text-xs text-text-muted mb-4 max-w-2xl">
            Each swatch is painted from its token and the value under it is read from the live
            stylesheet. Click a class to copy it. Text-colour tokens repeat the prefix: the class for{' '}
            <code className="font-mono text-text">text-muted</code> is{' '}
            <code className="font-mono text-text">text-text-muted</code>.
          </p>

          <SubSection title="Neutrals">
            <div className="flex flex-wrap gap-3">
              {NEUTRAL_COLOURS.map((token) => (
                <Swatch key={token.name} token={token} values={values} />
              ))}
            </div>
          </SubSection>

          <SubSection title="Primary">
            <div className="flex flex-wrap gap-3">
              {PRIMARY_COLOURS.map((token) => (
                <Swatch key={token.name} token={token} values={values} />
              ))}
            </div>
          </SubSection>

          <SubSection title="Brand scale">
            <div className="flex flex-wrap gap-3">
              {BRAND_COLOURS.map((token) => (
                <Swatch key={token.name} token={token} values={values} />
              ))}
            </div>
          </SubSection>

          <SubSection title="Status">
            <p className="text-xs text-text-muted mb-3 max-w-2xl">
              The base colour is for icons, dots and fills. Messages use the soft background, the fg
              text and the border together, as Alert and Badge do.
            </p>
            <div className="space-y-4">
              {STATUSES.map((status) => (
                <div key={status} className="flex flex-wrap items-start gap-3">
                  {STATUS_SET.map(({ suffix, usage }) => (
                    <Swatch key={suffix} token={{ name: `${status}${suffix}`, usage: [usage] }} values={values} />
                  ))}
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="On dark surfaces">
            <div className="flex flex-wrap gap-3 rounded-lg p-4" style={{ backgroundColor: 'var(--color-sidebar)' }}>
              {ON_DARK_COLOURS.map((token) => (
                <Swatch key={token.name} token={token} values={values} onDark />
              ))}
            </div>
          </SubSection>

          <SubSection title="Categories">
            <p className="text-xs text-text-muted mb-3 max-w-2xl">
              For fixed app categories (departments, dish groups, booking types). Colours that staff pick
              and save, such as shift templates and calendar notes, stay as data.
            </p>
            <div className="flex flex-wrap gap-3">
              {CATEGORY_NAMES.map((label, index) => {
                const n = index + 1
                return (
                  <div key={label} className="flex w-28 flex-col items-center gap-1.5">
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
                    <span className="font-mono text-2xs text-text-muted">{values[`--color-cat-${n}`] ?? ''}</span>
                  </div>
                )
              })}
            </div>
          </SubSection>

          <SubSection title="Charts and avatars">
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: CHART_COUNT }, (_, index) => (
                <Swatch key={`chart-${index}`} token={{ name: `chart-${index + 1}`, usage: ['fill'] }} values={values} />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {Array.from({ length: AVATAR_COUNT }, (_, index) => (
                <div key={`avatar-${index}`} className="flex w-28 flex-col items-center gap-1.5">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-on-dark"
                    style={{ backgroundColor: `var(--color-avatar-${index + 1})` }}
                  >
                    AB
                  </span>
                  <span className="text-xs font-semibold text-text-strong">avatar-{index + 1}</span>
                  <span className="font-mono text-2xs text-text-muted">{values[`--color-avatar-${index + 1}`] ?? ''}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="Guest pages only">
            <p className="text-xs text-text-muted mb-3 max-w-2xl">
              The Anchor guest palette, for pages inside GuestShell. Never on a staff screen.
            </p>
            <div className="flex flex-wrap gap-3">
              {GUEST_COLOURS.map((token) => (
                <Swatch key={token.name} token={token} values={values} />
              ))}
            </div>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 2. TYPOGRAPHY                                                 */}
        {/* ============================================================ */}
        <Section id="typography" title="Typography">
          <SubSection title="Type scale">
            <div className="space-y-3">
              {TYPE_SCALE.map((size) => (
                <div key={size.cls} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="w-44 shrink-0 font-mono text-xs text-text-muted">
                    {size.cls} {values[size.token] ? `(${values[size.token]})` : ''}
                  </span>
                  <p className={cn(size.cls, 'text-text')}>The quick brown fox jumps over the lazy dog.</p>
                  {'note' in size && <span className="text-xs text-text-soft">{size.note}</span>}
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="Headings">
            <div className="space-y-4">
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-3xl font-bold</span>
                <h1 className="text-3xl font-bold text-text-strong">Heading 1</h1>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-2xl font-semibold</span>
                <h2 className="text-2xl font-semibold text-text-strong">Heading 2</h2>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-xl font-semibold</span>
                <h3 className="text-xl font-semibold text-text-strong">Heading 3</h3>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-lg font-semibold</span>
                <h4 className="text-lg font-semibold text-text-strong">Heading 4</h4>
              </div>
            </div>
          </SubSection>

          <SubSection title="Weights and monospace">
            <div className="space-y-3">
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-sm font-medium</span>
                <p className="text-sm font-medium text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-sm font-semibold</span>
                <p className="text-sm font-semibold text-text">The quick brown fox jumps over the lazy dog.</p>
              </div>
              <div className="flex items-baseline gap-4">
                <span className="text-xs font-mono text-text-muted w-44 shrink-0">text-sm font-mono</span>
                <p className="text-sm font-mono text-text">const greeting = &apos;Hello, world!&apos;</p>
              </div>
            </div>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 3. RADIUS AND SHADOWS                                         */}
        {/* ============================================================ */}
        <Section id="shape" title="Radius & Shadows">
          <SubSection title="Radius">
            <div className="flex flex-wrap gap-4">
              {RADII.map((radius) => (
                <div key={radius.cls} className="flex w-32 flex-col items-center gap-1.5">
                  <div className={cn('h-16 w-16 border border-border-strong bg-primary-soft', radius.cls)} />
                  <CopyableClass className={radius.cls} />
                  <span className="font-mono text-2xs text-text-muted">{values[radius.token] ?? ''}</span>
                  <span className="text-center text-2xs text-text-soft">{radius.note}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              These six and <code className="font-mono">rounded-full</code> (circles only) are the whole scale.
            </p>
          </SubSection>

          <SubSection title="Shadows">
            <div className="flex flex-wrap gap-6">
              {SHADOWS.map((shadow) => (
                <div key={shadow.cls} className="flex w-32 flex-col items-center gap-1.5">
                  <div className={cn('h-16 w-24 rounded-lg bg-surface', shadow.cls)} />
                  <CopyableClass className={shadow.cls} />
                  <span className="text-center text-2xs text-text-soft">{shadow.note}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              These six are the whole scale; the Tailwind defaults in between are not tinted to match.
            </p>
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 4. SPACING                                                    */}
        {/* ============================================================ */}
        <Section id="spacing" title="Spacing">
          <SubSection title="Named sizes">
            <div className="space-y-3">
              {SPACING_TOKENS.map((space) => (
                <div key={space.cls} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="w-40 shrink-0">
                    <CopyableClass className={space.cls} />
                  </span>
                  <span className="w-12 shrink-0 font-mono text-xs text-text-muted">{values[space.token] ?? ''}</span>
                  <div className="h-5 rounded-sm bg-primary" style={{ width: `var(${space.token})` }} />
                  <span className="text-xs text-text-soft">{space.note}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection title="Scale">
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
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 5. ICONS                                                      */}
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
                <span className="text-2xs font-mono text-text-muted text-center leading-tight">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ============================================================ */}
        {/* 6. BUTTONS                                                    */}
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
        {/* 7. BADGES                                                     */}
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
        {/* 8. AVATARS                                                    */}
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
        {/* 9. ALERTS                                                     */}
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
        {/* 10. CARDS                                                     */}
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
        {/* 11. TABLES                                                   */}
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
        {/* 12. FORM CONTROLS                                            */}
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
        {/* 13. MODALS & DRAWERS                                         */}
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
        {/* 14. NAVIGATION                                               */}
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

          <SubSection title="SectionNav">
            <p className="text-sm text-text-muted mb-3">
              Moves between the sub-pages of a section. Links when items carry an href.
            </p>
            <SectionNav
              items={[
                { id: 'overview', label: 'Overview' },
                { id: 'details', label: 'Details', count: 3 },
                { id: 'history', label: 'History' },
              ]}
              activeId={section}
              onSelect={setSection}
            />
          </SubSection>

          <SubSection title="Tabs">
            <p className="text-sm text-text-muted mb-3">The one in-page tab style: a brand underline.</p>
            <Tabs
              tabs={[
                { id: 'all', label: 'All', count: 42 },
                { id: 'active', label: 'Active' },
                { id: 'archived', label: 'Archived' },
              ]}
              activeTab={tab}
              onTabChange={setTab}
            />
          </SubSection>

          <SubSection title="Segmented">
            <p className="text-sm text-text-muted mb-3">Switches between views of the same data.</p>
            <Segmented
              options={[
                { id: 'list', label: 'List' },
                { id: 'board', label: 'Board' },
              ]}
              value={view}
              onChange={setView}
            />
          </SubSection>
        </Section>

        {/* ============================================================ */}
        {/* 15. DATA DISPLAY                                             */}
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

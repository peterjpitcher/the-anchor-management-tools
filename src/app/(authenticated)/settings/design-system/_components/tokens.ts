/**
 * The tokens the design system reference page shows. Only names live here: every value on the
 * page is read from the live stylesheet (the `@theme static` block in src/app/globals.css), so
 * the page can never disagree with the app.
 */

/** A colour token (the name after `--color-`) and the utility prefixes it is used with. */
export interface ColourToken {
  name: string
  /** Utility prefixes, such as `bg` or `text`. Empty for tokens with no staff utility (chrome, guest). */
  usage: readonly string[]
  note?: string
}

/** A non-colour token: the CSS variable and, where one exists, the staff utility class. */
export interface ScaleToken {
  token: string
  cls?: string
  note?: string
}

export const NEUTRAL_COLOURS: readonly ColourToken[] = [
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

export const PRIMARY_COLOURS: readonly ColourToken[] = [
  { name: 'primary', usage: ['bg', 'text', 'border'], note: 'Buttons, links, active tabs' },
  { name: 'primary-hover', usage: ['hover:bg'] },
  { name: 'primary-soft', usage: ['bg'], note: 'Soft highlights' },
  { name: 'primary-soft-fg', usage: ['text'], note: 'Text on primary-soft' },
  { name: 'primary-fg', usage: ['text'], note: 'Text on primary' },
]

export const STATUSES = ['success', 'warning', 'danger', 'info'] as const

/** Each status comes as a set: the base for icons, dots and fills, then soft, fg and border. */
export const STATUS_SET: readonly { suffix: string; usage: string; note: string }[] = [
  { suffix: '', usage: 'bg', note: 'Icons, dots, fills' },
  { suffix: '-soft', usage: 'bg', note: 'Message background' },
  { suffix: '-fg', usage: 'text', note: 'Message text' },
  { suffix: '-border', usage: 'border', note: 'Message edge' },
]

export const ON_DARK_COLOURS: readonly ColourToken[] = [
  { name: 'on-dark', usage: ['text'] },
  { name: 'on-dark-muted', usage: ['text'] },
  { name: 'on-dark-subtle', usage: ['text'], note: 'Decoration only' },
  { name: 'on-dark-hover', usage: ['hover:bg'] },
  { name: 'on-dark-active', usage: ['bg'] },
  { name: 'on-dark-border', usage: ['border'] },
]

/**
 * The app chrome's own colours: the brand ramp and the sidebar set. Staff pages never use them
 * (the design-token guard's brand-ramp and sidebar rules), so no class is offered to copy.
 */
export const CHROME_COLOURS: readonly ColourToken[] = [
  ...['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((shade) => ({
    name: `brand-${shade}`,
    usage: [],
  })),
  { name: 'sidebar', usage: [], note: 'Sidebar background' },
  { name: 'sidebar-fg', usage: [] },
  { name: 'sidebar-fg-muted', usage: [] },
  { name: 'sidebar-active-bg', usage: [] },
  { name: 'sidebar-hover-bg', usage: [] },
  { name: 'sidebar-border', usage: [] },
]

export const CATEGORY_NAMES = ['Sky', 'Indigo', 'Violet', 'Pink', 'Orange', 'Amber', 'Teal', 'Stone'] as const
export const CHART_COUNT = 6
export const AVATAR_COUNT = 6

export const TYPE_SCALE: readonly ScaleToken[] = [
  { cls: 'text-2xs', token: '--text-2xs', note: 'The smallest size on any staff screen' },
  { cls: 'text-meta', token: '--text-meta', note: 'Meta lines and counts' },
  { cls: 'text-xs', token: '--text-xs', note: 'Labels, table headers, hints' },
  { cls: 'text-ui', token: '--text-ui', note: 'Table cells, dense controls' },
  { cls: 'text-sm', token: '--text-sm', note: 'Body text, card titles' },
  { cls: 'text-base', token: '--text-base', note: 'Section titles' },
  { cls: 'text-lg', token: '--text-lg', note: 'Page title on a phone' },
  { cls: 'text-xl', token: '--text-xl' },
  { cls: 'text-2xl', token: '--text-2xl', note: 'Page title' },
  { cls: 'text-3xl', token: '--text-3xl' },
]

export const FONTS: readonly ScaleToken[] = [
  { cls: 'font-sans', token: '--font-sans', note: 'Inter: everything on a staff screen' },
  { cls: 'font-mono', token: '--font-mono', note: 'JetBrains Mono: codes, references, class names' },
]

/** Radii by token. The class is derived on the page (`--radius-lg` is `rounded-lg`). */
export const RADII: readonly ScaleToken[] = [
  { token: '--radius-sm', note: 'Chips' },
  { token: '--radius-default', note: 'Buttons, fields, clickable rows' },
  { token: '--radius-md', note: '10px here, not Tailwind\'s 6px: the design system\'s own components only' },
  { token: '--radius-lg', note: 'Cards, panels, dialogs' },
  { token: '--radius-xl', note: 'Large panels' },
  { token: '--radius-pill', note: 'Badges, pills' },
]

export const SHADOWS: readonly ScaleToken[] = [
  { cls: 'shadow-xs', token: '--shadow-xs', note: 'Buttons' },
  { cls: 'shadow-sm', token: '--shadow-sm', note: 'Cards, tables' },
  { cls: 'shadow-default', token: '--shadow-default', note: 'Raised panels' },
  { cls: 'shadow-lg', token: '--shadow-lg', note: 'Dialogs, drawers, menus, toasts' },
  { cls: 'shadow-ring', token: '--shadow-ring', note: 'Focus ring' },
  { cls: 'shadow-ring-inset', token: '--shadow-ring-inset', note: 'Focus ring inside clipped containers' },
]

export const SIZE_TOKENS: readonly ScaleToken[] = [
  { cls: 'py-cell-y', token: '--spacing-cell-y', note: 'Table cell padding' },
  { cls: 'p-pad-card', token: '--spacing-pad-card', note: 'Card padding' },
  { cls: 'h-btn-h-sm', token: '--spacing-btn-h-sm', note: 'Small button (34px on a phone)' },
  { cls: 'h-btn-h', token: '--spacing-btn-h', note: 'Button (42px on a phone)' },
  { cls: 'h-input-h', token: '--spacing-input-h', note: 'Field (44px on a phone)' },
  { cls: 'h-btn-h-lg', token: '--spacing-btn-h-lg', note: 'Large button (48px on a phone)' },
  { cls: 'min-h-touch', token: '--spacing-touch', note: 'Touch target on the FOH, BOH and kiosk screens' },
]

/** The app shell's own measurements. PageLayout and AppShell use them; pages never do. */
export const SHELL_TOKENS: readonly ScaleToken[] = [
  { token: '--spacing-topbar', note: 'Top bar height' },
  { token: '--spacing-logo-row', note: 'Sidebar logo row' },
  { token: '--spacing-sidebar-collapsed', note: 'Sidebar, collapsed' },
  { token: '--spacing-sidebar-expanded', note: 'Sidebar, open' },
  { token: '--spacing-shell-pad-top', note: 'Top padding of the app shell <main>, from the shell breakpoint up' },
  { token: '--spacing-shell-pad-x', note: 'Side padding of the app shell <main>, from the shell breakpoint up' },
  { token: '--spacing-shell-pad-bottom', note: 'Bottom padding of the app shell <main>, from the shell breakpoint up' },
  { token: '--spacing-page-shell-pad-y', note: 'Top plus bottom padding, for a full-height page: calc(100dvh - this)' },
]

export const OTHER_TOKENS: readonly ScaleToken[] = [
  { token: '--breakpoint-shell', note: 'shell: and max-shell: switch here; SHELL_MEDIA_QUERY in JavaScript' },
  { token: '--ease-default', note: 'The one easing curve for transitions' },
]

/* ------------------------------------------------------------------ */
/*  Guest tokens: pages inside GuestShell only                         */
/* ------------------------------------------------------------------ */

export const GUEST_BRAND_COLOURS: readonly string[] = [
  'anchor-green', 'anchor-green-deep', 'anchor-green-light', 'anchor-gold', 'anchor-gold-dark',
  'anchor-gold-deep', 'anchor-gold-bright', 'anchor-cream', 'anchor-cream-text', 'anchor-charcoal',
  'anchor-grey-500', 'anchor-sand', 'anchor-success', 'anchor-danger',
]

export const GUEST_ROLE_COLOURS: readonly string[] = [
  'guest-bg', 'guest-surface', 'guest-sunk', 'guest-border', 'guest-border-strong', 'guest-text',
  'guest-text-strong', 'guest-text-muted', 'guest-accent-text', 'guest-button-text',
]

/** The guest tints, mixed from the brand colours in the stylesheet. */
export const GUEST_TINT_COLOURS: readonly string[] = [
  'guest-success-soft', 'guest-success-tint', 'guest-success-border', 'guest-notice-soft',
  'guest-notice-tint', 'guest-notice-border', 'guest-danger-soft', 'guest-danger-tint',
  'guest-danger-border', 'guest-danger-outline', 'guest-danger-hover', 'guest-brand-tint',
  'guest-hover', 'guest-on-dark-soft', 'guest-on-dark-muted', 'guest-on-dark-rule',
]

/** Guest type sizes, largest first. Each carries its own line height, and the display sizes their tracking. */
export const GUEST_TYPE: readonly { name: string; note: string; font: 'display' | 'body' | 'script' }[] = [
  { name: 'guest-amount-wide', note: 'Amount due, wide screens', font: 'display' },
  { name: 'guest-amount', note: 'Amount due', font: 'display' },
  { name: 'guest-h1-wide', note: 'Page title, wide screens', font: 'display' },
  { name: 'guest-script', note: 'Script line over a title', font: 'script' },
  { name: 'guest-h1', note: 'Page title', font: 'display' },
  { name: 'guest-figure', note: 'Figures', font: 'display' },
  { name: 'guest-h2', note: 'Card title', font: 'display' },
  { name: 'guest-large', note: 'Large text', font: 'body' },
  { name: 'guest-control', note: 'Fields and buttons', font: 'body' },
  { name: 'guest-lead', note: 'Lead paragraph', font: 'body' },
  { name: 'guest-body', note: 'Body text', font: 'body' },
  { name: 'guest-small', note: 'Small print', font: 'body' },
  { name: 'guest-note', note: 'Notes', font: 'body' },
  { name: 'guest-kicker', note: 'Kicker over a title (uppercase)', font: 'body' },
  { name: 'guest-label', note: 'Field labels (uppercase)', font: 'body' },
]

export const GUEST_SPACING: readonly ScaleToken[] = [
  { token: '--spacing-guest-3xs' },
  { token: '--spacing-guest-2xs' },
  { token: '--spacing-guest-xs' },
  { token: '--spacing-guest-sm' },
  { token: '--spacing-guest-md' },
  { token: '--spacing-guest-lg' },
  { token: '--spacing-guest-xl' },
  { token: '--spacing-guest-2xl' },
  { token: '--spacing-guest-3xl' },
  { token: '--spacing-guest-touch', note: 'Touch target' },
  { token: '--spacing-guest-control', note: 'Field and button height' },
  { token: '--spacing-guest-control-lg', note: 'Large button height' },
  { token: '--spacing-guest-logo', note: 'Logo width' },
]

export const GUEST_LEADING: readonly ScaleToken[] = [
  { token: '--leading-guest-flat', note: 'Labels and kickers' },
  { token: '--leading-guest-snug', note: 'Controls' },
  { token: '--leading-guest-body', note: 'Body and lead text' },
]

export const GUEST_TRACKING: readonly ScaleToken[] = [
  { token: '--tracking-guest-display', note: 'Display type (titles, figures, amounts)' },
  { token: '--tracking-guest-label', note: 'Field labels' },
  { token: '--tracking-guest-kicker', note: 'Kickers' },
]

export const GUEST_SHAPE: readonly ScaleToken[] = [
  { token: '--radius-guest-field', note: 'Fields and buttons' },
  { token: '--radius-guest-card', note: 'Cards' },
  { token: '--shadow-guest-card', note: 'Card shadow' },
  { token: '--shadow-guest-gold', note: 'Primary button shadow' },
  { token: '--shadow-guest-focus', note: 'Focus halo' },
  { token: '--container-guest', note: 'Page column' },
  { token: '--container-guest-wide', note: 'Wide page column' },
  { token: '--breakpoint-guest-narrow', note: 'Narrow phones' },
  // The three font aliases resolve only inside GuestShell (see the .guest-theme block in
  // globals.css), so their value reads empty on this staff page.
  { token: '--font-anchor-display', note: 'DM Serif Display: titles and figures. Set inside GuestShell only, so no value here' },
  { token: '--font-anchor-body', note: 'Outfit: body text. Set inside GuestShell only, so no value here' },
  { token: '--font-anchor-script', note: 'Clicker Script: the script line. Set inside GuestShell only, so no value here' },
]

/** The guest components (src/components/features/guest), for the list on the reference page. */
export const GUEST_COMPONENTS: readonly { name: string; note: string }[] = [
  { name: 'GuestShell', note: 'The page frame: the only <main>, the guest theme and the webfonts' },
  { name: 'GuestIntro', note: 'Kicker, script line, title and lead at the top of a page' },
  { name: 'GuestCard, GuestCardHeader', note: 'Panels and their titles' },
  { name: 'GuestSection', note: 'A ruled-off group lower down a page' },
  { name: 'GuestButton', note: 'Buttons and button-styled links: primary, outline, ghost, danger, destructive, link and choice' },
  { name: 'GuestAlert', note: 'Success, notice and problem messages' },
  { name: 'GuestBadge', note: 'Status badges (guestBadgeToneForStatus picks the tone)' },
  { name: 'GuestStatusMark', note: 'The large status icon at the top of a result page' },
  { name: 'GuestField', note: 'Label, hint and error around a control' },
  { name: 'GuestInput, GuestSelect, GuestTextarea', note: 'Form controls' },
  { name: 'GuestChoice', note: 'Radio and checkbox rows' },
  { name: 'GuestLink, GuestPhoneLink, GuestEmailLink, GuestHelpLine', note: 'Links and the help line' },
  { name: 'GuestAmount', note: 'An amount due or paid' },
  { name: 'DetailGrid, DetailRow', note: 'Label and value rows (date, time, party size)' },
  { name: 'TrustLine', note: 'The reassurance line under a payment control' },
  { name: 'GuestBlockedState', note: 'The shared unavailable, expired and throttled screen' },
  { name: 'GuestErrorBoundary', note: 'The error page inside a guest route' },
]

const guestColourVars = [...GUEST_BRAND_COLOURS, ...GUEST_ROLE_COLOURS, ...GUEST_TINT_COLOURS].map(
  (name) => `--color-${name}`,
)

const guestTypeVars = GUEST_TYPE.flatMap(({ name }) => [
  `--text-${name}`,
  `--text-${name}--line-height`,
  `--text-${name}--letter-spacing`,
])

/** Every token the page prints a value for; read from the live stylesheet, never copied here. */
export const LIVE_TOKENS: readonly string[] = [
  ...[...NEUTRAL_COLOURS, ...PRIMARY_COLOURS, ...ON_DARK_COLOURS, ...CHROME_COLOURS].map(
    (token) => `--color-${token.name}`,
  ),
  ...STATUSES.flatMap((status) => STATUS_SET.map(({ suffix }) => `--color-${status}${suffix}`)),
  ...CATEGORY_NAMES.flatMap((_, index) => ['', '-soft', '-fg'].map((suffix) => `--color-cat-${index + 1}${suffix}`)),
  ...Array.from({ length: CHART_COUNT }, (_, index) => `--color-chart-${index + 1}`),
  ...Array.from({ length: AVATAR_COUNT }, (_, index) => `--color-avatar-${index + 1}`),
  ...[
    ...TYPE_SCALE,
    ...FONTS,
    ...RADII,
    ...SHADOWS,
    ...SIZE_TOKENS,
    ...SHELL_TOKENS,
    ...OTHER_TOKENS,
    ...GUEST_SPACING,
    ...GUEST_LEADING,
    ...GUEST_TRACKING,
    ...GUEST_SHAPE,
  ].map((entry) => entry.token),
  ...guestColourVars,
  ...guestTypeVars,
]

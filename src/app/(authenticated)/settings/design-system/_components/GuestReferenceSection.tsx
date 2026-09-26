'use client'

import {
  Icon,
  LinkButton,
  Section,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'

import { MeasureTable, ReferenceCard, Swatch, SwatchRow, TableCard, TokenValue, ValueTable, useTokenValue } from './reference-ui'
import {
  GUEST_BRAND_COLOURS,
  GUEST_COMPONENTS,
  GUEST_LEADING,
  GUEST_ROLE_COLOURS,
  GUEST_SHAPE,
  GUEST_SPACING,
  GUEST_TINT_COLOURS,
  GUEST_TRACKING,
  GUEST_TYPE,
} from './tokens'

/*
 * The guest tokens may only be used as classes inside GuestShell (the design-token guard's
 * guest rule), so every sample here is painted with inline var() from the token name and no
 * guest class name is written in this file.
 */

/*
 * The guest font aliases resolve only on GuestShell's wrapper, which carries the webfont
 * variables. At :root they are invalid, so a bare var() here would fall back to the inherited
 * staff font (Inter). The generic family after the comma is the last entry of each alias's own
 * stack, so the samples show the right kind of face.
 */
const GUEST_FONT_VAR: Record<(typeof GUEST_TYPE)[number]['font'], string> = {
  display: 'var(--font-anchor-display, serif)',
  body: 'var(--font-anchor-body, sans-serif)',
  script: 'var(--font-anchor-script, cursive)',
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function GuestTypeRow({ entry }: { entry: (typeof GUEST_TYPE)[number] }): React.JSX.Element {
  const size = `--text-${entry.name}`
  const leading = `${size}--line-height`
  const tracking = `${size}--letter-spacing`
  const trackingValue = useTokenValue(tracking)
  const uppercase = entry.name === 'guest-label' || entry.name === 'guest-kicker'
  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-xs text-text">{size}</span>
        <p className="text-xs text-text-muted">{entry.note}</p>
      </TableCell>
      <TableCell>
        <span className="flex flex-col">
          <TokenValue token={size} />
          <TokenValue token={leading} />
          {trackingValue ? <TokenValue token={tracking} /> : null}
        </span>
      </TableCell>
      <TableCell>
        <span
          className="block text-text-strong"
          style={{
            fontSize: `var(${size})`,
            lineHeight: `var(${leading})`,
            letterSpacing: trackingValue ? `var(${tracking})` : undefined,
            fontFamily: GUEST_FONT_VAR[entry.font],
            textTransform: uppercase ? 'uppercase' : undefined,
          }}
        >
          {entry.font === 'script' ? 'The Anchor' : uppercase ? 'Party size' : 'Your table is booked'}
        </span>
      </TableCell>
    </TableRow>
  )
}

export function GuestReferenceSection(): React.JSX.Element {
  return (
    <Section
      id="guest"
      title="Guest Pages"
      description="The Anchor's guest pages have their own tokens and components, used only inside GuestShell. Staff screens never use them"
      className="scroll-mt-6"
    >
      <div className="space-y-6">
        <TableCard
          title="Guest Components"
          subtitle={
            IS_PRODUCTION
              ? 'src/components/features/guest. The live preview, /guest-preview, runs on a development server only: it returns 404 in production'
              : 'src/components/features/guest. The live preview, /guest-preview, runs here on a development server while signed in; it returns 404 in production'
          }
          action={
            IS_PRODUCTION ? undefined : (
              <LinkButton href="/guest-preview" size="sm" variant="secondary" iconRight={<Icon name="arrowRight" size={14} />}>
                Open Guest Preview
              </LinkButton>
            )
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Used For</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {GUEST_COMPONENTS.map((component) => (
                <TableRow key={component.name}>
                  <TableCell>
                    <span className="font-mono text-xs text-text">{component.name}</span>
                  </TableCell>
                  <TableCell className="text-text-muted">{component.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>

        <ReferenceCard title="Guest Colours" subtitle="The Anchor brand, the page roles, and the tints mixed from them">
          <SwatchRow>
            {GUEST_BRAND_COLOURS.map((name) => (
              <Swatch key={name} token={{ name, usage: [] }} />
            ))}
          </SwatchRow>
          <SwatchRow>
            {GUEST_ROLE_COLOURS.map((name) => (
              <Swatch key={name} token={{ name, usage: [] }} />
            ))}
          </SwatchRow>
          <SwatchRow>
            {GUEST_TINT_COLOURS.map((name) => (
              <Swatch key={name} token={{ name, usage: [] }} />
            ))}
          </SwatchRow>
        </ReferenceCard>

        <TableCard
          title="Guest Type"
          subtitle="Each size carries its line height, and the display sizes their tracking. The webfonts load only inside GuestShell, so these samples use each face's generic fallback (serif, sans-serif, cursive)"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Size, Leading, Tracking</TableHead>
                <TableHead>Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {GUEST_TYPE.map((entry) => (
                <GuestTypeRow key={entry.name} entry={entry} />
              ))}
            </TableBody>
          </Table>
        </TableCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <TableCard title="Guest Spacing" subtitle="The guest page rhythm, and the guest touch and control heights">
            <MeasureTable entries={GUEST_SPACING} />
          </TableCard>
          <TableCard title="Guest Leading and Tracking">
            <ValueTable entries={[...GUEST_LEADING, ...GUEST_TRACKING]} />
          </TableCard>
        </div>

        <TableCard title="Guest Shape, Width and Fonts">
          <ValueTable entries={GUEST_SHAPE} />
        </TableCard>
      </div>
    </Section>
  )
}

'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  SubHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  getToken,
  toast,
} from '@/ds'
import { cn } from '@/lib/utils'

import { LIVE_TOKENS, type ColourToken, type ScaleToken } from './tokens'

/* ------------------------------------------------------------------ */
/*  Live token values                                                  */
/* ------------------------------------------------------------------ */

const TokenValuesContext = createContext<Record<string, string>>({})

/**
 * Reads the computed value of every token the page shows from :root once the page has mounted,
 * so the numbers on the page always come from the live stylesheet. Tailwind's own sizes are in
 * rem, so those are shown in px like ours.
 */
export function TokenValuesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const inPx = (value: string): string => (/^[\d.]+rem$/.test(value) ? `${parseFloat(value) * rootPx}px` : value)
    setValues(Object.fromEntries(LIVE_TOKENS.map((name) => [name, inPx(getToken(name))])))
  }, [])
  return <TokenValuesContext.Provider value={values}>{children}</TokenValuesContext.Provider>
}

/** The live value of one token ('' until the page has read the stylesheet). */
export function useTokenValue(token: string): string {
  return useContext(TokenValuesContext)[token] ?? ''
}

/** A token's live value in small monospace. */
export function TokenValue({ token, className }: { token: string; className?: string }): React.JSX.Element {
  const value = useTokenValue(token)
  return <span className={cn('break-all font-mono text-2xs text-text-muted', className)}>{value}</span>
}

/* ------------------------------------------------------------------ */
/*  Building blocks                                                    */
/* ------------------------------------------------------------------ */

/** A class name that copies itself when pressed. */
export function CopyClass({ className }: { className: string }): React.JSX.Element {
  function handleCopy(): void {
    if (!navigator.clipboard) {
      toast.error('Copying is not available in this browser')
      return
    }
    navigator.clipboard
      .writeText(className)
      .then(() => toast.success(`Copied ${className}`))
      .catch(() => toast.error('Could not copy the class'))
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleCopy}
      aria-label={`Copy class ${className}`}
      className="bg-surface-2 font-mono font-normal text-text-muted"
    >
      {className}
    </Button>
  )
}

/** Code shown as a sample, in a sunk block that scrolls sideways when it is wide. */
export function CodeBlock({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="overflow-x-auto rounded-default border border-border bg-surface-2 p-3 font-mono text-xs text-text">
      <code>{code}</code>
    </pre>
  )
}

/** Inline code in running text. */
export function Code({ children }: { children: ReactNode }): React.JSX.Element {
  return <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs text-text">{children}</code>
}

/** A titled card: the h3 level of the page's heading ladder. */
export function ReferenceCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  )
}

/** A titled card holding a table: the table sits straight after the CardHeader, edge to edge. */
export function TableCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <Card padding="none">
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {children}
    </Card>
  )
}

/** One example inside a card: an h4 sub-heading, an optional note, then the live pieces. */
export function Example({
  title,
  note,
  children,
  stacked = false,
}: {
  title: string
  note?: ReactNode
  children: ReactNode
  /** Stack the pieces (fields, alerts) instead of wrapping them in a row. */
  stacked?: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <SubHeading>{title}</SubHeading>
      {note ? <p className="text-xs text-text-muted">{note}</p> : null}
      <div className={stacked ? 'space-y-3' : 'flex flex-wrap items-center gap-3'}>{children}</div>
    </div>
  )
}

/** Derives the Tailwind class for a colour token: `--color-text-muted` as a text colour is `text-text-muted`. */
function utilityClasses(name: string, prefixes: readonly string[]): string[] {
  return prefixes.map((prefix) => `${prefix}-${name}`)
}

/** One colour token: a swatch painted from the token itself, its classes and its live value. */
export function Swatch({ token, onDark = false }: { token: ColourToken; onDark?: boolean }): React.JSX.Element {
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
          {utilityClasses(token.name, token.usage).map((cls) => (
            <CopyClass key={cls} className={cls} />
          ))}
        </div>
      )}
      <TokenValue token={cssVar} className={cn('text-center', onDark && 'text-on-dark-muted')} />
      {token.note && (
        <span className={cn('text-center text-2xs', onDark ? 'text-on-dark-muted' : 'text-text-soft')}>
          {token.note}
        </span>
      )}
    </div>
  )
}

/** A row of swatches. */
export function SwatchRow({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <div className={cn('flex flex-wrap gap-3', className)}>{children}</div>
}

/* ------------------------------------------------------------------ */
/*  Measurements                                                       */
/* ------------------------------------------------------------------ */

function MeasureRow({ entry }: { entry: ScaleToken }): React.JSX.Element {
  return (
    <TableRow>
      <TableCell>{entry.cls ? <CopyClass className={entry.cls} /> : <span className="font-mono text-xs text-text">{entry.token}</span>}</TableCell>
      <TableCell>
        <TokenValue token={entry.token} />
      </TableCell>
      <TableCell>
        <div className="h-4 max-w-full rounded-sm bg-primary" style={{ width: `var(${entry.token})` }} />
      </TableCell>
      <TableCell className="text-text-muted">{entry.note}</TableCell>
    </TableRow>
  )
}

export function MeasureTable({ entries }: { entries: readonly ScaleToken[] }): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Token</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Used For</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <MeasureRow key={entry.token} entry={entry} />
        ))}
      </TableBody>
    </Table>
  )
}

/** Tokens with their live values and what they are for, for tokens that are not a length. */
export function ValueTable({ entries }: { entries: readonly ScaleToken[] }): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Token</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Used For</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.token}>
            <TableCell>
              <span className="font-mono text-xs text-text">{entry.token}</span>
            </TableCell>
            <TableCell>
              <TokenValue token={entry.token} />
            </TableCell>
            <TableCell className="text-text-muted">{entry.note}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

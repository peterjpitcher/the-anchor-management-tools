import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn knows the design tokens', () => {
  it('lets a later arbitrary shadow override shadow-ring (DS error halo)', () => {
    expect(cn('focus:shadow-ring', 'focus:shadow-[0_0_0_3px_red]')).toBe('focus:shadow-[0_0_0_3px_red]')
  })

  it('treats custom radii as radii', () => {
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('rounded-pill', 'rounded-md')).toBe('rounded-md')
    expect(cn('rounded-lg', 'rounded-default')).toBe('rounded-default')
  })

  it('treats custom shadows as shadows, not colours', () => {
    expect(cn('shadow-sm', 'shadow-default')).toBe('shadow-default')
    expect(cn('shadow-default', 'shadow-black/10')).toBe('shadow-default shadow-black/10')
  })

  it('treats custom spacing as spacing', () => {
    expect(cn('h-btn-h', 'h-9')).toBe('h-9')
    expect(cn('p-pad-card', 'p-4')).toBe('p-4')
    expect(cn('min-h-touch', 'min-h-10')).toBe('min-h-10')
  })

  it('treats custom text sizes as font sizes, not colours', () => {
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-danger')).toBe('text-ui text-danger')
    expect(cn('text-meta', 'text-text-muted')).toBe('text-meta text-text-muted')
    expect(cn('text-2xs', 'text-xs')).toBe('text-xs')
  })

  it('still merges colour tokens', () => {
    expect(cn('text-text-muted', 'text-danger')).toBe('text-danger')
    expect(cn('bg-surface', 'bg-primary')).toBe('bg-primary')
    expect(cn('border-border', 'border-danger-border')).toBe('border-danger-border')
  })
})

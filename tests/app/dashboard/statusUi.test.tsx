import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stat } from '@/ds'
import { attentionCountTone, revenueChangeTone } from '@/app/(authenticated)/dashboard/_shared/status-ui'

describe('dashboard figure tones', () => {
  it('colours a revenue change by its sign, and leaves "--" plain', () => {
    expect(revenueChangeTone('+4.2%')).toBe('success')
    expect(revenueChangeTone('+0.0%')).toBe('success')
    expect(revenueChangeTone('-3.0%')).toBe('danger')
    expect(revenueChangeTone('--')).toBe('default')
  })

  it('turns a count that needs someone amber once it is above zero', () => {
    expect(attentionCountTone(0)).toBe('default')
    expect(attentionCountTone(3)).toBe('warning')
  })

  it('puts the colour on the figure itself', () => {
    render(<Stat label="Week vs last" value="-3.0%" tone={revenueChangeTone('-3.0%')} />)
    expect(screen.getByText('-3.0%')).toHaveClass('text-danger-fg')
  })
})

// tests/components/schedule-calendar/ScheduleCalendar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleCalendar } from '@/components/schedule-calendar'

// Mock useMediaQuery to simulate mobile (always match max-width queries)
vi.mock('@/hooks/use-media-query', () => ({
    useMediaQuery: (q: string) => q.includes('max-width') && q.includes('639'),
}))

describe('ScheduleCalendar mobile', () => {
    it('renders list view on <640px regardless of selected view', () => {
        render(<ScheduleCalendar entries={[]} view="month" onViewChange={() => {}} />)
        // Mobile should render the list view landmark (Today heading)
        expect(screen.getByRole('heading', { name: /Today/ })).toBeInTheDocument()
    })

    it('hides the view switcher on mobile', () => {
        render(<ScheduleCalendar entries={[]} view="month" onViewChange={() => {}} />)
        expect(screen.queryByRole('button', { name: /^Month$/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Week$/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^List$/ })).not.toBeInTheDocument()
    })
})

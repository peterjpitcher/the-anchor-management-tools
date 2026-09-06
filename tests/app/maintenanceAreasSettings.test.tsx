import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/app/actions/maintenance-areas', () => ({
  listMaintenanceAreasForAdmin: vi.fn(),
  createMaintenanceArea: vi.fn(),
  renameMaintenanceArea: vi.fn(),
  reorderMaintenanceAreas: vi.fn(),
  setMaintenanceAreaActive: vi.fn(),
}))

import {
  createMaintenanceArea,
  listMaintenanceAreasForAdmin,
  renameMaintenanceArea,
  reorderMaintenanceAreas,
  setMaintenanceAreaActive,
} from '@/app/actions/maintenance-areas'
import MaintenanceAreasClient from '@/app/(authenticated)/settings/maintenance/MaintenanceAreasClient'
import { AREA_DUPLICATE_NAME_MESSAGE } from '@/lib/maintenance/areas'
import type { MaintenanceArea } from '@/types/maintenance'

const mockedList = listMaintenanceAreasForAdmin as unknown as Mock
const mockedCreate = createMaintenanceArea as unknown as Mock
const mockedRename = renameMaintenanceArea as unknown as Mock
const mockedReorder = reorderMaintenanceAreas as unknown as Mock
const mockedSetActive = setMaintenanceAreaActive as unknown as Mock

const BAR_ID = '11111111-1111-1111-1111-111111111111'
const CELLAR_ID = '22222222-2222-2222-2222-222222222222'

function area(id: string, name: string, sortOrder: number, active = true): MaintenanceArea {
  return {
    id,
    name,
    sortOrder,
    active,
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-01T09:00:00Z',
  }
}

const AREAS = [area(BAR_ID, 'Main Bar', 10), area(CELLAR_ID, 'Cellar', 20)]

beforeEach(() => {
  vi.clearAllMocks()
  mockedList.mockResolvedValue({ success: true, data: AREAS })
})

describe('the maintenance areas settings screen', () => {
  it('lists every area, and says what an area that is off still does', () => {
    render(<MaintenanceAreasClient initialAreas={[...AREAS, area('33', 'Old Snug', 30, false)]} initialError={null} />)

    expect(screen.getByText('Main Bar')).toBeInTheDocument()
    expect(screen.getByText('Old Snug')).toBeInTheDocument()
    // State in words, not by colour alone.
    expect(screen.getByText('Off, existing items only')).toBeInTheDocument()
  })

  it('offers no way to delete an area', () => {
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Turn off' })).toHaveLength(2)
  })

  it('shows the duplicate name message rather than a constraint error', async () => {
    mockedCreate.mockResolvedValue({ success: false, error: AREA_DUPLICATE_NAME_MESSAGE })
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    await userEvent.type(screen.getByLabelText('Area name'), 'main   BAR')
    await userEvent.click(screen.getByRole('button', { name: 'Add area' }))

    await waitFor(() => {
      expect(screen.getByText(AREA_DUPLICATE_NAME_MESSAGE)).toBeInTheDocument()
    })
    expect(mockedCreate).toHaveBeenCalledWith({ name: 'main   BAR' })
  })

  it('warns that a rename changes what existing items display', async () => {
    mockedRename.mockResolvedValue({ success: true, data: area(BAR_ID, 'Front Bar', 10) })
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0])
    const field = screen.getByLabelText('Rename Main Bar')
    await userEvent.clear(field)
    await userEvent.type(field, 'Front Bar')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/Existing items now show the new name/)).toBeInTheDocument()
    })
  })

  it('says what turning an area off does and does not do', async () => {
    mockedSetActive.mockResolvedValue({ success: true, data: area(BAR_ID, 'Main Bar', 10, false) })
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Turn off' })[0])

    await waitFor(() => {
      expect(mockedSetActive).toHaveBeenCalledWith({ id: BAR_ID, active: false })
    })
    expect(
      screen.getByText(/Existing items keep it and stay filterable by it/),
    ).toBeInTheDocument()
  })

  it('sends the whole running order when an area is moved', async () => {
    mockedReorder.mockResolvedValue({ success: true, data: [AREAS[1], AREAS[0]] })
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Move down Main Bar' }))

    await waitFor(() => {
      expect(mockedReorder).toHaveBeenCalledWith({ orderedIds: [CELLAR_ID, BAR_ID] })
    })
  })

  it('surfaces a failure from the server rather than swallowing it', async () => {
    mockedSetActive.mockResolvedValue({ success: false, error: 'Insufficient permissions' })
    render(<MaintenanceAreasClient initialAreas={AREAS} initialError={null} />)

    await userEvent.click(screen.getAllByRole('button', { name: 'Turn off' })[0])

    await waitFor(() => {
      expect(screen.getByText('Insufficient permissions')).toBeInTheDocument()
    })
  })

  it('shows a load failure passed down from the server', () => {
    render(<MaintenanceAreasClient initialAreas={[]} initialError="Could not load the areas." />)

    expect(screen.getByText('Could not load the areas.')).toBeInTheDocument()
  })
})

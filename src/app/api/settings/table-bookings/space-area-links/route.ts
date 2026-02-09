import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'

const ReplaceSpaceAreaLinksSchema = z.object({
  space_area_links: z.array(
    z.object({
      venue_space_id: z.string().uuid(),
      table_area_id: z.string().uuid()
    })
  )
})

type SpaceAreaLink = {
  venue_space_id: string
  table_area_id: string
}

function toPairKey(input: SpaceAreaLink): string {
  return `${input.venue_space_id}:${input.table_area_id}`
}

async function loadSpaceAreaLinkData(supabase: any) {
  const [spaceResult, areaResult, linkResult] = await Promise.all([
    (supabase.from('venue_spaces') as any)
      .select('id, name, active')
      .order('name', { ascending: true }),
    (supabase.from('table_areas') as any)
      .select('id, name')
      .order('name', { ascending: true }),
    (supabase.from('venue_space_table_areas') as any)
      .select('venue_space_id, table_area_id')
      .order('venue_space_id', { ascending: true })
      .order('table_area_id', { ascending: true })
  ])

  if (spaceResult.error) {
    throw new Error('Failed to load private-booking spaces')
  }

  if (areaResult.error) {
    throw new Error('Failed to load table areas')
  }

  if (linkResult.error) {
    throw new Error('Failed to load space-area links')
  }

  return {
    venue_spaces: (spaceResult.data || []) as any[],
    areas: (areaResult.data || []) as any[],
    space_area_links: (linkResult.data || []) as any[]
  }
}

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  try {
    const data = await loadSpaceAreaLinkData(auth.supabase)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load private-booking space mappings'
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ReplaceSpaceAreaLinksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid space-area payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const desiredMap = new Map<string, SpaceAreaLink>()
  for (const row of parsed.data.space_area_links) {
    const key = toPairKey(row)
    desiredMap.set(key, row)
  }

  const desiredRows = Array.from(desiredMap.values())
  const desiredSpaceIds = new Set(desiredRows.map((row) => row.venue_space_id))
  const desiredAreaIds = new Set(desiredRows.map((row) => row.table_area_id))

  if (desiredSpaceIds.size > 0) {
    const { data: spaces, error: spaceError } = await (auth.supabase.from('venue_spaces') as any)
      .select('id')
      .in('id', Array.from(desiredSpaceIds))

    if (spaceError) {
      return NextResponse.json({ error: 'Failed to validate private-booking spaces' }, { status: 500 })
    }

    const knownIds = new Set(((spaces || []) as any[]).map((row) => row.id as string))
    const unknownSpace = Array.from(desiredSpaceIds).find((id) => !knownIds.has(id))
    if (unknownSpace) {
      return NextResponse.json(
        { error: `Unknown private-booking space: ${unknownSpace}` },
        { status: 400 }
      )
    }
  }

  if (desiredAreaIds.size > 0) {
    const { data: areas, error: areaError } = await (auth.supabase.from('table_areas') as any)
      .select('id')
      .in('id', Array.from(desiredAreaIds))

    if (areaError) {
      return NextResponse.json({ error: 'Failed to validate table areas' }, { status: 500 })
    }

    const knownIds = new Set(((areas || []) as any[]).map((row) => row.id as string))
    const unknownArea = Array.from(desiredAreaIds).find((id) => !knownIds.has(id))
    if (unknownArea) {
      return NextResponse.json(
        { error: `Unknown table area: ${unknownArea}` },
        { status: 400 }
      )
    }
  }

  const { data: existingRows, error: existingError } = await (auth.supabase.from('venue_space_table_areas') as any)
    .select('venue_space_id, table_area_id')

  if (existingError) {
    return NextResponse.json({ error: 'Failed to load current space-area links' }, { status: 500 })
  }

  const existingMap = new Map<string, SpaceAreaLink>()
  for (const row of (existingRows || []) as any[]) {
    const pair: SpaceAreaLink = {
      venue_space_id: row.venue_space_id,
      table_area_id: row.table_area_id
    }
    existingMap.set(toPairKey(pair), pair)
  }

  const toInsert = desiredRows.filter((row) => !existingMap.has(toPairKey(row)))
  const toDelete = Array.from(existingMap.values()).filter((row) => !desiredMap.has(toPairKey(row)))

  if (toInsert.length > 0) {
    const { error: insertError } = await (auth.supabase.from('venue_space_table_areas') as any)
      .insert(
        toInsert.map((row) => ({
          venue_space_id: row.venue_space_id,
          table_area_id: row.table_area_id
        }))
      )

    if (insertError) {
      return NextResponse.json({ error: 'Failed to create space-area links' }, { status: 500 })
    }
  }

  for (const row of toDelete) {
    const { error: deleteError } = await (auth.supabase.from('venue_space_table_areas') as any)
      .delete()
      .eq('venue_space_id', row.venue_space_id)
      .eq('table_area_id', row.table_area_id)

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to remove space-area links' }, { status: 500 })
    }
  }

  try {
    const data = await loadSpaceAreaLinkData(auth.supabase)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to refresh private-booking space mappings'
      },
      { status: 500 }
    )
  }
}

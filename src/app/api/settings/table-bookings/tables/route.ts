import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'

const CreateTableSchema = z.object({
  name: z.string().trim().min(1).max(80),
  table_number: z.string().trim().min(1).max(40),
  capacity: z.number().int().min(1).max(100),
  area_id: z.string().uuid().optional().nullable(),
  area: z.string().trim().max(80).optional().nullable(),
  is_bookable: z.boolean().optional()
})

const UpdateTableSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    table_number: z.string().trim().min(1).max(40).optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    area_id: z.string().uuid().optional().nullable(),
    area: z.string().trim().max(80).optional().nullable(),
    is_bookable: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.table_number !== undefined ||
      value.capacity !== undefined ||
      value.area_id !== undefined ||
      value.area !== undefined ||
      value.is_bookable !== undefined,
    {
      message: 'No table fields supplied for update'
    }
  )

const ReplaceJoinLinksSchema = z.object({
  join_links: z.array(
    z.object({
      table_id: z.string().uuid(),
      join_table_id: z.string().uuid()
    })
  )
})

type CanonicalJoinLink = {
  table_id: string
  join_table_id: string
}

function normalizeAreaName(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized : null
}

async function resolveTableAreaSelection(
  supabase: any,
  input: {
    areaId?: string | null
    areaName?: string | null
  }
): Promise<{ areaId: string | null; areaName: string | null; error?: string }> {
  if (input.areaId) {
    const { data, error } = await (supabase.from('table_areas') as any)
      .select('id, name')
      .eq('id', input.areaId)
      .maybeSingle()

    if (error) {
      return { areaId: null, areaName: null, error: 'Failed to resolve table area' }
    }

    if (!data) {
      return { areaId: null, areaName: null, error: 'Selected table area was not found' }
    }

    return {
      areaId: data.id,
      areaName: data.name || null
    }
  }

  const areaName = normalizeAreaName(input.areaName)
  if (!areaName) {
    return { areaId: null, areaName: null }
  }

  const normalizedName = areaName.toLowerCase()
  const { data, error } = await (supabase.from('table_areas') as any)
    .upsert(
      {
        name: areaName,
        normalized_name: normalizedName
      },
      { onConflict: 'normalized_name' }
    )
    .select('id, name')
    .maybeSingle()

  if (error || !data) {
    return { areaId: null, areaName: null, error: 'Failed to save table area' }
  }

  return {
    areaId: data.id,
    areaName: data.name || areaName
  }
}

function canonicalizeJoinLink(input: CanonicalJoinLink): CanonicalJoinLink | null {
  if (input.table_id === input.join_table_id) {
    return null
  }

  return input.table_id < input.join_table_id
    ? input
    : {
        table_id: input.join_table_id,
        join_table_id: input.table_id
      }
}

async function loadTableSetupData(supabase: any) {
  const [tablesResult, linksResult, areasResult] = await Promise.all([
    (supabase.from('tables') as any)
      .select('id, name, table_number, capacity, area, area_id, is_bookable')
      .order('table_number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false }),
    (supabase.from('table_join_links') as any)
      .select('table_id, join_table_id')
      .order('table_id', { ascending: true })
      .order('join_table_id', { ascending: true }),
    (supabase.from('table_areas') as any)
      .select('id, name')
      .order('name', { ascending: true })
  ])

  if (tablesResult.error) {
    throw new Error('Failed to load tables')
  }

  if (linksResult.error) {
    throw new Error('Failed to load table join links')
  }

  if (areasResult.error) {
    throw new Error('Failed to load table areas')
  }

  return {
    tables: (tablesResult.data || []) as any[],
    join_links: (linksResult.data || []) as any[],
    areas: (areasResult.data || []) as any[]
  }
}

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) {
    return auth.response
  }

  try {
    const data = await loadTableSetupData(auth.supabase)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Failed to load table setup', error)
    return NextResponse.json(
      { error: 'Failed to load table setup' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

  const parsed = CreateTableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid table payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const resolvedArea = await resolveTableAreaSelection(auth.supabase, {
    areaId: payload.area_id ?? null,
    areaName: payload.area ?? null
  })

  if (resolvedArea.error) {
    return NextResponse.json({ error: resolvedArea.error }, { status: 400 })
  }

  const { data: inserted, error } = await (auth.supabase.from('tables') as any)
    .insert({
      name: payload.name,
      table_number: payload.table_number,
      capacity: payload.capacity,
      area_id: resolvedArea.areaId,
      area: resolvedArea.areaName,
      is_bookable: payload.is_bookable ?? true
    })
    .select('id, name, table_number, capacity, area, area_id, is_bookable')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to create table' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: inserted }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
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

  const parsed = UpdateTableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid table update payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const updateData: Record<string, unknown> = {}

  if (payload.name !== undefined) {
    updateData.name = payload.name
  }
  if (payload.table_number !== undefined) {
    updateData.table_number = payload.table_number
  }
  if (payload.capacity !== undefined) {
    updateData.capacity = payload.capacity
  }
  if (payload.area !== undefined || payload.area_id !== undefined) {
    const resolvedArea = await resolveTableAreaSelection(auth.supabase, {
      areaId: payload.area_id ?? null,
      areaName: payload.area ?? null
    })

    if (resolvedArea.error) {
      return NextResponse.json({ error: resolvedArea.error }, { status: 400 })
    }

    updateData.area_id = resolvedArea.areaId
    updateData.area = resolvedArea.areaName
  }
  if (payload.is_bookable !== undefined) {
    updateData.is_bookable = payload.is_bookable
  }

  const { data: updated, error } = await (auth.supabase.from('tables') as any)
    .update(updateData)
    .eq('id', payload.id)
    .select('id, name, table_number, capacity, area, area_id, is_bookable')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to update table' }, { status: 500 })
  }

  if (!updated) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: updated })
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

  const parsed = ReplaceJoinLinksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid join-link payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const canonicalMap = new Map<string, CanonicalJoinLink>()
  for (const row of parsed.data.join_links) {
    const canonical = canonicalizeJoinLink({
      table_id: row.table_id,
      join_table_id: row.join_table_id
    })

    if (!canonical) {
      continue
    }

    canonicalMap.set(`${canonical.table_id}:${canonical.join_table_id}`, canonical)
  }

  const desiredLinks = Array.from(canonicalMap.values())
  const desiredTableIds = new Set<string>()
  for (const link of desiredLinks) {
    desiredTableIds.add(link.table_id)
    desiredTableIds.add(link.join_table_id)
  }

  if (desiredTableIds.size > 0) {
    const { data: tableRows, error: tableLookupError } = await (auth.supabase.from('tables') as any)
      .select('id')
      .in('id', Array.from(desiredTableIds))

    if (tableLookupError) {
      return NextResponse.json({ error: 'Failed to validate join links' }, { status: 500 })
    }

    const existingIds = new Set(((tableRows || []) as any[]).map((row) => row.id as string))
    const unknownId = Array.from(desiredTableIds).find((id) => !existingIds.has(id))

    if (unknownId) {
      return NextResponse.json(
        { error: `Join link references unknown table: ${unknownId}` },
        { status: 400 }
      )
    }
  }

  const { data: existingRows, error: existingError } = await (auth.supabase.from('table_join_links') as any)
    .select('table_id, join_table_id')

  if (existingError) {
    return NextResponse.json({ error: 'Failed to load current join links' }, { status: 500 })
  }

  const existingMap = new Map<string, CanonicalJoinLink>()
  for (const row of (existingRows || []) as any[]) {
    const canonical = canonicalizeJoinLink({
      table_id: row.table_id,
      join_table_id: row.join_table_id
    })
    if (!canonical) continue
    existingMap.set(`${canonical.table_id}:${canonical.join_table_id}`, canonical)
  }

  const toInsert = desiredLinks.filter(
    (row) => !existingMap.has(`${row.table_id}:${row.join_table_id}`)
  )
  const toDelete = Array.from(existingMap.values()).filter(
    (row) => !canonicalMap.has(`${row.table_id}:${row.join_table_id}`)
  )

  if (toInsert.length > 0) {
    const { error: insertError } = await (auth.supabase.from('table_join_links') as any)
      .insert(
        toInsert.map((row) => ({
          table_id: row.table_id,
          join_table_id: row.join_table_id,
          created_by: auth.userId
        }))
      )

    if (insertError) {
      return NextResponse.json({ error: 'Failed to create join links' }, { status: 500 })
    }
  }

  for (const row of toDelete) {
    const { error: deleteError } = await (auth.supabase.from('table_join_links') as any)
      .delete()
      .eq('table_id', row.table_id)
      .eq('join_table_id', row.join_table_id)

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to remove join links' }, { status: 500 })
    }
  }

  try {
    const data = await loadTableSetupData(auth.supabase)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Failed to refresh table setup after join-link update', error)
    return NextResponse.json(
      { error: 'Failed to refresh table setup' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'

const SaveGroupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Group name is required').max(80),
  table_ids: z.array(z.string().uuid()),
})

const DeleteGroupSchema = z.object({
  id: z.string().uuid(),
})

type Pair = { table_id: string; join_table_id: string }

function canonicalizePair(a: string, b: string): Pair {
  return a < b ? { table_id: a, join_table_id: b } : { table_id: b, join_table_id: a }
}

async function recomputeJoinLinks(supabase: any) {
  // Load all group members
  const { data: allMembers, error: membersError } = await supabase
    .from('table_join_group_members')
    .select('group_id, table_id')

  if (membersError) throw new Error('Failed to load group members')

  // Compute desired pairs from all groups
  const byGroup = new Map<string, string[]>()
  for (const m of allMembers ?? []) {
    if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, [])
    byGroup.get(m.group_id)!.push(m.table_id as string)
  }

  const desiredMap = new Map<string, Pair>()
  for (const tableIds of byGroup.values()) {
    for (let i = 0; i < tableIds.length; i++) {
      for (let j = i + 1; j < tableIds.length; j++) {
        const pair = canonicalizePair(tableIds[i], tableIds[j])
        desiredMap.set(`${pair.table_id}:${pair.join_table_id}`, pair)
      }
    }
  }

  // Load current join links
  const { data: currentLinks } = await supabase
    .from('table_join_links')
    .select('table_id, join_table_id')

  const currentMap = new Map<string, Pair>()
  for (const row of currentLinks ?? []) {
    const pair = canonicalizePair(row.table_id as string, row.join_table_id as string)
    currentMap.set(`${pair.table_id}:${pair.join_table_id}`, pair)
  }

  // Diff and apply
  const toInsert = Array.from(desiredMap.values()).filter(
    (p) => !currentMap.has(`${p.table_id}:${p.join_table_id}`)
  )
  const toDelete = Array.from(currentMap.values()).filter(
    (p) => !desiredMap.has(`${p.table_id}:${p.join_table_id}`)
  )

  if (toDelete.length > 0) {
    const orFilter = toDelete
      .map((r) => `and(table_id.eq.${r.table_id},join_table_id.eq.${r.join_table_id})`)
      .join(',')
    const { error } = await supabase.from('table_join_links').delete().or(orFilter)
    if (error) throw new Error('Failed to remove stale join links')
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('table_join_links').insert(toInsert)
    if (error) throw new Error('Failed to insert new join links')
  }
}

async function loadGroups(supabase: any) {
  const { data, error } = await supabase
    .from('table_join_groups')
    .select('id, name, table_join_group_members(table_id)')
    .order('name', { ascending: true })

  if (error) throw new Error('Failed to load join groups')

  return (data ?? []).map((g: any) => ({
    id: g.id as string,
    name: g.name as string,
    table_ids: ((g.table_join_group_members ?? []) as any[]).map((m) => m.table_id as string),
  }))
}

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  try {
    const groups = await loadGroups(auth.supabase)
    return NextResponse.json({ success: true, data: { groups } })
  } catch (error) {
    console.error('Failed to load join groups', error)
    return NextResponse.json({ error: 'Failed to load join groups' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SaveGroupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    )
  }

  const { name, table_ids } = parsed.data

  const { data: group, error: groupError } = await auth.supabase
    .from('table_join_groups')
    .insert({ name })
    .select('id')
    .single()

  if (groupError) {
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }

  if (table_ids.length > 0) {
    const { error: membersError } = await auth.supabase
      .from('table_join_group_members')
      .insert(table_ids.map((table_id) => ({ group_id: group.id, table_id })))

    if (membersError) {
      return NextResponse.json({ error: 'Failed to add group members' }, { status: 500 })
    }
  }

  try {
    await recomputeJoinLinks(auth.supabase)
    const groups = await loadGroups(auth.supabase)
    return NextResponse.json({ success: true, data: { groups } }, { status: 201 })
  } catch (error) {
    console.error('Failed to recompute join links', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SaveGroupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    )
  }

  const { id, name, table_ids } = parsed.data
  if (!id) {
    return NextResponse.json({ error: 'Group id is required for update' }, { status: 400 })
  }

  const { error: updateError } = await auth.supabase
    .from('table_join_groups')
    .update({ name })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 })
  }

  // Replace members
  await auth.supabase.from('table_join_group_members').delete().eq('group_id', id)

  if (table_ids.length > 0) {
    const { error: membersError } = await auth.supabase
      .from('table_join_group_members')
      .insert(table_ids.map((table_id) => ({ group_id: id, table_id })))

    if (membersError) {
      return NextResponse.json({ error: 'Failed to update group members' }, { status: 500 })
    }
  }

  try {
    await recomputeJoinLinks(auth.supabase)
    const groups = await loadGroups(auth.supabase)
    return NextResponse.json({ success: true, data: { groups } })
  } catch (error) {
    console.error('Failed to recompute join links', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = DeleteGroupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid group id' }, { status: 400 })
  }

  const { error } = await auth.supabase
    .from('table_join_groups')
    .delete()
    .eq('id', parsed.data.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 })
  }

  try {
    await recomputeJoinLinks(auth.supabase)
    const groups = await loadGroups(auth.supabase)
    return NextResponse.json({ success: true, data: { groups } })
  } catch (error) {
    console.error('Failed to recompute join links', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

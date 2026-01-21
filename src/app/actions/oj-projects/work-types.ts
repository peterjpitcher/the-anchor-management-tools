'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

const WorkTypeSchema = z.object({
  name: z.string().min(1, 'Work type name is required').max(80, 'Work type name is too long'),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
  is_active: z.coerce.boolean().optional(),
})

export async function getWorkTypes() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view work types' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_work_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { error: error.message }
  return { workTypes: data || [] }
}

export async function createWorkType(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create work types' }

  const parsed = WorkTypeSchema.safeParse({
    name: formData.get('name'),
    sort_order: formData.get('sort_order') ?? undefined,
    is_active: formData.get('is_active') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_work_types')
    .insert({
      name: parsed.data.name,
      sort_order: parsed.data.sort_order ?? 0,
      is_active: parsed.data.is_active ?? true,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { workType: data, success: true as const }
}

export async function updateWorkType(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit work types' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Work type ID is required' }

  const parsed = WorkTypeSchema.safeParse({
    name: formData.get('name'),
    sort_order: formData.get('sort_order') ?? undefined,
    is_active: formData.get('is_active') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_work_types')
    .update({
      name: parsed.data.name,
      sort_order: parsed.data.sort_order ?? 0,
      is_active: parsed.data.is_active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { workType: data, success: true as const }
}

export async function disableWorkType(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit work types' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Work type ID is required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('oj_work_types')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { error: error.message }
  return { success: true as const }
}


'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'
import crypto from 'crypto'

const CreateProjectSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_name: z.string().min(1, 'Project name is required').max(200),
  brief: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  deadline: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid deadline date'),
  budget_ex_vat: z.coerce.number().min(0).optional(),
  budget_hours: z.coerce.number().min(0).optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived'] as const).optional(),
})

const UpdateProjectSchema = CreateProjectSchema.extend({
  id: z.string().uuid('Invalid project ID'),
})

function deriveClientCode(vendorName: string) {
  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
  const tokens = String(vendorName || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((t) => t.toUpperCase())
    .filter((t) => !stopWords.has(t))

  if (tokens.length === 0) {
    return 'CLIENT'
  }

  const initials = tokens.slice(0, 3).map((t) => t[0]).join('')
  if (initials.length >= 3) return initials
  return tokens[0].slice(0, 3)
}

function randomSuffix(length = 5) {
  while (true) {
    const raw = crypto.randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (raw.length >= length) return raw.slice(0, length)
  }
}

async function generateProjectCode(supabase: Awaited<ReturnType<typeof createClient>>, vendorId: string) {
  let clientCode: string | null = null
  try {
    const { data: settings } = await supabase
      .from('oj_vendor_billing_settings')
      .select('client_code')
      .eq('vendor_id', vendorId)
      .maybeSingle()
    if (settings?.client_code) {
      clientCode = String(settings.client_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null
    }
  } catch { }

  if (!clientCode) {
    const { data: vendor } = await supabase
      .from('invoice_vendors')
      .select('name')
      .eq('id', vendorId)
      .maybeSingle()
    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
  }

  for (let i = 0; i < 10; i++) {
    const code = `OJP-${clientCode}-${randomSuffix(5)}`
    const { data: existing } = await supabase
      .from('oj_projects')
      .select('id')
      .eq('project_code', code)
      .maybeSingle()
    if (!existing) return code
  }

  return `OJP-${clientCode}-${randomSuffix(8)}`
}

export async function getProjects(options?: { vendorId?: string; status?: string }) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view projects' }

  const supabase = await createClient()
  let query = supabase
    .from('oj_projects')
    .select(`
      *,
      vendor:invoice_vendors(
        id,
        name
      )
    `)
    .order('created_at', { ascending: false })

  if (options?.vendorId) {
    query = query.eq('vendor_id', options.vendorId)
  }
  if (options?.status && options.status !== 'all') {
    query = query.eq('status', options.status)
  }

  const { data, error } = await query
  if (error) return { error: error.message }

  // Fetch stats for these projects
  const projectIds = data?.map(p => p.id) || []
  const statsMap = new Map<string, any>()

  if (projectIds.length > 0) {
    const { data: stats } = await supabase
      .from('oj_project_stats')
      .select('*')
      .in('project_id', projectIds)

    if (stats) {
      stats.forEach(s => statsMap.set(s.project_id, s))
    }
  }

  const projectsWithStats = data?.map(p => ({
    ...p,
    total_hours_used: statsMap.get(p.id)?.total_hours_used || 0,
    total_spend_ex_vat: statsMap.get(p.id)?.total_spend_ex_vat || 0
  }))

  return { projects: projectsWithStats || [] }
}

export async function getProject(projectId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view projects' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_projects')
    .select(`
      *,
      vendor:invoice_vendors(*),
      contacts:oj_project_contacts(
        id,
        contact:invoice_vendor_contacts(*)
      )
    `)
    .eq('id', projectId)
    .single()

  if (error) return { error: error.message }
  return { project: data }
}

export async function createProject(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create projects' }

  const parsed = CreateProjectSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_name: formData.get('project_name'),
    brief: formData.get('brief') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    deadline: formData.get('deadline') || undefined,
    budget_ex_vat: formData.get('budget_ex_vat') || undefined,
    budget_hours: formData.get('budget_hours') || undefined,
    status: formData.get('status') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const projectCode = await generateProjectCode(supabase, parsed.data.vendor_id)

  const { data, error } = await supabase
    .from('oj_projects')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_code: projectCode,
      project_name: parsed.data.project_name,
      brief: parsed.data.brief || null,
      internal_notes: parsed.data.internal_notes || null,
      deadline: parsed.data.deadline ? parsed.data.deadline : null,
      budget_ex_vat: typeof parsed.data.budget_ex_vat === 'number' ? parsed.data.budget_ex_vat : null,
      budget_hours: typeof parsed.data.budget_hours === 'number' ? parsed.data.budget_hours : null,
      status: parsed.data.status ?? 'active',
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { project: data, success: true as const }
}

export async function updateProject(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit projects' }

  const parsed = UpdateProjectSchema.safeParse({
    id: formData.get('id'),
    vendor_id: formData.get('vendor_id'),
    project_name: formData.get('project_name'),
    brief: formData.get('brief') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    deadline: formData.get('deadline') || undefined,
    budget_ex_vat: formData.get('budget_ex_vat') || undefined,
    budget_hours: formData.get('budget_hours') || undefined,
    status: formData.get('status') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_projects')
    .update({
      vendor_id: parsed.data.vendor_id,
      project_name: parsed.data.project_name,
      brief: parsed.data.brief || null,
      internal_notes: parsed.data.internal_notes || null,
      deadline: parsed.data.deadline ? parsed.data.deadline : null,
      budget_ex_vat: typeof parsed.data.budget_ex_vat === 'number' ? parsed.data.budget_ex_vat : null,
      budget_hours: typeof parsed.data.budget_hours === 'number' ? parsed.data.budget_hours : null,
      status: parsed.data.status ?? 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { project: data, success: true as const }
}

export async function deleteProject(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'delete')
  if (!hasPermission) return { error: 'You do not have permission to delete projects' }

  const projectId = String(formData.get('id') || '')
  if (!projectId) return { error: 'Project ID is required' }

  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('oj_entries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)

  if (countError) return { error: countError.message }
  if ((count ?? 0) > 0) {
    return { error: 'Cannot delete a project with entries. Archive it instead.' }
  }

  const { error } = await supabase
    .from('oj_projects')
    .delete()
    .eq('id', projectId)

  if (error) return { error: error.message }
  return { success: true as const }
}

export async function updateProjectStatus(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit projects' }

  const id = String(formData.get('id') || '')
  const status = String(formData.get('status') || '')

  if (!id) return { error: 'Project ID is required' }
  if (!['active', 'paused', 'completed', 'archived'].includes(status)) {
    return { error: 'Invalid status' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('oj_projects')
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (error) return { error: error.message }
  return { success: true as const }
}

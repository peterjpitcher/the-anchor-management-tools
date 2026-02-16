'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

const ProjectContactSchema = z.object({
  project_id: z.string().uuid('Invalid project ID'),
  contact_id: z.string().uuid('Invalid contact ID'),
})

export async function getProjectContacts(projectId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view project contacts' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_project_contacts')
    .select(`
      *,
      contact:invoice_vendor_contacts(*)
    `)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { contacts: data || [] }
}

export async function addProjectContact(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit project contacts' }

  const parsed = ProjectContactSchema.safeParse({
    project_id: formData.get('project_id'),
    contact_id: formData.get('contact_id'),
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_project_contacts')
    .insert({
      project_id: parsed.data.project_id,
      contact_id: parsed.data.contact_id,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  return { projectContact: data, success: true as const }
}

export async function removeProjectContact(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit project contacts' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Project contact ID is required' }

  const supabase = await createClient()
  const { data: deletedContact, error } = await supabase
    .from('oj_project_contacts')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedContact) return { error: 'Project contact not found' }
  return { success: true as const }
}

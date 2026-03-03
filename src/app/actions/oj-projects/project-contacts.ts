'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
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
  const { data: { user } } = await supabase.auth.getUser()

  // H15 IDOR: Verify the contact belongs to the same vendor as the project
  const [{ data: projectRow }, { data: contactRow }] = await Promise.all([
    supabase
      .from('oj_projects')
      .select('vendor_id')
      .eq('id', parsed.data.project_id)
      .single(),
    supabase
      .from('invoice_vendor_contacts')
      .select('vendor_id')
      .eq('id', parsed.data.contact_id)
      .single(),
  ])

  if (!projectRow) return { error: 'Project not found' }
  if (!contactRow) return { error: 'Contact not found' }

  if (projectRow.vendor_id !== contactRow.vendor_id) {
    return { error: 'Contact does not belong to the same vendor as this project' }
  }

  const { data, error } = await supabase
    .from('oj_project_contacts')
    .insert({
      project_id: parsed.data.project_id,
      contact_id: parsed.data.contact_id,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_project_contact',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { project_id: parsed.data.project_id, contact_id: parsed.data.contact_id },
  })

  return { projectContact: data, success: true as const }
}

export async function removeProjectContact(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit project contacts' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Project contact ID is required' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // H15 IDOR: Verify the contact row exists and its project is accessible before deleting
  const { data: pcRow } = await supabase
    .from('oj_project_contacts')
    .select('project_id')
    .eq('id', id)
    .single()

  if (!pcRow) return { error: 'Project contact not found' }

  // Verify the associated project exists (RLS will also enforce access at DB level)
  const { data: projectRow } = await supabase
    .from('oj_projects')
    .select('id')
    .eq('id', pcRow.project_id)
    .single()

  if (!projectRow) return { error: 'Associated project not found or access denied' }

  const { data: deletedContact, error } = await supabase
    .from('oj_project_contacts')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedContact) return { error: 'Project contact not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'delete',
    resource_type: 'oj_project_contact',
    resource_id: id,
    operation_status: 'success',
    additional_info: { project_id: pcRow.project_id },
  })

  return { success: true as const }
}

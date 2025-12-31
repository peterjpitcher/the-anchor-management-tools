'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'

const TemplateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  prerequisites: z.any().optional(),
  screening_questions: z.any().optional(),
  interview_questions: z.any().optional(),
  screening_rubric: z.any().optional(),
  message_templates: z.any().optional(),
  compliance_lines: z.any().optional(),
})

export async function listJobTemplatesAction() {
  const allowed = await checkUserPermission('hiring', 'view')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('hiring_job_templates')
      .select('*')
      .order('title', { ascending: true })

    if (error) {
      console.error('List job templates failed:', error)
      return { success: false, error: 'Failed to fetch job templates' }
    }

    return { success: true, templates: data ?? [] }
  } catch (error: any) {
    console.error('List job templates failed:', error)
    return { success: false, error: error.message || 'Failed to fetch job templates' }
  }
}

export async function createJobTemplateAction(input: z.infer<typeof TemplateSchema>) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = TemplateSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('hiring_job_templates')
      .insert(parse.data)
      .select('*')
      .single()

    if (error) {
      console.error('Create job template failed:', error)
      return { success: false, error: error.message || 'Failed to create job template' }
    }

    revalidatePath('/hiring/templates')
    return { success: true, template: data }
  } catch (error: any) {
    console.error('Create job template failed:', error)
    return { success: false, error: error.message || 'Failed to create job template' }
  }
}

export async function updateJobTemplateAction(id: string, input: Partial<z.infer<typeof TemplateSchema>>) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const idParse = z.string().uuid().safeParse(id)
  if (!idParse.success) {
    return { success: false, error: 'Invalid template id' }
  }

  const parse = TemplateSchema.partial().safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('hiring_job_templates')
      .update(parse.data)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      console.error('Update job template failed:', error)
      return { success: false, error: error.message || 'Failed to update job template' }
    }

    revalidatePath('/hiring/templates')
    return { success: true, template: data }
  } catch (error: any) {
    console.error('Update job template failed:', error)
    return { success: false, error: error.message || 'Failed to update job template' }
  }
}

export async function deleteJobTemplateAction(id: string) {
  const allowed = await checkUserPermission('hiring', 'manage')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const idParse = z.string().uuid().safeParse(id)
  if (!idParse.success) {
    return { success: false, error: 'Invalid template id' }
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('hiring_job_templates')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete job template failed:', error)
      return { success: false, error: error.message || 'Failed to delete job template' }
    }

    revalidatePath('/hiring/templates')
    return { success: true }
  } catch (error: any) {
    console.error('Delete job template failed:', error)
    return { success: false, error: error.message || 'Failed to delete job template' }
  }
}

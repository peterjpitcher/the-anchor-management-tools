'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'

export type MessageTemplateRecord = {
  id: string
  name: string
  description: string | null
  template_type: string
  content: string
  variables: string[]
  is_default: boolean
  is_active: boolean
  estimated_segments: number | null
  send_timing: 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom'
  custom_timing_hours: number | null
  created_at: string
  updated_at: string
}

const SETTINGS_PATH = '/settings/message-templates'

function extractVariables(content: string): string[] {
  const matches = content.match(/{{(\w+)}}/g) || []
  const variables = matches.map((match) => match.replace(/[{}]/g, ''))
  return Array.from(new Set(variables))
}

async function ensureManagePermission() {
  const hasPermission = await checkUserPermission('messages', 'manage_templates')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage message templates' }
  }
  return { supabase: await createAdminClient() }
}

export async function listMessageTemplates() {
  try {
    const supabase = await createClient()
    const canView = await checkUserPermission('messages', 'manage_templates')
    if (!canView) {
      return { error: 'You do not have permission to view message templates' }
    }

    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('template_type')
      .order('is_default', { ascending: false })

    if (error) {
      console.error('Error loading message templates:', error)
      return { error: 'Failed to load message templates' }
    }

    const templates = (data ?? []).map((template) => ({
      ...template,
      description: template.description ?? null,
    })) as MessageTemplateRecord[]

    return { templates }
  } catch (error) {
    console.error('Unexpected error in listMessageTemplates:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createMessageTemplate(input: {
  name: string
  description?: string
  template_type: string
  content: string
  send_timing: 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom'
  custom_timing_hours?: number | null
}) {
  const ensure = await ensureManagePermission()
  if ('error' in ensure) {
    return ensure
  }

  const { supabase } = ensure
  const variables = extractVariables(input.content)

  try {
    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        name: input.name,
        description: input.description ?? null,
        template_type: input.template_type,
        content: input.content,
        variables,
        send_timing: input.send_timing,
        custom_timing_hours: input.send_timing === 'custom' ? input.custom_timing_hours ?? null : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating message template:', error)
      return { error: 'Failed to create message template' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'message_template',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { name: input.name, template_type: input.template_type },
    })

    revalidatePath(SETTINGS_PATH)
    return { success: true, template: data as MessageTemplateRecord }
  } catch (error) {
    console.error('Unexpected error in createMessageTemplate:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateMessageTemplate(input: {
  id: string
  name: string
  description?: string
  content: string
  send_timing: 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom'
  custom_timing_hours?: number | null
}) {
  const ensure = await ensureManagePermission()
  if ('error' in ensure) {
    return ensure
  }

  const { supabase } = ensure
  const variables = extractVariables(input.content)

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', input.id)
      .single()

    if (fetchError || !existing) {
      return { error: 'Template not found' }
    }

    const { data, error } = await supabase
      .from('message_templates')
      .update({
        name: input.name,
        description: input.description ?? null,
        content: input.content,
        variables,
        send_timing: input.send_timing,
        custom_timing_hours: input.send_timing === 'custom' ? input.custom_timing_hours ?? null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating message template:', error)
      return { error: 'Failed to update message template' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'message_template',
      resource_id: input.id,
      operation_status: 'success',
      old_values: { name: existing.name, template_type: existing.template_type },
      new_values: { name: input.name },
    })

    revalidatePath(SETTINGS_PATH)
    return { success: true, template: data as MessageTemplateRecord }
  } catch (error) {
    console.error('Unexpected error in updateMessageTemplate:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteMessageTemplate(templateId: string) {
  const ensure = await ensureManagePermission()
  if ('error' in ensure) {
    return ensure
  }

  const { supabase } = ensure

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (fetchError || !existing) {
      return { error: 'Template not found' }
    }

    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', templateId)

    if (error) {
      console.error('Error deleting message template:', error)
      return { error: 'Failed to delete message template' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'message_template',
      resource_id: templateId,
      operation_status: 'success',
      old_values: { name: existing.name, template_type: existing.template_type },
    })

    revalidatePath(SETTINGS_PATH)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteMessageTemplate:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function toggleMessageTemplate(templateId: string, nextActive: boolean) {
  const ensure = await ensureManagePermission()
  if ('error' in ensure) {
    return ensure
  }

  const { supabase } = ensure

  try {
    const { error } = await supabase
      .from('message_templates')
      .update({
        is_active: nextActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', templateId)

    if (error) {
      console.error('Error toggling message template:', error)
      return { error: 'Failed to update message template' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'message_template',
      resource_id: templateId,
      operation_status: 'success',
      additional_info: { action: nextActive ? 'activate' : 'deactivate' },
    })

    revalidatePath(SETTINGS_PATH)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error in toggleMessageTemplate:', error)
    return { error: 'An unexpected error occurred' }
  }
}

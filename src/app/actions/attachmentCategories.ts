'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'

export type AttachmentCategory = {
  category_id: string
  category_name: string
  email_on_upload: boolean
  created_at: string
  updated_at: string
}

async function requireSettingsManage(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>> } | { error: string }> {
  const hasPermission = await checkUserPermission('settings', 'manage')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage attachment categories' }
  }
  const supabase = await createClient()
  return { supabase }
}

export async function listAttachmentCategories() {
  try {
    const supabase = await createClient()

    const hasViewPermission = await checkUserPermission('settings', 'manage')
    if (!hasViewPermission) {
      return { error: 'You do not have permission to view attachment categories' }
    }

    const { data, error } = await supabase
      .from('attachment_categories')
      .select('*')
      .order('category_name')

    if (error) {
      console.error('Error loading attachment categories:', error)
      return { error: 'Failed to load attachment categories' }
    }

    return { categories: (data ?? []) as AttachmentCategory[] }
  } catch (error) {
    console.error('Unexpected error in listAttachmentCategories:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function createAttachmentCategory(input: { name: string; emailOnUpload?: boolean }) {
  try {
    const ensure = await requireSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const normalizedName = input.name.trim()
    if (!normalizedName) {
      return { error: 'Category name is required' }
    }

    const { supabase } = ensure

    const { data, error } = await supabase
      .from('attachment_categories')
      .insert({ category_name: normalizedName, email_on_upload: Boolean(input.emailOnUpload) })
      .select()
      .single()

    if (error) {
      console.error('Error creating attachment category:', error)
      return { error: 'Failed to create attachment category' }
    }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'attachment_category',
      resource_id: data.category_id,
      operation_status: 'success',
      new_values: { category_name: normalizedName, email_on_upload: Boolean(input.emailOnUpload) },
    })

    revalidatePath('/settings/categories')

    return { success: true, category: data as AttachmentCategory }
  } catch (error) {
    console.error('Unexpected error in createAttachmentCategory:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateAttachmentCategory(input: { id: string; name?: string; emailOnUpload?: boolean }) {
  try {
    const ensure = await requireSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const { supabase } = ensure

    const { data: existing, error: fetchError } = await supabase
      .from('attachment_categories')
      .select('*')
      .eq('category_id', input.id)
      .single()

    if (fetchError || !existing) {
      return { error: 'Category not found' }
    }

    const normalizedName = (input.name ?? existing.category_name).trim()
    if (!normalizedName) {
      return { error: 'Category name is required' }
    }

    const nextEmailOnUpload = input.emailOnUpload ?? existing.email_on_upload ?? false

    const { data, error } = await supabase
      .from('attachment_categories')
      .update({ category_name: normalizedName, email_on_upload: nextEmailOnUpload })
      .eq('category_id', input.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating attachment category:', error)
      return { error: 'Failed to update attachment category' }
    }

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'attachment_category',
      resource_id: input.id,
      operation_status: 'success',
      old_values: { category_name: existing.category_name, email_on_upload: existing.email_on_upload ?? false },
      new_values: { category_name: normalizedName, email_on_upload: nextEmailOnUpload },
    })

    revalidatePath('/settings/categories')

    return { success: true, category: data as AttachmentCategory }
  } catch (error) {
    console.error('Unexpected error in updateAttachmentCategory:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteAttachmentCategory(categoryId: string) {
  try {
    const ensure = await requireSettingsManage()
    if ('error' in ensure) {
      return { error: ensure.error }
    }

    const { supabase } = ensure

    const { data: existing, error: fetchError } = await supabase
      .from('attachment_categories')
      .select('*')
      .eq('category_id', categoryId)
      .single()

    if (fetchError || !existing) {
      return { error: 'Category not found' }
    }

    const { error } = await supabase
      .from('attachment_categories')
      .delete()
      .eq('category_id', categoryId)

    if (error) {
      console.error('Error deleting attachment category:', error)
      return { error: 'Failed to delete attachment category' }
    }

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'attachment_category',
      resource_id: categoryId,
      operation_status: 'success',
      old_values: { category_name: existing.category_name },
    })

    revalidatePath('/settings/categories')

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteAttachmentCategory:', error)
    return { error: 'An unexpected error occurred' }
  }
}

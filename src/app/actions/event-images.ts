'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'

const BUCKET_NAME = 'event-images'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

const PUBLIC_URL_MARKER = `/storage/v1/object/public/${BUCKET_NAME}/`

/** Recover the bucket-relative storage path from a public URL, or null if it is not ours. */
function storagePathFromPublicUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  const markerAt = imageUrl.indexOf(PUBLIC_URL_MARKER)
  if (markerAt === -1) return null
  const rawPath = imageUrl.slice(markerAt + PUBLIC_URL_MARKER.length).split('?')[0]
  if (!rawPath) return null
  try {
    return decodeURIComponent(rawPath)
  } catch {
    return rawPath
  }
}

/**
 * An entity owns a storage object only when the object sits in that entity's own
 * folder. New events inherit `event_categories.default_image_url` verbatim, so an
 * event's image URL frequently points at a category-owned object that the category
 * and every other event in that category also use. Deleting by URL alone would take
 * the file out from under all of them.
 */
function ownsStorageObject(
  storagePath: string | null,
  folder: 'events' | 'categories',
  entityId: string
): boolean {
  return Boolean(storagePath && storagePath.startsWith(`${folder}/${entityId}/`))
}

// Schema for image upload
const uploadImageSchema = z.object({
  event_id: z.string().uuid().optional(), // Optional for categories
  category_id: z.string().uuid().optional(), // For category images
  image_type: z.enum(['hero', 'thumbnail', 'poster', 'gallery', 'primary']), // Added 'primary' for single image
  alt_text: z.string().optional(),
  caption: z.string().optional(),
  display_order: z.number().int().min(0).optional()
})

export type ImageUploadState = {
  type: 'idle' | 'success' | 'error'
  message?: string
  imageUrl?: string
}

export async function uploadEventImage(
  prevState: ImageUploadState,
  formData: FormData
): Promise<ImageUploadState> {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('events', 'edit')
    if (!hasPermission) {
      return { type: 'error', message: 'Insufficient permissions to upload event images.' }
    }

    // Get the file from formData
    const file = formData.get('image_file') as File
    if (!file || file.size === 0) {
      return { type: 'error', message: 'No file selected.' }
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return { type: 'error', message: 'File size must be less than 10MB.' }
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return { type: 'error', message: 'Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.' }
    }

    // Validate other fields
    const fields = {
      event_id: formData.get('event_id') as string || undefined,
      category_id: formData.get('category_id') as string || undefined,
      image_type: formData.get('image_type') as string,
      alt_text: formData.get('alt_text') as string || undefined,
      caption: formData.get('caption') as string || undefined,
      display_order: formData.get('display_order') ? parseInt(formData.get('display_order') as string) : 0
    }

    const validationResult = uploadImageSchema.safeParse(fields)
    if (!validationResult.success) {
      console.error('Validation errors:', validationResult.error.flatten())
      const errors = validationResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
      return { type: 'error', message: `Invalid form data: ${errors}` }
    }

    const { event_id, category_id, image_type, alt_text, caption, display_order } = validationResult.data
    
    // Ensure we have either event_id or category_id
    if (!event_id && !category_id) {
      return { type: 'error', message: 'Either event_id or category_id is required.' }
    }
    const authClient = await createClient()
    const supabase = createAdminClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return { type: 'error', message: 'Authentication required.' }
    }

    // Sanitize filename
    const sanitizedFileName = file.name
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')

    const finalFileName = sanitizedFileName || 'unnamed_image'
    const folder = event_id ? `events/${event_id}` : `categories/${category_id}`
    const uniqueFileName = `${folder}/${image_type}/${Date.now()}_${finalFileName}`

    // Convert File to Buffer for Node.js compatibility with admin client
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(uniqueFileName, buffer, {
        upsert: false,
        contentType: file.type
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return { type: 'error', message: `Failed to upload image: ${uploadError.message}` }
    }

    const storagePath = uploadData.path

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath)

    // Save metadata to database if it's an event image
    let createdImageRecordId: string | null = null
    if (event_id) {
      const { data: imageRecord, error: dbError } = await supabase
        .from('event_images')
        .insert({
          event_id,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type,
          file_size_bytes: file.size,
          image_type,
          alt_text,
          caption,
          display_order: display_order || 0,
          uploaded_by: user.id
        })
        .select()
        .single()

      if (dbError) {
        // Clean up uploaded file on database error
        console.error('Database insert error:', dbError)
        const { error: cleanupError } = await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        if (cleanupError) {
          console.error('Failed to cleanup uploaded image after metadata insert error:', cleanupError)
        }
        return { type: 'error', message: 'Failed to save image metadata.' }
      }

      createdImageRecordId = imageRecord?.id ?? null
    }

    // Update the appropriate table based on whether it's an event or category
    if (event_id) {
      // For events, update the hero_image_url field
      const { data: updatedEvent, error: updateError } = await supabase
        .from('events')
        .update({ hero_image_url: publicUrl })
        .eq('id', event_id)
        .select('id')
        .maybeSingle()

      if (updateError || !updatedEvent) {
        console.error('Event update error:', updateError ?? 'event not found')
        const { error: storageCleanupError } = await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        if (storageCleanupError) {
          console.error('Failed to cleanup uploaded event image after event update error:', storageCleanupError)
        }

        if (createdImageRecordId) {
          const { error: metadataCleanupError } = await supabase
            .from('event_images')
            .delete()
            .eq('id', createdImageRecordId)

          if (metadataCleanupError) {
            console.error('Failed to cleanup event image metadata after event update error:', metadataCleanupError)
            return { type: 'error', message: 'Failed to update event image. Manual cleanup may be required.' }
          }
        }

        return { type: 'error', message: updatedEvent ? 'Failed to update event image.' : 'Event not found.' }
      }
    } else if (category_id) {
      // For categories, update default_image_url
      const { data: updatedCategory, error: updateError } = await supabase
        .from('event_categories')
        .update({ default_image_url: publicUrl })
        .eq('id', category_id)
        .select('id')
        .maybeSingle()

      if (updateError || !updatedCategory) {
        console.error('Category update error:', updateError ?? 'category not found')
        const { error: cleanupError } = await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        if (cleanupError) {
          console.error('Failed to cleanup uploaded category image after category update error:', cleanupError)
        }
        return { type: 'error', message: updatedCategory ? 'Failed to update category image.' : 'Category not found.' }
      }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'upload',
      resource_type: 'event',
      resource_id: event_id || category_id || '',
      operation_status: 'success',
      new_values: {
        imageType: image_type,
        fileName: file.name,
        fileSize: file.size
      },
      additional_info: { 
        storagePath,
        entityType: event_id ? 'event' : 'event_category'
      }
    })

    // Revalidate appropriate paths
    if (event_id) {
      revalidatePath(`/events/${event_id}`)
      revalidatePath(`/events/${event_id}/edit`)
    } else if (category_id) {
      revalidatePath('/settings/event-categories')
    }
    
    return { 
      type: 'success', 
      message: 'Image uploaded successfully!',
      imageUrl: publicUrl
    }
  } catch (error) {
    console.error('Unexpected error in uploadEventImage:', error)
    return { type: 'error', message: 'An unexpected error occurred.' }
  }
}

export async function deleteEventImage(imageUrl: string, entityId: string) {
  try {
    const hasPermission = await checkUserPermission('events', 'edit')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to delete event images.' }
    }

    const authClient = await createClient()
    const supabase = createAdminClient()

    const storagePath = storagePathFromPublicUrl(imageUrl)
    const eventOwnsFile = ownsStorageObject(storagePath, 'events', entityId)

    // Clear the reference BEFORE touching storage. If this fails, nothing has been
    // destroyed and the image is still live. The reverse order could leave the
    // website holding a URL to a file that no longer exists.
    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update({
        hero_image_url: null,
        thumbnail_image_url: null,
        poster_image_url: null
      })
      .eq('id', entityId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Failed to clear image URLs from event:', updateError)
      return { error: 'Failed to remove image from event.' }
    }
    if (!updatedEvent) {
      return { error: 'Event not found.' }
    }

    // Only ever remove a file this event actually owns. An inherited category image
    // is shared with the category itself and with every other event in it, so
    // removing it here would blank the image on all of them.
    if (eventOwnsFile && storagePath) {
      const { error: metadataError } = await supabase
        .from('event_images')
        .delete()
        .eq('event_id', entityId)
        .eq('storage_path', storagePath)

      if (metadataError) {
        console.error('Failed to delete event image metadata:', metadataError)
      }

      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([storagePath])

      // The reference is already gone, so the user's delete has succeeded. A failure
      // here only leaves an unreachable file behind, which is the safe failure mode.
      if (storageError) {
        console.error('Failed to remove event image from storage:', storageError)
      }
    }

    // Log audit event
    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email!,
        operation_type: 'delete',
        resource_type: 'event',
        resource_id: entityId,
        operation_status: 'success',
        old_values: {
          imageUrl: imageUrl
        },
        additional_info: {
          storagePath,
          // false means the file was inherited from the category and was left in place
          storageObjectRemoved: eventOwnsFile
        }
      })
    }

    revalidatePath(`/events/${entityId}`)
    revalidatePath(`/events/${entityId}/edit`)

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteEventImage:', error)
    return { error: 'An unexpected error occurred.' }
  }
}

/**
 * Clear a category's default image.
 *
 * Categories were previously routed through `deleteEventImage`, which looks the id
 * up in `events` and so always failed with "Event not found". Beyond that, a
 * category object is genuinely shared: events copy `default_image_url` verbatim at
 * creation, so the file can only be removed once nothing else points at it.
 */
export async function deleteCategoryImage(imageUrl: string, categoryId: string) {
  try {
    const hasPermission = await checkUserPermission('events', 'edit')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to delete category images.' }
    }

    const authClient = await createClient()
    const supabase = createAdminClient()

    const storagePath = storagePathFromPublicUrl(imageUrl)
    const categoryOwnsFile = ownsStorageObject(storagePath, 'categories', categoryId)

    // Clear the reference first, for the same reason as the event path above.
    const { data: updatedCategory, error: updateError } = await supabase
      .from('event_categories')
      .update({ default_image_url: null })
      .eq('id', categoryId)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Failed to clear image URL from category:', updateError)
      return { error: 'Failed to remove image from category.' }
    }
    if (!updatedCategory) {
      return { error: 'Category not found.' }
    }

    if (categoryOwnsFile && storagePath) {
      // Events that inherited this image still render it. Removing the file would
      // blank every one of them, so it stays until the last reference is gone.
      const { count: referencingEvents, error: countError } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .or(
          `hero_image_url.eq.${imageUrl},thumbnail_image_url.eq.${imageUrl},poster_image_url.eq.${imageUrl}`
        )

      if (countError) {
        // Unable to prove the file is unused, so leave it alone.
        console.error('Failed to count events referencing category image:', countError)
      } else if ((referencingEvents ?? 0) === 0) {
        const { error: storageError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([storagePath])

        if (storageError) {
          console.error('Failed to remove category image from storage:', storageError)
        }
      }
    }

    const { data: { user } } = await authClient.auth.getUser()
    if (user) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email!,
        operation_type: 'delete',
        resource_type: 'event_category',
        resource_id: categoryId,
        operation_status: 'success',
        old_values: { imageUrl },
        additional_info: { storagePath }
      })
    }

    revalidatePath('/settings/event-categories')

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in deleteCategoryImage:', error)
    return { error: 'An unexpected error occurred.' }
  }
}

async function getEventImages(eventId: string) {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('event_images')
      .select('*')
      .eq('event_id', eventId)
      .order('image_type')
      .order('display_order')

    if (error) {
      console.error('Error fetching event images:', error)
      return { error: 'Failed to fetch images.' }
    }

    // Generate public URLs for each image
    const imagesWithUrls = data.map(image => {
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(image.storage_path)
      
      return {
        ...image,
        url: publicUrl
      }
    })

    return { data: imagesWithUrls }
  } catch (error) {
    console.error('Unexpected error in getEventImages:', error)
    return { error: 'An unexpected error occurred.' }
  }
}

export async function updateImageMetadata(
  imageId: string,
  data: { alt_text?: string; caption?: string; display_order?: number }
) {
  try {
    const hasPermission = await checkUserPermission('events', 'edit')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to update event images.' }
    }

    const supabase = createAdminClient()

    const { data: updatedImage, error } = await supabase
      .from('event_images')
      .update({
        alt_text: data.alt_text,
        caption: data.caption,
        display_order: data.display_order,
        updated_at: new Date().toISOString()
      })
      .eq('id', imageId)
      .select('id')
      .maybeSingle()

    if (error) {
      return { error: 'Failed to update image metadata.' }
    }
    if (!updatedImage) {
      return { error: 'Image not found.' }
    }

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in updateImageMetadata:', error)
    return { error: 'An unexpected error occurred.' }
  }
}

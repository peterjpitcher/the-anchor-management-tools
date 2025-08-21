'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'

const BUCKET_NAME = 'event-images'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

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
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
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

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(uniqueFileName, file, { 
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
        await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        return { type: 'error', message: 'Failed to save image metadata.' }
      }
    }

    // Update the appropriate table based on whether it's an event or category
    if (event_id) {
      // For events, update the hero_image_url field
      const { error: updateError } = await supabase
        .from('events')
        .update({ hero_image_url: publicUrl })
        .eq('id', event_id)

      if (updateError) {
        console.error('Event update error:', updateError)
        await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        return { type: 'error', message: 'Failed to update event image.' }
      }
    } else if (category_id) {
      // For categories, update default_image_url
      const { error: updateError } = await supabase
        .from('event_categories')
        .update({ default_image_url: publicUrl })
        .eq('id', category_id)

      if (updateError) {
        console.error('Category update error:', updateError)
        await supabase.storage.from(BUCKET_NAME).remove([storagePath])
        return { type: 'error', message: 'Failed to update category image.' }
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

    const supabase = await createClient()
    
    // First, try to find the image in event_images table by URL
    const { data: images } = await supabase
      .from('event_images')
      .select('*')
      .eq('event_id', entityId)
    
    // Find the image that matches the URL
    let imageToDelete = null
    if (images && images.length > 0) {
      for (const img of images) {
        const { data: { publicUrl } } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(img.storage_path)
        
        if (publicUrl === imageUrl) {
          imageToDelete = img
          break
        }
      }
    }
    
    // If we found the image in event_images, delete it from storage
    if (imageToDelete) {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([imageToDelete.storage_path])

      if (storageError) {
        console.error('Storage deletion error:', storageError)
      }

      // Delete from database
      await supabase
        .from('event_images')
        .delete()
        .eq('id', imageToDelete.id)
    }

    // Always update the event to remove the image URL
    const { error: updateError } = await supabase
      .from('events')
      .update({ 
        hero_image_url: null,
        thumbnail_image_url: null,
        poster_image_url: null
      })
      .eq('id', entityId)
    
    if (updateError) {
      console.error('Failed to clear image URLs from event:', updateError)
      return { error: 'Failed to remove image from event.' }
    }

    // Log audit event
    const { data: { user } } = await supabase.auth.getUser()
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

export async function getEventImages(eventId: string) {
  try {
    const supabase = await createClient()
    
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

    const supabase = await createClient()
    
    const { error } = await supabase
      .from('event_images')
      .update({
        alt_text: data.alt_text,
        caption: data.caption,
        display_order: data.display_order,
        updated_at: new Date().toISOString()
      })
      .eq('id', imageId)

    if (error) {
      return { error: 'Failed to update image metadata.' }
    }

    return { success: true }
  } catch (error) {
    console.error('Unexpected error in updateImageMetadata:', error)
    return { error: 'An unexpected error occurred.' }
  }
}
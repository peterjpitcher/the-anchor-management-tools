'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

// Validation schemas
const MenuItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  price: z.number().min(0, 'Price must be positive'),
  category: z.enum(['main', 'side']),
  is_active: z.boolean().default(true),
  display_order: z.number().int().default(0),
  allergens: z.array(z.string()).default([]),
  dietary_info: z.array(z.string()).default([]),
});

// Get all menu items
export async function getSundayLunchMenuItems() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('sunday_lunch_menu_items')
      .select('*')
      .order('category')
      .order('display_order')
      .order('name');
      
    if (error) {
      console.error('Fetch menu items error:', error);
      return { error: 'Failed to fetch menu items' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get menu items error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get active menu items only (for booking page)
export async function getActiveSundayLunchMenuItems() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('sunday_lunch_menu_items')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('display_order')
      .order('name');
      
    if (error) {
      console.error('Fetch active menu items error:', error);
      return { error: 'Failed to fetch menu items' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get active menu items error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Create menu item
export async function createSundayLunchMenuItem(formData: FormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu items' };
    }
    
    // Parse and validate data
    const allergens = formData.get('allergens')?.toString().split(',').map(a => a.trim()).filter(Boolean) || [];
    const dietaryInfo = formData.get('dietary_info')?.toString().split(',').map(d => d.trim()).filter(Boolean) || [];
    
    const itemData = MenuItemSchema.parse({
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      price: parseFloat(formData.get('price') as string),
      category: formData.get('category'),
      is_active: formData.get('is_active') === 'true',
      display_order: parseInt(formData.get('display_order') as string) || 0,
      allergens,
      dietary_info: dietaryInfo,
    });
    
    // Create menu item
    const { data, error } = await supabase
      .from('sunday_lunch_menu_items')
      .insert(itemData)
      .select()
      .single();
      
    if (error) {
      console.error('Create menu item error:', error);
      return { error: 'Failed to create menu item' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'sunday_lunch_menu_item',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: {
        name: data.name,
        category: data.category,
        price: data.price,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings/settings/sunday-lunch');
    revalidatePath('/table-bookings/new');
    
    return { success: true, data };
  } catch (error) {
    console.error('Create menu item error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Update menu item
export async function updateSundayLunchMenuItem(
  itemId: string,
  formData: FormData
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu items' };
    }
    
    // Parse and validate data
    const allergens = formData.get('allergens')?.toString().split(',').map(a => a.trim()).filter(Boolean) || [];
    const dietaryInfo = formData.get('dietary_info')?.toString().split(',').map(d => d.trim()).filter(Boolean) || [];
    
    const itemData = MenuItemSchema.parse({
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      price: parseFloat(formData.get('price') as string),
      category: formData.get('category'),
      is_active: formData.get('is_active') === 'true',
      display_order: parseInt(formData.get('display_order') as string) || 0,
      allergens,
      dietary_info: dietaryInfo,
    });
    
    // Update menu item
    const { data, error } = await supabase
      .from('sunday_lunch_menu_items')
      .update(itemData)
      .eq('id', itemId)
      .select()
      .single();
      
    if (error) {
      console.error('Update menu item error:', error);
      return { error: 'Failed to update menu item' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'sunday_lunch_menu_item',
      resource_id: itemId,
      operation_status: 'success',
      additional_info: {
        name: data.name,
        updates: itemData,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings/settings/sunday-lunch');
    revalidatePath('/table-bookings/new');
    
    return { success: true, data };
  } catch (error) {
    console.error('Update menu item error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Delete menu item
export async function deleteSundayLunchMenuItem(itemId: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage menu items' };
    }
    
    // Get item details for audit
    const { data: item } = await supabase
      .from('sunday_lunch_menu_items')
      .select('name')
      .eq('id', itemId)
      .single();
    
    // Delete menu item
    const { error } = await supabase
      .from('sunday_lunch_menu_items')
      .delete()
      .eq('id', itemId);
      
    if (error) {
      console.error('Delete menu item error:', error);
      return { error: 'Failed to delete menu item' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'sunday_lunch_menu_item',
      resource_id: itemId,
      operation_status: 'success',
      additional_info: {
        name: item?.name,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings/settings/sunday-lunch');
    revalidatePath('/table-bookings/new');
    
    return { success: true };
  } catch (error) {
    console.error('Delete menu item error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
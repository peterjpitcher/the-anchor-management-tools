'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

// Validation schemas
const TableSchema = z.object({
  table_number: z.string().min(1, 'Table number is required'),
  capacity: z.number().min(1).max(20),
  is_active: z.boolean().default(true),
  notes: z.string().optional(),
});

const TableCombinationSchema = z.object({
  name: z.string().min(1, 'Combination name is required'),
  table_ids: z.array(z.string().uuid()).min(2, 'At least 2 tables required'),
  preferred_for_size: z.array(z.number()).optional(),
  is_active: z.boolean().default(true),
});

const BookingPolicySchema = z.object({
  booking_type: z.enum(['regular', 'sunday_lunch']),
  full_refund_hours: z.number().min(0),
  partial_refund_hours: z.number().min(0),
  partial_refund_percentage: z.number().min(0).max(100),
  modification_allowed: z.boolean().default(true),
  cancellation_fee: z.number().min(0).default(0),
  max_party_size: z.number().min(1).default(20),
  min_advance_hours: z.number().min(0).default(0),
  max_advance_days: z.number().min(1).default(56),
});

// Get all tables
export async function getTables() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('table_configuration')
      .select('*')
      .order('table_number');
      
    if (error) {
      console.error('Fetch tables error:', error);
      return { error: 'Failed to fetch tables' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get tables error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get all table combinations
export async function getTableCombinations() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('table_combinations')
      .select(`
        *,
        table_combination_tables(
          table:table_configuration(*)
        )
      `)
      .order('name');
      
    if (error) {
      console.error('Fetch combinations error:', error);
      return { error: 'Failed to fetch table combinations' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get combinations error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get all booking policies
export async function getBookingPolicies() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('booking_policies')
      .select('*')
      .order('booking_type');
      
    if (error) {
      console.error('Fetch policies error:', error);
      return { error: 'Failed to fetch booking policies' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get policies error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Table management
export async function createTable(formData: FormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage tables' };
    }
    
    // Validate data
    const validatedData = TableSchema.parse({
      table_number: formData.get('table_number'),
      capacity: parseInt(formData.get('capacity') as string),
      is_active: formData.get('is_active') === 'true',
      notes: formData.get('notes') || undefined,
    });
    
    // Check if table number already exists
    const { data: existing } = await supabase
      .from('table_configuration')
      .select('id')
      .eq('table_number', validatedData.table_number)
      .single();
      
    if (existing) {
      return { error: 'Table number already exists' };
    }
    
    // Create table
    const { data, error } = await supabase
      .from('table_configuration')
      .insert(validatedData)
      .select()
      .single();
      
    if (error) {
      console.error('Table creation error:', error);
      return { error: 'Failed to create table' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'table_configuration',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { table_number: data.table_number, capacity: data.capacity }
    });
    
    revalidatePath('/table-bookings/settings/tables');
    
    return { success: true, data };
  } catch (error) {
    console.error('Create table error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function updateTable(tableId: string, formData: FormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage tables' };
    }
    
    // Validate data
    const validatedData = TableSchema.parse({
      table_number: formData.get('table_number'),
      capacity: parseInt(formData.get('capacity') as string),
      is_active: formData.get('is_active') === 'true',
      notes: formData.get('notes') || undefined,
    });
    
    // Update table
    const { data, error } = await supabase
      .from('table_configuration')
      .update(validatedData)
      .eq('id', tableId)
      .select()
      .single();
      
    if (error) {
      console.error('Table update error:', error);
      return { error: 'Failed to update table' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_configuration',
      resource_id: tableId,
      operation_status: 'success',
      additional_info: { changes: validatedData }
    });
    
    revalidatePath('/table-bookings/settings/tables');
    
    return { success: true, data };
  } catch (error) {
    console.error('Update table error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

export async function deleteTable(tableId: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage tables' };
    }
    
    // Check if table has bookings
    const { data: bookings } = await supabase
      .from('table_bookings')
      .select('id')
      .contains('tables_assigned', [tableId])
      .eq('status', 'confirmed')
      .gte('booking_date', new Date().toISOString().split('T')[0])
      .limit(1);
      
    if (bookings && bookings.length > 0) {
      return { error: 'Cannot delete table with active bookings' };
    }
    
    // Delete table
    const { error } = await supabase
      .from('table_configuration')
      .delete()
      .eq('id', tableId);
      
    if (error) {
      console.error('Table deletion error:', error);
      return { error: 'Failed to delete table' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'table_configuration',
      resource_id: tableId,
      operation_status: 'success',
    });
    
    revalidatePath('/table-bookings/settings/tables');
    
    return { success: true };
  } catch (error) {
    console.error('Delete table error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Table combinations
export async function createTableCombination(formData: FormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage table combinations' };
    }
    
    // Validate data
    const validatedData = TableCombinationSchema.parse({
      name: formData.get('name'),
      table_ids: JSON.parse(formData.get('table_ids') as string),
      preferred_for_size: formData.get('preferred_for_size') 
        ? JSON.parse(formData.get('preferred_for_size') as string)
        : undefined,
      is_active: formData.get('is_active') === 'true',
    });
    
    // Calculate total capacity
    const { data: tables } = await supabase
      .from('table_configuration')
      .select('capacity')
      .in('id', validatedData.table_ids);
      
    const totalCapacity = tables?.reduce((sum, table) => sum + table.capacity, 0) || 0;
    
    // Create combination
    const { data, error } = await supabase
      .from('table_combinations')
      .insert({
        ...validatedData,
        total_capacity: totalCapacity,
      })
      .select()
      .single();
      
    if (error) {
      console.error('Combination creation error:', error);
      return { error: 'Failed to create table combination' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'table_combination',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { name: data.name, capacity: totalCapacity }
    });
    
    revalidatePath('/table-bookings/settings/tables');
    
    return { success: true, data };
  } catch (error) {
    console.error('Create combination error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Booking policies
export async function updateBookingPolicy(formData: FormData) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage booking policies' };
    }
    
    // Validate data
    const validatedData = BookingPolicySchema.parse({
      booking_type: formData.get('booking_type'),
      full_refund_hours: parseInt(formData.get('full_refund_hours') as string),
      partial_refund_hours: parseInt(formData.get('partial_refund_hours') as string),
      partial_refund_percentage: parseInt(formData.get('partial_refund_percentage') as string),
      modification_allowed: formData.get('modification_allowed') === 'true',
      cancellation_fee: parseFloat(formData.get('cancellation_fee') as string) || 0,
      max_party_size: parseInt(formData.get('max_party_size') as string),
      min_advance_hours: parseInt(formData.get('min_advance_hours') as string),
      max_advance_days: parseInt(formData.get('max_advance_days') as string),
    });
    
    // Update or insert policy
    const { data, error } = await supabase
      .from('booking_policies')
      .upsert(validatedData, {
        onConflict: 'booking_type',
      })
      .select()
      .single();
      
    if (error) {
      console.error('Policy update error:', error);
      return { error: 'Failed to update booking policy' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'booking_policy',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { booking_type: data.booking_type, changes: validatedData }
    });
    
    revalidatePath('/table-bookings/settings/policies');
    
    return { success: true, data };
  } catch (error) {
    console.error('Update policy error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Delete table combination
export async function deleteTableCombination(combinationId: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage table combinations' };
    }
    
    // Check if combination is used in any active bookings
    const { data: bookings } = await supabase
      .from('table_bookings')
      .select('id')
      .eq('table_combination_id', combinationId)
      .eq('status', 'confirmed')
      .gte('booking_date', new Date().toISOString().split('T')[0])
      .limit(1);
      
    if (bookings && bookings.length > 0) {
      return { error: 'Cannot delete combination with active bookings' };
    }
    
    // Delete combination
    const { error } = await supabase
      .from('table_combinations')
      .delete()
      .eq('id', combinationId);
      
    if (error) {
      console.error('Combination deletion error:', error);
      return { error: 'Failed to delete table combination' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'table_combination',
      resource_id: combinationId,
      operation_status: 'success',
    });
    
    revalidatePath('/table-bookings/settings/tables');
    
    return { success: true };
  } catch (error) {
    console.error('Delete combination error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Time slot capacity management
export async function updateTimeSlotCapacity(
  dayOfWeek: number,
  slotTime: string,
  maxCovers: number,
  bookingType?: 'regular' | 'sunday_lunch'
) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'manage');
    if (!hasPermission) {
      return { error: 'You do not have permission to manage time slots' };
    }
    
    // Update or insert time slot
    const { data, error } = await supabase
      .from('booking_time_slots')
      .upsert({
        day_of_week: dayOfWeek,
        slot_time: slotTime,
        max_covers: maxCovers,
        booking_type: bookingType || null,
        is_active: true,
      }, {
        onConflict: 'day_of_week,slot_time,booking_type',
      })
      .select()
      .single();
      
    if (error) {
      console.error('Time slot update error:', error);
      return { error: 'Failed to update time slot capacity' };
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'booking_time_slot',
      resource_id: data.id,
      operation_status: 'success',
      additional_info: { 
        day_of_week: dayOfWeek, 
        slot_time: slotTime, 
        max_covers: maxCovers 
      }
    });
    
    revalidatePath('/table-bookings/settings/time-slots');
    
    return { success: true, data };
  } catch (error) {
    console.error('Update time slot error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
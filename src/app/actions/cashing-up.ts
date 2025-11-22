'use server'

import { createClient } from '@/lib/supabase/server';
import { PermissionService } from '@/services/permission';
import { CashingUpService } from '@/services/cashing-up.service';
import { UpsertCashupSessionDTO } from '@/types/cashing-up';
import { revalidatePath } from 'next/cache';

export async function getSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) {
    return { error: 'Forbidden' };
  }

  try {
    const data = await CashingUpService.getSession(supabase, id);
    return { data };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function upsertSessionAction(data: UpsertCashupSessionDTO, existingId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const action = existingId ? 'edit' : 'create';
  const hasPermission = await PermissionService.checkUserPermission('cashing_up', action, user.id);
  if (!hasPermission) {
    return { success: false, error: 'Forbidden' };
  }

  try {
    const result = await CashingUpService.upsertSession(supabase, data, user.id, existingId);
    revalidatePath('/cashing-up'); // Revalidate relevant paths
    return { success: true, data: result };
  } catch (error: any) {
    console.error('Upsert error:', error);
    return { success: false, error: error.message };
  }
}

export async function submitSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'submit', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.submitSession(supabase, id, user.id);
    revalidatePath('/cashing-up');
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function approveSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'approve', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.approveSession(supabase, id, user.id);
    revalidatePath('/cashing-up');
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function lockSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'lock', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.lockSession(supabase, id, user.id);
    revalidatePath('/cashing-up');
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function unlockSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'unlock', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.unlockSession(supabase, id, user.id);
    revalidatePath('/cashing-up');
    return { success: true, data: result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getWeeklyDataAction(siteId: string, weekStartDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { error: 'Forbidden' };

  try {
    const data = await CashingUpService.getWeeklyData(supabase, siteId, weekStartDate);
    return { data };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function getDashboardDataAction(siteId?: string, fromDate?: string, toDate?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return { error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { error: 'Forbidden' };

  try {
    const data = await CashingUpService.getDashboardData(supabase, siteId, fromDate, toDate);
    return { data };
  } catch (error: any) {
    return { error: error.message };
  }
}
'use server'

import { createClient } from '@/lib/supabase/server';
import { PermissionService } from '@/services/permission';
import { CashingUpService } from '@/services/cashing-up.service';
import { UpsertCashupSessionDTO } from '@/types/cashing-up';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function getSessionByIdAction(id: string) {
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return { success: false, error: 'Failed to load dashboard data' };
  }
}

export async function getInsightsDataAction(siteId?: string, year?: number) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    // Default site if not provided
    let targetSiteId = siteId;
    if (!targetSiteId) {
      const { data: site } = await supabase.from('sites').select('id').limit(1).single();
      targetSiteId = site?.id;
    }

    if (!targetSiteId) {
       return { success: false, error: 'No site found' };
    }

    const data = await CashingUpService.getInsightsData(supabase, targetSiteId, year);
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching insights data:', error);
    return { success: false, error: 'Failed to load insights data' };
  }
}

export async function getDailyTargetAction(siteId: string, date: string) {
  const supabase = await createClient();
  try {
    const target = await CashingUpService.getDailyTarget(supabase, siteId, date);
    return { success: true, data: target };
  } catch (error: any) {
    console.error('Error getting daily target:', error);
    return { success: false, error: error.message };
  }
}

export async function setDailyTargetAction(siteId: string, date: string, amount: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  try {
    await CashingUpService.setDailyTarget(supabase, siteId, date, amount, user.id);
    return { success: true };
  } catch (error: any) {
    console.error('Error setting daily target:', error);
    return { success: false, error: error.message };
  }
}

export async function updateWeeklyTargetsAction(siteId: string, targets: Record<number, number>, effectiveDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  try {
    const targetArray = Object.entries(targets).map(([day, amount]) => ({
      dayOfWeek: parseInt(day),
      amount: Number(amount)
    }));

    await CashingUpService.setWeeklyTargets(supabase, siteId, targetArray, effectiveDate, user.id);
    return { success: true };
  } catch (error: any) {
    console.error('Error setting weekly targets:', error);
    return { success: false, error: error.message };
  }
}

export async function getWeeklyProgressAction(siteId: string, date: string) {
  const supabase = await createClient();
  try {
    const data = await CashingUpService.getWeeklyProgress(supabase, siteId, date);
    return { success: true, data };
  } catch (error: any) {
    console.error('Error getting weekly progress:', error);
    return { success: false, error: error.message };
  }
}

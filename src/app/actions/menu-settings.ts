'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { MenuSettingsService } from '@/services/menu-settings'; // New service import
import { getCurrentUser } from '@/lib/audit-helpers'; // Assuming audit-helpers is in lib

export async function getMenuTargetGp(options?: { client?: any }): Promise<number> {
  const [canView, canManage] = await Promise.all([
    checkUserPermission('menu_management', 'view'),
    checkUserPermission('menu_management', 'manage'),
  ]);
  if (!canView && !canManage) {
    throw new Error('Permission denied');
  }

  return MenuSettingsService.getMenuTargetGp(options);
}

export async function updateMenuTargetGp(rawTarget: number) {
  const hasPermission = await checkUserPermission('menu_management', 'manage');
  if (!hasPermission) {
    return { error: 'You do not have permission to update the GP target.' };
  }

  const { user_id, user_email } = await getCurrentUser(); // Get user for audit logging in RPC
  if (!user_id) {
    return { error: 'Unauthorized' };
  }

  const result = await MenuSettingsService.updateMenuTargetGp(rawTarget, user_id, user_email || undefined);

  if (result.error) {
    return { error: result.error };
  }

  revalidatePath('/menu-management/dishes');
  revalidatePath('/menu-management');
  revalidatePath('/settings/menu-target');
  revalidatePath('/api/menu-management/dishes');

  return { success: true, target: result.target };
}

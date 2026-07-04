'use server'

import { createClient } from '@/lib/supabase/server';
import { PermissionService } from '@/services/permission';
import { CashingUpService } from '@/services/cashing-up.service';
import { type CashupInsightsPeriod, UpsertCashupSessionDTO } from '@/types/cashing-up';
import { revalidatePath, revalidateTag } from 'next/cache';
import { logAuditEvent } from '@/app/actions/audit';
import { getErrorMessage } from '@/lib/errors';

async function getSessionByIdAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) {
    return { success: false, error: 'Forbidden' };
  }

  try {
    const data = await CashingUpService.getSession(supabase, id);
    return { success: true, data };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
    revalidatePath('/cashing-up');
    revalidateTag('dashboard');
    void logAuditEvent({ operation_type: existingId ? 'update' : 'create', resource_type: 'cashup_session', operation_status: 'success' });
    return { success: true, data: result };
  } catch (error: unknown) {
    console.error('Upsert error:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function upsertAndSubmitSessionAction(data: UpsertCashupSessionDTO, existingId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const action = existingId ? 'edit' : 'create';
  const [hasUpsertPermission, hasSubmitPermission] = await Promise.all([
    PermissionService.checkUserPermission('cashing_up', action, user.id),
    PermissionService.checkUserPermission('cashing_up', 'submit', user.id),
  ]);

  if (!hasUpsertPermission || !hasSubmitPermission) {
    return { success: false, error: 'Forbidden' };
  }

  try {
    const result = await CashingUpService.upsertSession(
      supabase,
      { ...data, status: 'submitted' },
      user.id,
      existingId
    );
    revalidatePath('/cashing-up');
    revalidateTag('dashboard');
    void logAuditEvent({
      operation_type: 'submit',
      resource_type: 'cashup_session',
      resource_id: result.id,
      operation_status: 'success',
    });
    return { success: true, data: result };
  } catch (error: unknown) {
    console.error('Submit cashup error:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

async function submitSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'submit', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.submitSession(supabase, id, user.id);
    revalidatePath('/cashing-up');
    revalidateTag('dashboard');
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_session', operation_status: 'success' });
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
    revalidateTag('dashboard');
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_session', operation_status: 'success' });
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
    revalidateTag('dashboard');
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_session', operation_status: 'success' });
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
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
    revalidateTag('dashboard');
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_session', operation_status: 'success' });
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Void a cash-up session: the record is kept for audit (greyed out in the UI)
 * but excluded from weekly totals. Requires cashing_up/manage; voiding an
 * approved session additionally requires approve, and a locked session unlock —
 * mirroring the approve/lock gating on those states.
 */
export async function voidCashupSession(
  { sessionId, reason }: { sessionId: string; reason: string }
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Unauthorized' };

  const hasManagePermission = await PermissionService.checkUserPermission('cashing_up', 'manage', user.id);
  if (!hasManagePermission) return { success: false, error: 'Forbidden' };

  const trimmedReason = reason?.trim();
  if (!trimmedReason) return { success: false, error: 'A reason is required to void a session' };

  try {
    const { data: session, error: fetchError } = await supabase
      .from('cashup_sessions')
      .select('id, status, voided_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!session) return { success: false, error: 'Session not found' };
    if (session.voided_at) return { success: false, error: 'Session is already voided' };

    if (session.status === 'approved') {
      const canApprove = await PermissionService.checkUserPermission('cashing_up', 'approve', user.id);
      if (!canApprove) return { success: false, error: 'Approved sessions can only be voided by users with approve permission' };
    }
    if (session.status === 'locked') {
      const canUnlock = await PermissionService.checkUserPermission('cashing_up', 'unlock', user.id);
      if (!canUnlock) return { success: false, error: 'Locked sessions can only be voided by users with unlock permission' };
    }

    const { data: voidedRow, error: updateError } = await supabase
      .from('cashup_sessions')
      .update({
        voided_at: new Date().toISOString(),
        voided_by: user.id,
        void_reason: trimmedReason,
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .is('voided_at', null)
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!voidedRow) return { success: false, error: 'Session not found or already voided' };

    revalidatePath('/cashing-up');
    revalidateTag('dashboard');
    void logAuditEvent({
      operation_type: 'void',
      resource_type: 'cashup_session',
      resource_id: sessionId,
      operation_status: 'success',
      additional_info: { reason: trimmedReason, previous_status: session.status },
    });
    return { success: true };
  } catch (error: unknown) {
    console.error('Void cashup error:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function deleteSessionAction(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'delete', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const result = await CashingUpService.deleteSession(supabase, id);
    revalidatePath('/cashing-up');
    revalidateTag('dashboard');
    void logAuditEvent({
      operation_type: 'delete',
      resource_type: 'cashup_session',
      resource_id: id,
      operation_status: 'success',
    });
    return { success: true, data: result };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getWeeklyDataAction(siteId: string, weekStartDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const data = await CashingUpService.getWeeklyData(supabase, siteId, weekStartDate);
    return { success: true, data };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getDashboardDataAction(siteId?: string, fromDate?: string, toDate?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const data = await CashingUpService.getDashboardData(supabase, siteId, fromDate, toDate);
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return { success: false, error: 'Failed to load dashboard data' };
  }
}

export async function getInsightsDataAction(siteId?: string, year?: number, period?: CashupInsightsPeriod) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
    if (!hasPermission) return { success: false, error: 'Forbidden' };

    // Default site if not provided
    let targetSiteId = siteId;
    if (!targetSiteId) {
      const { data: site } = await supabase.from('sites').select('id').limit(1).single();
      targetSiteId = site?.id;
    }

    if (!targetSiteId) {
       return { success: false, error: 'No site found' };
    }

    const data = await CashingUpService.getInsightsData(supabase, targetSiteId, { year, period });
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching insights data:', error);
    return { success: false, error: 'Failed to load insights data' };
  }
}

export async function getDailyTargetAction(siteId: string, date: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const target = await CashingUpService.getDailyTarget(supabase, siteId, date);
    return { success: true, data: target };
  } catch (error: unknown) {
    console.error('Error getting daily target:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function setDailyTargetAction(siteId: string, date: string, amount: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'edit', user.id);
  if (!hasPermission) return { success: false, error: 'Insufficient permissions' };

  try {
    await CashingUpService.setDailyTarget(supabase, siteId, date, amount, user.id);
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_target', operation_status: 'success' });
    return { success: true };
  } catch (error: unknown) {
    console.error('Error setting daily target:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

async function updateWeeklyTargetsAction(siteId: string, targets: Record<number, number>, effectiveDate: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'edit', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const targetArray = Object.entries(targets).map(([day, amount]) => ({
      dayOfWeek: parseInt(day),
      amount: Number(amount)
    }));

    await CashingUpService.setWeeklyTargets(supabase, siteId, targetArray, effectiveDate, user.id);
    void logAuditEvent({ operation_type: 'update', resource_type: 'cashup_targets', operation_status: 'success' });
    return { success: true };
  } catch (error: unknown) {
    console.error('Error setting weekly targets:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getWeeklyProgressAction(siteId: string, date: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'view', user.id);
  if (!hasPermission) return { success: false, error: 'Forbidden' };

  try {
    const data = await CashingUpService.getWeeklyProgress(supabase, siteId, date);
    return { success: true, data };
  } catch (error: unknown) {
    console.error('Error getting weekly progress:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

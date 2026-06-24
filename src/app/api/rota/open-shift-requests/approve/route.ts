import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from '@/app/actions/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { verifyOpenShiftApprovalToken, type OpenShiftApprovalTokenPayload } from '@/lib/rota/open-shift-request-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ApprovalResult = {
  status: 'approved' | 'stale';
  shift_id: string;
  week_start: string | null;
  reason: string | null;
};

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('redirectedFrom', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

function redirectToRota(
  request: NextRequest,
  payload: OpenShiftApprovalTokenPayload,
  result: 'approved' | 'stale' | 'error',
  weekStart?: string | null,
): NextResponse {
  const rotaUrl = new URL('/rota', request.url);
  rotaUrl.searchParams.set('week', weekStart || payload.expected.shiftDate);
  rotaUrl.searchParams.set('shift', payload.shiftId);
  rotaUrl.searchParams.set('openShiftRequest', result);
  return NextResponse.redirect(rotaUrl);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  const payload = token ? verifyOpenShiftApprovalToken(token) : null;
  if (!payload) {
    const rotaUrl = new URL('/rota', request.url);
    rotaUrl.searchParams.set('openShiftRequest', 'invalid');
    return NextResponse.redirect(rotaUrl);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirectToLogin(request);

  const [canEdit, canPublish] = await Promise.all([
    checkUserPermission('rota', 'edit', user.id),
    checkUserPermission('rota', 'publish', user.id),
  ]);
  if (!canEdit || !canPublish) return NextResponse.redirect(new URL('/unauthorized', request.url));

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('approve_rota_open_shift_request', {
    p_request_id: payload.requestId,
    p_shift_id: payload.shiftId,
    p_employee_id: payload.employeeId,
    p_actor_user_id: user.id,
    p_expected_shift_date: payload.expected.shiftDate,
    p_expected_start_time: payload.expected.startTime,
    p_expected_end_time: payload.expected.endTime,
    p_expected_unpaid_break_minutes: payload.expected.unpaidBreakMinutes,
    p_expected_department: payload.expected.department,
    p_expected_is_overnight: payload.expected.isOvernight,
    p_expected_name: payload.expected.name,
  });

  if (error) {
    console.error('[openShiftRequestApprove] approval failed', error);
    return redirectToRota(request, payload, 'error');
  }

  const result = ((Array.isArray(data) ? data[0] : data) ?? null) as ApprovalResult | null;
  if (!result || result.status !== 'approved') {
    return redirectToRota(request, payload, 'stale', result?.week_start);
  }

  void logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'approve_open_shift_request',
    resource_type: 'rota_shift',
    resource_id: payload.shiftId,
    operation_status: 'success',
    old_values: { employee_id: null, is_open_shift: true },
    new_values: {
      employee_id: payload.employeeId,
      is_open_shift: false,
      acceptance_status: 'accepted',
    },
    additional_info: {
      request_id: payload.requestId,
      source: 'manager_email_auto_accept',
    },
  });

  revalidatePath('/rota');
  revalidatePath('/portal/shifts');
  revalidatePath(`/employees/${payload.employeeId}`);

  return redirectToRota(request, payload, 'approved', result.week_start);
}

'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getErrorMessage } from '@/lib/errors';
import { formatDateInLondon } from '@/lib/dateUtils';
import { checkUserPermission } from './rbac';
import { logAuditEvent } from './audit';

export type ReviewFeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'dismissed';

export interface ReviewFeedbackItem {
  id: string;
  rating: number;
  comments: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  contactConsent: boolean;
  status: ReviewFeedbackStatus;
  staffNotes: string | null;
  createdAt: string;
  handledAt: string | null;
}

// Shape of the raw DB row we select (snake_case). Narrowed to the columns we read.
interface ReviewFeedbackRow {
  id: string;
  rating: number;
  comments: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  contact_consent: boolean | null;
  status: ReviewFeedbackStatus;
  staff_notes: string | null;
  created_at: string;
  handled_at: string | null;
}

const statusValues = ['new', 'in_progress', 'resolved', 'dismissed'] as const;

const updateStatusSchema = z.object({
  id: z.string().uuid('Invalid feedback id'),
  status: z.enum(statusValues),
  staffNotes: z.string().max(4000, 'Note is too long (maximum 4000 characters)').optional(),
});

// Rows fetched per page. Kept at 200 to match the original hard cap; the
// client requests further pages via `offset`.
const FEEDBACK_PAGE_SIZE = 200;

const OPEN_STATUSES: ReviewFeedbackStatus[] = ['new', 'in_progress'];

export interface ReviewFeedbackListData {
  items: ReviewFeedbackItem[];
  hasMore: boolean;
  newCount: number;
}

// Derives short initials for note attribution from the staff email local part
// (e.g. peter.pitcher@… → "PP"). Falls back to 'Staff'.
function staffInitialsFromEmail(email: string | null | undefined): string {
  if (!email) return 'Staff';
  const local = email.split('@')[0] ?? '';
  const initials = local
    .split(/[^a-zA-Z]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3);
  return initials || 'Staff';
}

function mapRow(row: ReviewFeedbackRow): ReviewFeedbackItem {
  return {
    id: row.id,
    rating: row.rating,
    comments: row.comments,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    contactConsent: row.contact_consent === true,
    status: row.status,
    staffNotes: row.staff_notes,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  };
}

export async function getReviewFeedbackList(options?: {
  includeResolved?: boolean;
  offset?: number;
}): Promise<{ success: true; data: ReviewFeedbackListData } | { error: string }> {
  try {
    const canView = await checkUserPermission('feedback', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view feedback' };
    }

    const includeResolved = options?.includeResolved === true;
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));

    const admin = createAdminClient();

    let query = admin
      .from('review_feedback')
      .select(
        'id, rating, comments, customer_name, customer_email, customer_phone, contact_consent, status, staff_notes, created_at, handled_at'
      )
      .order('created_at', { ascending: false })
      // Fetch one extra row beyond the page size to detect whether more exist.
      .range(offset, offset + FEEDBACK_PAGE_SIZE);

    if (!includeResolved) {
      query = query.in('status', OPEN_STATUSES);
    }

    const [listResult, countResult] = await Promise.all([
      query,
      admin
        .from('review_feedback')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new'),
    ]);

    if (listResult.error) throw listResult.error;
    if (countResult.error) throw countResult.error;

    const rows = (listResult.data ?? []) as ReviewFeedbackRow[];
    const hasMore = rows.length > FEEDBACK_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, FEEDBACK_PAGE_SIZE) : rows;

    return {
      success: true,
      data: {
        items: pageRows.map(mapRow),
        hasMore,
        newCount: countResult.count ?? 0,
      },
    };
  } catch (error: unknown) {
    console.error('Failed to list review feedback:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function updateReviewFeedbackStatus(input: {
  id: string;
  status: ReviewFeedbackStatus;
  staffNotes?: string;
}): Promise<
  | { success: true; data: { status: ReviewFeedbackStatus; staffNotes: string | null } }
  | { error: string }
> {
  try {
    const supabase = await createClient();
    const [
      {
        data: { user },
      },
      canManage,
    ] = await Promise.all([
      supabase.auth.getUser(),
      checkUserPermission('feedback', 'manage'),
    ]);

    if (!user) {
      return { error: 'Unauthorized' };
    }

    if (!canManage) {
      return { error: 'You do not have permission to manage feedback' };
    }

    const validated = updateStatusSchema.parse(input);

    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('review_feedback')
      .select('status, staff_notes')
      .eq('id', validated.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return { error: 'Feedback not found' };
    }

    const currentStatus = existing.status as ReviewFeedbackStatus;
    const currentNotes = (existing.staff_notes as string | null) ?? null;

    const updatePayload: {
      status: ReviewFeedbackStatus;
      handled_by?: string;
      handled_at?: string;
      staff_notes?: string;
    } = {
      status: validated.status,
    };

    // handled_by/handled_at record when the item was first actioned — only
    // stamp them when the status transitions away from 'new', so a notes-only
    // save on a new item does not mark it as handled.
    if (currentStatus === 'new' && validated.status !== 'new') {
      updatePayload.handled_by = user.id;
      updatePayload.handled_at = new Date().toISOString();
    }

    // Notes are append-only with attribution ("DD Mon, initials: note") so
    // concurrent edits never clobber each other.
    const note = validated.staffNotes?.trim();
    if (note) {
      const stamp = formatDateInLondon(new Date(), { day: '2-digit', month: 'short' });
      const line = `${stamp}, ${staffInitialsFromEmail(user.email)}: ${note}`;
      updatePayload.staff_notes = currentNotes ? `${currentNotes}\n${line}` : line;
    }

    const { data: updatedRows, error } = await admin
      .from('review_feedback')
      .update(updatePayload)
      .eq('id', validated.id)
      .select('id');

    if (error) throw error;
    if (!updatedRows || updatedRows.length === 0) {
      return { error: 'Feedback not found' };
    }

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'review_feedback',
      resource_id: validated.id,
      operation_status: 'success',
      new_values: {
        status: validated.status,
        ...(note && { staff_note_appended: note }),
      },
    });

    revalidatePath('/feedback-inbox');
    return {
      success: true,
      data: {
        status: validated.status,
        staffNotes: updatePayload.staff_notes ?? currentNotes,
      },
    };
  } catch (error: unknown) {
    console.error('Failed to update review feedback status:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0]?.message ?? 'Invalid feedback update' };
    }
    return { error: getErrorMessage(error) };
  }
}

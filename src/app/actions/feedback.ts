'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getErrorMessage } from '@/lib/errors';
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
  staffNotes: z.string().optional(),
});

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

export async function getReviewFeedbackList(): Promise<
  { success: true; data: ReviewFeedbackItem[] } | { error: string }
> {
  try {
    const canView = await checkUserPermission('feedback', 'view');
    if (!canView) {
      return { error: 'You do not have permission to view feedback' };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('review_feedback')
      .select(
        'id, rating, comments, customer_name, customer_email, customer_phone, contact_consent, status, staff_notes, created_at, handled_at'
      )
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = (data ?? []) as ReviewFeedbackRow[];
    return { success: true, data: rows.map(mapRow) };
  } catch (error: unknown) {
    console.error('Failed to list review feedback:', error);
    return { error: getErrorMessage(error) };
  }
}

export async function updateReviewFeedbackStatus(input: {
  id: string;
  status: ReviewFeedbackStatus;
  staffNotes?: string;
}): Promise<{ success: true } | { error: string }> {
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

    const updatePayload: {
      status: ReviewFeedbackStatus;
      handled_by: string;
      handled_at: string;
      staff_notes?: string;
    } = {
      status: validated.status,
      handled_by: user.id,
      handled_at: new Date().toISOString(),
    };

    if (validated.staffNotes !== undefined) {
      updatePayload.staff_notes = validated.staffNotes;
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('review_feedback')
      .update(updatePayload)
      .eq('id', validated.id);

    if (error) throw error;

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'review_feedback',
      resource_id: validated.id,
      operation_status: 'success',
      new_values: {
        status: validated.status,
        ...(validated.staffNotes !== undefined && { staff_notes: validated.staffNotes }),
      },
    });

    revalidatePath('/feedback-inbox');
    return { success: true };
  } catch (error: unknown) {
    console.error('Failed to update review feedback status:', error);
    if (error instanceof z.ZodError) {
      return { error: error.errors[0]?.message ?? 'Invalid feedback update' };
    }
    return { error: getErrorMessage(error) };
  }
}

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import toast from 'react-hot-toast';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { publishRotaWeek } from '@/app/actions/rota';
import type { RotaShift, RotaWeek } from '@/app/actions/rota';

function shiftIsUnpublished(shift: RotaShift, week: RotaWeek): boolean {
  if (week.status === 'draft') return true;
  if (!week.published_at) return false;
  return shift.created_at > week.published_at || shift.updated_at > week.published_at;
}

export default function RotaPublishStatus({
  week,
  shifts,
  canPublish,
}: {
  week: RotaWeek;
  shifts: RotaShift[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [publishPending, startPublishTransition] = useTransition();
  const activeShifts = shifts.filter(shift => shift.status !== 'cancelled');
  const unpublishedShifts = activeShifts.filter(shift => shiftIsUnpublished(shift, week));
  const hasAnyUnpublished = unpublishedShifts.length > 0;
  const hasAnyPublished = unpublishedShifts.length < activeShifts.length && activeShifts.length > 0;
  const isPublished = week.status === 'published' && !hasAnyUnpublished;
  const isDraft = !isPublished && !hasAnyPublished;
  const label = isPublished
    ? 'Published'
    : isDraft
      ? 'Draft'
      : 'Unpublished changes';
  const Icon = isPublished ? CheckCircleIcon : ExclamationTriangleIcon;
  const statusClasses = isPublished
    ? 'border-green-200 bg-green-50 text-green-700'
    : 'border-amber-200 bg-amber-50 text-amber-800';

  const handlePublish = () => {
    startPublishTransition(async () => {
      const result = await publishRotaWeek(week.id);
      if (!result.success) {
        toast.error((result as { success: false; error: string }).error);
        return;
      }
      toast.success('Rota published');
      router.refresh();
    });
  };

  return (
    <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium ${statusClasses}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
      {!isPublished && canPublish && (
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishPending}
          className="ml-1 rounded border border-current/30 bg-white/60 px-2 py-0.5 text-[11px] font-semibold hover:bg-white disabled:opacity-50"
        >
          {publishPending ? 'Publishing...' : 'Publish'}
        </button>
      )}
    </div>
  );
}

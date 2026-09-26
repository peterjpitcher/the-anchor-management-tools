'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button, toast, Icon } from '@/ds';
import { publishRotaWeek } from '@/app/actions/rota';
import type { RotaShift, RotaWeek } from '@/app/actions/rota';
import { shiftIsUnpublished, getRemovedPublishedShifts, type PublishedShiftSnapshot } from '@/lib/rota/publish-status';

export default function RotaPublishStatus({
  week,
  shifts,
  publishedShifts,
  canPublish,
}: {
  week: RotaWeek;
  shifts: RotaShift[];
  publishedShifts: PublishedShiftSnapshot[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [publishPending, startPublishTransition] = useTransition();
  const publishedShiftById = new Map(publishedShifts.map(shift => [shift.id, shift]));
  const activeShifts = shifts.filter(shift => shift.status !== 'cancelled');
  const unpublishedShifts = activeShifts.filter(shift => shiftIsUnpublished(shift, week, publishedShiftById));
  // Deletions leave no live tile to flag, so also count shifts removed since publish.
  const removedShifts = getRemovedPublishedShifts(shifts, week, publishedShifts);
  const hasAnyUnpublished = unpublishedShifts.length > 0 || removedShifts.length > 0;
  const hasAnyPublished = unpublishedShifts.length < activeShifts.length && activeShifts.length > 0;
  const isPublished = week.status === 'published' && !hasAnyUnpublished;
  const isDraft = !isPublished && !hasAnyPublished;
  const label = isPublished
    ? 'Published'
    : isDraft
      ? 'Draft'
      : 'Unpublished changes';
  const iconName = isPublished ? 'checkCircle' : 'alertTriangle';
  const statusClasses = isPublished
    ? 'border-success-border bg-success-soft text-success-fg'
    : 'border-warning-border bg-warning-soft text-warning-fg';

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
      <Icon name={iconName} size={16} className="shrink-0" />
      <span>{label}</span>
      {!isPublished && canPublish && (
        <Button
          type="button"
          variant="primary"
          size="xs"
          onClick={handlePublish}
          disabled={publishPending}
          className="ml-1"
        >
          {publishPending ? 'Publishing...' : 'Publish'}
        </Button>
      )}
    </div>
  );
}

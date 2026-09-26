'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button, toast } from '@/ds';
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
  const isPublished = week.status === 'published' && !hasAnyUnpublished;

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

  // Rendered last in the page's header actions: the primary Publish button, while the week has
  // anything unpublished. The week's status shows as the Badge on the Schedule card, not here.
  if (isPublished || !canPublish) return null;
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={handlePublish}
      loading={publishPending}
    >
      Publish
    </Button>
  );
}

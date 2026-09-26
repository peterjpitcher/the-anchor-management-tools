'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Badge, Button, toast, Icon } from '@/ds';
import { publishRotaWeek } from '@/app/actions/rota';
import type { RotaShift, RotaWeek } from '@/app/actions/rota';
import { shiftIsUnpublished, getRemovedPublishedShifts, type PublishedShiftSnapshot } from '@/lib/rota/publish-status';
import {
  ROTA_WEEK_PUBLISH_ICON,
  ROTA_WEEK_PUBLISH_LABEL,
  ROTA_WEEK_PUBLISH_TONE,
  type RotaWeekPublishState,
} from './_shared/status-ui';

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
  const state: RotaWeekPublishState = isPublished
    ? 'published'
    : isDraft
      ? 'draft'
      : 'unpublished_changes';

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

  // Rendered in the page's header actions: the status badge, then the primary Publish button,
  // which is last in the row.
  return (
    <>
      <Badge
        tone={ROTA_WEEK_PUBLISH_TONE[state]}
        icon={<Icon name={ROTA_WEEK_PUBLISH_ICON[state]} size={12} />}
      >
        {ROTA_WEEK_PUBLISH_LABEL[state]}
      </Badge>
      {!isPublished && canPublish && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handlePublish}
          loading={publishPending}
        >
          {publishPending ? 'Publishing...' : 'Publish'}
        </Button>
      )}
    </>
  );
}

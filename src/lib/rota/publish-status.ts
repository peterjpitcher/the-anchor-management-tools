export type PublishedShiftSnapshot = {
  id: string;
  employee_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  status: string;
  notes: string | null;
  is_overnight: boolean;
  is_open_shift: boolean;
  name: string | null;
};

export type RotaPublishWeek = {
  status: 'draft' | 'published';
  published_at: string | null;
};

export type RotaPublishShift = PublishedShiftSnapshot & {
  reassignment_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeTime(value: string): string {
  return value.length > 5 ? value.slice(0, 5) : value;
}

function hasPublishedRotaDifference(shift: RotaPublishShift, published: PublishedShiftSnapshot): boolean {
  return (
    shift.employee_id !== published.employee_id ||
    shift.shift_date !== published.shift_date ||
    normalizeTime(shift.start_time) !== normalizeTime(published.start_time) ||
    normalizeTime(shift.end_time) !== normalizeTime(published.end_time) ||
    Number(shift.unpaid_break_minutes) !== Number(published.unpaid_break_minutes) ||
    shift.department !== published.department ||
    shift.status !== published.status ||
    (shift.notes ?? null) !== (published.notes ?? null) ||
    Boolean(shift.is_overnight) !== Boolean(published.is_overnight) ||
    Boolean(shift.is_open_shift) !== Boolean(published.is_open_shift) ||
    (shift.name ?? null) !== (published.name ?? null)
  );
}

export function shiftIsUnpublished(
  shift: RotaPublishShift,
  week: RotaPublishWeek,
  publishedShiftById: Map<string, PublishedShiftSnapshot>,
): boolean {
  if (shift.status === 'sick') return false;
  if (shift.is_open_shift && shift.reassignment_reason?.startsWith("Couldn't Work")) return false;
  if (week.status === 'draft') return true;
  if (!week.published_at) return false;

  const published = publishedShiftById.get(shift.id);
  if (!published) return true;

  return hasPublishedRotaDifference(shift, published);
}

/**
 * Shifts that existed in the last published snapshot but no longer have a live shift
 * row (i.e. deleted since publish). {@link shiftIsUnpublished} is driven by live rows,
 * so it detects additions and edits but is structurally blind to deletions — a removed
 * shift leaves no live tile to flag. This walks the snapshot instead so deletions are
 * still surfaced as pending changes, keeping the UI in step with the week-level
 * `has_unpublished_changes` flag (which every delete sets). Returns [] for draft or
 * never-published weeks, where there is no snapshot to diff against.
 */
export function getRemovedPublishedShifts(
  liveShifts: { id: string }[],
  week: RotaPublishWeek,
  publishedShifts: PublishedShiftSnapshot[],
): PublishedShiftSnapshot[] {
  if (week.status !== 'published' || !week.published_at) return [];
  const liveIds = new Set(liveShifts.map(shift => shift.id));
  return publishedShifts.filter(published => !liveIds.has(published.id));
}

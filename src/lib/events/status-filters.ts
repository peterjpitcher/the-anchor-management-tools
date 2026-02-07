const UNAVAILABLE_EVENT_STATUSES = new Set(['sold_out', 'cancelled', 'draft']);

type StatusFilterResolution = {
  statuses: string[] | null;
  applyAvailabilityFilter: boolean;
  emptyResult: boolean;
};

export function resolveStatusFilters(statusParam: string | null, availableOnly: boolean): StatusFilterResolution {
  const parsedStatuses =
    statusParam && statusParam !== 'all'
      ? statusParam
          .split(',')
          .map((status) => status.trim())
          .filter(Boolean)
      : null;

  if (!availableOnly) {
    return { statuses: parsedStatuses, applyAvailabilityFilter: false, emptyResult: false };
  }

  if (!parsedStatuses) {
    return { statuses: null, applyAvailabilityFilter: true, emptyResult: false };
  }

  const availableStatuses = parsedStatuses.filter((status) => !UNAVAILABLE_EVENT_STATUSES.has(status));
  if (availableStatuses.length === 0) {
    return { statuses: null, applyAvailabilityFilter: false, emptyResult: true };
  }

  return { statuses: availableStatuses, applyAvailabilityFilter: false, emptyResult: false };
}

const MAX_EVENT_SEARCH_LENGTH = 120;

export function buildEventSearchOrFilter(rawSearch: string | null | undefined): string | null {
  const normalized = normalizeEventSearch(rawSearch);
  if (!normalized) {
    return null;
  }

  const wildcard = `*${escapeOrFilterValue(normalized)}*`;
  return [
    `name.ilike.${wildcard}`,
    `short_description.ilike.${wildcard}`,
    `long_description.ilike.${wildcard}`,
    `slug.ilike.${wildcard}`,
    `performer_name.ilike.${wildcard}`,
  ].join(",");
}

export function normalizeEventSearch(rawSearch: string | null | undefined): string | null {
  if (!rawSearch) {
    return null;
  }

  const normalized = rawSearch
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EVENT_SEARCH_LENGTH);

  return normalized.length ? normalized : null;
}

function escapeOrFilterValue(value: string): string {
  return value
    .replace(/[%_*(),.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

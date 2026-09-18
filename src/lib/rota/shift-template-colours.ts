export const SHIFT_TEMPLATE_COLOURS = [
  { label: 'Light blue', value: '#7DD3FC' },
  { label: 'Dark blue', value: '#1E3A8A' },
  { label: 'Yellow', value: '#FACC15' },
  { label: 'Orange', value: '#F97316' },
  { label: 'Purple', value: '#9333EA' },
  { label: 'Green', value: '#16A34A' },
  { label: 'Black', value: '#111827' },
  { label: 'White', value: '#FFFFFF' },
] as const;

/**
 * The colour for a calendar note with none stored, and for a new note: the first option, light
 * blue (design decision A11, 18 Sep 2026). Calendar notes pick from this same list
 * (src/components/schedule-calendar/appearance.ts). It lives here, not in the calendar
 * components, so server actions and data loaders can read it too.
 */
export const DEFAULT_CALENDAR_NOTE_COLOUR: string = SHIFT_TEMPLATE_COLOURS[0].value;

export function getAutomaticShiftColour(department: string, startTime: string): string | null {
  const normalisedDepartment = department.trim().toLowerCase();
  const normalisedStartTime = startTime.slice(0, 5);
  const [hours, minutes] = normalisedStartTime.split(':').map(Number);
  const startMinutes = Number.isFinite(hours) && Number.isFinite(minutes)
    ? hours * 60 + minutes
    : null;

  if (normalisedDepartment.includes('runner')) return '#9333EA';
  if (normalisedDepartment.includes('training')) return '#16A34A';
  if (normalisedDepartment.includes('host')) return '#111827';
  if (normalisedDepartment.includes('clean')) return '#FFFFFF';

  if (normalisedDepartment.includes('bar')) {
    if (normalisedStartTime === '12:00') return '#7DD3FC';
    if (startMinutes !== null && startMinutes >= 16 * 60) return '#1E3A8A';
  }

  if (normalisedDepartment.includes('kitchen') && startMinutes !== null) {
    return startMinutes < 16 * 60 ? '#FACC15' : '#F97316';
  }

  return null;
}

type ShiftColourSource = { department: string; start_time: string };

/**
 * The colour /rota draws a shift in. A template's colour wins only when a manager picked it by
 * hand (it differs from the automatic colour for the template's own role and start time);
 * otherwise the shift's own role and start time decide. Null means neither gives a colour, and
 * the shift falls back to its department look.
 *
 * The one copy of the rule: /rota (RotaGrid.tsx) and the printed rota
 * (src/app/api/rota/pdf/route.ts) both call it, so paper matches the screen.
 */
export function resolveShiftColour(
  shift: ShiftColourSource & { template_id: string | null },
  template: (ShiftColourSource & { colour: string | null }) | null | undefined,
): string | null {
  const automaticColour = getAutomaticShiftColour(shift.department, shift.start_time);
  if (!shift.template_id || !template?.colour) return automaticColour;

  const templateAutomaticColour = getAutomaticShiftColour(template.department, template.start_time);
  const hasManualOverride = !templateAutomaticColour
    || template.colour.toLowerCase() !== templateAutomaticColour.toLowerCase();

  return hasManualOverride ? template.colour : (automaticColour ?? template.colour);
}

export function shiftColourNeedsLightText(colour: string | null): boolean {
  if (!colour) return false;
  return ['#1E3A8A', '#9333EA', '#16A34A', '#111827'].includes(colour.toUpperCase());
}

export function getShiftColourLabel(colour: string | null): string | null {
  if (!colour) return null;
  return SHIFT_TEMPLATE_COLOURS.find(option => option.value.toLowerCase() === colour.toLowerCase())?.label ?? null;
}

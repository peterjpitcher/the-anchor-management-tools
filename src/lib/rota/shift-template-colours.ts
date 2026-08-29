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

export function shiftColourNeedsLightText(colour: string | null): boolean {
  if (!colour) return false;
  return ['#1E3A8A', '#9333EA', '#16A34A', '#111827'].includes(colour.toUpperCase());
}

export function getShiftColourLabel(colour: string | null): string | null {
  if (!colour) return null;
  return SHIFT_TEMPLATE_COLOURS.find(option => option.value.toLowerCase() === colour.toLowerCase())?.label ?? null;
}

export function snapToInterval(
  offsetPx: number,
  containerWidthPx: number,
  timelineStartMin: number,
  timelineEndMin: number,
  durationMinutes: number,
  intervalMinutes: number
): { snappedMinutes: number; timeString: string } {
  const timelineDurationMin = timelineEndMin - timelineStartMin;

  // Convert pixel offset to minutes from timeline start
  const rawMinutesFromStart = (offsetPx / containerWidthPx) * timelineDurationMin;

  // Snap to nearest interval
  const snappedFromStart = Math.round(rawMinutesFromStart / intervalMinutes) * intervalMinutes;

  // Convert to absolute minutes since midnight
  let snappedMinutes = timelineStartMin + snappedFromStart;

  // Clamp start: cannot be before timeline start
  snappedMinutes = Math.max(snappedMinutes, timelineStartMin);

  // Clamp end: booking must not overflow timeline end
  snappedMinutes = Math.min(snappedMinutes, timelineEndMin - durationMinutes);

  // Format as "HH:MM"
  const hours = Math.floor(snappedMinutes / 60);
  const minutes = snappedMinutes % 60;
  const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  return { snappedMinutes, timeString };
}

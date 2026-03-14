import { describe, it, expect } from 'vitest';
import { snapToInterval } from './snapToInterval';

const BASE = {
  containerWidthPx: 1200,
  timelineStartMin: 540, // 09:00
  timelineEndMin: 1380, // 23:00
  durationMinutes: 120,
  intervalMinutes: 15,
};

describe('snapToInterval', () => {
  it('snaps to nearest 15-minute interval', () => {
    // 150/1200 * 840 = 105 min from start → 540+105=645 (10:45)
    const result = snapToInterval(150, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
    expect(result.snappedMinutes).toBe(645);
    expect(result.timeString).toBe('10:45');
  });

  it('produces leading-zero time strings', () => {
    // offsetPx=0 → snappedMinutes=540, timeString='09:00'
    const result = snapToInterval(0, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
    expect(result.snappedMinutes).toBe(540);
    expect(result.timeString).toBe('09:00');
  });

  it('clamps start to timelineStartMin when offset is negative', () => {
    // offsetPx=-50 → clamped to timelineStartMin=540
    const result = snapToInterval(-50, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
    expect(result.snappedMinutes).toBe(540);
    expect(result.timeString).toBe('09:00');
  });

  it('clamps end so booking does not overflow timelineEndMin', () => {
    // offsetPx=1200 → would be 1380, but clamped to 1380-120=1260 (21:00)
    const result = snapToInterval(1200, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
    expect(result.snappedMinutes).toBe(1260);
    expect(result.timeString).toBe('21:00');
  });

  it('rounds up to next interval when past mid-point', () => {
    // 8 min past 540 → absolute=548, rawFromStart=8
    // 8/15=0.533... > 0.5 → rounds to 1 → 1*15=15 → 540+15=555 (09:15)
    // offsetPx for 8 min from start: 8/840 * 1200 = ~11.43px
    const offsetPx = (8 / 840) * 1200;
    const result = snapToInterval(offsetPx, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
    expect(result.snappedMinutes).toBe(555);
    expect(result.timeString).toBe('09:15');
  });

  it('timeString is always length 5 in "HH:MM" format', () => {
    const testCases = [0, 150, 300, 600, 900, 1100];
    for (const offsetPx of testCases) {
      const result = snapToInterval(offsetPx, BASE.containerWidthPx, BASE.timelineStartMin, BASE.timelineEndMin, BASE.durationMinutes, BASE.intervalMinutes);
      expect(result.timeString).toHaveLength(5);
      expect(result.timeString).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ROTA_SHIFT_STATUS_CLASSES, rotaShiftStatusClasses } from '../status-ui';

describe('rota shift status colours', () => {
  it.each([
    ['scheduled', 'bg-surface text-text border-border'],
    ['pending', 'bg-warning-soft text-warning-fg border-warning-border'],
    ['accepted', 'bg-success-soft text-success-fg border-success-border'],
    ['auto_accepted', 'bg-success-soft text-success-fg border-success-border'],
    ['sick', 'bg-danger-soft text-danger-fg border-danger-border'],
    ['rejected', 'border border-dashed border-danger text-danger-fg bg-surface'],
    ['cancelled', 'bg-surface-2 text-text-muted border-border'],
  ])('gives %s the agreed token classes', (status, classes) => {
    expect(rotaShiftStatusClasses(status)).toBe(classes);
    expect(ROTA_SHIFT_STATUS_CLASSES[status as keyof typeof ROTA_SHIFT_STATUS_CLASSES]).toBe(classes);
  });

  it('keeps a rejected shift distinct from a Couldn\'t Work shift', () => {
    expect(rotaShiftStatusClasses('rejected')).not.toBe(rotaShiftStatusClasses('sick'));
    expect(rotaShiftStatusClasses('rejected')).toContain('border-dashed');
  });

  it('falls back to a plain scheduled shift for anything it does not know, including Object property names', () => {
    for (const status of ['something_new', '', 'toString', 'constructor', '__proto__']) {
      expect(rotaShiftStatusClasses(status)).toBe(ROTA_SHIFT_STATUS_CLASSES.scheduled);
    }
  });
});

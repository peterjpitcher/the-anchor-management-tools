import { describe, expect, it } from 'vitest';
import { CATEGORY, CHART_SERIES, STAFF } from '@/lib/brand/palette';
import {
  ROTA_CALENDAR_NOTE_CLASSES,
  ROTA_CHART_COLOURS,
  ROTA_CHART_PRINT_COLOURS,
  ROTA_DAY_INFO_CLASSES,
  ROTA_DEPARTMENT_CATEGORIES,
  ROTA_DEPARTMENT_CLASSES,
  ROTA_DEPARTMENT_FALLBACK_CLASSES,
  ROTA_HOLIDAY_CLASSES,
  ROTA_HOURS_SERIES_COLOURS,
  ROTA_SHIFT_STATUS_CLASSES,
  rotaDepartmentCategory,
  rotaDepartmentClasses,
  rotaShiftStatusClasses,
} from '../status-ui';

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

describe('rota holiday colours', () => {
  it('shows approved holiday as success and a waiting request as warning, like accepted and pending shifts', () => {
    expect(ROTA_HOLIDAY_CLASSES.approved).toBe(ROTA_SHIFT_STATUS_CLASSES.accepted);
    expect(ROTA_HOLIDAY_CLASSES.pending).toBe(ROTA_SHIFT_STATUS_CLASSES.pending);
  });

  it('gives charts the same meanings as CSS colours: holiday success, Couldn\'t Work danger', () => {
    expect(ROTA_CHART_COLOURS).toEqual({
      holiday: 'var(--color-success)',
      couldntWork: 'var(--color-danger)',
    });
  });

  it('prints the same two meanings with the palette values of the same tokens', () => {
    expect(ROTA_CHART_PRINT_COLOURS).toEqual({
      holiday: STAFF.success,
      couldntWork: STAFF.danger,
    });
  });
});

describe('hours report line colours', () => {
  /** The palette value of a CSS token such as var(--color-chart-2) or var(--color-cat-5). */
  function paletteValue(css: string): string {
    const match = css.match(/^var\(--color-(chart|cat)-([1-8])\)$/);
    if (!match) throw new Error(`not a chart or category token: ${css}`);
    const index = Number(match[2]) - 1;
    return match[1] === 'chart' ? CHART_SERIES[index] : CATEGORY[index].base;
  }

  it('prints each person in the palette value of the colour the screen draws them in', () => {
    for (const { css, print } of ROTA_HOURS_SERIES_COLOURS) {
      expect(print).toBe(paletteValue(css));
    }
  });

  it('keeps the screen order: the six chart colours, then cat-2, cat-5 and cat-8', () => {
    expect(ROTA_HOURS_SERIES_COLOURS.map(colour => colour.css)).toEqual([
      'var(--color-chart-1)',
      'var(--color-chart-2)',
      'var(--color-chart-3)',
      'var(--color-chart-4)',
      'var(--color-chart-5)',
      'var(--color-chart-6)',
      'var(--color-cat-2)',
      'var(--color-cat-5)',
      'var(--color-cat-8)',
    ]);
  });

  it('gives nine people nine different colours, none of them the holiday or Couldn\'t Work colour', () => {
    const printed = ROTA_HOURS_SERIES_COLOURS.map(colour => colour.print.toLowerCase());
    expect(new Set(printed).size).toBe(9);
    expect(printed).not.toContain(STAFF.success.toLowerCase());
    expect(printed).not.toContain(STAFF.danger.toLowerCase());
  });
});

describe('rota department colours', () => {
  it.each([
    ['bar', 'bg-cat-1-soft text-cat-1-fg border-cat-1/20'],
    ['kitchen', 'bg-cat-5-soft text-cat-5-fg border-cat-5/20'],
    ['runner', 'bg-cat-3-soft text-cat-3-fg border-cat-3/20'],
    ['host', 'bg-cat-8-soft text-cat-8-fg border-cat-8/20'],
    ['training', 'bg-cat-7-soft text-cat-7-fg border-cat-7/20'],
    ['cleaning', 'bg-cat-2-soft text-cat-2-fg border-cat-2/20'],
  ])('gives %s its category colour', (department, classes) => {
    expect(rotaDepartmentClasses(department)).toBe(classes);
    expect(ROTA_DEPARTMENT_CLASSES[department as keyof typeof ROTA_DEPARTMENT_CLASSES]).toBe(classes);
  });

  it('never puts a department on a status tone', () => {
    for (const classes of Object.values(ROTA_DEPARTMENT_CLASSES)) {
      expect(classes).not.toMatch(/\b(?:bg|text|border)-(?:success|warning|danger|info)\b/);
    }
  });

  it('matches names without regard to case or surrounding spaces', () => {
    expect(rotaDepartmentClasses(' Kitchen ')).toBe(ROTA_DEPARTMENT_CLASSES.kitchen);
  });

  it('shows departments it does not know, including Object property names, as a neutral chip', () => {
    for (const department of ['bottle_shop', '', null, undefined, 'toString', 'constructor', '__proto__']) {
      expect(rotaDepartmentClasses(department)).toBe(ROTA_DEPARTMENT_FALLBACK_CLASSES);
      expect(rotaDepartmentCategory(department)).toBeNull();
    }
  });

  it('spells out exactly the category each department takes in the one department map', () => {
    expect(Object.keys(ROTA_DEPARTMENT_CLASSES).sort()).toEqual(Object.keys(ROTA_DEPARTMENT_CATEGORIES).sort());
    for (const [department, n] of Object.entries(ROTA_DEPARTMENT_CATEGORIES)) {
      expect(ROTA_DEPARTMENT_CLASSES[department as keyof typeof ROTA_DEPARTMENT_CLASSES])
        .toBe(`bg-cat-${n}-soft text-cat-${n}-fg border-cat-${n}/20`);
    }
  });

  it('finds the category for a department the same way the screen matches it', () => {
    expect(rotaDepartmentCategory('bar')).toBe(1);
    expect(rotaDepartmentCategory(' Kitchen ')).toBe(5);
    expect(rotaDepartmentCategory('CLEANING')).toBe(2);
  });

  it('gives every department its own category', () => {
    const categories = Object.values(ROTA_DEPARTMENT_CATEGORIES);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe('rota day note colours', () => {
  it('uses a category colour for each kind of day note, never danger for a private booking', () => {
    expect(ROTA_DAY_INFO_CLASSES).toEqual({
      event: { dot: 'bg-cat-2', text: 'text-cat-2-fg' },
      private_booking: { dot: 'bg-cat-3', text: 'text-cat-3-fg' },
      covers: { dot: 'bg-cat-7', text: 'text-cat-7-fg' },
      high_chairs: { dot: 'bg-cat-1', text: 'text-cat-1-fg' },
    });
  });

  it('draws a calendar note title as ordinary text, with its own colour on an outlined swatch', () => {
    // A white or pale yellow note could not be read when the title took the note colour.
    expect(ROTA_CALENDAR_NOTE_CLASSES.text).toBe('text-text');
    expect(ROTA_CALENDAR_NOTE_CLASSES.swatch).toContain('border border-border-strong');
  });
});

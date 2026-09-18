import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_NOTE_COLOUR,
  SHIFT_TEMPLATE_COLOURS,
  getAutomaticShiftColour,
  getShiftColourLabel,
  resolveShiftColour,
  shiftColourNeedsLightText,
} from '../shift-template-colours';

describe('getAutomaticShiftColour', () => {
  it.each([
    ['bar', '12:00', '#7DD3FC'],
    ['bar', '16:00', '#1E3A8A'],
    ['bar', '17:00', '#1E3A8A'],
    ['bar', '19:00', '#1E3A8A'],
    ['kitchen', '11:30', '#FACC15'],
    ['kitchen', '12:00', '#FACC15'],
    ['kitchen', '16:00', '#F97316'],
    ['kitchen', '18:00', '#F97316'],
    ['runner', '09:00', '#9333EA'],
    ['training', '18:00', '#16A34A'],
    ['host', '09:00', '#111827'],
    ['cleaning', '09:00', '#FFFFFF'],
  ])('uses the expected colour for %s at %s', (department, startTime, expected) => {
    expect(getAutomaticShiftColour(department, startTime)).toBe(expected);
  });

  it('matches role names inside longer department names', () => {
    expect(getAutomaticShiftColour('FOH Runner', '12:00:00')).toBe('#9333EA');
  });

  it('returns no automatic colour when there is no rule', () => {
    expect(getAutomaticShiftColour('cellar', '15:00')).toBeNull();
  });
});

describe('resolveShiftColour', () => {
  const barLunch = { department: 'bar', start_time: '12:00:00', colour: '#7DD3FC' };

  it('uses the role and start time when the shift has no template', () => {
    expect(resolveShiftColour({ department: 'bar', start_time: '17:00:00', template_id: null }, null)).toBe('#1E3A8A');
  });

  it('uses the role and start time when the template has no colour', () => {
    const template = { ...barLunch, colour: null };
    expect(resolveShiftColour({ department: 'kitchen', start_time: '10:00:00', template_id: 't1' }, template)).toBe('#FACC15');
  });

  it('lets the shift own start time win when the template colour is only its automatic one', () => {
    // A lunchtime template moved to the evening goes dark blue, as on /rota.
    expect(resolveShiftColour({ department: 'bar', start_time: '18:00:00', template_id: 't1' }, barLunch)).toBe('#1E3A8A');
  });

  it('keeps a colour a manager picked by hand', () => {
    const template = { department: 'kitchen', start_time: '17:00:00', colour: '#16A34A' };
    expect(resolveShiftColour({ department: 'kitchen', start_time: '17:00:00', template_id: 't2' }, template)).toBe('#16A34A');
  });

  it('keeps a template colour when the template has no automatic colour of its own', () => {
    const template = { department: 'bar', start_time: '11:00:00', colour: '#9333EA' };
    expect(resolveShiftColour({ department: 'bar', start_time: '11:00:00', template_id: 't3' }, template)).toBe('#9333EA');
  });

  it('falls back to the template colour when the shift itself has no automatic colour', () => {
    expect(resolveShiftColour({ department: 'bar', start_time: '11:00:00', template_id: 't1' }, barLunch)).toBe('#7DD3FC');
  });

  it('returns null when neither the template nor the role and start time give a colour', () => {
    expect(resolveShiftColour({ department: 'cellar', start_time: '10:00:00', template_id: null }, null)).toBeNull();
    expect(resolveShiftColour({ department: 'cellar', start_time: '10:00:00', template_id: 'gone' }, undefined)).toBeNull();
  });

  type Template = { department: string; start_time: string; colour: string | null };
  const tpl = (department: string, start_time: string, colour: string | null): Template => ({ department, start_time, colour });

  // One rule for /rota and the printed rota, across departments, templates and hand-picked colours.
  it.each<[string, string, string, string | null, Template | null | undefined, string | null]>([
    ['runner, no template', 'runner', '09:00:00', null, null, '#9333EA'],
    ['host, no template', 'host', '18:00:00', null, null, '#111827'],
    ['training, no template', 'training', '12:00:00', null, null, '#16A34A'],
    ['cleaning, no template', 'cleaning', '06:00:00', null, null, '#FFFFFF'],
    ['a longer department name with a role in it', 'FOH Runner', '12:00:00', null, null, '#9333EA'],
    ['an unknown department, no template', 'cellar', '12:00:00', null, null, null],
    ['bar in the afternoon, no template', 'bar', '14:00:00', null, null, null],
    ['kitchen in the evening, no template', 'kitchen', '16:00:00', null, null, '#F97316'],
    ['an evening kitchen template moved to lunch', 'kitchen', '11:00:00', 't', tpl('kitchen', '17:00:00', '#F97316'), '#FACC15'],
    ['a runner template on its automatic colour', 'runner', '10:00:00', 't', tpl('runner', '10:00:00', '#9333EA'), '#9333EA'],
    ['a lunch bar template moved to the afternoon', 'bar', '14:00:00', 't', tpl('bar', '12:00:00', '#7DD3FC'), '#7DD3FC'],
    ['a colour picked for a department with no rule', 'cellar', '10:00:00', 't', tpl('cellar', '10:00:00', '#16A34A'), '#16A34A'],
    ['a hand-picked colour stored in lower case', 'bar', '18:00:00', 't', tpl('bar', '18:00:00', '#facc15'), '#facc15'],
    ['an automatic colour stored in lower case', 'bar', '18:00:00', 't', tpl('bar', '18:00:00', '#1e3a8a'), '#1E3A8A'],
    ['white picked by hand', 'host', '09:00:00', 't', tpl('host', '09:00:00', '#FFFFFF'), '#FFFFFF'],
    ['a template that is no longer active', 'kitchen', '12:00:00', 'gone', undefined, '#FACC15'],
    ['a template with no colour', 'training', '12:00:00', 't', tpl('training', '12:00:00', null), '#16A34A'],
  ])('%s', (_label, department, start_time, template_id, template, expected) => {
    expect(resolveShiftColour({ department, start_time, template_id }, template)).toBe(expected);
  });
});

describe('DEFAULT_CALENDAR_NOTE_COLOUR', () => {
  it('is the first colour in the shared palette, light blue (decision A11)', () => {
    expect(DEFAULT_CALENDAR_NOTE_COLOUR).toBe(SHIFT_TEMPLATE_COLOURS[0].value);
    expect(getShiftColourLabel(DEFAULT_CALENDAR_NOTE_COLOUR)).toBe('Light blue');
  });
});

describe('getShiftColourLabel', () => {
  it('matches hex colours without caring about case', () => {
    expect(getShiftColourLabel('#f97316')).toBe('Orange');
  });
});

describe('shiftColourNeedsLightText', () => {
  it('uses light text on the dark shift colours', () => {
    expect(shiftColourNeedsLightText('#1e3a8a')).toBe(true);
    expect(shiftColourNeedsLightText('#111827')).toBe(true);
  });

  it('uses dark text on the light shift colours', () => {
    expect(shiftColourNeedsLightText('#FACC15')).toBe(false);
    expect(shiftColourNeedsLightText('#FFFFFF')).toBe(false);
  });
});

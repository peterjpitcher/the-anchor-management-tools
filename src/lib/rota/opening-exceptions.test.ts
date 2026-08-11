import { describe, expect, it } from 'vitest';
import {
  buildOpeningExceptions,
  describeOpeningException,
  type RegularHoursRow,
  type SpecialHoursRow,
} from './opening-exceptions';

// The live regular week, copied from business_hours (0 = Sunday).
const REGULAR: RegularHoursRow[] = [
  { day_of_week: 0, opens: '12:00:00', closes: '22:00:00', kitchen_opens: '13:00:00', kitchen_closes: '18:00:00', is_closed: false, is_kitchen_closed: false },
  { day_of_week: 1, opens: '16:00:00', closes: '22:00:00', kitchen_opens: null, kitchen_closes: null, is_closed: false, is_kitchen_closed: true },
  { day_of_week: 2, opens: '16:00:00', closes: '22:00:00', kitchen_opens: '16:00:00', kitchen_closes: '21:00:00', is_closed: false, is_kitchen_closed: false },
  { day_of_week: 3, opens: '16:00:00', closes: '22:00:00', kitchen_opens: '16:00:00', kitchen_closes: '21:00:00', is_closed: false, is_kitchen_closed: false },
  { day_of_week: 4, opens: '16:00:00', closes: '22:00:00', kitchen_opens: '16:00:00', kitchen_closes: '21:00:00', is_closed: false, is_kitchen_closed: false },
  { day_of_week: 5, opens: '16:00:00', closes: '22:00:00', kitchen_opens: '16:00:00', kitchen_closes: '21:00:00', is_closed: false, is_kitchen_closed: false },
  { day_of_week: 6, opens: '12:00:00', closes: '22:00:00', kitchen_opens: '12:00:00', kitchen_closes: '19:00:00', is_closed: false, is_kitchen_closed: false },
];

function regularFor(dayOfWeek: number): RegularHoursRow {
  return REGULAR[dayOfWeek];
}

function special(overrides: Partial<SpecialHoursRow> & { date: string }): SpecialHoursRow {
  return {
    opens: null,
    closes: null,
    kitchen_opens: null,
    kitchen_closes: null,
    is_closed: false,
    is_kitchen_closed: false,
    note: null,
    ...overrides,
  };
}

describe('describeOpeningException', () => {
  it('reports a full closure as the only thing that matters', () => {
    const result = describeOpeningException(
      special({ date: '2026-12-25', is_closed: true, opens: '12:00:00', closes: '22:00:00', note: 'Christmas Day' }),
      regularFor(5),
    );

    expect(result?.tone).toBe('danger');
    expect(result?.chips).toEqual([{ label: 'Closed all day', tone: 'danger' }]);
    expect(result?.note).toBe('Christmas Day');
  });

  it('treats a midnight close as closing later, not earlier', () => {
    // Live Halloween row: bar runs to midnight, kitchen finishes an hour early.
    const result = describeOpeningException(
      special({
        date: '2026-10-31',
        opens: '12:00:00',
        closes: '00:00:00',
        kitchen_opens: '12:00:00',
        kitchen_closes: '18:00:00',
        note: 'Halloween: pub open 12pm to midnight.',
      }),
      regularFor(6),
    );

    expect(result?.chips[0]).toEqual({ label: 'Bar 12pm-12am', tone: 'info' });
    expect(result?.details[0]).toBe('Bar open 12pm to 12am (usually 12pm to 10pm).');
    expect(result?.chips[1]).toEqual({ label: 'Kitchen 12pm-6pm', tone: 'warning' });
    expect(result?.details[1]).toContain('Closes earlier than usual.');
  });

  it('flags a later opening as the risky direction', () => {
    const result = describeOpeningException(
      special({ date: '2026-09-05', opens: '17:00:00', closes: '22:00:00', kitchen_opens: '17:00:00', kitchen_closes: '21:00:00' }),
      regularFor(6),
    );

    expect(result?.tone).toBe('warning');
    expect(result?.chips[0]).toEqual({ label: 'Bar 5pm-10pm', tone: 'warning' });
    expect(result?.details[0]).toContain('Opens later than usual.');
  });

  it('calls out a kitchen-only closure separately from the bar', () => {
    // Live 2026-05-07 row: bar unchanged, kitchen shut for the day.
    const result = describeOpeningException(
      special({ date: '2026-05-07', opens: '16:00:00', closes: '22:00:00', is_kitchen_closed: true, note: 'Kitchen closed today' }),
      regularFor(4),
    );

    expect(result?.chips).toEqual([{ label: 'Kitchen closed', tone: 'warning' }]);
    expect(result?.details[0]).toBe('Kitchen closed all day (usually 4pm to 9pm), so no kitchen shifts are needed.');
  });

  it('treats missing kitchen times as a closed kitchen even when the flag says otherwise', () => {
    // Live May Day row: is_kitchen_closed is false but there are no kitchen times.
    const result = describeOpeningException(
      special({ date: '2026-05-04', opens: '16:00:00', closes: '22:00:00', note: 'May Day bank holiday, kitchen closed for the day.' }),
      regularFor(1),
    );

    // Mondays never have a kitchen, so there is no kitchen change to report.
    expect(result?.chips).toEqual([]);
    expect(result?.note).toBe('May Day bank holiday, kitchen closed for the day.');
  });

  it('reports a kitchen opening on a day that normally has none', () => {
    const result = describeOpeningException(
      special({ date: '2026-09-07', opens: '16:00:00', closes: '22:00:00', kitchen_opens: '18:00:00', kitchen_closes: '21:00:00' }),
      regularFor(1),
    );

    expect(result?.chips).toEqual([{ label: 'Kitchen 6pm-9pm', tone: 'info' }]);
    expect(result?.details[0]).toContain('usually closed');
  });

  it('drops a row that simply restates the regular week', () => {
    const result = describeOpeningException(
      special({ date: '2026-03-22', opens: '12:00:00', closes: '22:00:00', kitchen_opens: '13:00:00', kitchen_closes: '18:00:00' }),
      regularFor(0),
    );

    expect(result).toBeNull();
  });

  it('keeps a row whose only change is the note', () => {
    const result = describeOpeningException(
      special({
        date: '2026-03-08',
        opens: '12:00:00',
        closes: '22:00:00',
        kitchen_opens: '13:00:00',
        kitchen_closes: '18:00:00',
        note: 'Sunday Lunch closed for this Sunday',
      }),
      regularFor(0),
    );

    expect(result?.chips).toEqual([]);
    expect(result?.details).toEqual([]);
    expect(result?.note).toBe('Sunday Lunch closed for this Sunday');
  });

  it('shows everything when there is no regular row to compare against', () => {
    const result = describeOpeningException(
      special({ date: '2026-09-05', opens: '12:00:00', closes: '22:00:00', kitchen_opens: '12:00:00', kitchen_closes: '19:00:00' }),
      undefined,
    );

    expect(result?.details[0]).toBe('Bar open 12pm to 10pm.');
  });
});

describe('buildOpeningExceptions', () => {
  it('matches each date to the right weekday during British Summer Time', () => {
    // 5 July 2026 is a Sunday. A local-time parse on a UTC server would slip to
    // Saturday and compare against the wrong regular row.
    const result = buildOpeningExceptions(
      [special({ date: '2026-07-05', opens: '12:00:00', closes: '22:00:00', kitchen_opens: '13:00:00', kitchen_closes: '16:00:00' })],
      REGULAR,
    );

    expect(result['2026-07-05'].chips).toEqual([{ label: 'Kitchen 1pm-4pm', tone: 'warning' }]);
  });

  it('keys only the days that are genuine exceptions', () => {
    const result = buildOpeningExceptions(
      [
        special({ date: '2026-03-22', opens: '12:00:00', closes: '22:00:00', kitchen_opens: '13:00:00', kitchen_closes: '18:00:00' }),
        special({ date: '2026-03-28', opens: '12:00:00', closes: '22:00:00', is_kitchen_closed: true }),
      ],
      REGULAR,
    );

    expect(Object.keys(result)).toEqual(['2026-03-28']);
  });
});

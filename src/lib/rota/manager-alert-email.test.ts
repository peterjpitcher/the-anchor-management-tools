import { describe, expect, it } from 'vitest';
import { buildManagerAlertEmailHtml, type UnfilledShiftSummary } from './email-templates';

const rejectedShift: UnfilledShiftSummary = {
  date: '2026-08-22',
  startTime: '18:00',
  endTime: '22:00',
  department: 'bar',
  templateName: 'Friday evening',
  rejectedByName: 'Ryan Bond',
  rejectionNote: 'Away at a wedding',
};

const plainOpenShift: UnfilledShiftSummary = {
  date: '2026-08-29',
  startTime: '12:00',
  endTime: '17:00',
  department: 'kitchen',
  templateName: null,
  rejectedByName: null,
  rejectionNote: null,
};

describe('buildManagerAlertEmailHtml', () => {
  it('chases an unpublished week with no unfilled shifts', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', 'not_published');
    expect(html).toContain('has not been published yet');
    expect(html).toContain('Staff emails are scheduled for 21:00');
    expect(html).not.toContain('needs somebody');
    expect(html).not.toContain('/rota/reassign');
  });

  it('chases unfilled shifts even when the week is fully published', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', null, [rejectedShift]);
    // Nothing to publish, so none of the publishing copy should appear.
    expect(html).not.toContain('has not been published yet');
    expect(html).not.toContain('unpublished changes');
    expect(html).toContain('1 shift still needs somebody');
    expect(html).toContain('Turned down by Ryan Bond');
    expect(html).toContain('Away at a wedding');
    expect(html).toContain('/rota/reassign');
  });

  it('separates rejected shifts from plain open ones in the count', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', null, [rejectedShift, plainOpenShift]);
    expect(html).toContain('2 shifts still need somebody');
    expect(html).toContain('1 of these was turned down by staff');
    // The unrejected one is listed but carries no rejection attribution.
    expect(html).toContain('kitchen');
    expect(html.match(/Turned down by/g)).toHaveLength(1);
  });

  it('says nothing about rejections when every open shift was simply unassigned', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', null, [plainOpenShift]);
    expect(html).toContain('These are open shifts with nobody assigned.');
    expect(html).not.toContain('Turned down by');
  });

  it('reports both problems in one email', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', 'unpublished_changes', [rejectedShift]);
    expect(html).toContain('unpublished changes');
    expect(html).toContain('1 shift still needs somebody');
  });

  it('escapes staff-supplied rejection text', () => {
    const html = buildManagerAlertEmailHtml('2026-08-17', null, [
      { ...rejectedShift, rejectionNote: '<script>alert(1)</script>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

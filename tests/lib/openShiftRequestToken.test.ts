import { describe, expect, it, beforeEach } from 'vitest';
import {
  createOpenShiftApprovalToken,
  verifyOpenShiftApprovalToken,
  type OpenShiftApprovalTokenPayload,
} from '@/lib/rota/open-shift-request-token';

const payload: OpenShiftApprovalTokenPayload = {
  v: 1,
  requestId: '11111111-1111-4111-8111-111111111111',
  shiftId: '22222222-2222-4222-8222-222222222222',
  employeeId: '33333333-3333-4333-8333-333333333333',
  requestedAt: '2026-06-24T12:00:00.000Z',
  expected: {
    shiftDate: '2026-07-25',
    startTime: '18:00:00',
    endTime: '22:00:00',
    unpaidBreakMinutes: 0,
    department: 'bar',
    isOvernight: false,
    name: 'Saturday Close',
  },
};

describe('open shift request approval token', () => {
  beforeEach(() => {
    process.env.OPEN_SHIFT_REQUEST_TOKEN_SECRET = 'test-secret';
  });

  it('round-trips a signed token', () => {
    const token = createOpenShiftApprovalToken(payload);
    expect(verifyOpenShiftApprovalToken(token)).toEqual(payload);
  });

  it('rejects a tampered token', () => {
    const token = createOpenShiftApprovalToken(payload);
    const [body, signature] = token.split('.');
    const tamperedBody = Buffer
      .from(JSON.stringify({ ...payload, employeeId: '44444444-4444-4444-8444-444444444444' }))
      .toString('base64url');

    expect(verifyOpenShiftApprovalToken(`${tamperedBody}.${signature}`)).toBeNull();
    expect(verifyOpenShiftApprovalToken(`${body}.bad-signature`)).toBeNull();
  });
});

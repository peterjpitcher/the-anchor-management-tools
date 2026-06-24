import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

const TokenPayloadSchema = z.object({
  v: z.literal(1),
  requestId: z.string().uuid(),
  shiftId: z.string().uuid(),
  employeeId: z.string().uuid(),
  requestedAt: z.string(),
  expected: z.object({
    shiftDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    unpaidBreakMinutes: z.number().int().min(0),
    department: z.string(),
    isOvernight: z.boolean(),
    name: z.string().nullable(),
  }),
});

export type OpenShiftApprovalTokenPayload = z.infer<typeof TokenPayloadSchema>;

function getTokenSecret(): string {
  const secret = process.env.OPEN_SHIFT_REQUEST_TOKEN_SECRET
    ?? process.env.CALENDAR_TOKEN_SECRET
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('OPEN_SHIFT_REQUEST_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set');
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', getTokenSecret()).update(value).digest('base64url');
}

export function createOpenShiftApprovalToken(payload: OpenShiftApprovalTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyOpenShiftApprovalToken(token: string): OpenShiftApprovalTokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = sign(encodedPayload);
  if (expectedSignature.length !== signature.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) return null;
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return TokenPayloadSchema.parse(parsed);
  } catch {
    return null;
  }
}

import { createHash } from 'crypto';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

export interface ApiKey {
  id: string;
  name: string;
  permissions: string[];
  rate_limit: number;
  is_active: boolean;
  expires_at?: string | null;
}

export async function hashApiKey(key: string): Promise<string> {
  return createHash('sha256').update(key).digest('hex');
}

export async function generateApiKey(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'anch_' + Buffer.from(bytes).toString('base64url');
}

/**
 * The three genuinely different answers to "is this caller authenticated?".
 *
 * `unavailable` is the one that used to be missing. Collapsing a database
 * failure into `invalid` made an outage indistinguishable from a forged key,
 * and callers that treat "not authenticated" as "anonymous browser" then drew
 * exactly the wrong conclusion: the public booking routes sent a website
 * request to their Turnstile gate and rejected the guest for failing a bot
 * check they had actually passed. Follows the same convention as
 * checkRateLimit, which already returns null so callers can fail explicitly.
 */
export type ApiKeyAuthState = 'authenticated' | 'anonymous' | 'unavailable';

type ApiKeyResolution =
  | { state: 'authenticated'; key: ApiKey }
  | { state: 'anonymous' }
  | { state: 'unavailable' };

async function resolveApiKey(apiKey: string | null): Promise<ApiKeyResolution> {
  if (!apiKey) {
    return { state: 'anonymous' };
  }

  // Use admin client for API key validation since api_keys table requires elevated permissions
  const supabase = createAdminClient();
  const keyHash = await hashApiKey(apiKey);

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, permissions, rate_limit, is_active, expires_at')
    .eq('key_hash', keyHash)
    .eq('is_active', true);

  if (error) {
    // Infrastructure, not the caller. Say so, rather than blaming the key.
    console.error('[API Auth] Failed to validate API key');
    return { state: 'unavailable' };
  }

  if (!data || data.length === 0) {
    return { state: 'anonymous' };
  }

  if (data.length > 1) {
    console.error('[API Auth] Duplicate active API key hashes detected');
  }

  const keyData = data[0];

  // Check expiry
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    console.warn('[API Auth] Rejected expired API key', { id: keyData.id });
    return { state: 'anonymous' };
  }

  // Fire-and-forget — don't block the response for observational timestamp update
  Promise.resolve(
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id)
      .select('id')
      .maybeSingle()
  )
    .then(({ error: updateError, data: updatedKey }) => {
      if (updateError) {
        console.error('[API Auth] Failed to update API key last_used_at');
      } else if (!updatedKey) {
        console.error('[API Auth] API key disappeared before last_used_at could be updated');
      }
    })
    .catch((err: unknown) =>
      console.warn('[API Auth] Failed to update last_used_at', {
        error: err instanceof Error ? err.message : String(err),
      })
    );

  return { state: 'authenticated', key: keyData as ApiKey };
}

/**
 * Back-compatible wrapper. Treats `unavailable` as "no key", which is the old
 * behaviour, so callers that only care whether they hold a usable key are
 * unchanged. Anything that must tell an outage apart from a bad key should use
 * resolveApiKey or getApiKeyAuthState instead.
 */
async function validateApiKey(apiKey: string | null): Promise<ApiKey | null> {
  const resolution = await resolveApiKey(apiKey);
  return resolution.state === 'authenticated' ? resolution.key : null;
}

// Returns `null` when rate limit checks are unavailable so callers can fail closed explicitly.
export async function checkRateLimit(apiKeyId: string, limit: number): Promise<boolean | null> {
  const supabase = createAdminClient();
  
  // Count requests in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { count, error } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('api_key_id', apiKeyId)
    .gte('created_at', oneHourAgo);

  if (error) {
    console.error('[API Auth] Rate limit check failed; blocking request (fail closed)', {
      apiKeyId,
      error: error.message,
    });
    return null;
  }

  return (count || 0) < limit;
}

async function logApiUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTime: number
) {
  const supabase = createAdminClient();
  const headersList = await headers();
  
  const { error } = await supabase.from('api_usage').insert({
    api_key_id: apiKeyId,
    endpoint,
    method,
    status_code: statusCode,
    response_time_ms: responseTime,
    ip_address: headersList.get('x-forwarded-for') || headersList.get('x-real-ip'),
    user_agent: headersList.get('user-agent'),
  });

  if (error) {
    throw error;
  }
}

const DEFAULT_CORS_ALLOWED_ORIGIN = 'https://www.the-anchor.pub';
const DEFAULT_CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, X-API-Key, Idempotency-Key, X-Turnstile-Token';

function parseCorsAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGIN ?? DEFAULT_CORS_ALLOWED_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getCorsAllowedOrigin(requestOrigin?: string | null): string {
  const allowedOrigins = parseCorsAllowedOrigins();

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] ?? DEFAULT_CORS_ALLOWED_ORIGIN;
}

export function createCorsPreflightResponse({
  request,
  methods = 'GET, POST, OPTIONS',
  allowedHeaders = DEFAULT_CORS_ALLOWED_HEADERS,
}: {
  request?: Request;
  methods?: string;
  allowedHeaders?: string;
} = {}) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': getCorsAllowedOrigin(request?.headers.get('origin')),
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': allowedHeaders,
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

/**
 * How a response may be stored by caches.
 *
 * `private` exists for routes whose body depends on the caller's scopes. Those
 * must never sit in a shared cache: two keys asking for the same URL get
 * different bodies, and a cached copy of one would be served to the other. It
 * also drops the ETag, because a validator on a scope-dependent body invites
 * exactly the same cross-serving through a 304.
 */
export type ApiCacheMode = 'public' | 'private';

export function createApiResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {},
  method?: string,
  cacheMode: ApiCacheMode = 'public'
) {
  // Normalise payload so consumers always see a success/data envelope
  const payload =
    data && typeof data === 'object' && 'success' in data
      ? data
      : { success: true, data };

  const isGet = !method || method.toUpperCase() === 'GET' || method.toUpperCase() === 'OPTIONS'
  const isCacheable = isGet && cacheMode === 'public'
  const cacheControl = isCacheable
    ? 'public, max-age=60, stale-while-revalidate=120'
    : 'no-store'

  const corsOrigin = getCorsAllowedOrigin()

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': DEFAULT_CORS_ALLOWED_HEADERS,
    Vary: 'Origin',
    ...headers,
  }

  // Only include ETag for cacheable responses.
  //
  // This used to base64 the payload and keep the first 27 characters. 27 base64
  // characters cover about 20 bytes, and the payload is normalised just above
  // to `{ success: true, data }`, so those bytes were always the literal
  // `{"success":true,"dat`. Every endpoint therefore returned the same ETag,
  // and a client honouring If-None-Match could ask for /api/menu carrying an
  // ETag it got from /api/events and be told 304 Not Modified, then serve the
  // wrong cached body. Verified against production before changing it.
  //
  // Hashing the whole payload matches the pattern already used correctly in
  // src/app/api/portal/calendar-feed/route.ts.
  if (isCacheable) {
    responseHeaders['ETag'] = `"${createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
      .slice(0, 32)}"`
  }

  return NextResponse.json(payload, {
    status,
    headers: responseHeaders,
  });
}

export function createErrorResponse(
  message: string, 
  code: string, 
  status: number = 400,
  details?: any,
  cacheMode: ApiCacheMode = 'public'
) {
  return createApiResponse(
    {
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
      },
    },
    status,
    {},
    undefined,
    cacheMode
  );
}

/**
 * True only when the request carries an API key that actually validates.
 *
 * Public endpoints use this to decide whether to skip the Turnstile bot check.
 * Testing for the mere presence of an x-api-key or authorization header is not
 * enough: neither header is authenticated by anyone, so any anonymous caller
 * could defeat the CAPTCHA by sending "x-api-key: anything".
 */
export async function isApiKeyAuthenticated(headersList: Headers): Promise<boolean> {
  return (await getApiKeyAuthState(headersList)) === 'authenticated';
}

/**
 * As isApiKeyAuthenticated, but keeps `unavailable` distinct from `anonymous`.
 *
 * Use this wherever "not authenticated" is about to be read as "an anonymous
 * browser", because that inference is only safe for `anonymous`. A caller that
 * presented a key we could not check is not a browser, and must not be handed
 * a bot challenge it was never given the means to answer.
 */
export async function getApiKeyAuthState(headersList: Headers): Promise<ApiKeyAuthState> {
  const apiKey = extractApiKey(headersList);
  if (!apiKey) {
    return 'anonymous';
  }
  return (await resolveApiKey(apiKey)).state;
}

function extractApiKey(headersList: Headers): string | null {
  const xApiKey = headersList.get('x-api-key')?.trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authHeader = headersList.get('authorization')?.trim();
  if (!authHeader) {
    return null;
  }

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || null;
}

function safePathname(url: string | null | undefined): string {
  if (!url) {
    return '/';
  }

  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

function normalizeRequestMethod(method: string | null | undefined): string {
  const normalized = method?.trim().toUpperCase();
  if (!normalized) {
    return 'GET';
  }

  return /^[A-Z]+$/.test(normalized) ? normalized : 'GET';
}

function normalizeRequestUrl(url: string | null | undefined): string {
  if (!url) {
    return 'http://localhost/';
  }

  try {
    return new URL(url).toString();
  } catch {
    if (url.startsWith('/')) {
      return `http://localhost${url}`;
    }
    return 'http://localhost/';
  }
}

async function safeLogApiUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTime: number
): Promise<void> {
  try {
    await logApiUsage(apiKeyId, endpoint, method, statusCode, responseTime);
  } catch {
    console.error('[API Auth] Failed to log API usage');
  }
}

export interface WithApiAuthOptions {
  /**
   * `private` for routes whose body depends on the caller's scopes. It applies
   * to the guard's own 401/403/429/503 replies too: a publicly cached 403 for
   * one key could otherwise be replayed to a key that does hold the scope.
   */
  cacheMode?: ApiCacheMode;
}

export async function withApiAuth(
  handler: (req: Request, apiKey: ApiKey) => Promise<Response>,
  requiredPermissions: string[] = ['read:events'],
  request?: Request,
  options?: WithApiAuthOptions
): Promise<Response> {
  const cacheMode: ApiCacheMode = options?.cacheMode ?? 'public';
  const startTime = Date.now();
  const headersList = await headers();
  const apiKey = extractApiKey(headersList);
  const resolution = await resolveApiKey(apiKey);

  // An outage is not a bad key. Answering 401 here sent integrators hunting for
  // a credential problem that did not exist, and matched what checkRateLimit
  // already does below when its own backing store is unreachable.
  if (resolution.state === 'unavailable') {
    return createErrorResponse(
      'Authentication is temporarily unavailable',
      'AUTH_UNAVAILABLE',
      503,
      undefined,
      cacheMode
    );
  }

  if (resolution.state === 'anonymous') {
    return createErrorResponse('Invalid or missing API key', 'UNAUTHORIZED', 401, undefined, cacheMode);
  }

  const validatedKey = resolution.key;

  // Check permissions
  const hasPermissions = requiredPermissions.every(perm => 
    validatedKey.permissions.includes(perm) || validatedKey.permissions.includes('*')
  );
  
  if (!hasPermissions) {
    const endpoint = safePathname(request?.url || headersList.get('x-url'));
    const method = normalizeRequestMethod(request?.method || headersList.get('x-method'));
    const responseTime = Date.now() - startTime;
    console.warn('[API Auth] Rejected API key with insufficient permissions', {
      apiKeyId: validatedKey.id,
      apiKeyName: validatedKey.name,
      endpoint,
      requiredPermissions,
      grantedPermissions: validatedKey.permissions,
    });
    safeLogApiUsage(
      validatedKey.id,
      endpoint,
      method,
      403,
      responseTime
    ).catch(err =>
      console.warn('[API Auth] Failed to log forbidden API usage', {
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403, undefined, cacheMode);
  }
  
  // Check rate limit
  const withinLimit = await checkRateLimit(validatedKey.id, validatedKey.rate_limit);

  if (withinLimit === null) {
    return createErrorResponse(
      'Rate limiting is temporarily unavailable',
      'RATE_LIMIT_UNAVAILABLE',
      503,
      undefined,
      cacheMode
    );
  }
  
  if (!withinLimit) {
    return createErrorResponse(
      'Rate limit exceeded', 
      'RATE_LIMIT_EXCEEDED', 
      429,
      undefined,
      cacheMode
    );
  }
  
  try {
    const fallbackUrl = normalizeRequestUrl(headersList.get('x-url'));
    const fallbackMethod = normalizeRequestMethod(headersList.get('x-method'));
    const req = request || new Request(fallbackUrl, { method: fallbackMethod });
    const response = await handler(req, validatedKey);
    const responseTime = Date.now() - startTime;
    
    // Fire-and-forget — don't block the response for observational logging
    safeLogApiUsage(
      validatedKey.id,
      safePathname(req.url),
      req.method || fallbackMethod,
      response.status,
      responseTime
    ).catch(err =>
      console.warn('[API Auth] Failed to log API usage', {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    return response;
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Fire-and-forget — don't block the error response for observational logging
    safeLogApiUsage(
      validatedKey.id,
      safePathname(request?.url || headersList.get('x-url')),
      headersList.get('x-method') || 'GET',
      500,
      responseTime
    ).catch(err =>
      console.warn('[API Auth] Failed to log API usage', {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    return createErrorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      500,
      undefined,
      cacheMode
    );
  }
}

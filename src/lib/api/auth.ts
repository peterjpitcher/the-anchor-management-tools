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
}

export async function hashApiKey(key: string): Promise<string> {
  return createHash('sha256').update(key).digest('hex');
}

export async function generateApiKey(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'anch_' + Buffer.from(bytes).toString('base64url');
}

export async function validateApiKey(apiKey: string | null): Promise<ApiKey | null> {
  if (!apiKey) {
    return null;
  }

  // Use admin client for API key validation since api_keys table requires elevated permissions
  const supabase = createAdminClient();
  const keyHash = await hashApiKey(apiKey);

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, permissions, rate_limit, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true);

  if (error) {
    console.error('[API Auth] Failed to validate API key');
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    console.error('[API Auth] Duplicate active API key hashes detected');
  }

  const keyData = data[0];

  // Update last used timestamp
  const { data: updatedKey, error: updateError } = await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyData.id)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[API Auth] Failed to update API key last_used_at');
  } else if (!updatedKey) {
    console.error('[API Auth] API key disappeared before last_used_at could be updated');
  }

  return keyData as ApiKey;
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

export async function logApiUsage(
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

export function createApiResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {}
) {
  // Normalise payload so consumers always see a success/data envelope
  const payload =
    data && typeof data === 'object' && 'success' in data
      ? data
      : { success: true, data };

  // Generate ETag for caching
  const etag = `"${Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .slice(0, 27)}"`;
  
  return NextResponse.json(payload, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      'Access-Control-Allow-Origin': '*', // Allow all origins for public API
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Idempotency-Key',
      'X-Powered-By': 'The Anchor API',
      'ETag': etag,
      ...headers,
    },
  });
}

export function createErrorResponse(
  message: string, 
  code: string, 
  status: number = 400,
  details?: any
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
    status
  );
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

export async function withApiAuth(
  handler: (req: Request, apiKey: ApiKey) => Promise<Response>,
  requiredPermissions: string[] = ['read:events'],
  request?: Request
): Promise<Response> {
  const startTime = Date.now();
  const headersList = await headers();
  const apiKey = extractApiKey(headersList);
  const validatedKey = await validateApiKey(apiKey);
  
  if (!validatedKey) {
    return createErrorResponse('Invalid or missing API key', 'UNAUTHORIZED', 401);
  }
  
  // Check permissions
  const hasPermissions = requiredPermissions.every(perm => 
    validatedKey.permissions.includes(perm) || validatedKey.permissions.includes('*')
  );
  
  if (!hasPermissions) {
    return createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403);
  }
  
  // Check rate limit
  const withinLimit = await checkRateLimit(validatedKey.id, validatedKey.rate_limit);

  if (withinLimit === null) {
    return createErrorResponse(
      'Rate limiting is temporarily unavailable',
      'RATE_LIMIT_UNAVAILABLE',
      503
    );
  }
  
  if (!withinLimit) {
    return createErrorResponse(
      'Rate limit exceeded', 
      'RATE_LIMIT_EXCEEDED', 
      429
    );
  }
  
  try {
    const fallbackUrl = normalizeRequestUrl(headersList.get('x-url'));
    const fallbackMethod = normalizeRequestMethod(headersList.get('x-method'));
    const req = request || new Request(fallbackUrl, { method: fallbackMethod });
    const response = await handler(req, validatedKey);
    const responseTime = Date.now() - startTime;
    
    // Log usage
    await safeLogApiUsage(
      validatedKey.id,
      safePathname(req.url),
      req.method || fallbackMethod,
      response.status,
      responseTime
    );
    
    return response;
  } catch (error) {
    const responseTime = Date.now() - startTime;

    await safeLogApiUsage(
      validatedKey.id,
      safePathname(request?.url || headersList.get('x-url')),
      headersList.get('x-method') || 'GET',
      500,
      responseTime
    );
    
    return createErrorResponse(
      'Internal server error',
      'INTERNAL_ERROR',
      500
    );
  }
}

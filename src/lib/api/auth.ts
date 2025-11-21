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
    console.log('[API Auth] No API key provided');
    return null;
  }
  
  console.log('[API Auth] Validating API key:', apiKey.substring(0, 10) + '...');
  
  // Use admin client for API key validation since api_keys table requires elevated permissions
  const supabase = createAdminClient();
  const keyHash = await hashApiKey(apiKey);
  console.log('[API Auth] Key hash:', keyHash);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, permissions, rate_limit, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true);
  
  if (error) {
    console.log('[API Auth] Database query error:', error.message);
    return null;
  }
  
  if (!data || data.length === 0) {
    console.log('[API Auth] No matching key found');
    return null;
  }
  
  if (data.length > 1) {
    console.log('[API Auth] Multiple keys found with same hash, using first one');
  }
  
  const keyData = data[0];
  
  console.log('[API Auth] Key validated:', keyData.name);
  
  // Update last used timestamp
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyData.id);
  
  return keyData as ApiKey;
}

export async function checkRateLimit(apiKeyId: string, limit: number): Promise<boolean> {
  const supabase = createAdminClient();
  
  // Count requests in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { count } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('api_key_id', apiKeyId)
    .gte('created_at', oneHourAgo);
  
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
  
  await supabase.from('api_usage').insert({
    api_key_id: apiKeyId,
    endpoint,
    method,
    status_code: statusCode,
    response_time_ms: responseTime,
    ip_address: headersList.get('x-forwarded-for') || headersList.get('x-real-ip'),
    user_agent: headersList.get('user-agent'),
  });
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
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

export async function withApiAuth(
  handler: (req: Request, apiKey: ApiKey) => Promise<Response>,
  requiredPermissions: string[] = ['read:events'],
  request?: Request
): Promise<Response> {
  const startTime = Date.now();
  const headersList = await headers();
  
  console.log('[API Auth] Headers received:');
  headersList.forEach((value, key) => {
    if (key.toLowerCase().includes('api') || key.toLowerCase().includes('auth')) {
      console.log(`  ${key}: ${value.substring(0, 20)}...`);
    }
  });
  
  // Check both X-API-Key and Authorization headers
  const xApiKey = headersList.get('x-api-key');
  const authHeader = headersList.get('authorization');
  
  console.log('[API Auth] X-API-Key header:', xApiKey ? xApiKey.substring(0, 10) + '...' : 'Not found');
  console.log('[API Auth] Authorization header:', authHeader ? authHeader.substring(0, 20) + '...' : 'Not found');
  
  const apiKey = xApiKey || authHeader?.replace('Bearer ', '');
  
  console.log('[API Auth] Final API key to validate:', apiKey ? apiKey.substring(0, 10) + '...' : 'None');
  
  const validatedKey = await validateApiKey(apiKey || null);
  
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
  
  if (!withinLimit) {
    return createErrorResponse(
      'Rate limit exceeded', 
      'RATE_LIMIT_EXCEEDED', 
      429
    );
  }
  
  try {
    const req = request || new Request(headersList.get('x-url') || '');
    const response = await handler(req, validatedKey);
    const responseTime = Date.now() - startTime;
    
    // Log usage
    const url = new URL(req.url || headersList.get('x-url') || '');
    await logApiUsage(
      validatedKey.id,
      url.pathname,
      req.method || headersList.get('x-method') || 'GET',
      response.status,
      responseTime
    );
    
    return response;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    await logApiUsage(
      validatedKey.id,
      new URL(headersList.get('x-url') || '').pathname,
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

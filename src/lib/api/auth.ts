import { createHash } from 'crypto';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
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
  if (!apiKey) return null;
  
  const supabase = await createClient();
  const keyHash = await hashApiKey(apiKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, permissions, rate_limit, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single();
  
  if (error || !data) return null;
  
  // Update last used timestamp
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);
  
  return data as ApiKey;
}

export async function checkRateLimit(apiKeyId: string, limit: number): Promise<boolean> {
  const supabase = await createClient();
  
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
  const supabase = await createClient();
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

export function createApiResponse(data: any, status: number = 200, headers: Record<string, string> = {}) {
  // Generate ETag for caching
  const etag = `"${Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 27)}"`;
  
  return NextResponse.json(data, {
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
  requiredPermissions: string[] = ['read:events']
): Promise<Response> {
  const startTime = Date.now();
  const headersList = await headers();
  
  // Check both X-API-Key and Authorization headers
  const apiKey = headersList.get('x-api-key') || 
                 headersList.get('authorization')?.replace('Bearer ', '');
  
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
    const response = await handler(new Request(''), validatedKey);
    const responseTime = Date.now() - startTime;
    
    // Log usage
    await logApiUsage(
      validatedKey.id,
      new URL(headersList.get('x-url') || '').pathname,
      headersList.get('x-method') || 'GET',
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
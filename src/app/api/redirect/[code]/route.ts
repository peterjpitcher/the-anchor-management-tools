import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseUserAgent, parseQueryParams, getCountryFromHeaders, getCityFromHeaders, getRegionFromHeaders } from '@/lib/user-agent-parser';

const FALLBACK_REDIRECT_URL = 'https://www.the-anchor.pub';
const MISSING_RELATION_CODE = '42P01';
let loggedMissingAliasTable = false;

function isMissingRelationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === MISSING_RELATION_CODE;
}

function normalizeShortCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const normalized = decoded.trim().toLowerCase();
    if (!normalized) return null;

    // Short codes only support letters, numbers, and hyphens.
    // This also prevents noise from requests like `robots.txt`.
    if (!/^[a-z0-9-]+$/.test(normalized)) return null;

    return normalized;
  } catch {
    return null;
  }
}

function extractClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstForwarded = forwardedFor?.split(',')[0]?.trim();
  const candidate = firstForwarded || request.headers.get('x-real-ip') || (request as any).ip;

  if (!candidate) return null;

  // Strip port from IPv4-with-port values like `203.0.113.1:12345`.
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  const ip = (ipv4WithPort ? ipv4WithPort[1] : candidate).trim();

  if (!ip) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code: rawCode } = await params;
    const shortCode = normalizeShortCode(rawCode);
    
    if (!shortCode) {
      return NextResponse.redirect(FALLBACK_REDIRECT_URL);
    }
    
    // Use service role key to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return NextResponse.redirect(FALLBACK_REDIRECT_URL);
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get the short link directly
    const { data: link, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('short_code', shortCode)
      .maybeSingle();
    
    if (error) {
      console.error('Short link lookup error:', shortCode, error);
      return NextResponse.redirect(FALLBACK_REDIRECT_URL);
    }

    let resolvedLink = link;
    let resolvedViaAlias = false;

    if (!resolvedLink) {
      const { data: alias, error: aliasError } = await supabase
        .from('short_link_aliases')
        .select('short_link_id')
        .eq('alias_code', shortCode)
        .maybeSingle();

      if (aliasError) {
        if (isMissingRelationError(aliasError)) {
          if (!loggedMissingAliasTable) {
            console.warn('Short link alias table missing. Apply latest Supabase migrations to enable aliases.');
            loggedMissingAliasTable = true;
          }
          return NextResponse.redirect(FALLBACK_REDIRECT_URL);
        }
        console.error('Short link alias lookup error:', shortCode, aliasError);
        return NextResponse.redirect(FALLBACK_REDIRECT_URL);
      }

      if (!alias) {
        return NextResponse.redirect(FALLBACK_REDIRECT_URL);
      }

      const { data: targetLink, error: targetError } = await supabase
        .from('short_links')
        .select('*')
        .eq('id', alias.short_link_id)
        .maybeSingle();

      if (targetError) {
        console.error('Short link alias target lookup error:', shortCode, targetError);
        return NextResponse.redirect(FALLBACK_REDIRECT_URL);
      }

      if (!targetLink) {
        return NextResponse.redirect(FALLBACK_REDIRECT_URL);
      }

      resolvedLink = targetLink;
      resolvedViaAlias = true;
    }
    
    // Check if expired
    if (resolvedLink.expires_at && new Date(resolvedLink.expires_at) < new Date()) {
      return NextResponse.redirect(FALLBACK_REDIRECT_URL);
    }
    
    // Track the click synchronously to ensure it records in serverless environment
    try {
      const userAgent = request.headers.get('user-agent');
      const { deviceType, browser, os } = parseUserAgent(userAgent);
      const utmParams = parseQueryParams(request.url);
      const ipAddress = extractClientIp(request);
      
      const { error: clickInsertError } = await supabase
        .from('short_link_clicks')
        .insert({
          short_link_id: resolvedLink.id,
          user_agent: userAgent,
          referrer: request.headers.get('referer'),
          ip_address: ipAddress,
          country: getCountryFromHeaders(request.headers),
          city: getCityFromHeaders(request.headers),
          region: getRegionFromHeaders(request.headers),
          device_type: deviceType,
          browser,
          os,
          utm_source: utmParams.utm_source,
          utm_medium: utmParams.utm_medium,
          utm_campaign: utmParams.utm_campaign,
          metadata: resolvedViaAlias ? { alias_code: shortCode } : {}
        });
      if (clickInsertError) {
        throw clickInsertError;
      }

      const { error: incrementError } = await (supabase as any).rpc('increment_short_link_clicks', {
        p_short_link_id: resolvedLink.id
      });
      if (incrementError) {
        throw incrementError;
      }
    } catch (err) {
      console.error('Error tracking click:', err);
    }
    
    // Redirect immediately to the destination URL
    return NextResponse.redirect(resolvedLink.destination_url);
  } catch (error) {
    console.error('Redirect error:', error);
    return NextResponse.redirect(FALLBACK_REDIRECT_URL);
  }
}

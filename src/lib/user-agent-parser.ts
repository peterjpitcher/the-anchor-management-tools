// Simple user agent parser for demographic data
export interface ParsedUserAgent {
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
  browser: string;
  os: string;
}

export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  if (!userAgent) {
    return { deviceType: 'unknown', browser: 'Unknown', os: 'Unknown' };
  }

  const ua = userAgent.toLowerCase();

  // Detect device type
  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/bot|crawler|spider|crawling/i.test(ua)) {
    deviceType = 'bot';
  } else if (/mobile|android|iphone|ipod|windows phone/i.test(ua) && !/ipad|tablet/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/ipad|tablet|kindle|silk|playbook/i.test(ua)) {
    deviceType = 'tablet';
  }

  // Detect browser
  let browser = 'Unknown';
  if (/edg\//i.test(ua)) {
    browser = 'Edge';
  } else if (/chrome|crios/i.test(ua) && !/edg\//i.test(ua)) {
    browser = 'Chrome';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Firefox';
  } else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) {
    browser = 'Safari';
  } else if (/opera|opr\//i.test(ua)) {
    browser = 'Opera';
  }

  // Detect OS
  let os = 'Unknown';
  if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/linux/i.test(ua) && !/android/i.test(ua)) {
    os = 'Linux';
  } else if (/android/i.test(ua)) {
    os = 'Android';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
  }

  return { deviceType, browser, os };
}

export function parseQueryParams(url: string): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
} {
  try {
    const urlObj = new URL(url);
    return {
      utm_source: urlObj.searchParams.get('utm_source') || undefined,
      utm_medium: urlObj.searchParams.get('utm_medium') || undefined,
      utm_campaign: urlObj.searchParams.get('utm_campaign') || undefined,
    };
  } catch {
    return {};
  }
}

// Get country code from Cloudflare headers (Vercel passes these through)
export function getCountryFromHeaders(headers: Headers): string | null {
  return headers.get('cf-ipcountry') || headers.get('x-vercel-ip-country') || null;
}

// Get city from headers
export function getCityFromHeaders(headers: Headers): string | null {
  return headers.get('x-vercel-ip-city') || null;
}

// Get region from headers  
export function getRegionFromHeaders(headers: Headers): string | null {
  return headers.get('x-vercel-ip-country-region') || null;
}
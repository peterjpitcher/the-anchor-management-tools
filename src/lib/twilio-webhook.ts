export function getTwilioWebhookValidationUrl(requestUrl: string): string {
  const parsedRequestUrl = new URL(requestUrl)
  // NEXT_PUBLIC_APP_URL is required at boot (src/lib/env.ts), so a preview-deployment host is
  // never a fallback here.
  const configuredBase =
    process.env.WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL

  if (!configuredBase) {
    return requestUrl
  }

  try {
    return new URL(`${parsedRequestUrl.pathname}${parsedRequestUrl.search}`, configuredBase).toString()
  } catch {
    return requestUrl
  }
}

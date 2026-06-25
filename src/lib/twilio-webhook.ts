export function getTwilioWebhookValidationUrl(requestUrl: string): string {
  const parsedRequestUrl = new URL(requestUrl)
  const configuredBase =
    process.env.WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)

  if (!configuredBase) {
    return requestUrl
  }

  try {
    return new URL(`${parsedRequestUrl.pathname}${parsedRequestUrl.search}`, configuredBase).toString()
  } catch {
    return requestUrl
  }
}

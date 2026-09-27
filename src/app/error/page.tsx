import ErrorClient from './_components/ErrorClient'

const FRIENDLY_MESSAGES: Record<string, { title: string; message: string }> = {
  missing_state: {
    title: 'Password Reset Timed Out',
    message:
      'The confirmation window took too long and the secure link expired. Please request a fresh reset email and click it on the same device.',
  },
  missing_token: {
    title: 'Reset Link Incomplete',
    message:
      'We could not read the reset link. Request a new password email and try again. Reach out if the problem persists.',
  },
  otp_expired: {
    title: 'Link Already Used or Expired',
    message:
      'This link was already used or has expired. You can request another password reset from the sign-in page.',
  },
  over_email_send_rate_limit: {
    title: 'Too Many Reset Attempts',
    message:
      'Please wait a few seconds before requesting another password reset email.',
  },
  rate_limited: {
    title: 'Too Many Attempts',
    message:
      'Please wait a few minutes before opening that link again.',
  },
}

function getFriendlyMessage(code?: string | string[]) {
  if (!code) return null
  const normalized = Array.isArray(code) ? code[0] : code
  return FRIENDLY_MESSAGES[normalized.toLowerCase()] ?? null
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type PageProps = {
  searchParams: SearchParams
}

export default async function ErrorPage({ searchParams }: PageProps) {
  const params = await searchParams
  const code = params.code
  const friendly = getFriendlyMessage(code)
  const codeStr = code ? (Array.isArray(code) ? code[0] : code) : undefined

  return (
    <ErrorClient
      title={friendly?.title ?? 'Something Went Wrong'}
      message={
        friendly?.message ??
        'We were not able to complete that request. Try again in a moment, or contact support if the issue continues.'
      }
      code={codeStr}
    />
  )
}

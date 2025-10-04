import Link from 'next/link'

const FRIENDLY_MESSAGES: Record<string, { title: string; message: string }> = {
  missing_state: {
    title: 'Password reset timed out',
    message:
      'The confirmation window took too long and the secure link expired. Please request a fresh reset email and click it on the same device.',
  },
  missing_token: {
    title: 'Reset link incomplete',
    message:
      'We could not read the reset link. Request a new password email and try again. Reach out if the problem persists.',
  },
  otp_expired: {
    title: 'Link already used or expired',
    message:
      'This link was already used or has expired. You can request another password reset from the login page.',
  },
  over_email_send_rate_limit: {
    title: 'Too many reset attempts',
    message:
      'Please wait a few seconds before requesting another password reset email.',
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

  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
      <div className="bg-white/10 border border-white/10 rounded-xl p-10 max-w-lg w-full text-white shadow-xl backdrop-blur">
        <h1 className="text-3xl font-semibold mb-3">Something went wrong</h1>
        {friendly ? (
          <>
            <h2 className="text-xl font-medium mb-2">{friendly.title}</h2>
            <p className="text-sm text-white/80 mb-6">{friendly.message}</p>
          </>
        ) : (
          <p className="text-sm text-white/80 mb-6">
            We weren&apos;t able to complete that request. Try again in a moment, or contact support if the issue continues.
          </p>
        )}

        {code && (
          <p className="text-xs text-white/60 mb-4">
            Technical code: <code className="text-white/80">{Array.isArray(code) ? code[0] : code}</code>
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/auth/login"
            className="inline-flex justify-center items-center rounded-md bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25 transition"
          >
            Back to login
          </Link>
          <Link
            href="mailto:support@orangejelly.co.uk"
            className="inline-flex justify-center items-center rounded-md bg-transparent border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition"
          >
            Contact support
          </Link>
        </div>
      </div>
    </div>
  )
}

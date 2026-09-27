'use client'

import { Button, LinkButton } from '@/ds'
import { AuthCard, AuthLink } from '@/app/auth/_components/AuthCard'

interface ErrorClientProps {
  title: string
  message: string
  code?: string
}

export default function ErrorClient({ title, message, code }: ErrorClientProps) {
  return (
    <AuthCard
      title={title}
      lead={message}
      icon={{ name: 'alertCircle', tone: 'danger' }}
      footer={<AuthLink href="mailto:support@orangejelly.co.uk">Contact Support</AuthLink>}
    >
      {code && (
        <p className="mb-4 break-words rounded-default bg-surface-2 p-3 text-center font-mono text-sm text-text-muted">
          REF-{code}
        </p>
      )}

      {/* The way forward first, as on the Access Denied screen. Try Again is the app's one retry
          button: secondary and small, wherever it appears. */}
      <div className="flex flex-col gap-2">
        <LinkButton href="/dashboard" variant="primary" size="lg" className="w-full">
          Go to Dashboard
        </LinkButton>
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          onClick={() => window.location.reload()}
        >
          Try Again
        </Button>
      </div>
    </AuthCard>
  )
}

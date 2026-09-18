'use client'

import { Icon, Button, LinkButton } from '@/ds'

interface ErrorClientProps {
  title: string
  message: string
  code?: string
}

export default function ErrorClient({ title, message, code }: ErrorClientProps) {
  return (
    <div className="auth">
      <div className="auth__card">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center">
            <Icon name="alertCircle" size={28} className="text-danger" />
          </div>
        </div>

        <h1 className="auth__h1 text-center">{title}</h1>
        <p className="auth__lead text-center">{message}</p>

        {code && (
          <div className="bg-surface-hover rounded-lg p-3 font-mono text-sm text-text-muted text-center mb-4 break-words">
            REF-{code}
          </div>
        )}

        <div className="flex flex-col gap-2 mt-4">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
          <LinkButton href="/dashboard" variant="secondary" size="lg" className="w-full">
            Back to Dashboard
          </LinkButton>
        </div>

        <div className="auth__footer">
          <a href="mailto:support@orangejelly.co.uk" className="auth__link text-xs">
            Contact support
          </a>
        </div>
      </div>
    </div>
  )
}

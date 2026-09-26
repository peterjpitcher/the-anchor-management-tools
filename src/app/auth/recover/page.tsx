import { Icon } from '@/ds'
import { AuthCard, AuthLink } from '../_components/AuthCard'

export default function RecoverPage() {
  return (
    <AuthCard
      title="Check Your Inbox"
      lead={
        <>
          We&apos;ve sent a secure link to your email. Open it in the same browser you&apos;d like
          to use, click <strong>Continue</strong>, and you&apos;ll be taken to set a new password.
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Didn&apos;t receive anything? Look in your spam or quarantine folder, or request another
          reset email.
        </p>

        {/* The same way out as the forgotten-password screen, so this step is never a dead end. */}
        <div className="text-center">
          <AuthLink href="/auth/login">
            <Icon name="arrowLeft" size={14} />
            Back to Login
          </AuthLink>
        </div>
      </div>
    </AuthCard>
  )
}

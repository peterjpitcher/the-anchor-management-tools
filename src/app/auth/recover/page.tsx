import { AuthCard } from '../_components/AuthCard'

export default function RecoverPage() {
  return (
    <AuthCard
      title="Check your inbox"
      lead={
        <>
          We&apos;ve sent a secure link to your email. Open it in the same browser you&apos;d like
          to use, click <strong>Continue</strong>, and you&apos;ll be taken to set a new password.
        </>
      }
    >
      <p className="text-xs text-text-muted">
        Didn&apos;t receive anything? Look in your spam or quarantine folder, or request another
        reset email.
      </p>
    </AuthCard>
  )
}

export default function RecoverPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="bg-white/10 border border-white/10 rounded-xl p-10 max-w-md text-center text-white shadow-xl backdrop-blur">
        <h1 className="text-2xl font-semibold">Check your inbox</h1>
        <p className="mt-3 text-sm text-white/80">
          We&apos;ve sent a secure link to your email. Open it in the same browser you&apos;d like to use,
          click <strong>Continue</strong>, and you&apos;ll be taken to set a new password.
        </p>
        <p className="mt-6 text-xs text-white/60">
          Didn&apos;t receive anything? Look in your spam or quarantine folder, or request another reset email.
        </p>
      </div>
    </div>
  )
}

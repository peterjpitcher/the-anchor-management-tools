import Image from 'next/image'

type AuthCardProps = {
  title: string
  lead?: React.ReactNode
  children?: React.ReactNode
}

/**
 * The card every sign-in screen shares: the /auth/login look (the `.auth` classes in
 * globals.css). Recover, reset-password and set-new-password used to show three other looks,
 * one of them dark text on the dark sidebar green, so the journey from forgetting a password to
 * choosing a new one now stays in one visual system.
 */
export function AuthCard({ title, lead, children }: AuthCardProps): React.JSX.Element {
  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div>
            <Image
              src="/orange-jelly/logo-horizontal.png"
              alt="Orange Jelly"
              width={1200}
              height={257}
              className="w-60 h-auto"
              priority
            />
            <div className="auth__sub">Management Tools</div>
          </div>
        </div>

        <h1 className="auth__h1">{title}</h1>
        {lead ? <p className="auth__lead">{lead}</p> : null}
        {children}
      </div>
    </div>
  )
}

import Image from 'next/image'
import { COMPANY_DETAILS } from '@/lib/company-details'

/**
 * The page frame for invoice payment. Invoices go out as Orange Jelly Limited, never as the
 * venue (owner decision, 28 August 2026), so this page carries the Orange Jelly name, logo and
 * legal line instead of the Anchor guest shell (owner decision, 18 September 2026).
 *
 * Orange Jelly has no colour system yet: docs/design/brief-orange-jelly.md asks a designer to
 * create one. Until it lands the page uses the neutral staff tokens and no invented brand
 * colours. The logo is the only Orange Jelly asset there is, a JPEG with a white background, so
 * it sits on a white bar.
 */
export function OrangeJellyShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3">
          <Image
            src="/logo-oj.jpg"
            alt="Orange Jelly"
            width={40}
            height={39}
            className="h-10 w-auto"
            priority
          />
          <span className="text-sm font-semibold text-text-strong">{COMPANY_DETAILS.legalName}</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-border bg-surface">
        <p className="mx-auto w-full max-w-xl px-4 py-5 text-meta leading-relaxed text-text-muted">
          {COMPANY_DETAILS.legalName}. Company registration {COMPANY_DETAILS.registrationNumber}.
          VAT {COMPANY_DETAILS.vatNumber}. {COMPANY_DETAILS.fullAddress}.
        </p>
      </footer>
    </div>
  )
}

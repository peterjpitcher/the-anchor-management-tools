import Image from 'next/image'
import { COMPANY_DETAILS } from '@/lib/company-details'

/**
 * The page frame for Orange Jelly's own customer pages, today the invoice payment page
 * (/invoice-portal/[token]); quotes or receipts can reuse it. Invoices go out as Orange Jelly
 * Limited, never as the venue (owner decision, 28 August 2026), so the frame carries the Orange
 * Jelly name, logo and legal line instead of the Anchor guest shell (owner decision,
 * 18 September 2026).
 *
 * The staff tokens are the Orange Jelly colours (owner design pack, 20 September 2026), so the
 * page uses them as they are. The logo is the horizontal wordmark the sign-in page shows. It
 * already spells out the name, so the header carries nothing else; the legal name stays in the
 * footer.
 *
 * This is the page chrome for those routes, like AppShell for staff pages, so it owns the only
 * <main>.
 */
export function OrangeJellyShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-xl items-center px-4 py-3">
          <Image
            src="/orange-jelly/logo-horizontal.png"
            alt="Orange Jelly"
            width={1200}
            height={260}
            className="h-8 w-auto"
            priority
          />
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

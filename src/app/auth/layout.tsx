import { AuthCreditProvider } from './_components/AuthCredit'
import { OrangeJellyCredit } from './_components/OrangeJellyCredit'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read on the server here and handed to AuthCard through context, because the sign-in
  // screens render the card from Client Components, which cannot fetch the feed themselves.
  return (
    <AuthCreditProvider
      credit={
        <OrangeJellyCredit
          className="text-xs text-text-soft"
          linkClassName="rounded-sm underline underline-offset-2 hover:text-text focus-visible:outline-hidden focus-visible:shadow-ring"
        />
      }
    >
      {children}
    </AuthCreditProvider>
  )
}

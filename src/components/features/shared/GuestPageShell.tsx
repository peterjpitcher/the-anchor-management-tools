import Image from 'next/image'
import { cn } from '@/lib/utils'

type GuestPageShellProps = {
  children: React.ReactNode
  maxWidthClassName?: string
  className?: string
}

export function GuestPageShell({
  children,
  maxWidthClassName = 'max-w-xl',
  className
}: GuestPageShellProps) {
  return (
    <main className={cn('min-h-screen bg-sidebar px-4 py-12 sm:py-20', className)}>
      <div className={cn('mx-auto w-full', maxWidthClassName)}>
        <div className="mx-auto mb-8 w-52 sm:w-64">
          <Image
            src="/logo.png"
            alt="The Anchor logo"
            width={256}
            height={256}
            className="h-auto w-full"
            priority
          />
        </div>

        {children}
      </div>
    </main>
  )
}

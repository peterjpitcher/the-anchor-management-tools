import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The login screen passes the page the person was trying to open to the sign-in action, which
// keeps a safe /portal/ link for portal-only staff (build contract 5.7), and goes wherever the
// action says.

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}))
const auth = vi.hoisted(() => ({ signIn: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: nav.refresh, prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/auth/login',
}))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}))
vi.mock('@/app/actions/auth', () => auth)

import LoginClient from '@/app/auth/login/_components/LoginClient'

const BS = String.fromCharCode(92)

function setSavedLinkCookie(value: string | null): void {
  document.cookie = value === null ? 'post_login_redirect=; Max-Age=0; Path=/' : `post_login_redirect=${encodeURIComponent(value)}; Path=/`
}

async function signInAs(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/Email address/), 'staff@example.com')
  await user.type(screen.getByLabelText(/Password/), 'a-password')
  await user.click(screen.getByRole('button', { name: 'Sign In' }))
}

describe('LoginClient and a saved link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.params = new URLSearchParams()
    setSavedLinkCookie(null)
    auth.signIn.mockResolvedValue({ success: true })
  })

  it('passes the saved portal link to sign-in and goes where sign-in says', async () => {
    const user = userEvent.setup()
    setSavedLinkCookie('/portal/training/asg-1')
    auth.signIn.mockResolvedValue({ success: true, redirectTo: '/portal/training/asg-1' })
    render(<LoginClient />)
    await signInAs(user)
    expect(auth.signIn).toHaveBeenCalledWith('staff@example.com', 'a-password', '/portal/training/asg-1')
    expect(nav.replace).toHaveBeenCalledWith('/portal/training/asg-1')
  })

  it('takes a next parameter before the cookie', async () => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next: '/portal/leave' })
    setSavedLinkCookie('/portal/training/asg-1')
    render(<LoginClient />)
    await signInAs(user)
    expect(auth.signIn).toHaveBeenCalledWith('staff@example.com', 'a-password', '/portal/leave')
    expect(nav.replace).toHaveBeenCalledWith('/portal/leave')
  })

  it.each([
    ['another site', 'https://evil.example/portal/training'],
    ['a protocol-relative link', '//evil.example'],
    ['a backslash trick', `/${BS}evil.example`],
    ['a sign-in page', '/auth/reset'],
    // These normalise to `//evil.example`, which the router would follow off the site.
    ['a dot segment before a double slash', '/.//evil.example'],
    ['a climb before a double slash', '/a/..//evil.example'],
    ['an encoded dot before a double slash', '/%2e//evil.example'],
    ['a climb out of a sign-in page', '/auth/..//evil.example'],
  ])('never sends anyone to %s', async (_label, next) => {
    const user = userEvent.setup()
    nav.params = new URLSearchParams({ next })
    render(<LoginClient />)
    await signInAs(user)
    expect(auth.signIn).toHaveBeenCalledWith('staff@example.com', 'a-password', '/dashboard')
    expect(nav.replace).toHaveBeenCalledWith('/dashboard')
  })

  it.each([
    ['the legacy redirectedFrom parameter', 'redirectedFrom'],
    ['the saved-link cookie', 'cookie'],
  ])('never sends a manager off the site through %s', async (_label, source) => {
    const user = userEvent.setup()
    if (source === 'cookie') setSavedLinkCookie('/.//evil.example')
    else nav.params = new URLSearchParams({ redirectedFrom: '/a/..//evil.example' })
    // A management user: sign-in gives no destination, so the login screen's own choice is used.
    auth.signIn.mockResolvedValue({ success: true })
    render(<LoginClient />)
    await signInAs(user)
    expect(nav.replace).toHaveBeenCalledWith('/dashboard')
    expect(nav.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/\//))
  })
})

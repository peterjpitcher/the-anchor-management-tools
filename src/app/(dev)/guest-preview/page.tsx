import { notFound } from 'next/navigation'
import { Bell, Check, Clock } from 'lucide-react'
import {
  DetailGrid,
  DetailRow,
  GuestAlert,
  GuestAmount,
  GuestBadge,
  GuestButton,
  GuestCard,
  GuestField,
  GuestShell,
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INPUT_INVALID_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GUEST_TEXTAREA_CLASS,
  GuestBlockedState,
  guestBadgeToneForStatus,
  guestFieldControlProps,
  TrustLine,
} from '@/components/features/guest'
import { cn } from '@/lib/utils'

/**
 * Fixture harness for the guest design system.
 *
 * Committed on purpose, not a throwaway: later phases re-run it to catch
 * regressions in the primitives, and the approved screenshots at 320, 390, 640
 * and 1024px live under docs/design/guest-pages-2026-08/baselines/.
 *
 * Everything below is synthetic. No database, no token, no real booking.
 *
 * Note: this route sits behind the app's normal auth middleware, so view it
 * while logged in on a dev server. It 404s outright in production.
 */

export const metadata = {
  title: 'Guest primitives preview',
}

/** Statuses the badge is expected to recognise, plus one it is not. */
const BADGE_FIXTURES = [
  'Confirmed',
  'Completed',
  'Seated',
  'Paid',
  'Awaiting deposit',
  'Pending Confirmation',
  'Outstanding',
  'Cancelled',
  'No show',
  'Failed',
  'Awaiting kitchen sign off',
]

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t border-guest-border-strong pt-5">
      <h2 className="font-anchor-display text-[22px] font-normal tracking-[-0.02em] text-guest-text-strong">
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function GuestPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <GuestShell>
      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>The Anchor</p>
        <h1 className={GUEST_H1_CLASS}>Guest primitives</h1>
        <p className={GUEST_LEAD_CLASS}>
          Every shared component and variant, rendered from synthetic fixtures.
        </p>
      </div>

      <Group title="Cards">
        <GuestCard variant="accent">
          <p className="text-[14px] leading-[1.6]">
            Accent card. Exactly one per page, on the thing the page exists to do.
          </p>
        </GuestCard>
        <GuestCard>
          <p className="text-[14px] leading-[1.6]">Plain card. Everything else.</p>
        </GuestCard>
      </Group>

      <Group title="Buttons">
        <div className="flex flex-col gap-2.5">
          <GuestButton variant="primary" size="sm">
            Primary sm
          </GuestButton>
          <GuestButton variant="primary" size="md">
            Primary md
          </GuestButton>
          <GuestButton variant="primary" size="lg" fullWidth>
            Primary lg, full width
          </GuestButton>
          <GuestButton variant="primary" disabled>
            Primary disabled
          </GuestButton>
          <GuestButton variant="outline">Outline</GuestButton>
          <GuestButton variant="ghost">Ghost</GuestButton>
          <GuestButton variant="danger">Danger</GuestButton>
          <GuestButton as="a" href="https://www.the-anchor.pub" external variant="outline">
            Anchor, external
          </GuestButton>
          <GuestButton as="link" href="/privacy" variant="ghost">
            Next link, internal
          </GuestButton>
        </div>
      </Group>

      <Group title="Alerts">
        <GuestAlert tone="success" title="Payment received">
          We have emailed your confirmation.
        </GuestAlert>
        <GuestAlert tone="notice" title="Your hold expires soon" icon={Clock}>
          We are holding your table until 7:15pm.
        </GuestAlert>
        <GuestAlert tone="problem" title="We could not take that payment">
          Nothing has been charged. Please try again.
        </GuestAlert>
        <GuestAlert
          tone="notice"
          title="Payment needed"
          action={
            <GuestButton variant="primary" fullWidth>
              Pay now
            </GuestButton>
          }
        >
          An alert holding an action pads to 16px.
        </GuestAlert>
        <GuestAlert tone="success" live="polite">
          Untitled alert with a polite live region.
        </GuestAlert>
      </Group>

      <Group title="Badges">
        <div className="flex flex-wrap gap-2">
          {BADGE_FIXTURES.map((status) => (
            <GuestBadge key={status} tone={guestBadgeToneForStatus(status)} dot>
              {status}
            </GuestBadge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <GuestBadge tone="success">No dot</GuestBadge>
          <GuestBadge tone="outstanding">No dot</GuestBadge>
          <GuestBadge tone="danger">No dot</GuestBadge>
          <GuestBadge tone="outline">No dot</GuestBadge>
        </div>
      </Group>

      <Group title="Amount">
        <GuestCard variant="accent">
          <GuestAmount label="Deposit due now" value="£30.00" sub="£10 per person for 3 guests" />
        </GuestCard>
        <GuestCard>
          <GuestAmount label="Balance remaining" value="£250.00" size="inline" />
        </GuestCard>
      </Group>

      <Group title="Detail rows and grid">
        <GuestCard>
          <DetailRow label="Booking reference" value="TB-2419" />
          <DetailRow label="Covers" value="3" />
          <DetailRow label="Hold expires" value="Today, 7:15pm" emphasis="deadline" />
        </GuestCard>
        <GuestCard>
          <DetailGrid
            items={[
              { label: 'Reference', value: 'PK-8823' },
              { label: 'Registration', value: 'AB12 CDE' },
              { label: 'Vehicle', value: 'Skoda Octavia' },
              { label: 'Status', value: <GuestBadge tone="success" dot>Paid</GuestBadge> },
            ]}
          />
        </GuestCard>
      </Group>

      <Group title="Fields">
        <GuestCard>
          <div className="flex flex-col gap-[18px]">
            <GuestField id="preview-party-size" label="Party size" required>
              <input
                {...guestFieldControlProps({ id: 'preview-party-size', required: true })}
                type="number"
                min={1}
                max={20}
                defaultValue={3}
                className={GUEST_INPUT_CLASS}
              />
            </GuestField>

            <GuestField
              id="preview-requirements"
              label="Special requirements"
              hint="Tell us about allergies or access needs. We share this with the kitchen and the team on shift. We keep it only for this booking."
            >
              <textarea
                {...guestFieldControlProps({
                  id: 'preview-requirements',
                  hint: 'present',
                })}
                rows={3}
                className={cn(GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS, 'min-h-[82px]')}
              />
            </GuestField>

            <GuestField
              id="preview-email"
              label="Email"
              error="Enter an email address we can reply to."
            >
              <input
                {...guestFieldControlProps({
                  id: 'preview-email',
                  error: 'Enter an email address we can reply to.',
                })}
                type="email"
                className={cn(GUEST_INPUT_CLASS, GUEST_INPUT_INVALID_CLASS)}
              />
            </GuestField>

            <fieldset className="rounded-guest-field border border-guest-border bg-guest-sunk px-[14px] py-3">
              <legend className="text-[13px] font-semibold">Add-ons</legend>
              <label className={GUEST_CHOICE_ROW_CLASS}>
                <input type="checkbox" name="preview-addon" value="cheese" />
                Cheese board
              </label>
              <label className={GUEST_CHOICE_ROW_CLASS}>
                <input type="radio" name="preview-choice" value="one" />
                A radio, same 20px box
              </label>
            </fieldset>
          </div>
        </GuestCard>
      </Group>

      <Group title="Trust line and sunk box">
        <TrustLine />
        <TrustLine>Secure payment via PayPal</TrustLine>
        <div className={GUEST_SUNK_BOX_CLASS}>
          <div className="flex flex-col gap-3">
            {[
              { Icon: Check, title: 'Secure booking', sub: 'Your details are encrypted.' },
              { Icon: Bell, title: 'Confirmation', sub: 'We text you when it is done.' },
              { Icon: Clock, title: 'Support', sub: 'Call us any time we are open.' },
            ].map(({ Icon, title, sub }) => (
              <div key={title} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-anchor-green/10">
                  <Icon aria-hidden="true" className="h-[15px] w-[15px] text-anchor-green" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold">{title}</span>
                  <span className="text-[12px] text-guest-text-muted">{sub}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Group>

      <Group title="Blocked state">
        <GuestBlockedState
          kicker="Table booking"
          heading="Payment link unavailable"
          lead="we could not open your payment link."
          reason="This payment link has expired."
          primaryAction={{ label: 'Call 01753 682707', href: 'tel:+441753682707' }}
          secondaryAction={{ label: 'Back to book a table', href: 'https://www.the-anchor.pub' }}
        />
      </Group>
    </GuestShell>
  )
}

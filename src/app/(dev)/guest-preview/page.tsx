import { notFound } from 'next/navigation'
import type { IconName } from '@/ds/icons'
import {
  DetailGrid,
  DetailRow,
  GuestAlert,
  GuestAmount,
  GuestBadge,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestCardHeader,
  GuestChoice,
  GuestField,
  GuestHelpLine,
  GuestInput,
  GuestIntro,
  GuestLink,
  GuestPhoneLink,
  GuestSection,
  GuestSelect,
  GuestShell,
  GuestStatusMark,
  GuestTextarea,
  GUEST_BODY_CLASS,
  GUEST_MESSAGE_CLASS,
  GUEST_NOTE_CLASS,
  GUEST_SUNK_BOX_CLASS,
  guestBadgeToneForStatus,
  guestFieldControlProps,
  TrustLine,
} from '@/components/features/guest'

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

const ASSURANCE_FIXTURES: Array<{ icon: IconName; title: string; sub: string }> = [
  { icon: 'check', title: 'Secure booking', sub: 'Your details are encrypted.' },
  { icon: 'bell', title: 'Confirmation', sub: 'We text you when it is done.' },
  { icon: 'clock', title: 'Support', sub: 'Call us any time we are open.' },
]

export default function GuestPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <GuestShell>
      <GuestIntro
        kicker="The Anchor"
        title="Guest primitives"
        lead="Every shared component and variant, rendered from synthetic fixtures."
      />

      <GuestSection title="Cards" titleId="preview-cards">
        <GuestCard variant="accent">
          <p className={GUEST_BODY_CLASS}>
            Accent card. Exactly one per page, on the thing the page exists to do.
          </p>
        </GuestCard>
        <GuestCard>
          <GuestCardHeader title="Titled card" description="A card title and one line under it." />
          <p className={GUEST_BODY_CLASS}>Plain card. Everything else.</p>
        </GuestCard>
        <GuestCard variant="danger">
          <p className={GUEST_BODY_CLASS}>Danger card. Holds the confirmation of something final.</p>
        </GuestCard>
      </GuestSection>

      <GuestSection title="Status marks" titleId="preview-marks">
        <div className="flex flex-wrap items-center gap-3">
          <GuestStatusMark tone="success" />
          <GuestStatusMark tone="notice" />
          <GuestStatusMark tone="problem" />
          <GuestStatusMark tone="brand" icon="bell" size="sm" />
          <GuestStatusMark tone="success" size="lg" />
        </div>
      </GuestSection>

      <GuestSection title="Buttons" titleId="preview-buttons">
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
          <GuestButton variant="primary" fullWidth="mobile">
            Primary, full width on a phone
          </GuestButton>
          <GuestButton variant="primary" disabled>
            Primary disabled
          </GuestButton>
          <GuestButton variant="primary" loading loadingText="Saving...">
            Primary loading
          </GuestButton>
          <GuestButton variant="outline">Outline</GuestButton>
          <GuestButton variant="ghost">Ghost</GuestButton>
          <GuestButton variant="danger">Danger</GuestButton>
          <GuestButton variant="destructive">Destructive</GuestButton>
          <GuestButton variant="link">Link action</GuestButton>
          <GuestButton variant="choice" pressed>
            <span className="font-semibold">Choice, chosen</span>
            <span className={GUEST_NOTE_CLASS}>A hint under the answer</span>
          </GuestButton>
          <GuestButton variant="choice" pressed={false}>
            <span className="font-semibold">Choice</span>
          </GuestButton>
          <GuestButton as="a" href="https://www.the-anchor.pub" external variant="outline">
            Anchor, external
          </GuestButton>
          <GuestButton as="link" href="/privacy" variant="ghost">
            Next link, internal
          </GuestButton>
        </div>
      </GuestSection>

      <GuestSection title="Alerts" titleId="preview-alerts">
        <GuestAlert tone="success" title="Payment received">
          We have emailed your confirmation.
        </GuestAlert>
        <GuestAlert tone="notice" title="Your hold expires soon" icon="clock">
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
      </GuestSection>

      <GuestSection title="Badges" titleId="preview-badges">
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
      </GuestSection>

      <GuestSection title="Figures" titleId="preview-figures">
        <GuestCard variant="accent">
          <GuestAmount label="Deposit due now" value="£30.00" sub="£10 per person for 3 guests" />
        </GuestCard>
        <GuestCard>
          <GuestAmount label="Booking" value="TB-2419" size="title" />
        </GuestCard>
        <GuestCard>
          <GuestAmount label="Balance remaining" value="£250.00" size="inline" />
        </GuestCard>
      </GuestSection>

      <GuestSection title="Detail rows and grid" titleId="preview-details">
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
      </GuestSection>

      <GuestSection title="Fields" titleId="preview-fields">
        <GuestCard>
          <div className="flex flex-col gap-guest-lg">
            <GuestField id="preview-party-size" label="Party size" required>
              <GuestInput
                {...guestFieldControlProps({ id: 'preview-party-size', required: true })}
                type="number"
                min={1}
                max={20}
                defaultValue={3}
              />
            </GuestField>

            <GuestField id="preview-course" label="Main course">
              <GuestSelect {...guestFieldControlProps({ id: 'preview-course' })} defaultValue="">
                <option value="">Please choose</option>
                <option value="roast">Roast beef</option>
              </GuestSelect>
            </GuestField>

            <GuestField
              id="preview-requirements"
              label="Special requirements"
              hint="Tell us about allergies or access needs. We share this with the kitchen and the team on shift. We keep it only for this booking."
            >
              <GuestTextarea
                {...guestFieldControlProps({
                  id: 'preview-requirements',
                  hint: 'present',
                })}
                rows={3}
              />
            </GuestField>

            <GuestField
              id="preview-email"
              label="Email"
              error="Enter an email address we can reply to."
            >
              <GuestInput
                {...guestFieldControlProps({
                  id: 'preview-email',
                  error: 'Enter an email address we can reply to.',
                })}
                type="email"
                invalid
              />
            </GuestField>

            <fieldset className="rounded-guest-field border border-guest-border bg-guest-sunk px-guest-md py-3">
              <legend className="px-1 font-anchor-body text-guest-small font-semibold">Add-ons</legend>
              <GuestChoice type="checkbox" id="preview-addon" name="preview-addon" value="cheese" label="Cheese board" />
              <GuestChoice type="radio" id="preview-choice" name="preview-choice" value="one" label="A radio, same 20px box" />
              <GuestChoice
                type="radio"
                id="preview-choice-boxed"
                name="preview-choice"
                value="two"
                boxed
                label="A boxed radio, for an option with two lines"
              />
            </fieldset>
          </div>
        </GuestCard>
      </GuestSection>

      <GuestSection title="Links, help line and trust line" titleId="preview-links">
        <p className={GUEST_MESSAGE_CLASS}>
          An inline <GuestLink href="/privacy">guest link</GuestLink> in running copy.
        </p>
        <GuestHelpLine>
          Need help? Call <GuestPhoneLink />.
        </GuestHelpLine>
        <TrustLine />
        <TrustLine>Secure payment via PayPal</TrustLine>
        <div className={GUEST_SUNK_BOX_CLASS}>
          <div className="flex flex-col gap-3">
            {ASSURANCE_FIXTURES.map(({ icon, title, sub }) => (
              <div key={title} className="flex items-center gap-3">
                <GuestStatusMark tone="brand" icon={icon} size="sm" />
                <span className="flex flex-col">
                  <span className="font-semibold">{title}</span>
                  <span className={GUEST_NOTE_CLASS}>{sub}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </GuestSection>

      <GuestSection title="Blocked state" titleId="preview-blocked">
        <GuestBlockedState
          kicker="Table booking"
          heading="Payment link unavailable"
          lead="we could not open your payment link."
          reason="This payment link has expired."
          primaryAction={{ label: 'Call 01753 682707', href: 'tel:+441753682707' }}
          secondaryAction={{ label: 'Back to book a table', href: 'https://www.the-anchor.pub' }}
        />
      </GuestSection>
    </GuestShell>
  )
}

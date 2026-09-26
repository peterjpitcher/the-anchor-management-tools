'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
// Imported file by file rather than through the `guest` barrel, which would pull
// the guest webfont module into this client bundle. GuestShell stays on the server page.
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestCardHeader } from '@/components/features/guest/GuestCardHeader'
import { GuestChoice } from '@/components/features/guest/GuestChoice'
import { GuestTextarea } from '@/components/features/guest/GuestControls'
import { GuestField } from '@/components/features/guest/GuestField'
import { GuestIntro } from '@/components/features/guest/GuestIntro'
import { GUEST_MESSAGE_CLASS, GUEST_MUTED_CLASS } from '@/components/features/guest/styles'
import { LEGACY_REPORT_LOCATIONS } from '@/lib/short-links/legacy-report'

type LegacyLinkClientProps = {
  shortCode: string
  destinationUrl: string
  staffMode: boolean
}

type SubmitState = 'idle' | 'saving' | 'saved' | 'error'

export default function LegacyLinkClient({
  shortCode,
  destinationUrl,
  staffMode,
}: LegacyLinkClientProps): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [isStaff, setIsStaff] = useState(staffMode)
  const [state, setState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const saving = state === 'saving'
  const saved = state === 'saved'

  async function submit(locationKey: string) {
    setSelected(locationKey)
    setState('saving')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/short-links/legacy-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: shortCode,
          locationKey,
          locationDetail: detail.trim() || undefined,
          isStaff,
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Could not save your answer')
      }

      setState('saved')
    } catch (error) {
      setState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Could not save your answer')
    }
  }

  // "Somewhere else" is the only option that needs a description, so it waits for the
  // separate submit below rather than posting on tap like the others.
  const needsDetail = selected === 'other' && !saved

  // A fragment, not a wrapper: the page's GuestShell spaces these blocks itself.
  return (
    <>
      <GuestIntro
        kicker="Link update"
        title="This link is moving"
        lead="We are retiring our old vip-club.uk web address. Your link still works, and it always will until we have replaced it everywhere."
      />

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-md">
          <p className={GUEST_MESSAGE_CLASS}>Carry on to what you were after:</p>
          <GuestButton as="a" href={destinationUrl} size="lg" fullWidth>
            Continue
          </GuestButton>
        </div>
      </GuestCard>

      {saved ? (
        <GuestCard>
          <div className="flex flex-col gap-guest-md">
            <GuestAlert tone="success" title="Thank you">
              That is genuinely helpful. It tells us exactly what to go and replace.
            </GuestAlert>
            <GuestButton as="a" href={destinationUrl} variant="outline" fullWidth>
              Continue
            </GuestButton>
          </div>
        </GuestCard>
      ) : (
        <GuestCard>
          <GuestCardHeader
            title="Where did you find this link?"
            description="One tap. It helps us find the old sign or QR code so we can put the new one up."
          />

          <div className="flex flex-col gap-guest-md">
            {errorMessage && (
              <GuestAlert tone="problem" title="That did not save">
                {errorMessage}
              </GuestAlert>
            )}

            {/*
              Above the options, not below, because tapping an option submits immediately.
              Always visible rather than gated behind ?staff=1: a staff member sweeping the
              pub arrives by scanning a QR code and cannot add a query parameter first.
              `staffMode` still pre-ticks it for anyone who did use the link.
            */}
            <GuestChoice
              type="checkbox"
              id="legacy-link-staff"
              checked={isStaff}
              onChange={(event) => setIsStaff(event.target.checked)}
              label={<span className="text-guest-text-muted">I work here, this is a staff check</span>}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {LEGACY_REPORT_LOCATIONS.map((option) => (
                <GuestButton
                  key={option.key}
                  variant="choice"
                  pressed={selected === option.key}
                  disabled={saving}
                  onClick={() => {
                    if (option.key === 'other') {
                      setSelected('other')
                      setState('idle')
                      return
                    }
                    void submit(option.key)
                  }}
                >
                  <span className="font-anchor-body text-guest-lead font-semibold leading-guest-snug text-guest-text">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="font-anchor-body text-guest-small leading-guest-snug text-guest-text-muted">
                      {option.hint}
                    </span>
                  )}
                </GuestButton>
              ))}
            </div>

            {needsDetail && (
              <div className="flex flex-col gap-3">
                <GuestField id="legacy-link-detail" label="Where was it?">
                  <GuestTextarea
                    id="legacy-link-detail"
                    rows={3}
                    maxLength={280}
                    value={detail}
                    onChange={(event) => setDetail(event.target.value)}
                    placeholder="For example, a sticker on the window by the front door"
                  />
                </GuestField>
                <GuestButton
                  as="button"
                  type="button"
                  disabled={detail.trim().length === 0}
                  loading={saving}
                  loadingText="Saving..."
                  onClick={() => void submit('other')}
                  fullWidth
                >
                  Send
                </GuestButton>
              </div>
            )}
          </div>
        </GuestCard>
      )}

      <p className={clsx('text-center', GUEST_MUTED_CLASS)}>
        Nothing is broken. Old links keep working while we swap them over.
      </p>
    </>
  )
}

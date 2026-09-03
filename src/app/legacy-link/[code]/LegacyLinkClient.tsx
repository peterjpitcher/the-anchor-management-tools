'use client'

import { useState } from 'react'
import {
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GUEST_TEXTAREA_CLASS,
  GuestAlert,
  GuestButton,
  GuestCard,
  GuestShell,
} from '@/components/features/guest'
import { LEGACY_REPORT_LOCATIONS } from '@/lib/short-links/legacy-report'
import { cn } from '@/lib/utils'

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

  return (
    <GuestShell maxWidthClassName="max-w-[600px]">
      <div className={GUEST_INTRO_CLASS}>
        <span className={GUEST_KICKER_CLASS}>Link update</span>
        <h1 className={GUEST_H1_CLASS}>This link is moving</h1>
        <p className={GUEST_LEAD_CLASS}>
          We are retiring our old vip-club.uk web address. Your link still works, and it always
          will until we have replaced it everywhere.
        </p>
      </div>

      <GuestCard variant="accent">
        <div className="flex flex-col gap-4">
          <p className="font-anchor-body text-[15px] leading-[1.6] text-guest-text">
            Carry on to what you were after:
          </p>
          <GuestButton as="a" href={destinationUrl} size="lg" fullWidth>
            Continue
          </GuestButton>
        </div>
      </GuestCard>

      {saved ? (
        <GuestCard>
          <div className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-[7px]">
              <h2 className="font-anchor-display text-[21px] font-normal leading-[1.25] text-guest-text-strong">
                Where did you find this link?
              </h2>
              <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
                One tap. It helps us find the old sign or QR code so we can put the new one up.
              </p>
            </div>

            {errorMessage && (
              <GuestAlert tone="problem" title="That did not save">
                {errorMessage}
              </GuestAlert>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {LEGACY_REPORT_LOCATIONS.map((option) => {
                const active = selected === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (option.key === 'other') {
                        setSelected('other')
                        setState('idle')
                        return
                      }
                      void submit(option.key)
                    }}
                    className={cn(
                      'guest-btn flex min-h-[52px] flex-col items-start justify-center gap-0.5 rounded-guest-field border-[1.5px] px-4 py-2.5 text-left font-anchor-body transition-[border-color,background-color] duration-200 disabled:cursor-not-allowed disabled:opacity-60',
                      active
                        ? 'border-anchor-gold-dark bg-anchor-cream'
                        : 'border-guest-border-strong bg-guest-surface hover:border-anchor-gold-dark'
                    )}
                  >
                    <span className="text-[15px] font-semibold leading-[1.3] text-guest-text">
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="text-[13px] leading-[1.35] text-guest-text-muted">
                        {option.hint}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {needsDetail && (
              <div className="flex flex-col gap-3">
                <label
                  htmlFor="legacy-link-detail"
                  className="font-anchor-body text-[14px] font-semibold leading-[1.4] text-guest-text"
                >
                  Where was it?
                </label>
                <textarea
                  id="legacy-link-detail"
                  rows={3}
                  maxLength={280}
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  placeholder="For example, a sticker on the window by the front door"
                  className={cn(GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS)}
                />
                <GuestButton
                  as="button"
                  type="button"
                  disabled={saving || detail.trim().length === 0}
                  onClick={() => void submit('other')}
                  fullWidth
                >
                  {saving ? 'Saving...' : 'Send'}
                </GuestButton>
              </div>
            )}

            {staffMode && (
              <div className={GUEST_SUNK_BOX_CLASS}>
                <label className={GUEST_CHOICE_ROW_CLASS} htmlFor="legacy-link-staff">
                  <input
                    id="legacy-link-staff"
                    type="checkbox"
                    checked={isStaff}
                    onChange={(event) => setIsStaff(event.target.checked)}
                    className="h-[18px] w-[18px] accent-anchor-green"
                  />
                  <span>Staff check, not a customer</span>
                </label>
                <p className="mt-1 font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
                  Recorded separately so a sweep of the pub does not look like customer traffic.
                  Add the exact spot under &ldquo;Somewhere else&rdquo; if it helps.
                </p>
              </div>
            )}
          </div>
        </GuestCard>
      )}

      <p className="text-center font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
        Nothing is broken. Old links keep working while we swap them over.
      </p>
    </GuestShell>
  )
}

'use client'

import { useCallback, useState } from 'react'
import type { SigningBrand, SigningMode } from '@/lib/signing/types'

/**
 * Everything the signing screen needs, worked out on the server. The same model drives the
 * public link page (both brands) and the staff portal page, so they cannot drift apart.
 */
export interface SigningViewModel {
  brand: SigningBrand
  mode: SigningMode
  title: string
  summary: string | null
  /** Who sent it, as the signer knows them. */
  senderName: string
  recipientName: string
  /** The exact words beside the tick box. Sent back with the signature and checked. */
  agreedText: string
  /** Where the screen starts. */
  initialPhase: 'identity' | 'form' | 'signed' | 'declined' | 'blocked'
  /** Why there is nothing to sign, for `blocked`. */
  blockedMessage: string | null
  /** True when the server has already seen this person open the document. */
  documentViewed: boolean
  /** "11 November 2026" */
  expiresOn: string
  /** A manager has handed over this device. */
  inPerson: boolean
  /** Signed in to the staff portal, so there is no personal link to mention. */
  isPortal: boolean
  otherSigners: Array<{ name: string; roleLabel: string; signed: boolean }>
  endpoints: {
    document: string
    /** Absent in the staff portal, where signing in is the identity check. */
    identity?: string
    sign: string
    decline: string
  }
}

type Phase = SigningViewModel['initialPhase']

interface ApiFailure {
  success: false
  error?: { code?: string; message?: string }
}

const GENERIC_FAILURE =
  'Sorry, that did not go through. Please check your connection and try again, or contact us and we will sort it out.'

async function postJson(url: string, body: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const payload = (await response.json().catch(() => null)) as { success?: boolean } | ApiFailure | null
    if (response.ok && payload?.success) return { ok: true }
    const message = (payload as ApiFailure | null)?.error?.message
    return { ok: false, message: message || GENERIC_FAILURE }
  } catch {
    return { ok: false, message: GENERIC_FAILURE }
  }
}

export interface SigningFlow {
  phase: Phase
  error: string | null
  busy: boolean
  documentOpened: boolean
  typedName: string
  agreed: boolean
  declining: boolean
  declineReason: string
  dateOfBirth: string
  completed: boolean
  setTypedName: (value: string) => void
  setAgreed: (value: boolean) => void
  setDeclining: (value: boolean) => void
  setDeclineReason: (value: string) => void
  setDateOfBirth: (value: string) => void
  markDocumentOpened: () => void
  submitIdentity: () => Promise<void>
  submitSignature: () => Promise<void>
  submitDecline: () => Promise<void>
}

export function useSigningFlow(model: SigningViewModel): SigningFlow {
  const [phase, setPhase] = useState<Phase>(model.initialPhase)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [documentOpened, setDocumentOpened] = useState(model.documentViewed)
  const [typedName, setTypedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [completed, setCompleted] = useState(false)

  const markDocumentOpened = useCallback(() => {
    setDocumentOpened(true)
    setError(null)
  }, [])

  const submitIdentity = useCallback(async () => {
    if (!model.endpoints.identity) return
    if (!dateOfBirth) {
      setError('Enter your date of birth.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await postJson(model.endpoints.identity, { date_of_birth: dateOfBirth })
    setBusy(false)
    if (result.ok) {
      setPhase('form')
    } else {
      setError(result.message)
    }
  }, [dateOfBirth, model.endpoints.identity])

  const submitSignature = useCallback(async () => {
    if (!documentOpened) {
      setError('Please open the document and read it before you continue.')
      return
    }
    if (typedName.trim().length < 2) {
      setError('Please type your full name.')
      return
    }
    if (!agreed) {
      setError('Please tick the box to confirm.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await postJson(model.endpoints.sign, {
      typed_name: typedName.trim(),
      agreed: true,
      agreed_text: model.agreedText,
    })
    setBusy(false)
    if (result.ok) {
      setCompleted(true)
      setPhase('signed')
    } else {
      setError(result.message)
    }
  }, [agreed, documentOpened, model.agreedText, model.endpoints.sign, typedName])

  const submitDecline = useCallback(async () => {
    setBusy(true)
    setError(null)
    const result = await postJson(model.endpoints.decline, { reason: declineReason.trim() || null })
    setBusy(false)
    if (result.ok) {
      setPhase('declined')
    } else {
      setError(result.message)
    }
  }, [declineReason, model.endpoints.decline])

  return {
    phase,
    error,
    busy,
    documentOpened,
    typedName,
    agreed,
    declining,
    declineReason,
    dateOfBirth,
    completed,
    setTypedName,
    setAgreed,
    setDeclining,
    setDeclineReason,
    setDateOfBirth,
    markDocumentOpened,
    submitIdentity,
    submitSignature,
    submitDecline,
  }
}

/** Words that change between signing and acknowledging, in one place for both views. */
export function signingWords(mode: SigningMode): {
  action: string
  button: string
  busy: string
  doneHeading: string
  doneLead: string
  tickHint: string
} {
  if (mode === 'acknowledge') {
    return {
      action: 'read and confirm',
      button: 'Confirm',
      busy: 'Saving…',
      doneHeading: 'Confirmed, thank you',
      doneLead: 'We have recorded that you have read and understood this document.',
      tickHint: 'Typing your name here is your confirmation.',
    }
  }
  return {
    action: 'read and sign',
    button: 'Sign document',
    busy: 'Signing…',
    doneHeading: 'Signed, thank you',
    doneLead: 'Your signature has been recorded.',
    tickHint: 'Typing your name here has the same effect as signing by hand.',
  }
}

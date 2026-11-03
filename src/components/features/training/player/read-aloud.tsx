'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Icon } from '@/ds'

/**
 * Read-aloud for the course player, with the phone's or computer's own speech (the Web Speech
 * API). Nothing leaves the device and no outside service is called, so no CSP change is needed.
 * A British English voice is used when the device has one; otherwise the device reads with its
 * default voice, still asked for en-GB. Where the browser has no speech at all, the button is
 * not drawn.
 */

export interface ReadAloud {
  /** False until the page has loaded in a browser that can speak. */
  supported: boolean
  speaking: boolean
  speak: (text: string) => void
  stop: () => void
}

/** The device's speech engine, or null where there is none (and during the server render). */
function speechEngine(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return null
  return window.speechSynthesis
}

/** A British English voice, preferring one that runs on the device, or null when there is none. */
export function pickBritishVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const british = voices.filter((voice) => voice.lang.replace('_', '-').toLowerCase() === 'en-gb')
  return british.find((voice) => voice.localService) ?? british[0] ?? null
}

/** One speech controller per player, so moving to another card can stop the last one. */
export function useReadAloud(): ReadAloud {
  const [supported, setSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    const engine = speechEngine()
    if (!engine) return
    setSupported(true)
    // Voices load late on some browsers, so pick again when the list arrives.
    const pick = (): void => {
      voiceRef.current = pickBritishVoice(engine.getVoices?.() ?? [])
    }
    pick()
    engine.addEventListener?.('voiceschanged', pick)
    return () => {
      engine.removeEventListener?.('voiceschanged', pick)
      engine.cancel()
    }
  }, [])

  const stop = useCallback((): void => {
    speechEngine()?.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback((text: string): void => {
    const engine = speechEngine()
    if (!engine || text.trim().length === 0) return
    engine.cancel()
    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.lang = 'en-GB'
    if (voiceRef.current) utterance.voice = voiceRef.current
    utterance.rate = 0.95
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    engine.speak(utterance)
  }, [])

  return { supported, speaking, speak, stop }
}

interface ReadAloudButtonProps {
  readAloud: ReadAloud
  /** The words to read: built by card-text.ts. */
  text: string
  /** What is being read, for screen readers: "Read this card aloud". */
  what?: string
}

/** "Read aloud" or "Stop reading". Not drawn where the device cannot speak. */
export function ReadAloudButton({ readAloud, text, what = 'this card' }: ReadAloudButtonProps): React.JSX.Element | null {
  if (!readAloud.supported) return null
  if (readAloud.speaking) {
    return (
      <Button type="button" variant="secondary" size="md" className="min-h-touch" icon={<Icon name="pause" />} onClick={readAloud.stop}>
        Stop reading
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="md"
      className="min-h-touch"
      icon={<Icon name="play" />}
      onClick={() => readAloud.speak(text)}
    >
      Read aloud
      <span className="sr-only">: {what}</span>
    </Button>
  )
}

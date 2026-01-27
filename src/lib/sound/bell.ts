type BellOptions = {
  volume?: number
  throttleMs?: number
}

let audioContext: AudioContext | null = null
let lastPlayedAtMs = 0

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) return null

  if (!audioContext) {
    audioContext = new AudioContextCtor()
  }

  return audioContext
}

/**
 * Plays a small "bell" notification using the Web Audio API.
 *
 * Note: Browsers may block audio until the user has interacted with the page.
 */
export async function playBell({ volume = 0.12, throttleMs = 350 }: BellOptions = {}) {
  if (process.env.NODE_ENV === 'test') return

  const nowMs = Date.now()
  if (nowMs - lastPlayedAtMs < throttleMs) return
  lastPlayedAtMs = nowMs

  const context = getAudioContext()
  if (!context) return

  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      return
    }
  }

  const now = context.currentTime
  const durationSeconds = 0.75

  const outputGain = context.createGain()
  outputGain.gain.setValueAtTime(0.0001, now)
  outputGain.gain.exponentialRampToValueAtTime(volume, now + 0.01)
  outputGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds)
  outputGain.connect(context.destination)

  const osc1 = context.createOscillator()
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(880, now)
  osc1.detune.setValueAtTime(-6, now)

  const osc2 = context.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1320, now)
  osc2.detune.setValueAtTime(7, now)

  osc1.connect(outputGain)
  osc2.connect(outputGain)

  let disconnected = false
  const disconnect = () => {
    if (disconnected) return
    disconnected = true
    try {
      osc1.disconnect()
      osc2.disconnect()
      outputGain.disconnect()
    } catch {
      // ignore
    }
  }

  osc1.onended = disconnect
  osc2.onended = disconnect

  osc1.start(now)
  osc2.start(now)
  osc1.stop(now + durationSeconds)
  osc2.stop(now + durationSeconds)
}


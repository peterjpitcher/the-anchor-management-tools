import { describe, expect, it } from 'vitest'
import { cardBodySpeech, cardScreenSpeech, cardTitle, checkSpeech, resultsSpeech } from '@/components/features/training/player/card-text'
import { pickBritishVoice } from '@/components/features/training/player/read-aloud'
import type { CourseCard } from '@/lib/training/types'

describe('card headings', () => {
  it('uses the card title, or none so the screen shows the section title', () => {
    expect(cardTitle({ type: 'paragraph', title: 'Why it matters', text: 'Text' })).toBe('Why it matters')
    expect(cardTitle({ type: 'paragraph', text: 'Text' })).toBeNull()
    expect(cardTitle({ type: 'callout', tone: 'warning', title: 'Call 999', text: 'Text' })).toBe('Call 999')
    expect(cardTitle({ type: 'image', src: 'images/a.jpg', alt: 'The cellar door' })).toBeNull()
    expect(
      cardTitle({ type: 'check_yourself', prompt: 'Q', options: ['a', 'b', 'c'], answer: 0, explanation: 'E' }),
    ).toBe('Check yourself')
  })
})

describe('read-aloud words', () => {
  it('reads each card type in order, with pauses', () => {
    const cards: Array<[CourseCard, string]> = [
      [{ type: 'paragraph', text: 'Raise the alarm first' }, 'Raise the alarm first.'],
      [{ type: 'bullets', items: ['One', 'Two?'] }, 'One. Two?'],
      [{ type: 'do_dont', do: ['Smile'], dont: ['Shout'] }, "Do. Smile. Don't. Shout."],
      [
        { type: 'table', columns: ['Day', 'Hours'], rows: [['Monday', '12 to 11']] },
        'Day: Monday, Hours: 12 to 11.',
      ],
      [
        { type: 'steps', steps: [{ title: 'Stop', text: 'Turn it off.' }, { title: 'Tell', text: 'Tell a manager.' }] },
        'Step 1, Stop. Turn it off. Step 2, Tell. Tell a manager.',
      ],
      [{ type: 'image', src: 'images/a.jpg', alt: 'The fire exit', caption: 'Keep it clear' }, 'The fire exit. Keep it clear.'],
    ]
    for (const [card, words] of cards) expect(cardBodySpeech(card)).toBe(words)
  })

  it('never reads out the answer of a check-yourself card', () => {
    const words = cardBodySpeech({
      type: 'check_yourself',
      prompt: 'What do you do first?',
      options: ['Look', 'Raise the alarm', 'Run'],
      answer: 1,
      explanation: 'SECRET EXPLANATION',
    })
    expect(words).toBe('What do you do first? Option 1: Look. Option 2: Raise the alarm. Option 3: Run.')
    expect(words).not.toContain('SECRET')
  })

  it('puts the heading first on a card screen', () => {
    expect(cardScreenSpeech('Fire', { type: 'paragraph', text: 'Get out.' })).toBe('Fire. Get out.')
  })

  it('reads a check without answers, and results with them', () => {
    expect(checkSpeech([{ id: 'q1', prompt: 'Pick one', options: ['A', 'B', 'C'] }])).toBe(
      'Question 1: Pick one. Option 1: A. Option 2: B. Option 3: C.',
    )
    const results = resultsSpeech('Not passed this time.', [
      { questionId: 'q1', prompt: 'Pick one', options: ['A', 'B', 'C'], chosen: 0, correctIndex: 2, correct: false, critical: true, explanation: 'C is right.' },
    ])
    expect(results).toBe('Not passed this time. Question 1: Pick one. You chose: A. The right answer is: C. C is right.')
  })
})

describe('pickBritishVoice', () => {
  const voice = (lang: string, localService: boolean, name = lang): SpeechSynthesisVoice =>
    ({ lang, localService, name, default: false, voiceURI: name }) as SpeechSynthesisVoice

  it('prefers a British voice on the device', () => {
    const remote = voice('en-GB', false, 'remote')
    const local = voice('en_GB', true, 'local')
    expect(pickBritishVoice([voice('en-US', true), remote, local])).toBe(local)
    expect(pickBritishVoice([voice('en-US', true), remote])).toBe(remote)
  })

  it('returns null when there is no British voice', () => {
    expect(pickBritishVoice([voice('en-US', true), voice('fr-FR', true)])).toBeNull()
    expect(pickBritishVoice([])).toBeNull()
  })
})

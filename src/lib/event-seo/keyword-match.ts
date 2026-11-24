// ──────────────────────────────────────────────────────────────
// Keyword matching for event copy.
//
// Exact phrase on whole words, with three foldings applied to both sides:
// hyphens read as spaces ("family-friendly" = "family friendly"), apostrophes
// are dropped ("new year's" = "new years"), and a simple plural "s" is ignored
// ("pub quizzes" still fails, "bingo nights" = "bingo night").
//
// "near me" is never written into copy: it is satisfied by place names and the
// Event schema, so it is stripped from a keyword before matching.
//
// There is deliberately no prefix fallback. Until 24 November 2026 a three word
// keyword counted as present when its first two words appeared, so "things to
// do in staines" passed on "things to" and "the anchor stanwell moor" on "the
// anchor".
// ──────────────────────────────────────────────────────────────

function foldWord(word: string): string {
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Lower case words with the foldings applied, in order. */
export function keywordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[^a-z0-9£]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(foldWord)
}

/** The keyword as it must appear in copy: "near me" removed. Empty when nothing is left. */
export function copyableKeyword(keyword: string): string {
  return keyword.replace(/\bnear\s+me\b/gi, ' ').replace(/\s+/g, ' ').trim()
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

/** True when the whole keyword appears in the text as a phrase. */
export function matchesKeyword(text: string, keyword: string): boolean {
  if (!text) return false
  const needle = keywordTokens(copyableKeyword(keyword))
  if (needle.length === 0) return false
  return containsSequence(keywordTokens(text), needle)
}

/**
 * The focus phrase: the first Focus entry that still has words once "near me"
 * is taken off. Null when the tier is empty.
 */
export function focusPhrase(primaryKeywords: string[]): string | null {
  for (const kw of primaryKeywords) {
    const copyable = copyableKeyword(kw)
    if (keywordTokens(copyable).length > 0) return copyable
  }
  return null
}

/**
 * A focus phrase to offer staff from the event name, for them to confirm or replace: the part
 * after a colon when there is one ("Sleigh My Name: Festive Music Bingo" gives "festive music
 * bingo"), otherwise the whole name without "at The Anchor". Null when nothing usable is left.
 */
export function suggestFocusPhrase(eventName: string | null | undefined): string | null {
  const name = (eventName ?? '').trim()
  if (!name) return null
  const afterColon = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
  const phrase = afterColon
    .replace(/\bat\s+the\s+anchor\b/gi, ' ')
    .replace(/\bthe\s+anchor\b/gi, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}'&£ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return keywordTokens(phrase).length > 0 ? phrase : null
}

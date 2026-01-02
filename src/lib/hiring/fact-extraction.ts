import { franc } from 'franc'

export type ResumeFacts = {
    postcodes?: string[]
    postcode?: string
    distance_to_anchor_miles?: number
    commute_status?: 'yes' | 'no' | 'unclear'
    language?: string
    language_confidence?: number
    is_english?: boolean
}

const POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi
const ANCHOR_POSTCODE = (process.env.HIRING_ANCHOR_POSTCODE || 'TW19 6AQ').toUpperCase().trim()
const COMMUTE_MAX_MILES = Number(process.env.HIRING_COMMUTE_MAX_MILES || 10)
const COMMUTE_REJECT_MILES = Number(process.env.HIRING_COMMUTE_REJECT_MILES || Math.max(COMMUTE_MAX_MILES * 2, COMMUTE_MAX_MILES + 5))
const languageCache = new Map<string, { language: string; confidence: number; isEnglish: boolean }>()
const postcodeCache = new Map<string, { lat: number; lon: number }>()

const ENGLISH_STOPWORDS = new Set([
    'the', 'and', 'to', 'of', 'in', 'for', 'with', 'experience', 'skills', 'education',
    'work', 'customer', 'service', 'team', 'responsible', 'role', 'years', 'years',
    'bar', 'restaurant', 'hospitality', 'manager', 'assistant', 'supervisor',
])

const SECTION_HEADING_REGEX = /^(experience|employment|work history|work experience|education|skills|summary|profile|projects|certifications|training|qualifications)\b/i

function normalizePostcode(postcode: string) {
    const compact = postcode.replace(/\s+/g, '').toUpperCase()
    if (compact.length <= 3) return compact
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

export function extractPostcodes(text: string): string[] {
    const matches = text.match(POSTCODE_REGEX) || []
    const normalized = matches.map((match) => normalizePostcode(match))
    return Array.from(new Set(normalized))
}

function normalizeLanguageSample(text: string) {
    return text.replace(/\s+/g, ' ').trim()
}

function stripLanguagesSection(text: string) {
    const lines = text.split(/\r?\n/)
    const filtered: string[] = []
    let skipping = false

    lines.forEach((raw) => {
        const line = raw.trim()
        if (/^languages?\b/i.test(line)) {
            skipping = true
            return
        }
        if (skipping) {
            if (!line) {
                skipping = false
                return
            }
            if (SECTION_HEADING_REGEX.test(line)) {
                skipping = false
                filtered.push(raw)
                return
            }
            return
        }
        filtered.push(raw)
    })

    return filtered.join('\n')
}

function sanitizeLanguageText(text: string) {
    return text
        .replace(/\b\S+@\S+\.\S+\b/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
}

function computeStopwordRatio(text: string) {
    const words = text.toLowerCase().match(/[a-z]+/g) || []
    if (!words.length) return 0
    let hits = 0
    for (const word of words) {
        if (ENGLISH_STOPWORDS.has(word)) hits += 1
    }
    return hits / words.length
}

function computeAsciiLetterRatio(text: string) {
    const letters = text.match(/[A-Za-z]/g) || []
    const nonAsciiLetters = text.match(/[^\x00-\x7F]/g) || []
    if (!letters.length) return 0
    return letters.length / (letters.length + nonAsciiLetters.length)
}

export function detectLanguage(text: string) {
    const sample = normalizeLanguageSample(text.slice(0, 5000))
    if (!sample) {
        return { language: 'und', confidence: 0, isEnglish: false }
    }

    if (languageCache.has(sample)) {
        return languageCache.get(sample)!
    }

    const detected = franc(sample, { minLength: 200 })
    const stopwordRatio = computeStopwordRatio(sample)
    const asciiRatio = computeAsciiLetterRatio(sample)

    let language = detected
    let confidence = 0.4
    let isEnglish = false

    if (detected === 'eng') {
        isEnglish = true
        confidence = 0.85
    } else if (detected === 'und') {
        if (stopwordRatio > 0.05 && asciiRatio > 0.9) {
            isEnglish = true
            language = 'eng'
            confidence = Math.min(0.7, stopwordRatio + 0.2)
        } else {
            confidence = 0.2
        }
    } else {
        isEnglish = false
        confidence = Math.max(0.6, stopwordRatio * 0.2)
    }

    const result = { language, confidence: Number(confidence.toFixed(2)), isEnglish }
    languageCache.set(sample, result)
    return result
}

async function getPostcodeCoordinates(postcode: string): Promise<{ lat: number; lon: number } | null> {
    const normalized = normalizePostcode(postcode)
    if (postcodeCache.has(normalized)) {
        return postcodeCache.get(normalized)!
    }

    try {
        const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalized)}`)
        if (!response.ok) {
            return null
        }

        const payload = await response.json()
        if (!payload?.result) return null
        const coords = { lat: payload.result.latitude, lon: payload.result.longitude }
        postcodeCache.set(normalized, coords)
        return coords
    } catch (error) {
        return null
    }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
    const toRad = (value: number) => (value * Math.PI) / 180
    const radiusMiles = 3958.8
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return radiusMiles * c
}

async function computeDistanceToAnchor(postcode: string) {
    const candidateCoords = await getPostcodeCoordinates(postcode)
    const anchorCoords = await getPostcodeCoordinates(ANCHOR_POSTCODE)
    if (!candidateCoords || !anchorCoords) return null
    return Number(haversineMiles(candidateCoords.lat, candidateCoords.lon, anchorCoords.lat, anchorCoords.lon).toFixed(1))
}

function deriveCommuteStatus(distanceMiles: number | null) {
    if (distanceMiles == null) return undefined
    if (distanceMiles <= COMMUTE_MAX_MILES) return 'yes'
    if (distanceMiles >= COMMUTE_REJECT_MILES) return 'no'
    return 'unclear'
}

export async function extractResumeFacts(text: string): Promise<ResumeFacts> {
    const postcodes = extractPostcodes(text)
    const primaryPostcode = postcodes[0]
    const languageSample = sanitizeLanguageText(stripLanguagesSection(text))
    const languageResult = detectLanguage(languageSample)
    const facts: ResumeFacts = {
        postcodes,
        postcode: primaryPostcode,
        language: languageResult.language,
        language_confidence: languageResult.confidence,
        is_english: languageResult.isEnglish,
    }

    if (primaryPostcode) {
        const distanceMiles = await computeDistanceToAnchor(primaryPostcode)
        if (distanceMiles != null) {
            facts.distance_to_anchor_miles = distanceMiles
            facts.commute_status = deriveCommuteStatus(distanceMiles)
        }
    }

    return facts
}

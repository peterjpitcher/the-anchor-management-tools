import { isShortLinkHost, isShortLinkPath } from '@/lib/short-links/routing'
import { ShortLinkService } from '@/services/short-links'

const URL_TOKEN_REGEX = /https?:\/\/\S+/gi
const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', ')', ']', '}', '"', "'", '>'])

type ParsedToken = {
  rawToken: string
  cleanUrl: string | null
  trailingSuffix: string
}

function splitUrlToken(rawToken: string): { cleanUrl: string; trailingSuffix: string } {
  let cleanUrl = rawToken
  let trailingSuffix = ''

  while (cleanUrl.length > 0) {
    const char = cleanUrl[cleanUrl.length - 1]
    if (!TRAILING_PUNCTUATION.has(char)) {
      break
    }

    // Keep balanced closing parenthesis when it is part of the URL.
    if (char === ')') {
      const opens = (cleanUrl.match(/\(/g) || []).length
      const closes = (cleanUrl.match(/\)/g) || []).length
      if (closes <= opens) {
        break
      }
    }

    cleanUrl = cleanUrl.slice(0, -1)
    trailingSuffix = `${char}${trailingSuffix}`
  }

  return { cleanUrl, trailingSuffix }
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function parseUrlToken(rawToken: string): ParsedToken {
  const { cleanUrl, trailingSuffix } = splitUrlToken(rawToken)
  const parsedUrl = parseHttpUrl(cleanUrl)

  if (!parsedUrl) {
    return {
      rawToken,
      cleanUrl: null,
      trailingSuffix
    }
  }

  return {
    rawToken,
    cleanUrl,
    trailingSuffix
  }
}

export async function shortenUrlsInSmsBody(body: string): Promise<string> {
  if (!body) return body

  const rawMatches = Array.from(body.matchAll(URL_TOKEN_REGEX)).map((match) => match[0])
  if (rawMatches.length === 0) {
    return body
  }

  const uniqueRawTokens = Array.from(new Set(rawMatches))
  const parsedTokens = uniqueRawTokens.map((rawToken) => parseUrlToken(rawToken))

  const uniqueCleanUrls = Array.from(
    new Set(
      parsedTokens
        .map((token) => token.cleanUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    )
  )

  const replacementByCleanUrl = new Map<string, string>()

  await Promise.all(
    uniqueCleanUrls.map(async (cleanUrl) => {
      const parsed = parseHttpUrl(cleanUrl)
      if (!parsed) {
        replacementByCleanUrl.set(cleanUrl, cleanUrl)
        return
      }

      if (isShortLinkHost(parsed.host) && isShortLinkPath(parsed.pathname)) {
        replacementByCleanUrl.set(cleanUrl, cleanUrl)
        return
      }

      try {
        const result = await ShortLinkService.createShortLinkInternal({
          destination_url: cleanUrl,
          link_type: 'custom',
          metadata: {
            source: 'sms_auto_shortener'
          }
        })
        replacementByCleanUrl.set(cleanUrl, result.full_url)
      } catch {
        replacementByCleanUrl.set(cleanUrl, cleanUrl)
      }
    })
  )

  const replacementByRawToken = new Map<string, string>()
  for (const token of parsedTokens) {
    if (!token.cleanUrl) {
      replacementByRawToken.set(token.rawToken, token.rawToken)
      continue
    }

    const replacedUrl = replacementByCleanUrl.get(token.cleanUrl) || token.cleanUrl
    replacementByRawToken.set(token.rawToken, `${replacedUrl}${token.trailingSuffix}`)
  }

  return body.replace(URL_TOKEN_REGEX, (rawToken) => replacementByRawToken.get(rawToken) || rawToken)
}


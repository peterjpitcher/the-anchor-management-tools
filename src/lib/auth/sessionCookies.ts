const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

if (!SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to read Supabase session cookies.')
}

const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]

export const SESSION_COOKIE_NAME = `sb-${projectRef}-auth-token`
export const USER_COOKIE_NAME = `${SESSION_COOKIE_NAME}-user`

const MAX_CHUNK_SIZE = 3180
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export type CookieRecord = {
  name: string
  value: string
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function base64UrlEncode(input: string) {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4)
  const padded = normalized + '='.repeat(padding)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

export function readStoredValue(cookies: CookieRecord[], baseName: string) {
  const direct = cookies.find(cookie => cookie.name === baseName)?.value ?? null
  const chunkPattern = new RegExp(`^${escapeRegex(baseName)}\\.(\\d+)$`)
  const chunkValues = cookies
    .map(cookie => {
      const match = cookie.name.match(chunkPattern)
      if (!match) {
        return null
      }
      return {
        index: Number.parseInt(match[1], 10),
        value: cookie.value,
      }
    })
    .filter((entry): entry is { index: number; value: string } => entry !== null)
    .sort((a, b) => a.index - b.index)

  if (chunkValues.length > 0) {
    const combined = chunkValues.map(entry => entry.value).join('')
    if (direct) {
      return direct + combined
    }
    return combined
  }

  return direct
}

export function decodeStoredValue(raw: string | null) {
  if (!raw) {
    return null
  }
  if (raw.startsWith('base64-')) {
    try {
      return base64UrlDecode(raw.substring('base64-'.length))
    } catch {
      return null
    }
  }

  return raw
}

export function encodeStoredValue(value: string) {
  return `base64-${base64UrlEncode(value)}`
}

export function buildChunkedCookies(baseName: string, encodedValue: string) {
  if (encodedValue.length <= MAX_CHUNK_SIZE) {
    return [{ name: baseName, value: encodedValue }]
  }

  const chunks = [] as { name: string; value: string }[]
  for (let i = 0, index = 0; i < encodedValue.length; i += MAX_CHUNK_SIZE, index += 1) {
    chunks.push({
      name: `${baseName}.${index}`,
      value: encodedValue.slice(i, i + MAX_CHUNK_SIZE),
    })
  }
  return chunks
}

type CookieOptions = {
  httpOnly: boolean
  sameSite: 'lax'
  path: string
  secure: boolean
  maxAge: number
}

function removeStaleCookies(
  response: import('next/server').NextResponse,
  baseName: string,
  existingNames: string[],
  options: CookieOptions
) {
  existingNames
    .filter(name => name === baseName || name.startsWith(`${baseName}.`))
    .forEach(name => {
      response.cookies.set({
        name,
        value: '',
        ...options,
        maxAge: 0,
      })
    })
}

export function setStoredValue(
  response: import('next/server').NextResponse,
  baseName: string,
  encodedValue: string,
  existingNames: string[],
  secure: boolean
) {
  const options: CookieOptions = {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: COOKIE_MAX_AGE,
  }

  const cookiesToSet = buildChunkedCookies(baseName, encodedValue)
  const newNames = new Set(cookiesToSet.map(cookie => cookie.name))

  existingNames
    .filter(name => name === baseName || name.startsWith(`${baseName}.`))
    .filter(name => !newNames.has(name))
    .forEach(name => {
      response.cookies.set({
        name,
        value: '',
        ...options,
        maxAge: 0,
      })
    })

  cookiesToSet.forEach(cookie => {
    response.cookies.set({
      ...options,
      name: cookie.name,
      value: cookie.value,
    })
  })
}

export function clearStoredValue(
  response: import('next/server').NextResponse,
  baseName: string,
  existingNames: string[],
  secure: boolean
) {
  const options: CookieOptions = {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: 0,
  }

  removeStaleCookies(response, baseName, existingNames, options)
}

export function parseJsonValue<T>(value: string | null) {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

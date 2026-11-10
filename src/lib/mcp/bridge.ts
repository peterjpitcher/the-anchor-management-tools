import { NextRequest } from 'next/server'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import actionsJson from '@/lib/mcp/generated/actions.json'
import routesJson from '@/lib/mcp/generated/routes.json'
import { ACTION_MODULES, ROUTE_MODULES } from '@/lib/mcp/generated/loaders'
import type { ManifestAction, ManifestRoute } from '@/lib/mcp/manifest/build'

/**
 * Runs the app's own server actions and staff API routes for an MCP request.
 *
 * Nothing here checks permissions or business rules itself: the action or route does, exactly
 * as it does for a click in the browser, because the request runs as the acting account (see
 * src/lib/mcp/acting-context.ts). This file only finds the code, shapes the arguments and turns
 * the answer into something an agent can read.
 */

export const ACTIONS = actionsJson as ManifestAction[]
export const ROUTES = routesJson as ManifestRoute[]

const ACTIONS_BY_NAME = new Map(ACTIONS.map((action) => [action.name, action]))

export const MAX_RESULT_CHARS = 200_000
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// ---------------------------------------------------------------------------------------------
// Results

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Set) return [...value]
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (value instanceof Uint8Array) return { bytes: value.byteLength }
  return value
}

export function toText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, jsonReplacer, 1)
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n[Cut at ${MAX_RESULT_CHARS.toLocaleString('en-GB')} of ${text.length.toLocaleString('en-GB')} characters. Ask for less: a narrower date range, a filter or a smaller page.]`
}

export function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: toText(value) }], ...(isError ? { isError: true } : {}) }
}

export function errorResult(message: string): CallToolResult {
  return textResult({ error: message }, true)
}

/** The app's actions report most failures as `{ error }` rather than throwing. */
function looksLikeFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.error === 'string' && record.success !== true
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; details?: unknown; hint?: unknown }
    const parts = [error.message]
    if (extra.code) parts.push(`code ${String(extra.code)}`)
    if (extra.details) parts.push(String(extra.details))
    if (extra.hint) parts.push(String(extra.hint))
    return parts.join('; ')
  }
  return typeof error === 'string' ? error : JSON.stringify(error, jsonReplacer)
}

// ---------------------------------------------------------------------------------------------
// Finding and describing actions

function signature(action: ManifestAction): string {
  const params = action.params.map((param) => `${param.name}${param.optional ? '?' : ''}: ${param.type}`).join(', ')
  return `${action.name}(${params})`
}

function summary(action: ManifestAction): string {
  // The first line with words in it: some comments open with a ruled line of dashes.
  return action.doc.split('\n').find((line) => /[A-Za-z]/.test(line))?.trim() ?? ''
}

export function findActions(input: { query?: string; area?: string; readOnly?: boolean; limit?: number }): CallToolResult {
  const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const area = input.area?.toLowerCase()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)

  const scored = ACTIONS.filter((action) => {
    if (input.readOnly && !action.readOnly) return false
    if (area && !action.module.toLowerCase().includes(area)) return false
    return true
  })
    .map((action) => {
      const name = action.name.toLowerCase()
      const doc = action.doc.toLowerCase()
      let score = 0
      for (const word of words) {
        if (name.includes(word)) score += 3
        else if (doc.includes(word)) score += 1
        else return null
      }
      return { action, score }
    })
    .filter((entry): entry is { action: ManifestAction; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.action.name.localeCompare(b.action.name))

  return textResult({
    total: scored.length,
    shown: Math.min(scored.length, limit),
    areas: area || words.length ? undefined : [...new Set(ACTIONS.map((action) => action.module))],
    actions: scored.slice(0, limit).map(({ action }) => ({
      name: action.name,
      readOnly: action.readOnly,
      signature: signature(action),
      summary: summary(action),
    })),
  })
}

export function describeAction(name: string): CallToolResult {
  const action = ACTIONS_BY_NAME.get(name)
  if (!action) return errorResult(`No action called "${name}". Use find_actions to search.`)
  return textResult({
    name: action.name,
    readOnly: action.readOnly,
    runWith: action.readOnly ? 'run_read_action (or run_action)' : 'run_action',
    signature: signature(action),
    params: action.params,
    typeRefs: action.typeRefs,
    doc: action.doc,
    howToCall:
      'Pass `args` as a JSON array in parameter order. For a FormData parameter pass an object; arrays become repeated keys, nested objects become JSON strings, and a file is { filename, mimeType, base64 }.',
  })
}

// ---------------------------------------------------------------------------------------------
// Running actions

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFileShape(value: unknown): value is { filename: string; mimeType?: string; base64: string } {
  return isPlainObject(value) && typeof value.filename === 'string' && typeof value.base64 === 'string'
}

function appendFormValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (isFileShape(value)) {
    const bytes = Buffer.from(value.base64, 'base64')
    form.append(key, new File([bytes], value.filename, { type: value.mimeType ?? 'application/octet-stream' }))
    return
  }
  if (typeof value === 'object') {
    form.append(key, JSON.stringify(value))
    return
  }
  form.append(key, String(value))
}

export function toFormData(input: Record<string, unknown>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) appendFormValue(form, key, item)
    } else {
      appendFormValue(form, key, value)
    }
  }
  return form
}

export async function runAction(name: string, args: unknown[] | undefined, options: { readOnlyOnly: boolean }): Promise<CallToolResult> {
  const action = ACTIONS_BY_NAME.get(name)
  if (!action) return errorResult(`No action called "${name}". Use find_actions to search.`)
  if (options.readOnlyOnly && !action.readOnly) {
    return errorResult(`"${name}" can change data, so run_read_action will not run it. Use run_action.`)
  }

  const given = args ?? []
  if (given.length > action.params.length) {
    return errorResult(`"${name}" takes ${action.params.length} argument(s) but was given ${given.length}. Signature: ${signature(action)}`)
  }

  const loader = ACTION_MODULES[action.module]
  if (!loader) return errorResult(`The module for "${name}" is missing. Run npm run mcp:manifest.`)
  const loaded = (await loader()) as Record<string, unknown>
  const fn = loaded[action.export]
  if (typeof fn !== 'function') return errorResult(`"${name}" is no longer a function. Run npm run mcp:manifest.`)

  const prepared = given.map((value, index) =>
    action.params[index]?.type === 'FormData' && isPlainObject(value) ? toFormData(value) : value,
  )

  try {
    const result = await (fn as (...values: unknown[]) => Promise<unknown>)(...prepared)
    return textResult(result === undefined ? { done: true } : result, looksLikeFailure(result))
  } catch (error) {
    return errorResult(describeThrown(error))
  }
}

// ---------------------------------------------------------------------------------------------
// Staff API routes

export function findRoutes(query?: string): CallToolResult {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const routes = ROUTES.filter((route) => words.every((word) => route.path.toLowerCase().includes(word)))
  return textResult({
    total: routes.length,
    routes: routes.map((route) => ({ path: route.path, methods: route.methods, auth: route.auth })),
    note: 'Bracketed segments are placeholders: call /api/invoices/abc123/pdf for /api/invoices/[id]/pdf.',
  })
}

type RouteParams = Record<string, string | string[]>

export function matchRoutePath(pattern: string, path: string): RouteParams | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  const params: RouteParams = {}

  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index]
    const optionalRest = part.match(/^\[\[\.\.\.(.+)\]\]$/)
    const rest = part.match(/^\[\.\.\.(.+)\]$/)
    const single = part.match(/^\[(.+)\]$/)
    if (optionalRest || rest) {
      const remaining = pathParts.slice(index).map(decodeURIComponent)
      if (rest && remaining.length === 0) return null
      params[(optionalRest ?? rest)![1]] = remaining
      return index === patternParts.length - 1 ? params : null
    }
    const value = pathParts[index]
    if (value === undefined) return null
    if (single) params[single[1]] = decodeURIComponent(value)
    else if (part !== value) return null
  }
  return pathParts.length === patternParts.length ? params : null
}

function dynamicSegments(pattern: string): number {
  return pattern.split('/').filter((part) => part.startsWith('[')).length
}

export function resolveRoute(path: string): { route: ManifestRoute; params: RouteParams } | null {
  const candidates = ROUTES.map((route) => ({ route, params: matchRoutePath(route.path, path) }))
    .filter((entry): entry is { route: ManifestRoute; params: RouteParams } => entry.params !== null)
    .sort((a, b) => dynamicSegments(a.route.path) - dynamicSegments(b.route.path))
  return candidates[0] ?? null
}

export async function callRoute(
  input: {
    method: string
    path: string
    query?: Record<string, string>
    body?: unknown
    form?: Record<string, unknown>
  },
  origin: string,
): Promise<CallToolResult> {
  const path = input.path.split('?')[0]
  const match = resolveRoute(path)
  if (!match) return errorResult(`No staff route matches ${path}. Use find_app_routes to list them.`)
  if (!match.route.methods.includes(input.method)) {
    return errorResult(`${match.route.path} takes ${match.route.methods.join(', ')}, not ${input.method}.`)
  }

  const loader = ROUTE_MODULES[match.route.module]
  if (!loader) return errorResult(`The module for ${match.route.path} is missing. Run npm run mcp:manifest.`)
  const loaded = (await loader()) as Record<string, unknown>
  const handler = loaded[input.method]
  if (typeof handler !== 'function') return errorResult(`${match.route.path} has no ${input.method} handler.`)

  const url = new URL(path, origin)
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value)

  const init: { method: string; headers: Record<string, string>; body?: BodyInit } = { method: input.method, headers: {} }
  if (input.form) {
    init.body = toFormData(input.form)
  } else if (input.body !== undefined && input.method !== 'GET') {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(input.body)
  }

  let response: Response
  try {
    response = await (handler as (request: NextRequest, context: { params: Promise<RouteParams> }) => Promise<Response>)(
      new NextRequest(url, init),
      { params: Promise.resolve(match.params) },
    )
  } catch (error) {
    return errorResult(describeThrown(error))
  }

  const contentType = response.headers.get('content-type') ?? ''
  const disposition = response.headers.get('content-disposition') ?? undefined
  const failed = response.status >= 400

  if (contentType.includes('json')) {
    const text = await response.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // Not valid JSON after all: hand the text back as it came.
    }
    return textResult({ status: response.status, data }, failed)
  }

  if (contentType.startsWith('text/') || contentType === '') {
    return textResult({ status: response.status, contentType, disposition, text: await response.text() }, failed)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return errorResult(`The file is ${bytes.byteLength.toLocaleString('en-GB')} bytes, over the ${MAX_FILE_BYTES.toLocaleString('en-GB')} byte limit.`)
  }
  return {
    content: [
      { type: 'text', text: toText({ status: response.status, contentType, disposition, bytes: bytes.byteLength }) },
      {
        type: 'resource',
        resource: { uri: `anchor-management://route${path}`, mimeType: contentType, blob: bytes.toString('base64') },
      },
    ],
    ...(failed ? { isError: true } : {}),
  }
}

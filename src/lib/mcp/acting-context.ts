import { AsyncLocalStorage } from 'node:async_hooks'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who an MCP request is acting as, for the length of that one request.
 *
 * `/api/mcp` is the only caller of `runAsMcpActor`. Inside it, `createClient()` in
 * `src/lib/supabase/server.ts` hands back a client signed in as the acting user instead of
 * reading the request's cookies, so every server action and staff route runs exactly as it
 * would for that person in a browser: the same permission checks, row level security and
 * audit trail. AsyncLocalStorage keeps the context to the async chain that started it, so a
 * browser request handled by the same server instance at the same moment never sees it.
 */
export interface McpActingContext {
  /** The auth user id every change is made as. */
  userId: string
  /** The API key's name, recorded on every audit entry written during the request. */
  keyName: string
  /** The signed-in client for this request. Built once, on first use. */
  getClient: () => Promise<SupabaseClient>
}

const storage = new AsyncLocalStorage<McpActingContext>()

export function runAsMcpActor<T>(context: McpActingContext, work: () => Promise<T>): Promise<T> {
  return storage.run(context, work)
}

export function getMcpActingContext(): McpActingContext | undefined {
  return storage.getStore()
}

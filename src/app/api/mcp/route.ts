import type { SupabaseClient } from '@supabase/supabase-js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createErrorResponse, withMcpAuth } from '@/lib/api/auth'
import { runAsMcpActor } from '@/lib/mcp/acting-context'
import { createActingClient } from '@/lib/mcp/acting-session'
import { buildMcpServer } from '@/lib/mcp/server'
import { usageLabel } from '@/lib/mcp/usage-label'

/**
 * The agent bridge: an MCP server (Streamable HTTP, stateless, JSON responses) that runs the
 * app's own server actions and staff routes as the owner's account. How it works and how to
 * connect an agent: docs/agent-mcp.md.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return createErrorResponse('The request body must be JSON-RPC', 'PARSE_ERROR', 400)
  }

  return withMcpAuth(request, usageLabel(body), async (key) => {
    const userId = process.env.MCP_ACTING_USER_ID?.trim()
    if (!userId || !UUID_PATTERN.test(userId)) {
      // Never fall back to anyone else's account.
      return createErrorResponse('Agent access is not configured on this deployment', 'MCP_NOT_CONFIGURED', 503)
    }

    let client: Promise<SupabaseClient> | null = null
    const getClient = (): Promise<SupabaseClient> => {
      if (!client) {
        client = createActingClient(userId).catch((error: unknown) => {
          client = null
          throw error
        })
      }
      return client
    }

    return runAsMcpActor({ userId, keyName: key.name, getClient }, async () => {
      const server = buildMcpServer({ keyName: key.name, userId, origin: new URL(request.url).origin })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await server.connect(transport)
      try {
        return await transport.handleRequest(request, { parsedBody: body })
      } finally {
        await server.close()
      }
    })
  })
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Use POST' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  })
}

export function GET(): Response {
  return methodNotAllowed()
}

export function DELETE(): Response {
  return methodNotAllowed()
}

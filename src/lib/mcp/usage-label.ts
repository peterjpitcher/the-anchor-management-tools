const MAX_LABEL_CHARS = 200

interface JsonRpcMessage {
  method?: unknown
  params?: { name?: unknown; arguments?: Record<string, unknown> }
}

/** Names a call for the usage log: the tool, plus the action, route or table it touched. */
export function usageLabel(body: unknown): string {
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[]
  const parts = messages.map((message) => {
    if (!message || typeof message !== 'object') return 'invalid'
    if (message.method !== 'tools/call') return typeof message.method === 'string' ? message.method : 'response'
    const tool = typeof message.params?.name === 'string' ? message.params.name : 'unknown'
    const args = message.params?.arguments ?? {}
    const target =
      typeof args.name === 'string' ? args.name
        : typeof args.path === 'string' ? `${String(args.method ?? '')} ${args.path}`.trim()
          : typeof args.table === 'string' ? args.table
            : ''
    return target ? `${tool}:${target}` : tool
  })
  return `/api/mcp/${parts.join(',')}`.slice(0, MAX_LABEL_CHARS)
}

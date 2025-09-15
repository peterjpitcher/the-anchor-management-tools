#!/usr/bin/env tsx
/**
 * Simple check for short-link redirects using a custom Host header.
 * Requires dev server running on http://localhost:3000
 */
import http from 'node:http'
import https from 'node:https'

type Check = { path: string; host: string; expectedHostIncludes?: string }

function requestWithHost(url: string, host: string): Promise<{ status: number; location?: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          Host: host,
        },
      },
      (res) => {
        // Do not follow redirects; just capture Location
        res.resume()
        resolve({ status: res.statusCode || 0, location: res.headers.location, headers: res.headers })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  const base = 'http://localhost:3000'
  const checks: Check[] = [
    { path: '/', host: 'vip-club.uk', expectedHostIncludes: 'the-anchor.pub' },
    { path: '/NOPE', host: 'vip-club.uk', expectedHostIncludes: 'the-anchor.pub' },
  ]

  const results = [] as string[]
  for (const c of checks) {
    const { status, location } = await requestWithHost(base + c.path, c.host)
    const ok = status >= 300 && status < 400 && (!!c.expectedHostIncludes ? (location || '').includes(c.expectedHostIncludes) : !!location)
    results.push(`${ok ? 'PASS' : 'FAIL'} ${c.host}${c.path} -> ${status} ${location || ''}`)
  }

  console.log(results.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


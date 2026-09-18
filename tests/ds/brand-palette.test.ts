import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DOCUMENT_PALETTE } from '@/lib/brand/palette'
it('pins PDF colours to the application design tokens', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')
  const names = { text: 'text', textMuted: 'text-muted', border: 'border', surface2: 'surface-2' }
  for (const [key, name] of Object.entries(names)) expect(css).toContain(`--color-${name}: ${DOCUMENT_PALETTE[key as keyof typeof DOCUMENT_PALETTE]};`)
})

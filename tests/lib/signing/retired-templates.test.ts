// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * The four policy acknowledgements the staff training courses replaced (owner decision,
 * 2 November 2026). Migration 20261103090300 switched them off and put a [[RETIRED: ...]] line at
 * the top of each, but anyone editing the wording can delete that line. The code must refuse them
 * whatever the stored row says: never rendered, never sent, never switched on.
 */

const state = vi.hoisted(() => ({
  client: null as unknown,
  adminCalls: 0,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    state.adminCalls += 1
    return state.client
  },
}))
// templates.ts reaches the signing service, which would otherwise load the email and PDF stack.
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/invoice-sender', () => ({ invoiceEmailRouting: () => ({ from: 'Orange Jelly <billing@example.test>' }) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: async () => {
    throw new Error('A test must never start a browser')
  },
  createPdfBrowser: async () => {
    throw new Error('A test must never start a browser')
  },
  closePdfBrowser: async () => undefined,
}))

import { SigningError } from '@/lib/signing/service'
import {
  RETIRED_TEMPLATE_MESSAGE,
  RETIRED_TEMPLATE_SLUGS,
  isRetiredTemplateSlug,
  renderTemplateDocument,
  templateActivationBlocker,
} from '@/lib/signing/templates'

const RETIRED = ['health-and-safety', 'allergens', 'challenge-25', 'data-protection'] as const
// Finished wording: no [[...]] marker of any kind, long enough to count as wording.
const FINISHED_BODY = '## What this confirms\nYou have read the policy and you understand what it asks of you at work.'
const LONG_DASH = String.fromCharCode(0x2014)

/** A template as the database might hold it after someone deleted the RETIRED line and switched it on by hand. */
function seed(slug: string): void {
  state.client = createFakeDb({
    signing_templates: [
      {
        id: `template-${slug}`,
        kind: 'policy_acknowledgement',
        slug,
        title: `Policy: ${slug}`,
        body: FINISHED_BODY,
        version: 4,
        is_active: true,
      },
    ],
  }).client
}

beforeEach(() => {
  state.client = null
  state.adminCalls = 0
})

describe('the policies staff training replaced', () => {
  it('lists exactly the four slugs the retiring migration names', () => {
    expect([...RETIRED_TEMPLATE_SLUGS].sort()).toEqual([...RETIRED].sort())
  })

  it('says plainly that the policy was replaced by staff training', () => {
    expect(RETIRED_TEMPLATE_MESSAGE).toContain('replaced by staff training')
    expect(RETIRED_TEMPLATE_MESSAGE).not.toMatch(/\[\[|undefined/)
    expect(RETIRED_TEMPLATE_MESSAGE).not.toContain(LONG_DASH)
  })

  it('recognises the slugs however they are typed, and nothing else', () => {
    for (const slug of RETIRED) {
      expect(isRetiredTemplateSlug(slug), slug).toBe(true)
      expect(isRetiredTemplateSlug(` ${slug.toUpperCase()} `), slug).toBe(true)
    }
    for (const slug of ['staff-handbook', 'allergens-2', 'policy-phones', '', null, undefined]) {
      expect(isRetiredTemplateSlug(slug), String(slug)).toBe(false)
    }
  })
})

describe('rendering a retired policy', () => {
  it.each(RETIRED)('refuses %s even when its stored row is switched on with finished wording', async (slug) => {
    seed(slug)

    const attempt = renderTemplateDocument({ kind: 'policy_acknowledgement', slug, mergeValues: { worker_name: 'Sam Smith' } })

    await expect(attempt).rejects.toBeInstanceOf(SigningError)
    await expect(attempt).rejects.toMatchObject({ code: 'template_retired', message: RETIRED_TEMPLATE_MESSAGE })
    // Refused before the database is read, so nothing stored can bring it back.
    expect(state.adminCalls).toBe(0)
  })

  it('still renders a policy that was not retired, such as the staff handbook', async () => {
    seed('staff-handbook')

    const rendered = await renderTemplateDocument({
      kind: 'policy_acknowledgement',
      slug: 'staff-handbook',
      mergeValues: { worker_name: 'Sam Smith' },
    })

    expect(rendered.template.slug).toBe('staff-handbook')
    expect(rendered.html).toContain('You have read the policy')
  })
})

describe('switching a retired policy on', () => {
  it.each(RETIRED)('is refused for %s, with no [[...]] marker left in its wording', (slug) => {
    expect(templateActivationBlocker({ slug, title: `Policy: ${slug}`, body: FINISHED_BODY })).toBe(RETIRED_TEMPLATE_MESSAGE)
  })

  it('says it was replaced before anything about gaps in the wording', () => {
    const body = `[[RETIRED: replaced by the staff training courses.]]\n\n${FINISHED_BODY}\n[[TO CONFIRM: something]]`
    expect(templateActivationBlocker({ slug: 'allergens', title: 'Allergens', body })).toBe(RETIRED_TEMPLATE_MESSAGE)
  })

  it('leaves every other template to the usual checks', () => {
    expect(templateActivationBlocker({ slug: 'staff-handbook', title: 'Staff handbook', body: FINISHED_BODY })).toBeNull()
    expect(templateActivationBlocker({ title: 'Staff handbook', body: FINISHED_BODY })).toBeNull()
    expect(templateActivationBlocker({ slug: 'staff-handbook', title: 'Staff handbook', body: `${FINISHED_BODY}\n[[TO CONFIRM: x]]` })).toContain(
      'Fill in or remove this gap first'
    )
  })
})

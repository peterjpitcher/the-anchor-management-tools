import type { z } from 'zod'

/**
 * One block of an email.
 *
 * Every module in this directory is a transcription of the designer's markup with slots cut
 * into the text nodes and href values, and nothing else changed. The fixtures in
 * `__fixtures__/` are the source of truth: the fidelity test renders each module with
 * `sample` and asserts the output matches `fixture` byte for byte. If you reformat the
 * markup, that test fails, which is the point.
 *
 * `sample` holds the exact values the handover used for this block, so the fidelity test
 * needs no separate lookup table. It doubles as the preview data in the block catalogue.
 *
 * `text` produces the plain-text alternative for the same content. About a third of opens
 * have images off and some recipients block HTML entirely, so the text part has to carry
 * the message on its own rather than being an afterthought.
 */
export interface EmailBlockModule<TData> {
  /** Stable identifier used in campaign content JSON. Never rename without a migration. */
  type: string
  /** Filename in `__fixtures__/` this block must reproduce exactly. */
  fixture: string
  schema: z.ZodType<TData>
  /** The handover's own values for this block. */
  sample: TData
  render: (data: TData) => string
  text: (data: TData) => string
}

export function defineBlock<TData>(module: EmailBlockModule<TData>): EmailBlockModule<TData> {
  return module
}

/** Shape shared by every image slot in the library. */
export interface EmailImage {
  src: string
  alt: string
  width: number
  height: number
}

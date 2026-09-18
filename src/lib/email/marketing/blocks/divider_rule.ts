import { z } from 'zod'

import { GUEST } from '@/lib/brand/palette'

import { defineBlock } from './types'

/**
 * A 1px hairline rule inset to the 536px content width.
 *
 * Structural only. Use it to separate two sections that sit on the same cream background
 * and would otherwise run together. No slots, because there is nothing here to vary.
 */

export const dividerRuleSchema = z.object({})

export type DividerRuleData = z.infer<typeof dividerRuleSchema>

export const dividerRule = defineBlock<DividerRuleData>({
  type: 'divider_rule',
  fixture: 'divider_rule.html',
  schema: dividerRuleSchema,
  sample: {},
  render: () =>
    `
<tr><td bgcolor="${GUEST.cream}" align="center" style="background-color:${GUEST.cream};padding:34px 32px"><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:536px;border-collapse:collapse"><tbody><tr><td height="1" style="height:1px;background-color:${GUEST.border};font-size:0;line-height:0">&nbsp;</td></tr></tbody></table></td></tr>
`,
  text: () => '\n---\n',
})

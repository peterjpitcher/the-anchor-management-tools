import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
}

export type AiParsedIngredient = {
  name: string
  description: string | null
  supplier_name: string | null
  supplier_sku: string | null
  brand: string | null
  pack_size: number | null
  pack_size_unit: string
  pack_cost: number | null
  portions_per_pack: number | null
  wastage_pct: number
  storage_type: string
  allergens: string[]
  dietary_flags: string[]
  notes: string | null
}

export type AiParsingResult = {
  success: boolean
  data?: AiParsedIngredient
  error?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    cost: number
  }
}

const ALLERGEN_OPTIONS = [
  'celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 
  'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soya', 'sulphites'
];

const DIETARY_OPTIONS = [
  'vegan', 'vegetarian', 'gluten_free', 'dairy_free', 'halal', 'kosher'
];

const UNIT_OPTIONS = [
  'each', 'portion', 'gram', 'kilogram', 'millilitre', 'litre', 
  'ounce', 'pound', 'teaspoon', 'tablespoon', 'cup', 'slice', 'piece'
];

const STORAGE_OPTIONS = [
  'ambient', 'chilled', 'frozen', 'dry', 'other'
];

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
  const promptCost = (promptTokens / 1000) * pricing.prompt
  const completionCost = (completionTokens / 1000) * pricing.completion
  return Number((promptCost + completionCost).toFixed(6))
}

export async function parseIngredientWithAI(rawData: string): Promise<AiParsingResult> {
  try {
    const { apiKey, baseUrl } = await getOpenAIConfig()

    if (!apiKey) {
      return { success: false, error: 'OpenAI is not configured. Please add an API key in Settings.' }
    }

    const model = 'gpt-4o-mini'

    const systemPrompt = `You are a data extraction assistant for a restaurant management system. 
Your task is to parse raw product information (HTML, text, or JSON) into a structured ingredient format.
Extract as much information as possible. 

CRITICAL: When dietary claims are EXPLICITLY STATED in the input text (e.g., "Gluten Free", "Suitable for Vegans", "Milk Free", "Halal"), you MUST include them in the 'dietary_flags' array.
- For "Milk Free", map it to 'dairy_free'.
- For "Suitable for vegans" or "Vegan", map it to 'vegan'.
- For "Gluten Free", map it to 'gluten_free'.
- For "Suitable for vegetarians" or "Vegetarian", map it to 'vegetarian'.

Also, use your general knowledge about food to populate dietary flags (vegan, vegetarian, gluten_free, dairy_free, etc.) even if not explicitly labeled in the text, provided it is obvious and universally true for that ingredient.
- Example: If the product is "Frozen Peas", you MUST mark it as vegan, vegetarian, gluten_free, and dairy_free.
- Example: "Beef Mince" is gluten_free and dairy_free, but NOT vegan or vegetarian.

For allergens, generally be conservative, BUT if the product clearly contains or IS a common allergen, mark it.
- Example: "Plain Flour" -> Contains Gluten.
- Example: "Double Cream" -> Contains Milk.

IMPORTANT: Enforce logical hierarchy for dietary flags:
- If an item is "vegan", it is AUTOMATICALLY "vegetarian" and "dairy_free".
- If an item is "vegetarian", it is NOT necessarily "vegan".

For units, normalize to the closest standard unit (e.g. 'kg' -> 'kilogram', 'ml' -> 'millilitre').
Pack cost should be the price for the full pack/case, not per unit, if possible.
If the input is HTML from a supplier website, look for 'ingredients', 'nutrition', and 'specifications' sections.`

    const response = await retry(
      async () => fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is the raw product data:\n\n${rawData.slice(0, 100000)}` }, // Increased limit to 100k chars
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'ingredient_parsing',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'The product name' },
                  description: { type: ['string', 'null'], description: 'Brief product description or list of main ingredients' },
                  supplier_name: { type: ['string', 'null'], description: 'Name of the supplier (e.g. Booker, Tesco)' },
                  supplier_sku: { type: ['string', 'null'], description: 'Supplier product code or SKU' },
                  brand: { type: ['string', 'null'], description: 'Product brand' },
                  pack_size: { type: ['number', 'null'], description: 'The numeric size of the pack (e.g. 2.5 for 2.5kg)' },
                  pack_size_unit: { type: 'string', enum: UNIT_OPTIONS, description: 'The unit for the pack size' },
                  pack_cost: { type: ['number', 'null'], description: 'Cost of the full pack in GBP' },
                  portions_per_pack: { type: ['number', 'null'], description: 'Estimated number of portions per pack' },
                  wastage_pct: { type: 'number', description: 'Estimated wastage percentage (0-100)' },
                  storage_type: { type: 'string', enum: STORAGE_OPTIONS, description: 'How the product should be stored' },
                  allergens: {
                    type: 'array', 
                    items: { type: 'string', enum: ALLERGEN_OPTIONS },
                    description: 'List of allergens present'
                  },
                  dietary_flags: {
                    type: 'array',
                    items: { type: 'string', enum: DIETARY_OPTIONS },
                    description: 'List of dietary suitable flags'
                  },
                  notes: { type: ['string', 'null'], description: 'Any other relevant information not captured above' }
                },
                required: [
                  'name', 'description', 'supplier_name', 'supplier_sku', 'brand', 
                  'pack_size', 'pack_size_unit', 'pack_cost', 'portions_per_pack', 
                  'wastage_pct', 'storage_type', 'allergens', 'dietary_flags', 'notes'
                ],
                additionalProperties: false
              }
            }
          }
        }),
      }),
      RetryConfigs.api
    )

    if (!response.ok) {
      const text = await response.text()
      console.error('OpenAI parsing request failed', text)
      return { success: false, error: `OpenAI request failed: ${response.statusText}` }
    }

    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content

    if (!content) {
      return { success: false, error: 'OpenAI returned no content' }
    }

    let parsedData: AiParsedIngredient
    try {
      parsedData = JSON.parse(content)
      
      // Post-processing: Enforce logical dietary hierarchies
      const flags = new Set(parsedData.dietary_flags || [])
      
      if (flags.has('vegan')) {
        flags.add('vegetarian')
        // Usually vegans don't eat dairy, but dairy_free is often an allergy claim.
        // However, for menu purposes, Vegan usually implies no dairy ingredients.
        // We will add it if not present, but user can remove if there's a specific "May contain" risk they want to flag manually.
        flags.add('dairy_free')
      }
      
      parsedData.dietary_flags = Array.from(flags)

    } catch (e) {
      console.error('Failed to parse OpenAI JSON response', e)
      return { success: false, error: 'Failed to parse AI response' }
    }

    // Calculate usage stats
    const usage = payload.usage ? {
      promptTokens: payload.usage.prompt_tokens,
      completionTokens: payload.usage.completion_tokens,
      cost: calculateOpenAICost(payload.model || model, payload.usage.prompt_tokens, payload.usage.completion_tokens)
    } : undefined

    return {
      success: true,
      data: parsedData,
      usage
    }

  } catch (err: any) {
    console.error('parseIngredientWithAI error:', err)
    return { success: false, error: err.message || 'Internal server error' }
  }
}

import { generatePhoneVariants } from '@/lib/utils'

function quoteOrFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function isPhoneSearchTerm(term: string): boolean {
  return /^[0-9\s\-+()]+$/.test(term.trim())
}

export function buildCustomerSearchFilter(term: string): string {
  const trimmed = term.trim()

  if (isPhoneSearchTerm(trimmed)) {
    const variants = generatePhoneVariants(trimmed, { defaultCountryCode: '44' })
    const clauses = variants.flatMap((variant) => {
      const pattern = quoteOrFilterValue(`%${variant}%`)
      return [
        `mobile_number.ilike.${pattern}`,
        `mobile_e164.ilike.${pattern}`,
      ]
    })

    return Array.from(new Set(clauses)).join(',')
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  const firstWord = quoteOrFilterValue(`%${words[0]}%`)

  if (words.length === 1) {
    return `first_name.ilike.${firstWord},last_name.ilike.${firstWord}`
  }

  const remainingWords = quoteOrFilterValue(`%${words.slice(1).join(' ')}%`)
  return [
    `and(first_name.ilike.${firstWord},last_name.ilike.${remainingWords})`,
    `and(first_name.ilike.${remainingWords},last_name.ilike.${firstWord})`,
  ].join(',')
}

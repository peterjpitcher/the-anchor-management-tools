'use server'

const DISABLED_RESPONSE = { error: 'Loyalty program has been decommissioned.' }

function disabled<T = typeof DISABLED_RESPONSE, A extends any[] = any[]>(..._args: A): T {
  return DISABLED_RESPONSE as T
}

export const loyaltyDisabled = () => DISABLED_RESPONSE

export const customerCheckIn = async (...args: Parameters<typeof disabled>) => disabled(...args)
export const staffCheckIn = async (...args: Parameters<typeof disabled>) => disabled(...args)
export const generateRedemptionCode = async (...args: Parameters<typeof disabled>) => disabled(...args)
export const redeemCode = async (...args: Parameters<typeof disabled>) => disabled(...args)
export const enrollMember = async (...args: Parameters<typeof disabled>) => disabled(...args)

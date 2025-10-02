import { ParkingPricingBreakdownLine, ParkingPricingResult } from '@/types/parking'

const MILLIS_PER_MINUTE = 60_000
const HOUR_MINUTES = 60
const DAY_MINUTES = 24 * HOUR_MINUTES
const WEEK_MINUTES = 7 * DAY_MINUTES
const MONTH_MINUTES = 30 * DAY_MINUTES

export interface ParkingRateConfig {
  hourlyRate: number
  dailyRate: number
  weeklyRate: number
  monthlyRate: number
}

export interface ParkingPricingOptions {
  minimumMinutes?: number
}

interface BreakdownCandidate {
  months: number
  weeks: number
  days: number
  hours: number
  cost: number
}

const DEFAULT_MINIMUM_MINUTES = 30

/**
 * Calculate the optimal combination of month/week/day/hour pricing that covers the
 * requested duration at the lowest cost. Remaining partial units are rounded up to
 * the next billable unit. For example, 5h30m will evaluate both 6 hourly units and
 * a single day, picking whichever is cheaper.
 */
export function calculateParkingPricing(
  start: Date,
  end: Date,
  rates: ParkingRateConfig,
  options: ParkingPricingOptions = {}
): ParkingPricingResult {
  const effectiveRates = normaliseRates(rates)

  const minimumMinutes = options.minimumMinutes ?? DEFAULT_MINIMUM_MINUTES
  const diffMillis = end.getTime() - start.getTime()

  if (diffMillis <= 0) {
    throw new Error('End time must be after start time for parking bookings')
  }

  const durationMinutes = Math.ceil(diffMillis / MILLIS_PER_MINUTE)

  if (durationMinutes < minimumMinutes) {
    throw new Error('Parking duration must be at least 30 minutes')
  }

  const best = findBestCombination(durationMinutes, effectiveRates)

  const breakdown: ParkingPricingBreakdownLine[] = []
  if (best.months > 0) {
    breakdown.push({
      unit: 'month',
      quantity: best.months,
      rate: effectiveRates.monthlyRate,
      subtotal: roundCurrency(best.months * effectiveRates.monthlyRate)
    })
  }
  if (best.weeks > 0) {
    breakdown.push({
      unit: 'week',
      quantity: best.weeks,
      rate: effectiveRates.weeklyRate,
      subtotal: roundCurrency(best.weeks * effectiveRates.weeklyRate)
    })
  }
  if (best.days > 0) {
    breakdown.push({
      unit: 'day',
      quantity: best.days,
      rate: effectiveRates.dailyRate,
      subtotal: roundCurrency(best.days * effectiveRates.dailyRate)
    })
  }
  if (best.hours > 0) {
    breakdown.push({
      unit: 'hour',
      quantity: best.hours,
      rate: effectiveRates.hourlyRate,
      subtotal: roundCurrency(best.hours * effectiveRates.hourlyRate)
    })
  }

  const total = roundCurrency(best.cost)

  return {
    total,
    breakdown,
    durationMinutes
  }
}

function normaliseRates(rates: ParkingRateConfig): ParkingRateConfig {
  if (rates.hourlyRate <= 0) {
    throw new Error('Hourly rate must be configured for parking pricing')
  }
  if (rates.dailyRate <= 0) {
    throw new Error('Daily rate must be configured for parking pricing')
  }
  if (rates.weeklyRate <= 0) {
    throw new Error('Weekly rate must be configured for parking pricing')
  }
  if (rates.monthlyRate <= 0) {
    throw new Error('Monthly rate must be configured for parking pricing')
  }

  return {
    hourlyRate: rates.hourlyRate,
    dailyRate: rates.dailyRate,
    weeklyRate: rates.weeklyRate,
    monthlyRate: rates.monthlyRate
  }
}

function findBestCombination(minutes: number, rates: ParkingRateConfig): BreakdownCandidate {
  const maxMonths = Math.ceil(minutes / MONTH_MINUTES) + 1
  let best: BreakdownCandidate | null = null

  for (let months = 0; months <= maxMonths; months++) {
    const remainingAfterMonths = minutes - months * MONTH_MINUTES
    const maxWeeks = Math.ceil(Math.max(remainingAfterMonths, 0) / WEEK_MINUTES) + 1

    for (let weeks = 0; weeks <= maxWeeks; weeks++) {
      const remainingAfterWeeks = remainingAfterMonths - weeks * WEEK_MINUTES
      const dayHour = optimiseDaysAndHours(Math.max(remainingAfterWeeks, 0), rates)

      const cost =
        months * rates.monthlyRate +
        weeks * rates.weeklyRate +
        dayHour.days * rates.dailyRate +
        dayHour.hours * rates.hourlyRate

      const candidate: BreakdownCandidate = {
        months,
        weeks,
        days: dayHour.days,
        hours: dayHour.hours,
        cost
      }

      if (!best || isBetterCandidate(candidate, best)) {
        best = candidate
      }
    }
  }

  if (!best) {
    throw new Error('Unable to calculate parking pricing')
  }

  return best
}

function optimiseDaysAndHours(minutes: number, rates: ParkingRateConfig) {
  const maxDays = Math.ceil(minutes / DAY_MINUTES) + 1
  let bestDays = 0
  let bestHours = 0
  let bestCost = Number.POSITIVE_INFINITY

  for (let days = 0; days <= maxDays; days++) {
    const remainingAfterDays = minutes - days * DAY_MINUTES
    const hoursNeeded = remainingAfterDays > 0 ? Math.ceil(remainingAfterDays / HOUR_MINUTES) : 0
    const cost = days * rates.dailyRate + hoursNeeded * rates.hourlyRate

    if (cost < bestCost) {
      bestCost = cost
      bestDays = days
      bestHours = hoursNeeded
    }
  }

  return { days: bestDays, hours: bestHours }
}

function isBetterCandidate(candidate: BreakdownCandidate, current: BreakdownCandidate): boolean {
  const candidateCost = roundCurrency(candidate.cost)
  const currentCost = roundCurrency(current.cost)

  if (candidateCost < currentCost) {
    return true
  }
  if (candidateCost > currentCost) {
    return false
  }

  // Tie-breaker: prefer fewer large units to reduce operational churn
  const candidateUnits = candidate.months + candidate.weeks + candidate.days + candidate.hours
  const currentUnits = current.months + current.weeks + current.days + current.hours

  if (candidateUnits < currentUnits) {
    return true
  }

  // Next tie-breaker: prefer combinations with fewer manual adjustments (months > weeks > days > hours)
  if (candidate.months !== current.months) {
    return candidate.months > current.months
  }
  if (candidate.weeks !== current.weeks) {
    return candidate.weeks > current.weeks
  }
  if (candidate.days !== current.days) {
    return candidate.days > current.days
  }
  return candidate.hours < current.hours
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

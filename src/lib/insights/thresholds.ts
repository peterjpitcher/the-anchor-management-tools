/**
 * Every tunable number in the weekly insights report lives here, so a threshold is
 * changed in one place after the first few reports (spec decision 7). Section files
 * import from this module and must not hard-code their own copies.
 *
 * Each block belongs to one section; add to a block rather than defining a local constant.
 */

/** Engine timing (spec 4.2). The section deadline matches the database statement timeout. */
export const INSIGHTS_TIMING = {
  sectionDeadlineMs: 8_000,
  buildDeadlineMs: 25_000,
  concurrency: 4,
} as const

/** A change is "notable" at 20% or more AND at least the floor for that measure (spec 4.4). */
export const NOTABLE_CHANGE = 0.2
/** 4-week against 13-week weekly average: growing or declining at 10% or more. */
export const TREND_CHANGE = 0.1

export const FLOORS = {
  tableBookings: 5,
  covers: 15,
  dayCovers: 6,
  newCustomers: 5,
  eventSeats: 5,
  parkingBookings: 3,
  linkClicks: 50,
  weeklyTakings: 300,
  dailyTakings: 150,
} as const

/**
 * When each source began collecting data. A comparison whose window starts earlier
 * shows "not enough history yet" instead of comparing against missing data.
 */
export const COLLECTION_STARTS = {
  marketing: '2026-08-16',
  feedback: '2026-07-05',
  checklists: '2026-07-19',
} as const

/** Scoring for manager actions (spec 4.7). */
export const ACTION_SCORING = {
  severity: { red: 300, amber: 200, win: 100 },
  urgency: [
    { withinDays: 2, points: 60 },
    { withinDays: 6, points: 40 },
    { withinDays: 13, points: 20 },
  ],
  impact: { money: 30, customer: 30, safety: 30, staffing: 20, housekeeping: 0 },
  maxActions: 10,
  maxGreenActions: 2,
} as const

/** Email content budget (spec 7). */
export const EMAIL_BUDGET = {
  exceptionRows: 25,
  metricsPerSection: 4,
  maxBytes: 90_000,
  commentChars: 300,
} as const

// ---------------------------------------------------------------------------
// Section blocks
// ---------------------------------------------------------------------------

export const EVENTS = {
  /** Statuses listed as upcoming. Cancelled, draft and postponed are not listed. */
  listedStatuses: ['scheduled', 'rescheduled', 'sold_out'],
  /** Past occurrences with these statuses are not used as comparators. */
  excludedComparatorStatuses: ['cancelled', 'draft', 'postponed'],
  redWithinDays: 7,
  redFillBelow: 0.25,
  behindComparableRatio: 0.6,
  behindComparableGapSeats: 5,
  stalledFillBelow: 0.75,
  winFillAtLeast: 0.75,
  aheadOfUsualRatio: 1.25,
  comparableMinimum: 3,
  comparableMaximum: 6,
  comparableLookbackWeeks: 26,
} as const

export const CUSTOMERS = {
  spikeMultiple: 3,
  spikeMinimum: 20,
} as const

export const MARKETING = {
  minDeliveredForAverages: 50,
  bounceRed: 0.05,
  bounceAmber: 0.02,
  unsubscribeMultiple: 2,
  unsubscribeMinimum: 3,
  clickBelowRatio: 0.3,
  bestMinimumBaseline: 3,
  earlyFiguresHours: 24,
} as const

export const FEEDBACK = {
  lowRatingAtMost: 2,
  oldUnresolvedDays: 14,
  repeatThemeMinimum: 2,
  repeatThemeWindowDays: 28,
  /** Lower-case keywords; a comment containing any of them gets the tag. */
  themes: {
    food: ['food', 'meal', 'dish', 'menu', 'cold', 'burnt', 'undercooked', 'overcooked', 'portion', 'taste', 'chips', 'roast', 'starter', 'dessert', 'gravy'],
    service: ['service', 'wait', 'waited', 'waiting', 'slow', 'ignored', 'queue', 'order', 'served', 'forgot', 'forgotten'],
    staff: ['staff', 'waiter', 'waitress', 'barman', 'barmaid', 'bartender', 'manager', 'rude', 'unfriendly', 'attitude'],
    cleanliness: ['dirty', 'clean', 'toilet', 'toilets', 'smell', 'smelly', 'sticky', 'hygiene', 'filthy', 'mess'],
    safety: ['unsafe', 'injury', 'injured', 'hurt', 'allergy', 'allergic', 'allergen', 'slipped', 'slip', 'fell', 'glass', 'food poisoning', 'ill after', 'sick after', 'fire'],
  },
} as const

export const TABLE_BOOKINGS = {
  largePartyAtLeast: 15,
  weakDayRatio: 0.5,
  weakDaysForAmber: 2,
  strongDayRatio: 1.5,
  paceLookbackWeeks: 4,
} as const

export const PRIVATE_HIRE = {
  holdExpiringHours: 48,
  pipelineDays: 90,
} as const

export const PARKING = {
  defaultCapacity: 10,
  amberOccupancy: 0.8,
} as const

export const MAINTENANCE = {
  nothingDoneWeeks: 13,
  nothingDoneMinimumOpen: 10,
  /** One primary category per area, so category counts add up to the open total (spec 5.8). */
  areaCategories: {
    'Toilets (Ladies)': 'customer-facing',
    'Toilets (Gents)': 'customer-facing',
    'Toilets (Accessible)': 'customer-facing',
    'Dining Room': 'customer-facing',
    'Beer Garden and Terrace': 'customer-facing',
    'Main Bar': 'customer-facing',
    'Function Room': 'customer-facing',
    'Car Park': 'customer-facing',
    Kitchen: 'operations',
    Cellar: 'operations',
    'Plant and Utilities': 'operations',
    'Staff Areas': 'operations',
    'Exterior and Building': 'building',
    Signage: 'building',
  } as Record<string, 'customer-facing' | 'operations' | 'building'>,
} as const

export const EMPLOYEES = {
  rightToWorkRedDays: 30,
  rightToWorkAmberDays: 60,
  onboardingGraceDays: 14,
  statuses: ['Active', 'Started Separation'],
} as const

export const ROTA = {
  openShiftFarDays: 56,
  leaveRedStartsWithinDays: 7,
  leaveRedWaitingDays: 7,
  hardToStaffMinimum: 3,
  hardToStaffShare: 0.5,
  acceptanceWindowWeeks: 4,
} as const

export const CHECKLISTS = {
  redBelow: 0.9,
  amberBelow: 0.95,
  lateShareAmber: 0.15,
  repeatMissesThisWeek: 3,
  repeatMissesFourWeeks: 6,
  rankingMinimumCompletions: 10,
  unassignedMissesAmber: 10,
  weeksShown: 8,
  mostMissedShown: 5,
} as const

export const INVOICES = {
  redOverdueDays: 30,
  mergeAbove: 3,
} as const

export const CASHING_UP = {
  varianceAmber: 10,
  varianceRed: 50,
  missingRed: 3,
  weeklyChange: 0.2,
  anomalyChange: 0.2,
  anomalyMinimumAmount: 150,
  anomalyMinimumSamples: 8,
  baselineMinimumIn4Weeks: 3,
  baselineMinimumIn13Weeks: 10,
} as const

export const SHORT_LINKS = {
  topShown: 5,
  top13WeeksShown: 3,
  shareWin: 0.3,
  gainingRatio: 0.5,
  totalDropAmber: 0.4,
  topLosingRatio: 0.5,
  /** Reported elsewhere or not marketing: excluded from the section (verified against live data). */
  excludedLinkTypes: ['marketing_email'],
  excludedMetadataKeys: ['guest_link_kind'],
} as const

export const RECRUITMENT = {
  decisionRedDays: 7,
  reviewAmberDays: 7,
  inactiveStatuses: ['talent_pool', 'rejected', 'withdrawn', 'declined_duplicate', 'hired'],
} as const

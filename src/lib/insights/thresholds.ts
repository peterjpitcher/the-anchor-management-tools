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
  /**
   * Floor for the click-rate check: the campaign must be at least this many clickers short of
   * what the 13-week average rate would give, so 2 clickers against 3 is not "30% below".
   */
  clickBelowMinimumClickers: 3,
  /** Floor for the bounce checks, so one bounce on a tiny frequency-capped send is not a list problem. */
  bounceMinimumCount: 2,
  bestMinimumBaseline: 3,
  earlyFiguresHours: 24,
} as const

export const FEEDBACK = {
  lowRatingAtMost: 2,
  oldUnresolvedDays: 14,
  repeatThemeMinimum: 2,
  repeatThemeWindowDays: 28,
  /** Like item signals of one rule merge into one list action when there are more than this. */
  mergeAbove: 3,
  /**
   * Lower-case keywords, matched as whole words or phrases; a comment containing any of
   * them gets the tag. A safety tag makes an unresolved item red, so safety words are
   * phrases where the single word is too common ("a glass of wine", "a log fire", "worth
   * the trip", "great gluten free menu", "fell short"). The safety list leans towards
   * catching a real concern over avoiding a false red: a wrong tag costs one read of an
   * item that is open anyway, a missed one leaves a fall or an allergen amber.
   */
  themes: {
    food: ['food', 'meal', 'dish', 'menu', 'cold', 'burnt', 'undercooked', 'overcooked', 'portion', 'taste', 'chips', 'roast', 'starter', 'dessert', 'gravy'],
    service: ['service', 'wait', 'waited', 'waiting', 'slow', 'ignored', 'queue', 'order', 'served', 'forgot', 'forgotten'],
    staff: ['staff', 'waiter', 'waitress', 'barman', 'barmaid', 'bartender', 'manager', 'rude', 'unfriendly', 'attitude'],
    cleanliness: ['dirty', 'clean', 'toilet', 'toilets', 'smell', 'smelly', 'sticky', 'hygiene', 'filthy', 'mess'],
    safety: [
      'unsafe', 'dangerous', 'hazard', 'hazards', 'hazardous', 'injury', 'injuries', 'injured', 'hurt',
      'allergy', 'allergic', 'allergen', 'allergens', 'anaphylaxis', 'anaphylactic', 'epipen', 'coeliac', 'celiac',
      'contained gluten', 'had gluten', 'gluten in', 'not gluten free', "wasn't gluten free", 'contained nuts', 'traces of nuts',
      'slipped', 'slippery', 'wet floor', 'tripped', 'tripping', 'trip over',
      'fell over', 'fell down', 'fell on the', 'fell onto', 'fell off', 'fell from', 'had a fall', 'took a fall',
      'broken glass', 'smashed glass', 'chipped glass', 'cracked glass', 'glass in my', 'glass in our', 'there was glass', 'found glass',
      'piece of glass', 'bit of glass', 'bits of glass', 'glass on the floor', 'shard', 'shards',
      'choked', 'choking', 'burned myself', 'burnt myself', 'scalded', 'cut myself', 'cut my hand', 'cut my finger', 'cut my lip',
      'food poisoning', 'ill after', 'sick after',
      'fire exit', 'fire door', 'fire alarm', 'caught fire', 'smoke alarm', 'full of smoke',
    ],
  },
} as const

export const TABLE_BOOKINGS = {
  largePartyAtLeast: 15,
  weakDayRatio: 0.5,
  weakDaysForAmber: 2,
  strongDayRatio: 1.5,
  paceLookbackWeeks: 4,
  /** Weeks back for the next-7-days totals: "on the books at this point 1, 4 and 13 weeks ago". */
  paceComparisonWeeks: [1, 4, 13],
  /** First table booking recorded (live, 18 Sep 2026: 4 Aug 2025). */
  collectionStart: '2025-08-04',
  /** First walk-in recorded (live, 18 Sep 2026: 11 Feb 2026). Actual covers include walk-ins. */
  walkInsCollectionStart: '2026-02-11',
  /** The booking engine refuses a food arrival within this many minutes of a service ending. */
  foodCutOffMinutes: 30,
} as const

export const PRIVATE_HIRE = {
  holdExpiringHours: 48,
  pipelineDays: 90,
  /** The balance falls due this many days before the event when no due date is stored. */
  balanceDueDaysBefore: 14,
  /** Not recorded anywhere in the app, so printed on the section as not checked (decision 9). */
  notTracked: ['menu confirmed', 'dietary requirements', 'room set-up'],
  /** Linked invoices in these states no longer settle the booking; the booking's own balance is used. */
  withdrawnInvoiceStatuses: ['void', 'written_off'],
} as const

export const PARKING = {
  defaultCapacity: 10,
  amberOccupancy: 0.8,
  /** First parking booking, verified live on 18 Sep 2026 (the rate took effect on 3 Oct 2025). */
  collectionStart: '2025-10-12',
  /** More busy days than this in the next 14 merge into one list action per rule. */
  mergeDaysAbove: 2,
} as const

export const MAINTENANCE = {
  nothingDoneWeeks: 13,
  nothingDoneMinimumOpen: 10,
  /** The tracker went live on 6 Sep 2026 (first item created then; earlier reported_on dates are backdated). */
  collectionStart: '2026-09-06',
  /** Like signals of one rule become one list action when there are more than this many. */
  mergeAbove: 2,
  /** Titles are clipped in report sentences so one long title cannot swamp the email. */
  titleChars: 120,
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
  /**
   * New starters invited through the app stay 'Onboarding' until they finish the form. The
   * two onboarding checks (unfinished after the start date, invite expired unused) look at
   * these statuses only: the app can resend an invite and finish onboarding only while a
   * person is 'Onboarding', so on Active staff those flags could never clear. The other
   * checks skip new starters: those records arrive with the form.
   */
  onboardingStatuses: ['Onboarding'],
} as const

export const ROTA = {
  openShiftFarDays: 56,
  leaveRedStartsWithinDays: 7,
  leaveRedWaitingDays: 7,
  hardToStaffMinimum: 3,
  hardToStaffShare: 0.5,
  acceptanceWindowWeeks: 4,
  /**
   * Staff began accepting and rejecting shifts in the portal on 6 June 2026. Reliability
   * rows before that are backfill and are ignored; `rota_shift_rejections` starts that day.
   */
  decisionsCollectionStart: '2026-06-06',
  /** Weeks from the current one judged for publishing (the open-shift horizon, 56 days). */
  publishingHorizonWeeks: 8,
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
  /** More out-of-range readings than this become one list action. */
  mergeBreachesAbove: 1,
  /**
   * The overnight sweep (checklists-generate cron, through the job queue) runs from 05:00
   * London and locks the day before. Live since 15 Aug 2026 it has landed by 05:07 every
   * morning, so a check still not locked at 05:30 means the sweep failed or ran late.
   */
  sweepRunsAt: '05:00',
  sweepLockedBy: '05:30',
} as const

export const INVOICES = {
  redOverdueDays: 30,
  mergeAbove: 3,
  /** Statuses that can carry an unpaid balance (spec 5.12). Draft, paid, void and written off are out. */
  openStatuses: ['sent', 'partially_paid', 'overdue'],
  /** Invoice ids per link lookup, so the request URL stays well inside the gateway limit. */
  linkLookupChunk: 150,
} as const

export const CASHING_UP = {
  varianceAmber: 10,
  varianceRed: 50,
  missingRed: 3,
  /**
   * Days a cash-up may take to be entered before its day counts as missing. Cash-ups are
   * routinely entered late (live, 1 Jun to 18 Sep 2026: median about 66 hours from the start of
   * the day), so a trading day is missing only once its date is on or before today minus
   * (entryGraceDays + 1). A younger day with no cash-up is "not entered yet", never a signal.
   */
  entryGraceDays: 3,
  /** Days, ending on the grace boundary, checked for missing cash-ups; each weekly report sees a day twice. */
  missingLookbackDays: 14,
  weeklyChange: 0.2,
  anomalyChange: 0.2,
  anomalyMinimumAmount: 150,
  anomalyMinimumSamples: 8,
  baselineMinimumIn4Weeks: 3,
  baselineMinimumIn13Weeks: 10,
  /** Statuses that count as entered. Drafts count as not entered (spec 5.13). */
  enteredStatuses: ['submitted', 'approved', 'locked'],
  /** Entered days the previous 13 weeks need before this week's variance rate is judged. */
  varianceRateMinimumDays: 28,
  /** Dates named in a sentence before it says "and N more". */
  datesNamed: 5,
  /** Members listed under a merged action before it says "and N more". */
  membersShown: 10,
} as const

export const SHORT_LINKS = {
  topShown: 5,
  top13WeeksShown: 3,
  shareWin: 0.3,
  gainingRatio: 0.5,
  totalDropAmber: 0.4,
  topLosingRatio: 0.5,
  /** First click recorded (live, 18 Sep 2026: 14 Jul 2025). Bot clicks were flagged from the first day. */
  collectionStart: '2025-07-14',
  /** Link ids per lookup, so the request URL stays well inside the gateway limit. */
  linkLookupChunk: 150,
  /** Parent links followed up to the campaign root (live, 18 Sep 2026: at most 2 levels). */
  maxParentDepth: 5,
  /** Link names are clipped in report sentences. */
  nameChars: 60,
  /**
   * Links that are not marketing, so their clicks are left out (checked against live metadata
   * on 18 Sep 2026). Marketing email links are reported under Marketing emails (spec 5.3).
   */
  excludedLinkTypes: ['marketing_email'],
  /** Any of these metadata keys marks a link made for one guest or booking (manage, pay, confirm). */
  excludedMetadataKeys: ['guest_link_kind', 'guest_token_hash', 'mobile_number', 'customer_id', 'table_booking_id', 'event_booking_id', 'booking_id'],
  /** Metadata values marking texts shortened automatically, guest links and review asks. */
  excludedMetadataValues: {
    source: ['sms_auto_shortener', 'guest_link_builder', 'guest_review_ask', 'google_review_link'],
    type: ['booking_confirmation', 'sunday_lunch_payment'],
    purpose: ['review_feedback_funnel'],
  },
  /** Review links made by hand carry no metadata; their destination gives them away. */
  excludedDestinationHosts: ['g.page', 'search.google.com'],
} as const

export const RECRUITMENT = {
  decisionRedDays: 7,
  reviewAmberDays: 7,
  inactiveStatuses: ['talent_pool', 'rejected', 'withdrawn', 'declined_duplicate', 'hired'],
  /** First application, verified live on 18 Sep 2026. */
  collectionStart: '2026-06-08',
  /** New applications: a change against the 4-week average is notable at this many or more. */
  newApplicationsFloor: 5,
  /** Like signals of one rule become one list action when there are more than this many. */
  mergeAbove: 2,
  /** Role titles are clipped in report sentences. */
  titleChars: 60,
  /** Application ids per appointment or status lookup, so the request URL stays inside the gateway limit. */
  idLookupChunk: 150,
} as const

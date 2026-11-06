/**
 * The shapes the Christmas food page (organiser) and the guest's own choice page share.
 *
 * Plain data only, so a server page can hand them to the client line component as props. Kept free
 * of imports from server-only modules for the same reason.
 */

import type { PreorderSavedBy, PreorderSeatCourseCount } from '@/types/preorders'

/** A dish a guest can choose, with what the menu panel shows about it. */
export type FoodDish = {
  id: string
  name: string
  description: string | null
  allergens: string | null
  /** A kids main, offered on 1 course only (A1). */
  isChildOption: boolean
  /** Add-ons carry a price, charged on the night. Null on everything else today. */
  priceGbp: number | null
}

export type FoodMenu = {
  starter: FoodDish[]
  main: FoodDish[]
  dessert: FoodDish[]
  /** Optional extras, ticked on top of the courses. Empty when the menu has none. */
  addons: FoodDish[]
}

/** One price on the menu panel. */
export type FoodTierPrice = { name: string; priceGbp: number; isKids: boolean }

/**
 * Each tier's price on the booking's own day: Tuesday to Thursday or Friday to Sunday. Read from the
 * Christmas menu in menu management, never written here.
 */
export type FoodTierPrices = {
  /** "Friday 11 December", the day the prices are for. */
  dayLabel: string | null
  /** 1 course is priced by the main chosen. */
  oneCourse: FoodTierPrice[]
  /** Null when the menu has no price for that day. */
  twoCourse: { priceGbp: number; description: string | null } | null
  threeCourse: { priceGbp: number; description: string | null } | null
}

/** One guest's line, as both pages render it. */
export type FoodSeatView = {
  ordinal: number
  /** Null when the seat has no row yet; the save creates it. */
  coverId: string | null
  guestName: string | null
  hasAllergies: boolean | null
  allergyDetail: string | null
  dietaryNote: string | null
  courseCount: PreorderSeatCourseCount
  /** Live choices only. A dish since withdrawn is listed in `withdrawn` and must be chosen again. */
  starterId: string | null
  mainId: string | null
  dessertId: string | null
  addonIds: string[]
  /** "Main: Beef", for each choice no longer on the menu. */
  withdrawn: string[]
  /** What the line still needs, e.g. "a name and a main", or null when it is done. */
  missing: string | null
  lastSavedBy: PreorderSavedBy | null
  /** Organiser page only: the guest's address once a link has gone. */
  inviteEmail: string | null
  inviteSentAt: string | null
  /** Organiser page only: true while the one resend is still available. */
  canResendInvite: boolean
}

/** What a save or an invite answers, as JSON. */
export type FoodActionResult =
  | { success: true; seat: FoodSeatView; message?: string }
  | { success: false; error: string; seat?: FoodSeatView }

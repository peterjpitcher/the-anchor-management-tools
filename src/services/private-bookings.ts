/**
 * Private Bookings Service — barrel re-export
 *
 * This file re-exports all functionality from the decomposed sub-modules in
 * `./private-bookings/`. The `PrivateBookingService` class is preserved as a
 * thin facade that delegates to the standalone functions, ensuring backward
 * compatibility with existing callers.
 */

// Re-export everything from sub-modules for direct function-style imports
export * from './private-bookings/types';
export * from './private-bookings/queries';
export * from './private-bookings/mutations';
export * from './private-bookings/payments';

// ---------------------------------------------------------------------------
// Backward-compatible class facade
// ---------------------------------------------------------------------------

import type { BookingStatus } from '@/types/private-bookings';
import type { CreatePrivateBookingInput, UpdatePrivateBookingInput } from './private-bookings/types';

import {
  createBooking,
  updateBooking,
  updateBookingStatus,
  applyBookingDiscount,
  cancelBooking,
  expireBooking,
  extendHold,
  deletePrivateBooking,
  addNote,
  addBookingItem,
  updateBookingItem,
  deleteBookingItem,
  reorderBookingItems,
  createVenueSpace,
  updateVenueSpace,
  deleteVenueSpace,
  createCateringPackage,
  updateCateringPackage,
  deleteCateringPackage,
  createVendor,
  updateVendor,
  deleteVendor,
} from './private-bookings/mutations';

import {
  getBookings,
  fetchPrivateBookings,
  fetchPrivateBookingsForCalendar,
  getBookingById,
  getBookingByIdForEdit,
  getBookingByIdForItems,
  getBookingByIdForMessages,
  getVenueSpaces,
  getVenueSpacesForManagement,
  getCateringPackages,
  getCateringPackagesForManagement,
  getVendors,
  getVendorsForManagement,
  getVendorRate,
} from './private-bookings/queries';

import {
  recordDeposit,
  recordFinalPayment,
  recordBalancePayment,
} from './private-bookings/payments';

export class PrivateBookingService {
  static createBooking = createBooking;
  static updateBooking = updateBooking;
  static updateBookingStatus = updateBookingStatus;
  static applyBookingDiscount = applyBookingDiscount;
  static cancelBooking = cancelBooking;
  static expireBooking = expireBooking;
  static extendHold = extendHold;
  static deletePrivateBooking = deletePrivateBooking;
  static addNote = addNote;
  static getBookings = getBookings;
  static fetchPrivateBookings = fetchPrivateBookings;
  static fetchPrivateBookingsForCalendar = fetchPrivateBookingsForCalendar;
  static getBookingById = getBookingById;
  static getBookingByIdForEdit = getBookingByIdForEdit;
  static getBookingByIdForItems = getBookingByIdForItems;
  static getBookingByIdForMessages = getBookingByIdForMessages;
  static getVenueSpaces = getVenueSpaces;
  static getVenueSpacesForManagement = getVenueSpacesForManagement;
  static getCateringPackages = getCateringPackages;
  static getCateringPackagesForManagement = getCateringPackagesForManagement;
  static getVendors = getVendors;
  static getVendorsForManagement = getVendorsForManagement;
  static getVendorRate = getVendorRate;
  static addBookingItem = addBookingItem;
  static updateBookingItem = updateBookingItem;
  static deleteBookingItem = deleteBookingItem;
  static reorderBookingItems = reorderBookingItems;
  static createVenueSpace = createVenueSpace;
  static updateVenueSpace = updateVenueSpace;
  static deleteVenueSpace = deleteVenueSpace;
  static createCateringPackage = createCateringPackage;
  static updateCateringPackage = updateCateringPackage;
  static deleteCateringPackage = deleteCateringPackage;
  static createVendor = createVendor;
  static updateVendor = updateVendor;
  static deleteVendor = deleteVendor;
  static recordDeposit = recordDeposit;
  static recordFinalPayment = recordFinalPayment;
  static recordBalancePayment = recordBalancePayment;
}

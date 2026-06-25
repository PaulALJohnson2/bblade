/**
 * apiService.js — thin re-export layer over firestoreService.
 *
 * Kept so page/components can import from a stable "services" path
 * (matches the original app's structure). All stock data access lives in
 * ../firebase/firestoreService.
 */

export {
  // Stock Items
  getAllStockItems,
  getStockItemById,
  saveOrUpdateStockItem,
  deleteStockItem,
  subscribeToStockItems,

  // Stock Import
  importStockList,
  addStockItems,
  deleteAllStockItems,
  fixGallonStockItems,

  // Stock Sessions
  createStockSession,
  getCurrentStockSession,
  getStockSession,
  saveStockCount,
  completeStockSession,
  reopenStockSession,
  deleteStockSession,
  getAllStockSessions,
  subscribeToStockSessions,
  subscribeToStockSession,

  // Venue (the venue document → name)
  subscribeToVenue,
  getVenue,
  saveVenue,

  // Account (the customer → name, entitlements)
  subscribeToAccount,
  getAccount,
  saveAccount,

  // Members (account-level staff identity + access)
  subscribeToMembers,
  getMembers,
  saveMember,
  deleteMember,
} from '../firebase/firestoreService';

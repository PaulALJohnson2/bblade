/**
 * StockDataContext — one app-wide stock-items listener.
 *
 * Previously each page (StockTaking, Wastage) opened its own subscribeToStockItems
 * on mount, so the list "loaded" every time you navigated in. This provider wraps
 * the authed app and subscribes once as soon as a venue is known, keeping the list
 * warm in memory across route changes — so opening Stock Count / Wastage is instant.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { subscribeToStockItems } from '../services/apiService';

const StockDataContext = createContext({ items: [], itemsLoading: true, itemsError: null });

export const useStockData = () => useContext(StockDataContext);

export function StockDataProvider({ children }) {
  const { selectedPub } = useAuth();
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState(null);

  useEffect(() => {
    if (!selectedPub) { setItems([]); setItemsLoading(true); return; }
    setItemsLoading(true);
    setItemsError(null);
    const unsub = subscribeToStockItems(
      selectedPub.path,
      (list) => { setItems(list || []); setItemsLoading(false); },
      (err) => { setItemsError(err); setItemsLoading(false); }
    );
    return () => unsub();
  }, [selectedPub]);

  return (
    <StockDataContext.Provider value={{ items, itemsLoading, itemsError }}>
      {children}
    </StockDataContext.Provider>
  );
}

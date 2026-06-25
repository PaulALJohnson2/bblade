/**
 * StockTaking Page - Inventory Management
 *
 * Mobile-optimized stock counting workflow with session support:
 * 1. Start a new session or continue an existing one
 * 2. Search for stock item
 * 3. Tap item to select
 * 4. Enter cases and/or bottles
 * 5. Submit to save count to session
 * 6. Complete session to update stock quantities
 *
 * Two sections: Bar and Kitchen
 * Access: Requires 'stock', 'admin', or 'superadmin' role
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToStockItems,
  saveOrUpdateStockItem,
  deleteStockItem,
  createStockSession,
  saveStockCount,
  completeStockSession,
  reopenStockSession,
  deleteStockSession,
  subscribeToStockSessions,
  subscribeToStockSession
} from '../services/apiService';
import { getThemeColors } from '../utils/theme';
import UnitPicker from '../components/UnitPicker';
import CountUnitPrompt from '../components/CountUnitPrompt';
import CountCategoryPrompt from '../components/CountCategoryPrompt';
import { itemHasUnit } from '../utils/unitTemplates';

// First count of an imported-without-a-category item: confirm the AI suggestion.
const itemNeedsCategory = (it) =>
  !!it && !(it.category && String(it.category).trim()) && !!(it.categorySuggested && String(it.categorySuggested).trim());
import useTheme from '../hooks/useTheme';
import { parseUnitInfo, formatCountDisplay, formatCountSummary, formatItemDescription } from '../utils/stockUnitUtils';
import StockListUpload from '../components/StockListUpload';

function StockTaking() {
  const { currentUser, userProfile, selectedPub, canAccessStock, canEdit, isSuperAdmin, isAdmin } = useAuth();
  const { isDark } = useTheme();
  const colors = getThemeColors(isDark);
  const navigate = useNavigate();
  const wholeInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const firstResultRef = useRef(null);
  const selectedCardRef = useRef(null);

  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Session state
  const [allSessions, setAllSessions] = useState([]);
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showSessionPicker, setShowSessionPicker] = useState(true);

  // Search and quick entry state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [assigningUnitId, setAssigningUnitId] = useState(null);
  const [assigningCatId, setAssigningCatId] = useState(null);
  const [wholeQuantity, setWholeQuantity] = useState('');
  const [partQuantity, setPartQuantity] = useState('');
  const [tenthsQuantity, setTenthsQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Section filter
  const [activeSection, setActiveSection] = useState('all');
  // Category filter (e.g. 'Draught Ale', 'Spirits') - 'all' shows everything
  const [activeCategory, setActiveCategory] = useState('all');
  const [showSummary, setShowSummary] = useState(false);
  const [viewingSession, setViewingSession] = useState(null); // For viewing completed session details
  const [deletingSession, setDeletingSession] = useState(null); // Session pending deletion confirmation
  const [toast, setToast] = useState(null); // { message, type: 'error'|'info' }
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm, confirmLabel, confirmColor }
  const [viewingHistory, setViewingHistory] = useState(null); // { itemName, history[], unitInfo }
  const [summarySession, setSummarySession] = useState(null); // Session to show in summary modal
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);


  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const showConfirm = (title, message, onConfirm, { confirmLabel = 'Confirm', confirmColor = '#e53e3e' } = {}) => {
    setConfirmModal({ title, message, onConfirm, confirmLabel, confirmColor });
  };

  // Track screen size for mobile vs desktop layout
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Admin form state (for adding new items)
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    section: 'bar',
    quantity: '',
    unit: '',
    wholeUnit: '',
    partUnit: '',
    unitCost: '',
    notes: ''
  });

  // Check access
  useEffect(() => {
    if (!canAccessStock()) {
      navigate('/');
    }
  }, [canAccessStock, navigate]);

  // Subscribe to real-time stock items updates
  useEffect(() => {
    if (!currentUser || !selectedPub) {
      return;
    }
    setLoading(true);
    setError(null);

    const unsubscribe = subscribeToStockItems(
      selectedPub.path,
      (items) => {
        setAllItems(items);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, selectedPub]);

  // Subscribe to all sessions for real-time updates
  useEffect(() => {
    if (!selectedPub) return;

    setSessionLoading(true);
    const unsubscribe = subscribeToStockSessions(
      selectedPub.path,
      (sessions) => {
        setAllSessions(sessions || []);
        setSessionLoading(false);
      },
      (err) => {
        console.error('Sessions subscription error:', err);
        setSessionLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedPub]);

  // Subscribe to session updates when we have one
  useEffect(() => {
    if (!selectedPub || !currentSession?.id) return;

    const unsubscribe = subscribeToStockSession(
      selectedPub.path,
      currentSession.id,
      (session) => {
        if (!session || session.status === 'completed') {
          // Session was deleted or completed - go back to session picker
          setCurrentSession(null);
          setShowSessionPicker(true);
        } else {
          // Session exists and is in progress - update it
          setCurrentSession(session);
          if (session.section) setActiveSection(session.section);
        }
      },
      (err) => console.error('Session subscription error:', err)
    );

    return () => unsubscribe();
  }, [selectedPub, currentSession?.id]);

  // When a card is selected (expanded inline):
  //  - Desktop: focus the first input for quick typing.
  //  - Mobile: leave the keyboard closed until the user taps a field, and
  //    scroll the expanded card into view so its Save button is reachable.
  useEffect(() => {
    if (!selectedItem) return;

    if (isMobile) {
      const t = setTimeout(() => {
        selectedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      return () => clearTimeout(t);
    }

    if (wholeInputRef.current) {
      const t = setTimeout(() => wholeInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }

    return () => {};
  }, [selectedItem, isMobile]);

  // Filter items based on search and section
  const filteredItems = allItems.filter(item => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query ||
      item.name.toLowerCase().includes(query) ||
      (item.category && item.category.toLowerCase().includes(query));
    const matchesSection = activeSection === 'all' || item.section === activeSection;
    // While searching, ignore the category tab so results span the whole section
    const matchesCategory = activeCategory === 'all' || !!query || item.category === activeCategory;
    return !item.archived && matchesSearch && matchesSection && matchesCategory;
  });

  // Categories available within the current section, for the category tabs
  const sectionItems = allItems.filter(item => !item.archived && (activeSection === 'all' || item.section === activeSection));
  const categories = [...new Set(sectionItems.map(item => item.category).filter(Boolean))].sort();
  // All confirmed categories across the venue, for quick-pick in the category prompt.
  const allCategories = [...new Set(allItems.filter(i => !i.archived).map(i => i.category).filter(Boolean))].sort();

  // Scroll to first search result when searching
  useEffect(() => {
    if (searchQuery && filteredItems.length > 0 && firstResultRef.current) {
      firstResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchQuery, filteredItems.length]);

  // Reset the category tab when switching section so it can't hide every item
  useEffect(() => {
    setActiveCategory('all');
  }, [activeSection]);

  const barItems = allItems.filter(item => !item.archived && item.section === 'bar');
  const kitchenItems = allItems.filter(item => !item.archived && item.section === 'kitchen');

  // Get count for an item from the current session
  const getSessionCount = (itemId) => {
    return currentSession?.counts?.[itemId] || null;
  };

  const handleStartSession = async (section) => {
    if (!selectedPub || !currentUser) return;

    const result = await createStockSession(
      selectedPub.path,
      currentUser.uid,
      userProfile?.displayName || currentUser.email,
      section
    );

    if (result.success) {
      // Set session with ID - the subscription will fill in full details
      setCurrentSession({ id: result.sessionId });
      setShowSessionPicker(false);
    } else {
      showToast('Error starting session: ' + result.error);
    }
  };

  const handleSelectSession = (session) => {
    setCurrentSession(session);
    if (session.section) setActiveSection(session.section);
    setShowSessionPicker(false);
  };

  const handleBackToSessionPicker = () => {
    setCurrentSession(null);
    setShowSessionPicker(true);
    setSearchQuery('');
    setSelectedItem(null);
  };

  const handleCompleteSession = async () => {
    if (!currentSession || !selectedPub) return;

    const countedItems = Object.keys(currentSession.counts || {}).length;
    if (countedItems === 0) {
      showToast('No items have been counted in this session.', 'info');
      return;
    }

    showConfirm(
      'Complete Stock Take?',
      `This will update ${countedItems} item(s) with the counted quantities.`,
      async () => {
        const result = await completeStockSession(selectedPub.path, currentSession.id);
        if (result.success) {
          setCurrentSession(null);
          setShowSessionPicker(true);
          setLastSaved({ name: 'Stock take completed', quantity: `${countedItems} items updated` });
          setTimeout(() => setLastSaved(null), 3000);
        } else {
          showToast('Error completing session: ' + result.error);
        }
      },
      { confirmLabel: 'Complete', confirmColor: '#38a169' }
    );
  };

  const handleCancelSession = async () => {
    if (!currentSession || !selectedPub) return;

    showConfirm(
      'Delete Stock Take?',
      'All counted data will be permanently deleted. This cannot be undone.',
      async () => {
        const result = await deleteStockSession(selectedPub.path, currentSession.id);
        if (result.success) {
          setCurrentSession(null);
          setShowSessionPicker(true);
        } else {
          showToast('Error deleting session: ' + result.error);
        }
      },
      { confirmLabel: 'Delete', confirmColor: '#e53e3e' }
    );
  };

  // Delete a session (admin/superadmin only)
  const handleDeleteSession = async (session) => {
    if (!selectedPub) return;

    const result = await deleteStockSession(selectedPub.path, session.id);
    if (result.success) {
      // Listener will update sessions list
      setDeletingSession(null);
      // If we were viewing this session, close the modal
      if (viewingSession?.id === session.id) {
        setViewingSession(null);
      }
      if (summarySession?.id === session.id) {
        setSummarySession(null);
        setShowSummary(false);
      }
    } else {
      showToast('Error deleting session: ' + result.error);
    }
  };




  const handleReopenSession = async (session) => {
    if (!selectedPub) return;

    const result = await reopenStockSession(selectedPub.path, session.id);
    if (result.success) {
      setViewingSession(null);
      setCurrentSession({ id: session.id });
      setShowSessionPicker(false);
    } else {
      showToast('Error reopening session: ' + result.error);
    }
  };

  const handleItemSelect = (item) => {
    setSelectedItem(item);
    // Pre-fill with existing count if any
    const existingCount = getSessionCount(item.id);
    if (existingCount) {
      setWholeQuantity((existingCount.wholeCount ?? existingCount.cases)?.toString() || '');
      if (existingCount.partLabel === 'Tenths') {
        setTenthsQuantity(Math.round(existingCount.partCount ?? existingCount.bottles ?? 0)?.toString() || '');
        setPartQuantity('');
      } else {
        setPartQuantity((existingCount.partCount ?? existingCount.bottles)?.toString() || '');
        setTenthsQuantity('');
      }
    } else {
      setWholeQuantity('');
      setPartQuantity('');
      setTenthsQuantity('');
    }
  };

  // Tapping a card header toggles its inline entry panel open/closed.
  const handleItemToggle = (item) => {
    if (selectedItem?.id === item.id) {
      handleCancelEntry();
    } else {
      handleItemSelect(item);
    }
  };

  // Counter assigns a count method/size to an item that was imported without one.
  // Saved back to the item (merge), so the realtime listener flips the card to steppers.
  const handleAssignUnit = async (item, unit) => {
    setAssigningUnitId(item.id);
    const res = await saveOrUpdateStockItem(selectedPub.path, item.id, {
      wholeUnit: unit.wholeUnit,
      partUnit: unit.partUnit,
      unit: unit.unit || unit.wholeUnit,
    });
    setAssigningUnitId(null);
    if (res.success) {
      // Reflect immediately so the desktop form (driven by selectedItem) flips to steppers.
      setSelectedItem(prev => (prev && prev.id === item.id)
        ? { ...prev, wholeUnit: unit.wholeUnit, partUnit: unit.partUnit, unit: unit.unit || unit.wholeUnit }
        : prev);
    } else {
      showToast('Could not save unit: ' + res.error);
    }
  };

  // Counter confirms (or edits) the AI-suggested category at first count → builds the pill.
  const handleAssignCategory = async (item, category) => {
    setAssigningCatId(item.id);
    const res = await saveOrUpdateStockItem(selectedPub.path, item.id, {
      category,
      categorySuggested: '',
    });
    setAssigningCatId(null);
    if (res.success) {
      setSelectedItem(prev => (prev && prev.id === item.id)
        ? { ...prev, category, categorySuggested: '' }
        : prev);
    } else {
      showToast('Could not save category: ' + res.error);
    }
  };

  const handleQuantitySubmit = async () => {
    if (!selectedItem || saving || !currentSession) return;

    const unitInfo = parseUnitInfo(selectedItem);
    const wholeVal = parseFloat(wholeQuantity) || 0;
    let tenthsVal = parseFloat(tenthsQuantity) || 0;
    // ".3" or "0.3" means 3 tenths, not 0.3 tenths
    if (tenthsVal > 0 && tenthsVal < 1) tenthsVal = Math.round(tenthsVal * 10);
    const partVal = parseFloat(partQuantity) || 0;
    const usedTenths = unitInfo.hasTenthsOption && tenthsVal > 0;

    if (wholeVal === 0 && partVal === 0 && tenthsVal === 0) return;

    setSaving(true);

    // Tenths: each tenth = unitsPerWhole / 10
    // Direct: part value is in the actual unit
    const partContribution = usedTenths
      ? tenthsVal * (unitInfo.unitsPerWhole / 10)
      : partVal;

    const savedPartCount = usedTenths ? tenthsVal : partVal;
    const savedPartLabel = usedTenths ? 'Tenths' : unitInfo.partLabel;

    const newQuantity = Math.round(((wholeVal * unitInfo.unitsPerWhole) + partContribution) * 100) / 100;

    const result = await saveStockCount(
      selectedPub.path,
      currentSession.id,
      selectedItem.id,
      {
        wholeCount: wholeVal,
        partCount: savedPartCount,
        quantity: newQuantity,
        itemName: selectedItem.name,
        wholeLabel: unitInfo.wholeLabel,
        partLabel: savedPartLabel,
        countedBy: userProfile?.displayName || currentUser.email
      }
    );

    setSaving(false);

    if (result.success) {
      const display = formatCountDisplay({
        wholeCount: wholeVal,
        partCount: savedPartCount,
        wholeLabel: unitInfo.wholeLabel,
        partLabel: savedPartLabel
      });
      setLastSaved({ name: selectedItem.name, quantity: display.detail });
      // Collapse the card and stay put in the list. Keep the current tab/search
      // filter, and don't touch focus so the keyboard stays closed.
      setSelectedItem(null);
      setWholeQuantity('');
      setPartQuantity('');
      setTenthsQuantity('');
      setTimeout(() => setLastSaved(null), 2000);
    } else {
      showToast('Error saving: ' + result.error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      // Find all enabled inputs in the entry form
      const form = e.target.closest('[data-entry-form]');
      if (form) {
        const inputs = Array.from(form.querySelectorAll('input:not(:disabled)'));
        const idx = inputs.indexOf(e.target);
        if (idx >= 0 && idx < inputs.length - 1) {
          e.preventDefault();
          inputs[idx + 1].focus();
          inputs[idx + 1].select();
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleQuantitySubmit();
      }
    } else if (e.key === 'Escape') {
      handleCancelEntry();
    }
  };

  const handleCancelEntry = () => {
    setSelectedItem(null);
    setWholeQuantity('');
    setPartQuantity('');
    setTenthsQuantity('');
    // Desktop only: return focus to search. On mobile, leave the keyboard closed.
    if (!isMobile && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };


  // Admin functions
  const handleDeleteItem = (item) => {
    showConfirm(
      'Delete Item?',
      `Are you sure you want to delete "${item.name}"?`,
      async () => {
        const result = await deleteStockItem(selectedPub.path, item.id);
        if (!result.success) {
          showToast('Error deleting: ' + result.error);
        }
      }
    );
  };

  const handleAdminFormSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast('Please enter an item name', 'info');
      return;
    }

    const result = await saveOrUpdateStockItem(
      selectedPub.path,
      null,
      {
        name: formData.name.trim(),
        section: formData.section,
        quantity: parseFloat(formData.quantity) || 0,
        unit: formData.unit.trim(),
        wholeUnit: formData.wholeUnit.trim(),
        partUnit: formData.partUnit.trim(),
        unitCost: parseFloat(formData.unitCost) || 0,
        notes: formData.notes.trim()
      }
    );

    if (result.success) {
      setShowAdminForm(false);
      setFormData({ name: '', section: 'bar', quantity: '', unit: '', wholeUnit: '', partUnit: '', unitCost: '', notes: '' });
    } else {
      showToast('Error: ' + result.error);
    }
  };

  const formatSessionDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Split a summary string into total (bracketed part) and detail (the rest)
  // e.g. "3 Kegs, 5 Tenths (175 Litres)" → { total: "175 Litres", detail: "3 Kegs, 5 Tenths" }
  const splitSummary = (summary) => {
    const match = summary.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (match) return { detail: match[1].trim(), total: match[2].trim() };
    return { detail: '', total: summary };
  };

  const formatCountedAt = (countedAt) => {
    if (!countedAt) return '';
    const date = countedAt.toDate ? countedAt.toDate() : new Date(countedAt);
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Who counted this item first vs who last updated it, from the count's
  // history. Falls back to the flat fields for counts saved before history.
  const getProvenance = (count) => {
    const hist = Array.isArray(count.history) ? count.history : [];
    if (hist.length > 0) {
      const first = hist[0];
      const last = hist[hist.length - 1];
      return {
        countedBy: first.countedBy || '',
        countedAt: first.countedAt,
        updated: hist.length > 1,
        updatedBy: last.countedBy || '',
        updatedAt: last.countedAt,
        changes: hist.length,
      };
    }
    const by = Array.isArray(count.countedBy) ? count.countedBy.join(', ') : (count.countedBy || '');
    return { countedBy: by, countedAt: count.countedAt, updated: false, updatedBy: '', updatedAt: null, changes: 1 };
  };

  // Express a signed change in quantity using the item's units, working out
  // whether the editor added or removed — e.g. "+2 Kegs, 50 Litres" or "−1 Keg".
  // Returns null when there was no net change.
  const formatDelta = (fromQty, toQty, unitInfo) => {
    const round2 = (v) => Math.round(v * 100) / 100;
    const dq = round2((toQty || 0) - (fromQty || 0));
    if (!dq) return null;
    const abs = Math.abs(dq);
    const upw = (unitInfo && unitInfo.hasPartUnit && unitInfo.unitsPerWhole) || 1;
    const parts = [];
    if (upw > 1) {
      const whole = Math.trunc(abs / upw);
      const rem = round2(abs - whole * upw);
      if (whole) parts.push(`${whole} ${unitInfo.wholeLabel}`);
      if (rem) parts.push(`${rem} ${unitInfo.partLabel}`);
    } else {
      parts.push(`${abs} ${(unitInfo && unitInfo.wholeLabel) || ''}`.trim());
    }
    return { positive: dq > 0, text: `${dq > 0 ? '+' : '−'}${parts.join(', ')}` };
  };

  // The most recent change to a count (delta between the last two entries).
  const lastDeltaFor = (count, item) => {
    const hist = Array.isArray(count.history) ? count.history : [];
    if (hist.length < 2) return null;
    const unitInfo = item ? parseUnitInfo(item) : null;
    return formatDelta(hist[hist.length - 2].quantity, hist[hist.length - 1].quantity, unitInfo);
  };

  const renderCountMeta = (count, item) => {
    const p = getProvenance(count);
    if (!p.countedBy && !p.countedAt) return null;
    const delta = p.updated ? lastDeltaFor(count, item) : null;
    return (
      <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        <span>Counted by {p.countedBy || 'Unknown'}{p.countedAt ? ` · ${formatCountedAt(p.countedAt)}` : ''}</span>
        {p.updated && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Updated by {p.updatedBy || 'Unknown'}
            {delta && <strong style={{ color: delta.positive ? '#38a169' : '#e53e3e' }}>{delta.text}</strong>}
            {p.updatedAt ? `· ${formatCountedAt(p.updatedAt)}` : ''}
            {isAdmin() && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const unitInfo = item ? parseUnitInfo(item) : null;
                  setViewingHistory({ itemName: count.itemName, history: count.history, unitInfo });
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.textSecondary,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                ({p.changes} changes)
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  const generateSessionText = (session) => {
    const date = session.createdAt?.toDate ? session.createdAt.toDate() : new Date(session.createdAt);
    const dateStr = date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let text = `STOCK TAKE\n`;
    text += `${dateStr}\n`;
    text += `By: ${session.createdByName}\n`;
    text += `${'='.repeat(40)}\n\n`;

    const buildCounted = (section) => Object.entries(session.counts || {})
      .filter(([itemId]) => {
        const item = allItems.find(i => i.id === itemId);
        return item?.section === section;
      })
      .map(([itemId, count]) => {
        const item = allItems.find(i => i.id === itemId);
        const unitInfo = item ? parseUnitInfo(item) : null;
        const hist = Array.isArray(count.history) ? count.history : [];
        const lastDelta = hist.length > 1 ? formatDelta(hist[hist.length - 2].quantity, hist[hist.length - 1].quantity, unitInfo) : null;
        return { itemId, ...count, summary: formatCountSummary(count, unitInfo), lastDelta };
      });

    const barCounted = buildCounted('bar');
    const kitchenCounted = buildCounted('kitchen');

    const formatCountText = (count) => {
      const p = getProvenance(count);
      let line = `${count.itemName}: ${count.summary}`;
      if (p.countedBy || p.countedAt) {
        line += `\n    Counted by ${p.countedBy || 'Unknown'}${p.countedAt ? ' ' + formatCountedAt(p.countedAt) : ''}`;
        if (p.updated) {
          const d = count.lastDelta ? ` (${count.lastDelta.text})` : '';
          line += `\n    Updated by ${p.updatedBy || 'Unknown'}${d}${p.updatedAt ? ' ' + formatCountedAt(p.updatedAt) : ''}`;
        }
      }
      return line + '\n';
    };

    if (barCounted.length > 0) {
      text += `BAR (${barCounted.length} items)\n`;
      text += `${'-'.repeat(40)}\n`;
      barCounted.forEach(count => {
        text += formatCountText(count);
      });
      text += '\n';
    }

    if (kitchenCounted.length > 0) {
      text += `KITCHEN (${kitchenCounted.length} items)\n`;
      text += `${'-'.repeat(40)}\n`;
      kitchenCounted.forEach(count => {
        text += formatCountText(count);
      });
      text += '\n';
    }

    text += `${'='.repeat(40)}\n`;
    text += `TOTAL ITEMS COUNTED: ${Object.keys(session.counts || {}).length}\n`;

    return text;
  };

  const generateSessionPDF = (session) => {
    const date = session.createdAt?.toDate ? session.createdAt.toDate() : new Date(session.createdAt);
    const dateStr = date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const buildPdfCounted = (section) => Object.entries(session.counts || {})
      .filter(([itemId]) => {
        const item = allItems.find(i => i.id === itemId);
        return item?.section === section;
      })
      .map(([itemId, count]) => {
        const item = allItems.find(i => i.id === itemId);
        const unitInfo = item ? parseUnitInfo(item) : null;
        const hist = Array.isArray(count.history) ? count.history : [];
        const lastDelta = hist.length > 1 ? formatDelta(hist[hist.length - 2].quantity, hist[hist.length - 1].quantity, unitInfo) : null;
        return { itemId, ...count, summary: formatCountSummary(count, unitInfo), lastDelta };
      });

    const barCounted = buildPdfCounted('bar');
    const kitchenCounted = buildPdfCounted('kitchen');

    const renderItemHtml = (count) => {
      const p = getProvenance(count);
      const countedStr = (p.countedBy || p.countedAt)
        ? `Counted by ${p.countedBy || 'Unknown'}${p.countedAt ? ' &bull; ' + formatCountedAt(p.countedAt) : ''}`
        : '';
      const deltaStr = count.lastDelta ? ` &bull; ${count.lastDelta.text}` : '';
      const updatedStr = p.updated
        ? `Updated by ${p.updatedBy || 'Unknown'}${deltaStr}${p.updatedAt ? ' &bull; ' + formatCountedAt(p.updatedAt) : ''}`
        : '';
      const { total, detail } = splitSummary(count.summary);
      return `
        <div class="item">
          <div class="item-left">
            <span class="item-name">${count.itemName}</span>
            ${detail ? `<span class="item-detail">${detail}</span>` : ''}
            ${countedStr ? `<span class="item-meta">${countedStr}</span>` : ''}
            ${updatedStr ? `<span class="item-meta">${updatedStr}</span>` : ''}
          </div>
          <span class="item-total">${total}</span>
        </div>
      `;
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${selectedPub?.name || 'Stock'} Stock Take - ${dateStr}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 40px;
            color: #1a202c;
            max-width: 800px;
            margin: 0 auto;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #2563EB;
          }
          .header h1 {
            font-size: 28px;
            color: #2563EB;
            margin-bottom: 8px;
          }
          .header .date {
            font-size: 16px;
            color: #4a5568;
          }
          .header .by {
            font-size: 14px;
            color: #718096;
            margin-top: 4px;
          }
          .section {
            margin-bottom: 25px;
          }
          .section-header {
            background: #2563EB;
            color: white;
            padding: 10px 15px;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-radius: 4px 4px 0 0;
          }
          .items {
            border: 1px solid #e2e8f0;
            border-top: none;
            border-radius: 0 0 4px 4px;
          }
          .item {
            display: flex;
            justify-content: space-between;
            padding: 12px 15px;
            border-bottom: 1px solid #e2e8f0;
          }
          .item:last-child {
            border-bottom: none;
          }
          .item:nth-child(even) {
            background: #f7fafc;
          }
          .item-left {
            display: flex;
            flex-direction: column;
          }
          .item-name {
            font-weight: 500;
          }
          .item-total {
            font-weight: 700;
            font-size: 15px;
            color: #1a202c;
            white-space: nowrap;
          }
          .item-detail {
            color: #718096;
            font-size: 12px;
            margin-top: 2px;
          }
          .item-meta {
            color: #a0aec0;
            font-size: 11px;
            margin-top: 1px;
          }
          .item-by {
            color: #a0aec0;
            font-size: 12px;
            font-weight: normal;
          }
          .item-entry {
            display: flex;
            justify-content: space-between;
            width: 100%;
            padding: 4px 0 4px 20px;
            font-size: 12px;
            color: #718096;
            border-top: 1px solid #edf2f7;
            margin-top: 4px;
          }
          .item-entry-time {
            color: #a0aec0;
            font-size: 11px;
          }
          .total {
            margin-top: 30px;
            padding: 15px 20px;
            background: linear-gradient(135deg, #2563EB 0%, #1E40AF 100%);
            color: white;
            border-radius: 6px;
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: 600;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            color: #a0aec0;
            font-size: 12px;
          }
          @media print {
            body { padding: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${selectedPub?.name || 'Stock'} Stock Take</h1>
          <div class="date">${dateStr}</div>
          <div class="by">Completed by ${session.createdByName}</div>
        </div>

        ${barCounted.length > 0 ? `
          <div class="section">
            <div class="section-header">Bar (${barCounted.length} items)</div>
            <div class="items">
              ${barCounted.map(count => renderItemHtml(count)).join('')}
            </div>
          </div>
        ` : ''}

        ${kitchenCounted.length > 0 ? `
          <div class="section">
            <div class="section-header">Kitchen (${kitchenCounted.length} items)</div>
            <div class="items">
              ${kitchenCounted.map(count => renderItemHtml(count)).join('')}
            </div>
          </div>
        ` : ''}

        <div class="total">
          <span>Total Items Counted</span>
          <span>${Object.keys(session.counts || {}).length}</span>
        </div>

        <div class="footer">
          Generated from P&L Dashboard
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();
  };

  if (!canAccessStock()) return null;
  if (loading || sessionLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: '1rem'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${colors.bgLight}`,
          borderTopColor: colors.primary,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div style={{ color: colors.textSecondary }}>Loading stock...</div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }
  if (error) return <div className="error">Error: {error}</div>;

  const countedItemsCount = Object.keys(currentSession?.counts || {}).length;
  const sessionAccent = currentSession?.section === 'kitchen' ? '#d69e2e' : colors.primary;
  // Text on the session-accent surface: dark-aware on-primary for bar (cobalt); white stays on the kitchen amber.
  const onSessionAccent = currentSession?.section === 'kitchen' ? '#FFFFFF' : colors.onPrimary;

  return (
    <div className="stock-taking">
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!showSessionPicker && currentSession && (
            <button
              onClick={handleBackToSessionPicker}
              style={{
                padding: '0.5rem 0.75rem',
                backgroundColor: colors.bgLight,
                color: colors.textPrimary,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              ← Back
            </button>
          )}
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Stock</h1>
        </div>
        {isSuperAdmin() && (
          <button
            onClick={() => setShowAdminForm(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: colors.primary,
              color: colors.onPrimary,
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            + Add Item
          </button>
        )}
      </div>

      {/* Empty state: no stock items yet — onboard by uploading a stock list */}
      {allItems.length === 0 && (
        <StockListUpload
          venuePath={selectedPub.path}
          canEdit={canEdit()}
          onAddManually={isSuperAdmin() ? () => setShowAdminForm(true) : null}
        />
      )}

      {/* Session Picker (only once stock items exist) */}
      {allItems.length > 0 && (showSessionPicker ? (
        <div style={{ marginBottom: '1rem' }}>
          {/* Success message for completed sessions */}
          {lastSaved && (
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#48bb78',
              color: 'white',
              borderRadius: '4px',
              marginBottom: '1rem',
              textAlign: 'center',
              fontWeight: '500'
            }}>
              {lastSaved.name} - {lastSaved.quantity}
            </div>
          )}

          {/* Start New Session Buttons */}
          {(() => {
            const openBar = allSessions.find(s => s.status === 'in_progress' && s.section === 'bar');
            const openKitchen = allSessions.find(s => s.status === 'in_progress' && s.section === 'kitchen');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {openBar ? (
                    <div style={{
                      flex: 1,
                      padding: '0.75rem 1rem',
                      backgroundColor: isDark ? '#1a3a3a' : '#e6fffa',
                      color: isDark ? '#81e6d9' : '#285e61',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      textAlign: 'center'
                    }}>
                      Bar stock take in progress
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartSession('bar')}
                      style={{
                        flex: 1,
                        padding: '1rem',
                        backgroundColor: colors.primary,
                        color: colors.onPrimary,
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        fontWeight: 'bold'
                      }}
                    >
                      + Bar Stock Take
                    </button>
                  )}
                  {openKitchen ? (
                    <div style={{
                      flex: 1,
                      padding: '0.75rem 1rem',
                      backgroundColor: isDark ? '#4a3c1a' : '#fefcbf',
                      color: isDark ? '#fbd38d' : '#744210',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      textAlign: 'center'
                    }}>
                      Kitchen stock take in progress
                    </div>
                  ) : (
                    <button
                      onClick={() => handleStartSession('kitchen')}
                      style={{
                        flex: 1,
                        padding: '1rem',
                        backgroundColor: '#d69e2e',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        fontWeight: 'bold'
                      }}
                    >
                      + Kitchen Stock Take
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Session List */}
          {allSessions.length > 0 ? (() => {
            const sortSessions = (sessions) => [...sessions].sort((a, b) => {
              // In-progress first, then by createdAt newest first
              if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
              if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
              const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
              const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
              return bTime - aTime;
            });
            const barSessions = sortSessions(allSessions.filter(s => s.section === 'bar'));
            const kitchenSessions = sortSessions(allSessions.filter(s => s.section === 'kitchen'));
            const otherSessions = allSessions.filter(s => !s.section);

            const renderSessionCard = (session) => {
              const isInProgress = session.status === 'in_progress';
              const itemCount = Object.keys(session.counts || {}).length;
              const sectionColor = session.section === 'kitchen' ? '#d69e2e' : colors.primary;

              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => isInProgress ? handleSelectSession(session) : (() => { setSummarySession(session); setShowSummary(true); })()}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: isInProgress
                      ? (session.section === 'kitchen'
                        ? (isDark ? '#4a3e2d' : '#fefce8')
                        : (isDark ? '#2d4a3e' : '#e6fffa'))
                      : colors.bgCard,
                    border: `1px solid ${isInProgress
                      ? sectionColor
                      : colors.border}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}>
                    <div style={{ fontWeight: 'bold', color: colors.textPrimary, fontSize: '0.9rem' }}>
                      {formatSessionDate(session.createdAt)}
                    </div>
                    <span style={{
                      fontSize: '0.7rem',
                      backgroundColor: isInProgress ? '#38a169' : colors.textSecondary,
                      color: 'white',
                      padding: '0.125rem 0.4rem',
                      borderRadius: '9999px',
                      flexShrink: 0
                    }}>
                      {isInProgress ? 'In Progress' : 'Completed'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                    {session.createdByName} • {itemCount} items
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    marginTop: '0.5rem'
                  }}>
                    <span style={{
                      color: sectionColor,
                      fontWeight: '500',
                      fontSize: '0.85rem'
                    }}>
                      {isInProgress ? 'Continue →' : 'View →'}
                    </span>
                  </div>
                </button>
              );
            };

            return (
              <div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  {/* Bar column */}
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: colors.primary,
                      marginBottom: '0.5rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: `2px solid ${colors.primary}`,
                      paddingBottom: '0.25rem'
                    }}>
                      Bar
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {barSessions.length > 0 ? barSessions.map(renderSessionCard) : (
                        <div style={{ textAlign: 'center', padding: '1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
                          No bar sessions
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Kitchen column */}
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: '#d69e2e',
                      marginBottom: '0.5rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '2px solid #d69e2e',
                      paddingBottom: '0.25rem'
                    }}>
                      Kitchen
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {kitchenSessions.length > 0 ? kitchenSessions.map(renderSessionCard) : (
                        <div style={{ textAlign: 'center', padding: '1rem', color: colors.textSecondary, fontSize: '0.85rem' }}>
                          No kitchen sessions
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {otherSessions.length > 0 && (
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {otherSessions.map(renderSessionCard)}
                  </div>
                )}
              </div>
            );
          })() : (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: colors.textSecondary
            }}>
              No previous stock takes
            </div>
          )}
        </div>
      ) : currentSession && (
        /* Active Session Header - hidden on mobile when searching */
        <div style={{
          padding: '1rem',
          backgroundColor: currentSession?.section === 'kitchen'
            ? (isDark ? '#4a3e2d' : '#fefce8')
            : (isDark ? '#2d4a3e' : '#e6fffa'),
          border: `1px solid ${currentSession?.section === 'kitchen'
            ? (isDark ? '#d69e2e' : '#d69e2e')
            : (isDark ? '#38a169' : '#38b2ac')}`,
          borderRadius: '8px',
          marginBottom: '1rem',
          display: (isMobile && searchQuery) ? 'none' : 'block'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div>
              <div style={{ fontWeight: 'bold', color: colors.textPrimary }}>
                {currentSession?.section === 'kitchen' ? 'Kitchen' : 'Bar'} Stock Take In Progress
              </div>
              <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>
                Started {formatSessionDate(currentSession.createdAt)} by {currentSession.createdByName}
              </div>
              <div style={{ fontSize: '0.85rem', color: colors.textSecondary }}>
                {countedItemsCount} of {filteredItems.length} items counted
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowSummary(true)}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#4299e1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Summary
              </button>
              <button
                onClick={handleCancelSession}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#e53e3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Delete
              </button>
              <button
                onClick={handleCompleteSession}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#38a169',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Complete
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Only show counting interface if session is active and not showing picker */}
      {allItems.length > 0 && !showSessionPicker && currentSession && (
        <>
          {/* Success Message */}
          {lastSaved && (
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#48bb78',
              color: 'white',
              borderRadius: '4px',
              marginBottom: '1rem',
              textAlign: 'center',
              fontWeight: '500'
            }}>
              Saved: {lastSaved.name} = {lastSaved.quantity}
            </div>
          )}

          {/* Search Bar */}
          <div style={{ marginBottom: '1rem' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search stock..."
              style={{
                width: '100%',
                padding: '1rem',
                fontSize: '1.1rem',
                border: `2px solid ${colors.border}`,
                borderRadius: '8px',
                backgroundColor: colors.bgCard,
                color: colors.textPrimary
              }}
            />
          </div>

          {/* Section Tabs - hidden when session has a section locked */}
          {!currentSession?.section && (
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1rem',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: '0.25rem',
              scrollbarWidth: 'none'
            }}>
              {['all', 'bar', 'kitchen'].map(section => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  style={{
                    flexShrink: 0,
                    padding: '0.5rem 1rem',
                    backgroundColor: activeSection === section ? colors.primary : colors.bgLight,
                    color: activeSection === section ? 'white' : colors.textPrimary,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    textTransform: 'capitalize',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {section === 'all' ? 'All' : section} ({section === 'all' ? allItems.length : section === 'bar' ? barItems.length : kitchenItems.length})
                </button>
              ))}
            </div>
          )}

          {/* Category Tabs - filter the list to a single category (hidden while searching) */}
          {!searchQuery && categories.length > 1 && (
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1rem',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: '0.25rem',
              scrollbarWidth: 'none'
            }}>
              {['all', ...categories].map(category => {
                const count = category === 'all'
                  ? sectionItems.length
                  : sectionItems.filter(item => item.category === category).length;
                const isActive = activeCategory === category;
                return (
                  <button
                    key={category}
                    onClick={(e) => {
                      setActiveCategory(category);
                      // Slide the tapped pill to the far left of the row (browser clamps at max scroll).
                      const el = e.currentTarget;
                      const row = el.parentElement;
                      row.scrollBy({ left: el.getBoundingClientRect().left - row.getBoundingClientRect().left, behavior: 'smooth' });
                    }}
                    style={{
                      flexShrink: 0,
                      padding: '0.5rem 1rem',
                      backgroundColor: isActive ? sessionAccent : colors.bgLight,
                      color: isActive ? 'white' : colors.textPrimary,
                      border: 'none',
                      borderRadius: '9999px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontSize: '0.85rem',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {category === 'all' ? 'All' : category} ({count})
                  </button>
                );
              })}
            </div>
          )}


          {/* Stock Items List */}
          <div style={{
            paddingBottom: '1rem'
          }}>
            {filteredItems.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '2rem',
                color: colors.textSecondary
              }}>
                {searchQuery ? 'No items match your search' : 'No stock items yet'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {filteredItems.map((item, index) => {
                  const sessionCount = getSessionCount(item.id);
                  const isCounted = !!sessionCount;
                  const isFirstResult = index === 0 && searchQuery;

                  return (
                    <React.Fragment key={item.id}>
                    {/* Desktop: inline entry form above selected item */}
                    {!isMobile && selectedItem?.id === item.id && (
                      <div style={{
                        padding: '1rem',
                        marginBottom: '0.5rem',
                        backgroundColor: `${sessionAccent}15`,
                        border: `2px solid ${sessionAccent}`,
                        borderRadius: '8px'
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginBottom: '1rem'
                        }}>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: colors.textPrimary, marginBottom: '0.25rem' }}>
                              {selectedItem.name}
                            </div>
                            <div style={{ color: colors.textSecondary, fontSize: '0.85rem' }}>
                              {selectedItem.category || selectedItem.section}
                              {' • '}{formatItemDescription(selectedItem) || selectedItem.unit}
                                                          </div>
                          </div>
                          <button
                            onClick={handleCancelEntry}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: colors.bgLight,
                              border: 'none',
                              fontSize: '0.9rem',
                              cursor: 'pointer',
                              color: colors.textPrimary,
                              borderRadius: '4px'
                            }}
                          >
                            Cancel
                          </button>
                        </div>

                        {/* Input Fields and Submit - horizontal layout for desktop */}
                        {(() => {
                          // Imported with an AI-suggested category? Confirm it first (builds the pill).
                          if (itemNeedsCategory(selectedItem)) {
                            return (
                              <CountCategoryPrompt
                                item={selectedItem}
                                colors={colors}
                                saving={assigningCatId === selectedItem.id}
                                existingCategories={allCategories}
                                onConfirm={(c) => handleAssignCategory(selectedItem, c)}
                              />
                            );
                          }
                          // Imported without a size? Ask the counter to pick one.
                          if (!itemHasUnit(selectedItem)) {
                            return (
                              <CountUnitPrompt
                                item={selectedItem}
                                colors={colors}
                                saving={assigningUnitId === selectedItem.id}
                                onAssign={(u) => handleAssignUnit(selectedItem, u)}
                              />
                            );
                          }
                          const unitInfo = parseUnitInfo(selectedItem);
                          const tenthsDisabled = !!partQuantity;
                          const partDisabled = !!tenthsQuantity;
                          const hasAnyValue = wholeQuantity || partQuantity || tenthsQuantity;
                          const stepBtnSm = (onClick, label, disabled) => (
                            <button
                              onClick={onClick}
                              disabled={disabled}
                              tabIndex={-1}
                              style={{
                                width: '36px',
                                height: '36px',
                                border: 'none',
                                borderRadius: '4px',
                                backgroundColor: disabled ? (isDark ? '#1a202c' : '#f7fafc') : sessionAccent,
                                color: disabled ? colors.textSecondary : 'white',
                                fontSize: '1.2rem',
                                fontWeight: 'bold',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                opacity: disabled ? 0.4 : 1,
                                textAlign: 'center',
                                lineHeight: '36px',
                                padding: 0,
                                WebkitAppearance: 'none'
                              }}
                            >{label}</button>
                          );
                          const stepValue = (val, setter, delta, disabled, max) => {
                            if (disabled) return;
                            const current = parseFloat(val) || 0;
                            let next = Math.max(0, current + delta);
                            if (max != null) next = Math.min(max, next);
                            setter(next === 0 ? '' : next.toString());
                          };
                          // Tenths cap at 9 (10 tenths = a whole).
                          const partMax = unitInfo.partLabel === 'Tenths' ? 9 : undefined;
                          return (
                            <div data-entry-form style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                {stepBtnSm(() => stepValue(wholeQuantity, setWholeQuantity, -1, false), '−', false)}
                                <input
                                  ref={wholeInputRef}
                                  type="text"
                                  inputMode="decimal"
                                  enterKeyHint={unitInfo.hasPartUnit ? 'next' : 'done'}
                                  value={wholeQuantity}
                                  onChange={(e) => setWholeQuantity(e.target.value.replace(/[^0-9.]/g, ''))}
                                  onKeyDown={handleKeyDown}
                                  placeholder="0"
                                  style={{
                                    width: '60px',
                                    padding: '0.5rem',
                                    fontSize: '1.25rem',
                                    fontWeight: 'bold',
                                    textAlign: 'center',
                                    border: `2px solid ${colors.border}`,
                                    borderRadius: '4px',
                                    backgroundColor: isDark ? '#2d3748' : '#ffffff',
                                    color: colors.textPrimary
                                  }}
                                />
                                {stepBtnSm(() => stepValue(wholeQuantity, setWholeQuantity, 1, false), '+', false)}
                                <span style={{ fontWeight: '500', color: colors.textPrimary, marginLeft: '0.25rem' }}>{unitInfo.wholeLabel}</span>
                              </div>
                              {unitInfo.hasPartUnit && unitInfo.hasTenthsOption && (
                                <>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {stepBtnSm(() => stepValue(tenthsQuantity, setTenthsQuantity, -1, tenthsDisabled, 9), '−', tenthsDisabled)}
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      enterKeyHint="done"
                                      value={tenthsQuantity}
                                      onChange={(e) => {
                                        let v = e.target.value.replace(/[^0-9.]/g, '');
                                        if (v !== '' && parseFloat(v) > 9) v = '9';
                                        setTenthsQuantity(v);
                                      }}
                                      onKeyDown={handleKeyDown}
                                      disabled={tenthsDisabled}
                                      placeholder="0"
                                      style={{
                                        width: '60px',
                                        padding: '0.5rem',
                                        fontSize: '1.25rem',
                                        fontWeight: 'bold',
                                        textAlign: 'center',
                                        border: `2px solid ${tenthsDisabled ? 'transparent' : colors.border}`,
                                        borderRadius: '4px',
                                        backgroundColor: tenthsDisabled ? (isDark ? '#1a202c' : '#f7fafc') : (isDark ? '#2d3748' : '#ffffff'),
                                        color: tenthsDisabled ? colors.textSecondary : colors.textPrimary,
                                        opacity: tenthsDisabled ? 0.4 : 1
                                      }}
                                    />
                                    {stepBtnSm(() => stepValue(tenthsQuantity, setTenthsQuantity, 1, tenthsDisabled, 9), '+', tenthsDisabled)}
                                    <span style={{ fontWeight: '500', color: tenthsDisabled ? colors.textSecondary : colors.textPrimary, opacity: tenthsDisabled ? 0.4 : 1, marginLeft: '0.25rem' }}>Tenths</span>
                                  </div>
                                  <span style={{ color: colors.textSecondary, fontSize: '0.85rem', fontStyle: 'italic' }}>or</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {stepBtnSm(() => stepValue(partQuantity, setPartQuantity, -1, partDisabled), '−', partDisabled)}
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      enterKeyHint="done"
                                      value={partQuantity}
                                      onChange={(e) => setPartQuantity(e.target.value.replace(/[^0-9.]/g, ''))}
                                      onKeyDown={handleKeyDown}
                                      disabled={partDisabled}
                                      placeholder="0"
                                      style={{
                                        width: '60px',
                                        padding: '0.5rem',
                                        fontSize: '1.25rem',
                                        fontWeight: 'bold',
                                        textAlign: 'center',
                                        border: `2px solid ${partDisabled ? 'transparent' : colors.border}`,
                                        borderRadius: '4px',
                                        backgroundColor: partDisabled ? (isDark ? '#1a202c' : '#f7fafc') : (isDark ? '#2d3748' : '#ffffff'),
                                        color: partDisabled ? colors.textSecondary : colors.textPrimary,
                                        opacity: partDisabled ? 0.4 : 1
                                      }}
                                    />
                                    {stepBtnSm(() => stepValue(partQuantity, setPartQuantity, 1, partDisabled), '+', partDisabled)}
                                    <span style={{ fontWeight: '500', color: partDisabled ? colors.textSecondary : colors.textPrimary, opacity: partDisabled ? 0.4 : 1, marginLeft: '0.25rem' }}>{unitInfo.partLabel}</span>
                                  </div>
                                </>
                              )}
                              {unitInfo.hasPartUnit && !unitInfo.hasTenthsOption && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  {stepBtnSm(() => stepValue(partQuantity, setPartQuantity, -1, false, partMax), '−', false)}
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    enterKeyHint="done"
                                    value={partQuantity}
                                    onChange={(e) => {
                                      let v = e.target.value.replace(/[^0-9.]/g, '');
                                      if (partMax != null && v !== '' && parseFloat(v) > partMax) v = String(partMax);
                                      setPartQuantity(v);
                                    }}
                                    onKeyDown={handleKeyDown}
                                    placeholder="0"
                                    style={{
                                      width: '60px',
                                      padding: '0.5rem',
                                      fontSize: '1.25rem',
                                      fontWeight: 'bold',
                                      textAlign: 'center',
                                      border: `2px solid ${colors.border}`,
                                      borderRadius: '4px',
                                      backgroundColor: isDark ? '#2d3748' : '#ffffff',
                                      color: colors.textPrimary
                                    }}
                                  />
                                  {stepBtnSm(() => stepValue(partQuantity, setPartQuantity, 1, false, partMax), '+', false)}
                                  <span style={{ fontWeight: '500', color: colors.textPrimary, marginLeft: '0.25rem' }}>{unitInfo.partLabel}</span>
                                </div>
                              )}
                              <button
                                onClick={handleQuantitySubmit}
                                disabled={saving || !hasAnyValue}
                                style={{
                                  padding: '0.5rem 1.5rem',
                                  backgroundColor: sessionAccent,
                                  color: onSessionAccent,
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: saving || !hasAnyValue ? 'not-allowed' : 'pointer',
                                  fontSize: '1rem',
                                  fontWeight: 'bold',
                                  opacity: !hasAnyValue ? 0.6 : 1
                                }}
                              >
                                {saving ? 'Saving...' : 'Submit'}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <div
                      ref={(el) => {
                        if (isFirstResult) firstResultRef.current = el;
                        if (selectedItem?.id === item.id) selectedCardRef.current = el;
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '1rem',
                        backgroundColor: isCounted
                          ? (isDark ? '#2d4a3e' : '#f0fff4')
                          : selectedItem?.id === item.id
                            ? `${sessionAccent}15`
                            : colors.bgCard,
                        border: `1px solid ${isCounted
                          ? (isDark ? '#38a169' : '#9ae6b4')
                          : selectedItem?.id === item.id
                            ? sessionAccent
                            : colors.border}`,
                        borderRadius: '8px'
                      }}
                    >
                      <div
                        onClick={() => handleItemToggle(item)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer'
                        }}
                      >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: '500',
                          color: colors.textPrimary,
                          marginBottom: '0.25rem'
                        }}>
                          {item.name}
                        </div>
                        {isCounted && (() => {
                          const by = sessionCount.countedBy;
                          const names = Array.isArray(by) ? by : [by || ''];
                          const initials = names.map(n => n.split(/\s+/).map(w => w[0] || '').join('').toUpperCase()).filter(Boolean).join(', ') || '✓';
                          return (
                            <span style={{
                              display: 'inline-block',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              backgroundColor: '#38a169',
                              color: 'white',
                              padding: '0.1rem 0.5rem',
                              borderRadius: '9999px',
                              whiteSpace: 'nowrap',
                              marginBottom: '0.3rem'
                            }}>
                              {initials}
                            </span>
                          );
                        })()}
                        <div style={{
                          fontSize: '0.8rem',
                          color: colors.textSecondary,
                          textTransform: 'capitalize'
                        }}>
                          {item.category || item.section}
                          {formatItemDescription(item) && ` • ${formatItemDescription(item)}`}
                          {isCounted && (() => {
                            const { detail, total } = splitSummary(formatCountSummary(sessionCount, parseUnitInfo(item)));
                            return detail && total ? <span style={{ marginLeft: '0.5rem' }}>• {total}</span> : null;
                          })()}
                        </div>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        flexShrink: 0
                      }}>
                        <div style={{
                          backgroundColor: colors.bgLight,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          fontSize: isCounted ? '0.85rem' : '1.1rem',
                          color: isCounted ? colors.textPrimary : colors.textSecondary,
                          minWidth: '54px',
                          textAlign: 'center',
                          whiteSpace: 'nowrap'
                        }}>
                          {isCounted ? formatCountDisplay(sessionCount).short : '—'}
                        </div>
                        {isAdmin() && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteItem(item);
                            }}
                            style={{
                              padding: '0.25rem 0.5rem',
                              backgroundColor: '#e53e3e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.75rem'
                            }}
                          >
                            Del
                          </button>
                        )}
                      </div>
                      </div>
                      {/* Inline entry panel — expands the card; steppers don't open the keyboard */}
                      {isMobile && selectedItem?.id === item.id && (() => {
                        // Imported with an AI-suggested category? Confirm it first (builds the pill).
                        if (itemNeedsCategory(item)) {
                          return (
                            <CountCategoryPrompt
                              item={item}
                              colors={colors}
                              saving={assigningCatId === item.id}
                              existingCategories={allCategories}
                              onConfirm={(c) => handleAssignCategory(item, c)}
                            />
                          );
                        }
                        // Imported without a size? Ask the counter to pick one.
                        if (!itemHasUnit(item)) {
                          return (
                            <CountUnitPrompt
                              item={item}
                              colors={colors}
                              saving={assigningUnitId === item.id}
                              onAssign={(u) => handleAssignUnit(item, u)}
                            />
                          );
                        }
                        const unitInfo = parseUnitInfo(item);
                        const tenthsDisabled = !!partQuantity;
                        const partDisabled = !!tenthsQuantity;
                        const hasAnyValue = wholeQuantity || partQuantity || tenthsQuantity;
                        const stepValue = (val, setter, delta, disabled, max) => {
                          if (disabled) return;
                          const current = parseFloat(val) || 0;
                          let next = Math.max(0, current + delta);
                          if (max != null) next = Math.min(max, next);
                          setter(next === 0 ? '' : next.toString());
                        };
                        const stepBtn = (onClick, label, disabled) => (
                          <button
                            type="button"
                            onClick={onClick}
                            disabled={disabled}
                            tabIndex={-1}
                            style={{
                              width: '48px', height: '48px', border: 'none', borderRadius: '8px',
                              backgroundColor: disabled ? colors.bgLight : sessionAccent,
                              color: disabled ? colors.textSecondary : onSessionAccent,
                              fontSize: '1.5rem', fontWeight: 'bold',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              opacity: disabled ? 0.4 : 1, padding: 0, lineHeight: '48px',
                              WebkitAppearance: 'none', flexShrink: 0
                            }}
                          >{label}</button>
                        );
                        const numInput = (value, setter, disabled, ref, max) => (
                          <input
                            ref={ref}
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            value={value}
                            onChange={(e) => {
                              let v = e.target.value.replace(/[^0-9.]/g, '');
                              if (max != null && v !== '' && parseFloat(v) > max) v = String(max);
                              setter(v);
                            }}
                            onKeyDown={handleKeyDown}
                            disabled={disabled}
                            placeholder="0"
                            style={{
                              flex: 1, minWidth: 0, padding: '0.75rem', fontSize: '1.5rem',
                              fontWeight: 'bold', textAlign: 'center',
                              border: `2px solid ${disabled ? 'transparent' : colors.border}`,
                              borderRadius: '8px',
                              backgroundColor: disabled ? colors.bgLight : colors.bgCard,
                              color: disabled ? colors.textSecondary : colors.textPrimary,
                              opacity: disabled ? 0.4 : 1
                            }}
                          />
                        );
                        const unitRow = (label, value, setter, disabled, ref, max) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {stepBtn(() => stepValue(value, setter, -1, disabled, max), '−', disabled)}
                            {numInput(value, setter, disabled, ref, max)}
                            {stepBtn(() => stepValue(value, setter, 1, disabled, max), '+', disabled)}
                            <span style={{ width: '60px', flexShrink: 0, fontWeight: 500, fontSize: '0.9rem', color: disabled ? colors.textSecondary : colors.textPrimary, opacity: disabled ? 0.4 : 1 }}>{label}</span>
                          </div>
                        );
                        // Tenths represent how full a container is — capped at 9 (10 tenths = a whole).
                        const partMax = unitInfo.partLabel === 'Tenths' ? 9 : undefined;
                        return (
                          <div data-entry-form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${colors.border}` }}>
                            {unitRow(unitInfo.wholeLabel, wholeQuantity, setWholeQuantity, false, wholeInputRef)}
                            {unitInfo.hasPartUnit && unitInfo.hasTenthsOption && (
                              <>
                                {unitRow('Tenths', tenthsQuantity, setTenthsQuantity, tenthsDisabled, null, 9)}
                                <div style={{ textAlign: 'center', color: colors.textSecondary, fontSize: '0.8rem', fontStyle: 'italic' }}>or</div>
                                {unitRow(unitInfo.partLabel, partQuantity, setPartQuantity, partDisabled, null, partMax)}
                              </>
                            )}
                            {unitInfo.hasPartUnit && !unitInfo.hasTenthsOption &&
                              unitRow(unitInfo.partLabel, partQuantity, setPartQuantity, false, null, partMax)
                            }
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                              <button
                                type="button"
                                onClick={handleCancelEntry}
                                style={{ flexShrink: 0, padding: '0.85rem 1.25rem', backgroundColor: colors.bgLight, color: colors.textPrimary, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}
                              >Cancel</button>
                              <button
                                type="button"
                                onClick={handleQuantitySubmit}
                                disabled={saving || !hasAnyValue}
                                style={{ flex: 1, padding: '0.85rem', backgroundColor: sessionAccent, color: onSessionAccent, border: 'none', borderRadius: '8px', cursor: saving || !hasAnyValue ? 'not-allowed' : 'pointer', fontSize: '1.05rem', fontWeight: 'bold', opacity: !hasAnyValue ? 0.6 : 1 }}
                              >{saving ? 'Saving…' : 'Save'}</button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Summary Modal */}
      {showSummary && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: isMobile ? colors.bgCard : 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'center',
          zIndex: summarySession ? 1001 : 1000,
          padding: isMobile ? 0 : '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: isMobile ? '1rem' : '2rem',
            paddingTop: isMobile ? 'max(1rem, env(safe-area-inset-top))' : '2rem',
            borderRadius: isMobile ? 0 : '12px',
            width: '100%',
            maxWidth: isMobile ? '100%' : '700px',
            maxHeight: isMobile ? '100%' : '90vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.25rem',
              flexShrink: 0
            }}>
              <div>
                <h3 style={{ margin: 0, color: colors.textPrimary, fontSize: '1.25rem' }}>Stock Summary</h3>
                {summarySession && (
                  <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                    {formatSessionDate(summarySession.createdAt)} • {summarySession.createdByName}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setShowSummary(false); setSummarySession(null); }}
                style={{
                  padding: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: colors.textSecondary
                }}
              >
                ×
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Counted items breakdown */}
            {(summarySession || currentSession) && Object.keys((summarySession || currentSession).counts || {}).length > 0 && (
              <>
                {/* Bar items */}
                {(() => {
                  const barCounted = Object.entries((summarySession || currentSession).counts || {})
                    .filter(([itemId]) => {
                      const item = allItems.find(i => i.id === itemId);
                      return item?.section === 'bar';
                    })
                    .map(([itemId, count]) => {
                      const item = allItems.find(i => i.id === itemId);
                      const unitInfo = item ? parseUnitInfo(item) : null;
                      return { itemId, ...count, summary: formatCountSummary(count, unitInfo) };
                    });

                  if (barCounted.length === 0) return null;

                  return (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{
                        fontWeight: '600',
                        color: colors.primary,
                        marginBottom: '0.5rem',
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: `2px solid ${colors.primary}`,
                        paddingBottom: '0.25rem'
                      }}>
                        Bar ({barCounted.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {barCounted.map(count => {
                          const item = allItems.find(i => i.id === count.itemId);
                          const { total, detail } = splitSummary(count.summary);
                          return (
                            <div key={count.itemId} style={{
                              padding: '0.625rem 0.75rem',
                              backgroundColor: colors.bgLight,
                              borderRadius: '6px'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: detail ? '0.2rem' : 0 }}>
                                <span style={{ fontWeight: '500', color: colors.textPrimary, fontSize: '0.95rem' }}>
                                  {count.itemName}
                                </span>
                                <span style={{ color: sessionAccent, fontWeight: '700', fontSize: '1rem' }}>
                                  {total}
                                </span>
                              </div>
                              {detail && <div style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{detail}</div>}
                              {renderCountMeta(count, item)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Kitchen items */}
                {(() => {
                  const kitchenCounted = Object.entries((summarySession || currentSession).counts || {})
                    .filter(([itemId]) => {
                      const item = allItems.find(i => i.id === itemId);
                      return item?.section === 'kitchen';
                    })
                    .map(([itemId, count]) => {
                      const item = allItems.find(i => i.id === itemId);
                      const unitInfo = item ? parseUnitInfo(item) : null;
                      return { itemId, ...count, summary: formatCountSummary(count, unitInfo) };
                    });

                  if (kitchenCounted.length === 0) return null;

                  return (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{
                        fontWeight: '600',
                        color: '#d69e2e',
                        marginBottom: '0.5rem',
                        fontSize: '0.85rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '2px solid #d69e2e',
                        paddingBottom: '0.25rem'
                      }}>
                        Kitchen ({kitchenCounted.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {kitchenCounted.map(count => {
                          const item = allItems.find(i => i.id === count.itemId);
                          const { total, detail } = splitSummary(count.summary);
                          return (
                            <div key={count.itemId} style={{
                              padding: '0.625rem 0.75rem',
                              backgroundColor: colors.bgLight,
                              borderRadius: '6px'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: detail ? '0.2rem' : 0 }}>
                                <span style={{ fontWeight: '500', color: colors.textPrimary, fontSize: '0.95rem' }}>
                                  {count.itemName}
                                </span>
                                <span style={{ color: '#d69e2e', fontWeight: '700', fontSize: '1rem' }}>
                                  {total}
                                </span>
                              </div>
                              {detail && <div style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{detail}</div>}
                              {renderCountMeta(count, item)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* No items counted yet */}
            {(summarySession || currentSession) && Object.keys((summarySession || currentSession).counts || {}).length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '2rem',
                color: colors.textSecondary
              }}>
                No items counted yet
              </div>
            )}
            </div>

            {summarySession && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexShrink: 0 }}>
                <button
                  onClick={() => generateSessionPDF(summarySession)}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    backgroundColor: '#38a169',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  Download PDF
                </button>
              </div>
            )}

            {summarySession?.status === 'completed' && (
              <button
                onClick={() => { handleReopenSession(summarySession); setShowSummary(false); setSummarySession(null); }}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  backgroundColor: '#ed8936',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  flexShrink: 0
                }}
              >
                Reopen Session
              </button>
            )}

            <button
              onClick={() => { setShowSummary(false); setSummarySession(null); }}
              style={{
                width: '100%',
                marginTop: '0.5rem',
                padding: '0.75rem',
                backgroundColor: summarySession ? colors.bgLight : sessionAccent,
                color: summarySession ? colors.textPrimary : onSessionAccent,
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem',
                flexShrink: 0
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* View Completed Session Modal */}
      {viewingSession && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: '1.5rem',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '500px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <div>
                <h3 style={{ margin: 0, color: colors.textPrimary }}>Stock Take</h3>
                <div style={{ fontSize: '0.85rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                  {formatSessionDate(viewingSession.createdAt)} • {viewingSession.createdByName}
                </div>
              </div>
              <button
                onClick={() => setViewingSession(null)}
                style={{
                  padding: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: colors.textSecondary
                }}
              >
                ×
              </button>
            </div>

            {/* Items breakdown */}
            {Object.keys(viewingSession.counts || {}).length > 0 ? (
              <>
                {/* Bar items */}
                {(() => {
                  const barCounted = Object.entries(viewingSession.counts || {})
                    .filter(([itemId]) => {
                      const item = allItems.find(i => i.id === itemId);
                      return item?.section === 'bar';
                    })
                    .map(([itemId, count]) => {
                      const item = allItems.find(i => i.id === itemId);
                      const unitInfo = item ? parseUnitInfo(item) : null;
                      return { itemId, ...count, summary: formatCountSummary(count, unitInfo) };
                    });

                  if (barCounted.length === 0) return null;

                  return (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{
                        fontWeight: '600',
                        color: colors.textPrimary,
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Bar ({barCounted.length} items)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {barCounted.map(count => {
                          const item = allItems.find(i => i.id === count.itemId);
                          const { total, detail } = splitSummary(count.summary);
                          return (
                            <div key={count.itemId} style={{
                              padding: '0.5rem',
                              backgroundColor: colors.bgLight,
                              borderRadius: '4px',
                              fontSize: '0.9rem'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: detail ? '0.15rem' : 0 }}>
                                <span style={{ color: colors.textPrimary, fontWeight: '500' }}>
                                  {count.itemName}
                                </span>
                                <span style={{ fontWeight: '700', color: colors.textPrimary, whiteSpace: 'nowrap' }}>
                                  {total}
                                </span>
                              </div>
                              {detail && <div style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{detail}</div>}
                              {renderCountMeta(count, item)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Kitchen items */}
                {(() => {
                  const kitchenCounted = Object.entries(viewingSession.counts || {})
                    .filter(([itemId]) => {
                      const item = allItems.find(i => i.id === itemId);
                      return item?.section === 'kitchen';
                    })
                    .map(([itemId, count]) => {
                      const item = allItems.find(i => i.id === itemId);
                      const unitInfo = item ? parseUnitInfo(item) : null;
                      return { itemId, ...count, summary: formatCountSummary(count, unitInfo) };
                    });

                  if (kitchenCounted.length === 0) return null;

                  return (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{
                        fontWeight: '600',
                        color: colors.textPrimary,
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Kitchen ({kitchenCounted.length} items)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {kitchenCounted.map(count => {
                          const item = allItems.find(i => i.id === count.itemId);
                          const { total, detail } = splitSummary(count.summary);
                          return (
                            <div key={count.itemId} style={{
                              padding: '0.5rem',
                              backgroundColor: colors.bgLight,
                              borderRadius: '4px',
                              fontSize: '0.9rem'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: detail ? '0.15rem' : 0 }}>
                                <span style={{ color: colors.textPrimary, fontWeight: '500' }}>
                                  {count.itemName}
                                </span>
                                <span style={{ fontWeight: '700', color: colors.textPrimary, whiteSpace: 'nowrap' }}>
                                  {total}
                                </span>
                              </div>
                              {detail && <div style={{ color: colors.textSecondary, fontSize: '0.8rem' }}>{detail}</div>}
                              {renderCountMeta(count, item)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Total */}
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: isDark ? '#2d4a3e' : '#e6fffa',
                  borderRadius: '4px',
                  marginBottom: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: '600'
                }}>
                  <span style={{ color: colors.textPrimary }}>Total Items Counted</span>
                  <span style={{ color: colors.textPrimary }}>{Object.keys(viewingSession.counts || {}).length}</span>
                </div>
              </>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '2rem',
                color: colors.textSecondary
              }}>
                No items were counted in this session
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                onClick={() => {
                  setSummarySession(viewingSession);
                  setShowSummary(true);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#4299e1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Summary
              </button>
              <button
                onClick={() => generateSessionPDF(viewingSession)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#38a169',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Download PDF
              </button>
            </div>

            {viewingSession.status === 'completed' && (
              <button
                onClick={() => handleReopenSession(viewingSession)}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  backgroundColor: '#ed8936',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Reopen Session
              </button>
            )}

            <button
              onClick={() => setViewingSession(null)}
              style={{
                width: '100%',
                marginTop: '0.5rem',
                padding: '0.75rem',
                backgroundColor: colors.bgLight,
                color: colors.textPrimary,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delete Session Confirmation Modal */}
      {deletingSession && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: '1.5rem',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '400px'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: colors.textPrimary }}>Delete Session?</h3>
            <p style={{ color: colors.textSecondary, marginBottom: '1rem' }}>
              Are you sure you want to delete the stock take from{' '}
              <strong>{formatSessionDate(deletingSession.createdAt)}</strong>?
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setDeletingSession(null)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: colors.bgLight,
                  color: colors.textPrimary,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteSession(deletingSession)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#e53e3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Add Item Modal */}
      {showAdminForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: '1.5rem',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '400px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ marginTop: 0, color: colors.textPrimary }}>Add Stock Item</h3>
            <form onSubmit={handleAdminFormSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', color: colors.textPrimary }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    backgroundColor: colors.bgCard,
                    color: colors.textPrimary
                  }}
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', color: colors.textPrimary }}>
                  Section
                </label>
                <select
                  value={formData.section}
                  onChange={(e) => setFormData({...formData, section: e.target.value})}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    backgroundColor: colors.bgCard,
                    color: colors.textPrimary
                  }}
                >
                  <option value="bar">Bar</option>
                  <option value="kitchen">Kitchen</option>
                </select>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', color: colors.textPrimary }}>
                  Opening quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.quantity}
                  onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    backgroundColor: colors.bgCard,
                    color: colors.textPrimary
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', color: colors.textPrimary }}>
                  How is it counted?
                </label>
                <UnitPicker
                  section={formData.section}
                  value={{ wholeUnit: formData.wholeUnit, partUnit: formData.partUnit }}
                  onChange={(next) => setFormData({ ...formData, wholeUnit: next.wholeUnit, partUnit: next.partUnit, unit: next.unit })}
                  colors={colors}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: '500', color: colors.textPrimary }}>
                  Unit Cost
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.unitCost}
                  onChange={(e) => setFormData({...formData, unitCost: e.target.value})}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    backgroundColor: colors.bgCard,
                    color: colors.textPrimary
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowAdminForm(false)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: colors.bgLight,
                    color: colors.textPrimary,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: colors.primary,
                    color: colors.onPrimary,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: toast.type === 'error' ? '#e53e3e' : '#4299e1',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '500',
            zIndex: 2000,
            maxWidth: '90%',
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            cursor: 'pointer'
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1002,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: '1.5rem',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '400px'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: colors.textPrimary }}>{confirmModal.title}</h3>
            <p style={{ color: colors.textSecondary, marginBottom: '1.5rem' }}>{confirmModal.message}</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setConfirmModal(null)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: colors.bgLight,
                  color: colors.textPrimary,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: confirmModal.confirmColor || '#e53e3e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                {confirmModal.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Count History Modal (admin only) */}
      {viewingHistory && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1003,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: colors.bgCard,
            padding: '1.5rem',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '450px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <h3 style={{ margin: 0, color: colors.textPrimary, fontSize: '1.1rem' }}>
                {viewingHistory.itemName}
              </h3>
              <button
                onClick={() => setViewingHistory(null)}
                style={{
                  padding: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: colors.textSecondary
                }}
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: '0.8rem', color: colors.textSecondary, marginBottom: '1rem' }}>
              {viewingHistory.history.length} count {viewingHistory.history.length === 1 ? 'entry' : 'entries'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {viewingHistory.history.map((entry, idx) => {
                const isLatest = idx === viewingHistory.history.length - 1;
                const isFirst = idx === 0;
                const summaryOf = (e) => viewingHistory.unitInfo
                  ? formatCountSummary(e, viewingHistory.unitInfo)
                  : `${e.quantity}`;
                const { total, detail } = splitSummary(summaryOf(entry));
                // How much this editor added or removed vs the previous entry.
                const delta = !isFirst
                  ? formatDelta(viewingHistory.history[idx - 1].quantity, entry.quantity, viewingHistory.unitInfo)
                  : null;
                const badge = isFirst ? 'Initial' : isLatest ? 'Current' : 'Update';
                return (
                  <div key={idx} style={{
                    padding: '0.75rem',
                    backgroundColor: isLatest ? (isDark ? '#2d4a3e' : '#f0fff4') : colors.bgLight,
                    borderRadius: '6px',
                    border: isLatest ? `1px solid ${isDark ? '#38a169' : '#9ae6b4'}` : 'none'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '700', color: colors.textPrimary }}>
                        {total}
                      </span>
                      <span style={{
                        fontSize: '0.7rem',
                        backgroundColor: isLatest ? '#38a169' : colors.textSecondary,
                        color: 'white',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '9999px'
                      }}>
                        {badge}
                      </span>
                    </div>
                    {detail && <div style={{ color: colors.textSecondary, fontSize: '0.8rem', marginTop: '0.15rem' }}>{detail}</div>}
                    {delta && (
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: '0.15rem', color: delta.positive ? '#38a169' : '#e53e3e' }}>
                        {delta.text}
                      </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: colors.textSecondary, marginTop: '0.25rem' }}>
                      {isFirst ? 'Counted by ' : 'Updated by '}{entry.countedBy || 'Unknown'} • {formatCountedAt(entry.countedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setViewingHistory(null)}
              style={{
                width: '100%',
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: colors.bgLight,
                color: colors.textPrimary,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StockTaking;

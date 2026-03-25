// ─── Shared Record Detail Hook ───
// Manages record detail panel + new record modal state.
// Used by Kanban, Calendar, CardGrid (views with modal-based record workflows).
// Table.jsx uses NewRecordModal directly (+ button) but manages its own detail panel for link features.

import { useState, useCallback, useRef } from "react";

/**
 * Shared state management for record detail panel + new record modal.
 *
 * @returns {{
 *   detailPage: object|null,
 *   openDetail: (page: object) => void,
 *   closeDetail: () => void,
 *   showNewModal: boolean,
 *   newModalPrefill: object,
 *   openNew: (prefill?: object) => void,
 *   closeNew: () => void,
 *   handleCardClick: (page: object, pageId: string) => void,
 * }}
 */
export function useRecordDetail() {
  const [detailPage, setDetailPage] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalPrefill, setNewModalPrefill] = useState({});
  const lastClickRef = useRef({ id: null, time: 0 });

  const openDetail = useCallback((page) => setDetailPage(page), []);
  const closeDetail = useCallback(() => setDetailPage(null), []);

  const openNew = useCallback((prefill = {}) => {
    setNewModalPrefill(prefill);
    setShowNewModal(true);
  }, []);

  const closeNew = useCallback(() => {
    setShowNewModal(false);
    setNewModalPrefill({});
  }, []);

  /**
   * Double-click-to-open pattern used by Kanban cards and CardGrid cards.
   * Two clicks within 1s on the same card opens the detail panel.
   */
  const handleCardClick = useCallback((page, pageId) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last.id === pageId && now - last.time < 1000) {
      setDetailPage(page);
      lastClickRef.current = { id: null, time: 0 };
    } else {
      lastClickRef.current = { id: pageId, time: now };
    }
  }, []);

  return {
    detailPage,
    openDetail,
    closeDetail,
    showNewModal,
    newModalPrefill,
    openNew,
    closeNew,
    handleCardClick,
  };
}

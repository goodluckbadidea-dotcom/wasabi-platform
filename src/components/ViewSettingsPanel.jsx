// ─── View Settings Panel ───
// Per-view configuration panel for color coding, visible properties, sort, card size, and bar labels.
// Shared across all view types — sections render conditionally based on viewType.
// Supports two modes:
//   1. Inline (Sushi Roll): changes apply immediately via onConfigChange
//   2. Unified (all views): buffered edits with Save/Reset, integrated with ColorMappingContext

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, VIEW_PALETTE, isLightColor } from "../design/tokens.js";
import { IconClose, IconGear } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";
import { DATE_TIERS, DATE_TIER_DEFAULTS } from "../zen/TaskList.jsx";
import PagePermissionsPanel from "./PagePermissionsPanel.jsx";

// ─── Section Header ───

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      color: C.darkMuted,
      padding: "12px 0 6px",
    }}>
      {children}
    </div>
  );
}

// ─── Color Swatch Row ───

function PalettePicker({ value, onChange, inheritedIdx }) {
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {VIEW_PALETTE.map((p, idx) => {
        const isActive = value === idx;
        const isInherited = inheritedIdx === idx && value === undefined;
        return (
          <button
            key={idx}
            onClick={() => onChange(idx)}
            title={p.key}
            style={{
              width: 20,
              height: 20,
              borderRadius: RADIUS.sm,
              background: p.hex,
              border: isActive
                ? "2px solid #fff"
                : isInherited
                  ? `2px dashed ${C.darkMuted}`
                  : "2px solid transparent",
              outline: isActive ? `2px solid ${C.accent}` : "none",
              cursor: "pointer",
              transition: "all 0.1s",
              flexShrink: 0,
              opacity: isInherited && !isActive ? 0.7 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Toggle Checkbox ───

function FieldToggle({ label, checked, onChange }) {
  return (
    <label style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 0",
      cursor: "pointer",
      fontSize: 12,
      color: C.darkText,
      fontFamily: FONT,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: C.accent }}
      />
      {label}
    </label>
  );
}

// ─── Toggle Button Pair ───

function ToggleButtons({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: value === opt.key ? 600 : 400,
            fontFamily: FONT,
            border: `1px solid ${value === opt.key ? C.accent : C.darkBorder}`,
            borderRadius: RADIUS.pill,
            background: value === opt.key ? C.accent + "22" : "transparent",
            color: value === opt.key ? C.accent : C.darkMuted,
            cursor: "pointer",
            transition: "all 0.12s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Styled Select ───

function StyledSelect({ value, onChange, children, placeholder }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      style={{
        width: "100%",
        padding: "6px 10px",
        fontSize: 12,
        fontFamily: FONT,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.pill,
        background: C.darkSurf2,
        color: C.darkText,
        cursor: "pointer",
        outline: "none",
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}

// ─── Field List Box ───

function FieldListBox({ children, maxHeight = 180 }) {
  return (
    <div style={{
      background: C.dark,
      borderRadius: RADIUS.lg,
      padding: "6px 12px",
      border: `1px solid ${C.edgeLine}`,
      maxHeight,
      overflowY: "auto",
    }}>
      {children}
    </div>
  );
}

// ─── Source Badge (inherited vs custom) ───

function SourceBadge({ source }) {
  if (!source) return null;
  const isInherited = source === "inherited";
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 500,
      padding: "1px 5px",
      borderRadius: RADIUS.sm,
      background: isInherited ? C.darkSurf2 : C.accent + "22",
      color: isInherited ? C.darkMuted : C.accent,
      marginLeft: 4,
      flexShrink: 0,
    }}>
      {isInherited ? "inherited" : "custom"}
    </span>
  );
}

// ─── Color Mapping Section (shared between modes) ───

function ColorMappingSection({
  colorableFields,
  colorField,
  colorOptions,
  colorMapping,
  globalColorMapping,
  onColorFieldChange,
  onColorMappingChange,
  isGantt,
  colorMode,
  onColorModeChange,
  showInheritedBadges,
}) {
  return (
    <>
      {/* Color Mode (Gantt only) */}
      {isGantt && (
        <>
          <SectionLabel>Color Mode</SectionLabel>
          <ToggleButtons
            options={[
              { key: "dateField", label: "By Date Field" },
              { key: "property", label: "By Property" },
            ]}
            value={colorMode}
            onChange={onColorModeChange}
          />
        </>
      )}

      {/* Color Source */}
      {colorableFields.length > 0 && (
        <>
          <SectionLabel>Color Source</SectionLabel>
          <StyledSelect
            value={colorField}
            onChange={onColorFieldChange}
            placeholder="Auto-detect"
          >
            {colorableFields.map((f) => (
              <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
            ))}
          </StyledSelect>
        </>
      )}

      {/* Color Mapping */}
      {colorOptions.length > 0 && (colorMode === "property" || !isGantt) && (
        <>
          <SectionLabel>Color Mapping</SectionLabel>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: C.dark,
            borderRadius: RADIUS.lg,
            padding: "10px 12px",
            border: `1px solid ${C.edgeLine}`,
          }}>
            {colorOptions.map((opt) => {
              const currentIdx = colorMapping[opt.name];
              const globalIdx = globalColorMapping?.[opt.name];
              const isCustom = currentIdx !== undefined;
              const displayIdx = isCustom ? currentIdx : globalIdx;
              return (
                <div key={opt.name}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: C.darkText,
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: displayIdx !== undefined
                        ? VIEW_PALETTE[displayIdx]?.hex || C.darkMuted
                        : C.darkMuted,
                      flexShrink: 0,
                    }} />
                    {opt.name}
                    {showInheritedBadges && (
                      <SourceBadge source={isCustom ? "custom" : (globalIdx !== undefined ? "inherited" : null)} />
                    )}
                  </div>
                  <PalettePicker
                    value={currentIdx}
                    onChange={(idx) => onColorMappingChange(opt.name, idx)}
                    inheritedIdx={showInheritedBadges ? globalIdx : undefined}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

// ─── Main Panel ───

export default function ViewSettingsPanel({
  viewConfig,          // { type, label, config }
  schema,              // classified schema from PageShell
  onConfigChange,      // (configUpdates) => void — inline mode
  onClose,
  // Unified color mapping props (optional — when present, enables Save/Reset mode)
  viewKey,             // string — unique key for this view in ColorMappingContext
  globalColorMapping,  // object — global default color mappings
  globalColorField,    // string — global default color field
  viewColorConfig,     // { colorField, colorMapping, dateChipColors } — current view-level overrides
  onSave,              // ({ colorField, colorMapping, dateChipColors }) => void — commit buffered changes
  onReset,             // () => void — clear view overrides
  // Multi-database sections (Tasks view)
  databaseSections,    // [{ dbId, dbName, schema, viewColorConfig }] — per-database configs
  onSaveSection,       // (dbId, { colorField, colorMapping }) => void
  onResetSection,      // (dbId) => void
  // Page-level settings (PIN protection)
  pageConfig,          // optional — page config for PIN toggle
  identity,            // optional — current user identity for admin check
  onUpdatePageConfig,  // optional — (pageId, updates) => void
}) {
  const isUnifiedMode = !!viewKey || !!databaseSections;

  const viewType = viewConfig?.type;
  const config = viewConfig?.config || {};
  const isGantt = viewType === "gantt";
  const isCardGrid = viewType === "cardGrid";
  const isKanban = viewType === "kanban";
  const isTable = viewType === "table";
  const showVisibleProps = (isCardGrid || isKanban || isTable) && !isUnifiedMode;
  const showViewSettings = !isUnifiedMode;

  // ─── Unified mode: buffered state ───
  const [draftColorField, setDraftColorField] = useState(
    viewColorConfig?.colorField ?? null
  );
  const [draftColorMapping, setDraftColorMapping] = useState(
    viewColorConfig?.colorMapping || {}
  );
  const [draftDateChipColors, setDraftDateChipColors] = useState(
    viewColorConfig?.dateChipColors || {}
  );
  const [draftDirty, setDraftDirty] = useState(false);

  const isTasksView = viewConfig?.type === "tasks";

  // Per-database drafts for Tasks view
  const [sectionDrafts, setSectionDrafts] = useState(() => {
    if (!databaseSections) return {};
    const drafts = {};
    for (const sec of databaseSections) {
      drafts[sec.dbId] = {
        colorField: sec.viewColorConfig?.colorField ?? null,
        colorMapping: sec.viewColorConfig?.colorMapping || {},
        dirty: false,
      };
    }
    return drafts;
  });

  // ─── Inline mode: collect fields from schema ───
  const colorableFields = useMemo(() => {
    if (!schema) return [];
    const fields = [];
    for (const f of (schema.statuses || [])) fields.push(f);
    for (const f of (schema.selects || [])) fields.push(f);
    for (const f of (schema.multiSelects || [])) fields.push(f);
    return fields;
  }, [schema]);

  const allFields = useMemo(() => {
    if (!schema) return [];
    return (schema.allFields || []).filter(
      (f) => f.type !== "relation" && f.type !== "rollup" && f.type !== "files" && f.type !== "created_by" && f.type !== "last_edited_by"
    );
  }, [schema]);

  const sortableFields = allFields;

  const colorField = config.colorField || null;
  const effectiveColorField = colorField || (colorableFields[0]?.name || null);
  const colorFieldSchema = colorableFields.find((f) => f.name === effectiveColorField);
  const colorOptions = colorFieldSchema?.options || [];

  const dateFieldNames = useMemo(() => {
    if (!schema) return [];
    return (schema.dates || []).map((f) => f.name);
  }, [schema]);

  const colorMode = config.colorMode || "dateField";
  const colorMapping = config.colorMapping || {};
  const sidebarFields = config.sidebarFields || [];
  const barFields = config.barFields || [];
  const visibleFields = config.visibleFields || [];
  const dateFields = config.dateFields || [];
  const sortField = config.sortField || null;
  const sortDir = config.sortDir || "asc";
  const cardSize = config.cardSize || "standard";

  // ─── Inline mode handlers ───

  const handleColorFieldChange = useCallback((fieldName) => {
    onConfigChange?.({ colorField: fieldName, colorMapping: {} });
  }, [onConfigChange]);

  const handleColorModeChange = useCallback((mode) => {
    onConfigChange?.({ colorMode: mode });
  }, [onConfigChange]);

  const handleColorMappingChange = useCallback((optionName, paletteIdx) => {
    onConfigChange?.({
      colorMapping: { ...colorMapping, [optionName]: paletteIdx },
    });
  }, [onConfigChange, colorMapping]);

  const toggleSidebarField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...sidebarFields.filter((f) => f !== fieldName), fieldName]
      : sidebarFields.filter((f) => f !== fieldName);
    onConfigChange?.({ sidebarFields: updated });
  }, [onConfigChange, sidebarFields]);

  const toggleBarField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...barFields.filter((f) => f !== fieldName), fieldName]
      : barFields.filter((f) => f !== fieldName);
    onConfigChange?.({ barFields: updated });
  }, [onConfigChange, barFields]);

  const toggleVisibleField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...visibleFields.filter((f) => f !== fieldName), fieldName]
      : visibleFields.filter((f) => f !== fieldName);
    onConfigChange?.({ visibleFields: updated });
  }, [onConfigChange, visibleFields]);

  const toggleDateField = useCallback((fieldName, checked) => {
    const base = dateFields.length > 0 ? dateFields : dateFieldNames;
    const updated = checked
      ? [...base.filter((f) => f !== fieldName), fieldName]
      : base.filter((f) => f !== fieldName);
    onConfigChange?.({ dateFields: updated });
  }, [onConfigChange, dateFields, dateFieldNames]);

  const handleSortFieldChange = useCallback((field) => {
    onConfigChange?.({ sortField: field });
  }, [onConfigChange]);

  const handleSortDirChange = useCallback((dir) => {
    onConfigChange?.({ sortDir: dir });
  }, [onConfigChange]);

  const handleCardSizeChange = useCallback((size) => {
    onConfigChange?.({ cardSize: size });
  }, [onConfigChange]);

  // ─── Unified mode handlers ───

  const handleDraftColorFieldChange = useCallback((fieldName) => {
    setDraftColorField(fieldName);
    setDraftColorMapping({});
    setDraftDirty(true);
  }, []);

  const handleDraftColorMappingChange = useCallback((optionName, paletteIdx) => {
    setDraftColorMapping((prev) => ({ ...prev, [optionName]: paletteIdx }));
    setDraftDirty(true);
  }, []);

  const handleDraftDateChipChange = useCallback((tier, paletteIdx) => {
    setDraftDateChipColors((prev) => ({ ...prev, [tier]: paletteIdx }));
    setDraftDirty(true);
  }, []);

  const handleSaveUnified = useCallback(() => {
    const updates = { colorField: draftColorField, colorMapping: draftColorMapping };
    if (isTasksView) updates.dateChipColors = draftDateChipColors;
    onSave?.(updates);
    setDraftDirty(false);
  }, [onSave, draftColorField, draftColorMapping, draftDateChipColors, isTasksView]);

  const handleResetUnified = useCallback(() => {
    onReset?.();
    setDraftColorField(null);
    setDraftColorMapping({});
    setDraftDateChipColors({});
    setDraftDirty(false);
  }, [onReset]);

  // Per-database section handlers
  const handleSectionColorFieldChange = useCallback((dbId, fieldName) => {
    setSectionDrafts((prev) => ({
      ...prev,
      [dbId]: { colorField: fieldName, colorMapping: {}, dirty: true },
    }));
  }, []);

  const handleSectionColorMappingChange = useCallback((dbId, optionName, paletteIdx) => {
    setSectionDrafts((prev) => ({
      ...prev,
      [dbId]: {
        ...prev[dbId],
        colorMapping: { ...(prev[dbId]?.colorMapping || {}), [optionName]: paletteIdx },
        dirty: true,
      },
    }));
  }, []);

  const handleSaveSection = useCallback((dbId) => {
    const draft = sectionDrafts[dbId];
    if (draft) {
      onSaveSection?.(dbId, { colorField: draft.colorField, colorMapping: draft.colorMapping });
      setSectionDrafts((prev) => ({ ...prev, [dbId]: { ...prev[dbId], dirty: false } }));
    }
  }, [sectionDrafts, onSaveSection]);

  const handleResetSection = useCallback((dbId) => {
    onResetSection?.(dbId);
    setSectionDrafts((prev) => ({
      ...prev,
      [dbId]: { colorField: null, colorMapping: {}, dirty: false },
    }));
  }, [onResetSection]);

  const anySectionDirty = Object.values(sectionDrafts).some((d) => d.dirty);

  // ─── Unified mode: resolve color options from draft state ───
  const unifiedColorableFields = useMemo(() => {
    if (!isUnifiedMode || !schema) return [];
    const fields = [];
    for (const f of (schema.statuses || [])) fields.push(f);
    for (const f of (schema.selects || [])) fields.push(f);
    for (const f of (schema.multiSelects || [])) fields.push(f);
    return fields;
  }, [isUnifiedMode, schema]);

  const unifiedEffectiveField = draftColorField || globalColorField || (unifiedColorableFields[0]?.name || null);
  const unifiedFieldSchema = unifiedColorableFields.find((f) => f.name === unifiedEffectiveField);
  const unifiedColorOptions = unifiedFieldSchema?.options || [];

  // ─── Render helper: Save/Reset footer ───
  function renderFooter(isDirty, onSaveClick, onResetClick) {
    return (
      <div style={{
        padding: "12px 16px",
        borderTop: `1px solid ${C.edgeLine}`,
        display: "flex",
        gap: 8,
        flexShrink: 0,
      }}>
        <button
          onClick={onResetClick}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: FONT,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            background: "transparent",
            color: C.darkMuted,
            cursor: "pointer",
          }}
        >
          Reset to Default
        </button>
        <button
          onClick={onSaveClick}
          disabled={!isDirty}
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT,
            border: "none",
            borderRadius: RADIUS.pill,
            background: isDirty ? C.accent : C.darkSurf2,
            color: isDirty ? "#fff" : C.darkMuted,
            cursor: isDirty ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 199,
          animation: ANIM.backdropFade,
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: C.darkSurf,
        borderLeft: `1px solid ${C.edgeLine}`,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        boxShadow: SHADOW.dropdown,
        fontFamily: FONT,
        animation: ANIM.snapInRight(),
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${C.edgeLine}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconGear size={14} color={C.accent} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.darkText }}>
              View Settings
            </span>
            <span style={{ fontSize: 10, color: C.darkMuted, fontWeight: 400 }}>
              {viewConfig?.label || viewType || viewKey}
            </span>
          </div>
          <button
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
            onClick={onClose}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 24px" }}>

          {/* ═══ PIN Protection Toggle (admin-only, or single-user mode) ═══ */}
          {pageConfig && (!identity || identity.role === "admin") && onUpdatePageConfig && (
            <div style={{ marginBottom: 16 }}>
              <SectionLabel>Protection</SectionLabel>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 0",
              }}>
                <div>
                  <div style={{ fontSize: 12, color: C.darkText, fontWeight: 500 }}>PIN Lock</div>
                  <div style={{ fontSize: 10, color: C.darkMuted }}>Editors must enter PIN to edit this page</div>
                </div>
                <button
                  onClick={() => onUpdatePageConfig(pageConfig.id, { pin_protected: !pageConfig.pin_protected })}
                  style={{
                    width: 38, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                    background: pageConfig.pin_protected ? C.accent : C.darkBorder,
                    position: "relative", transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, background: "#fff",
                    position: "absolute", top: 2,
                    left: pageConfig.pin_protected ? 20 : 2,
                    transition: "left 0.2s",
                  }} />
                </button>
              </div>

              {/* Page Permissions */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: C.darkText, fontWeight: 500, marginBottom: 6 }}>Page Access</div>
                <div style={{ fontSize: 10, color: C.darkMuted, marginBottom: 8 }}>Control who can view and edit this page</div>
                <PagePermissionsPanel pageId={pageConfig.id} />
              </div>
            </div>
          )}

          {/* ═══ Multi-database sections (Tasks view) ═══ */}
          {databaseSections && databaseSections.map((sec) => {
            const secColorableFields = (() => {
              if (!sec.schema) return [];
              const fields = [];
              for (const f of (sec.schema.statuses || [])) fields.push(f);
              for (const f of (sec.schema.selects || [])) fields.push(f);
              for (const f of (sec.schema.multiSelects || [])) fields.push(f);
              return fields;
            })();
            const draft = sectionDrafts[sec.dbId] || { colorField: null, colorMapping: {} };
            const effField = draft.colorField || globalColorField || (secColorableFields[0]?.name || null);
            const fieldSchema = secColorableFields.find((f) => f.name === effField);
            const secColorOptions = fieldSchema?.options || [];

            return (
              <div key={sec.dbId} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.accent,
                  padding: "8px 0 4px",
                  borderBottom: `1px solid ${C.edgeLine}`,
                  marginBottom: 4,
                }}>
                  {sec.dbName}
                </div>
                <ColorMappingSection
                  colorableFields={secColorableFields}
                  colorField={draft.colorField}
                  colorOptions={secColorOptions}
                  colorMapping={draft.colorMapping}
                  globalColorMapping={globalColorMapping}
                  onColorFieldChange={(f) => handleSectionColorFieldChange(sec.dbId, f)}
                  onColorMappingChange={(opt, idx) => handleSectionColorMappingChange(sec.dbId, opt, idx)}
                  isGantt={false}
                  colorMode="property"
                  onColorModeChange={() => {}}
                  showInheritedBadges={true}
                />
                {draft.dirty && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => handleResetSection(sec.dbId)}
                      style={{
                        flex: 1, padding: "6px 8px", fontSize: 11, fontFamily: FONT,
                        border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
                        background: "transparent", color: C.darkMuted, cursor: "pointer",
                      }}
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => handleSaveSection(sec.dbId)}
                      style={{
                        flex: 1, padding: "6px 8px", fontSize: 11, fontWeight: 600, fontFamily: FONT,
                        border: "none", borderRadius: RADIUS.pill,
                        background: C.accent, color: "#fff", cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* ═══ Single-database unified mode ═══ */}
          {isUnifiedMode && !databaseSections && (
            <ColorMappingSection
              colorableFields={unifiedColorableFields}
              colorField={draftColorField}
              colorOptions={unifiedColorOptions}
              colorMapping={draftColorMapping}
              globalColorMapping={globalColorMapping}
              onColorFieldChange={handleDraftColorFieldChange}
              onColorMappingChange={handleDraftColorMappingChange}
              isGantt={isGantt}
              colorMode={colorMode}
              onColorModeChange={handleColorModeChange}
              showInheritedBadges={true}
            />
          )}

          {/* ═══ Date Chip Colors (Tasks view only) ═══ */}
          {isUnifiedMode && isTasksView && (
            <>
              <SectionLabel>Date Chip Colors</SectionLabel>
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: C.dark,
                borderRadius: RADIUS.lg,
                padding: "10px 12px",
                border: `1px solid ${C.edgeLine}`,
              }}>
                {DATE_TIERS.map((tier) => {
                  const currentIdx = draftDateChipColors[tier];
                  const defaultIdx = DATE_TIER_DEFAULTS[tier];
                  const displayIdx = currentIdx ?? defaultIdx;
                  const entry = VIEW_PALETTE[displayIdx] || VIEW_PALETTE[0];
                  return (
                    <div key={tier}>
                      <div style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: C.darkText,
                        marginBottom: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: RADIUS.pill,
                          background: entry.hex,
                          color: isLightColor(entry.hex) ? "#1a1a1a" : "#fff",
                          flexShrink: 0,
                        }}>
                          {tier}
                        </span>
                        {currentIdx !== undefined && (
                          <SourceBadge source="custom" />
                        )}
                      </div>
                      <PalettePicker
                        value={currentIdx}
                        onChange={(idx) => handleDraftDateChipChange(tier, idx)}
                        inheritedIdx={defaultIdx}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ═══ Inline mode (Sushi Roll) ═══ */}
          {!isUnifiedMode && (
            <>
              {/* Owner Column Toggle (table views only) */}
              {isTable && (
                <>
                  <SectionLabel>Owner Column</SectionLabel>
                  <FieldToggle
                    label="Show Owner column"
                    checked={!!config.showOwnerColumn}
                    onChange={(checked) => onConfigChange?.({ showOwnerColumn: checked })}
                  />
                  <p style={{ fontSize: 10, color: C.darkMuted, margin: "2px 0 0" }}>
                    Adds an assignable Owner field after the title column.
                  </p>
                </>
              )}

              {/* Visible Properties */}
              {showVisibleProps && allFields.length > 0 && (
                <>
                  <SectionLabel>Visible Properties</SectionLabel>
                  <p style={{ fontSize: 10, color: C.darkMuted, margin: "0 0 6px" }}>
                    Choose which fields appear on cards/rows. Empty = auto-detect.
                  </p>
                  <FieldListBox maxHeight={200}>
                    {allFields.map((f) => (
                      <FieldToggle
                        key={f.name}
                        label={`${f.name} (${f.type})`}
                        checked={visibleFields.includes(f.name)}
                        onChange={(checked) => toggleVisibleField(f.name, checked)}
                      />
                    ))}
                  </FieldListBox>
                </>
              )}

              {/* Sort */}
              {sortableFields.length > 0 && (
                <>
                  <SectionLabel>Sort</SectionLabel>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 2 }}>
                      <StyledSelect
                        value={sortField}
                        onChange={handleSortFieldChange}
                        placeholder="No sort"
                      >
                        {sortableFields.map((f) => (
                          <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                      </StyledSelect>
                    </div>
                    <div style={{ flex: 1 }}>
                      <ToggleButtons
                        options={[
                          { key: "asc", label: "A-Z" },
                          { key: "desc", label: "Z-A" },
                        ]}
                        value={sortDir}
                        onChange={handleSortDirChange}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Group By (Kanban only) */}
              {isKanban && colorableFields.length > 0 && (
                <>
                  <SectionLabel>Group By</SectionLabel>
                  <StyledSelect
                    value={config.columnField || ""}
                    onChange={(fieldName) => onConfigChange?.({ columnField: fieldName })}
                    placeholder="Auto-detect"
                  >
                    {colorableFields.map((f) => (
                      <option key={f.name} value={f.name}>{f.name}</option>
                    ))}
                  </StyledSelect>
                </>
              )}

              {/* Card Size */}
              {isCardGrid && (
                <>
                  <SectionLabel>Card Size</SectionLabel>
                  <ToggleButtons
                    options={[
                      { key: "compact", label: "Compact" },
                      { key: "standard", label: "Standard" },
                    ]}
                    value={cardSize}
                    onChange={handleCardSizeChange}
                  />
                </>
              )}

              {/* Timeline Fields */}
              {isGantt && dateFieldNames.length > 0 && (
                <>
                  <SectionLabel>Timeline Fields</SectionLabel>
                  <p style={{ fontSize: 10, color: C.darkMuted, margin: "0 0 6px" }}>
                    Date properties shown as bars in the timeline.
                  </p>
                  <FieldListBox>
                    {dateFieldNames.map((fname) => {
                      const isChecked = dateFields.length === 0 ? true : dateFields.includes(fname);
                      return (
                        <FieldToggle
                          key={fname}
                          label={fname}
                          checked={isChecked}
                          onChange={(checked) => toggleDateField(fname, checked)}
                        />
                      );
                    })}
                  </FieldListBox>
                </>
              )}

              {/* Color sections (inline) */}
              <ColorMappingSection
                colorableFields={colorableFields}
                colorField={colorField}
                colorOptions={colorOptions}
                colorMapping={colorMapping}
                globalColorMapping={null}
                onColorFieldChange={handleColorFieldChange}
                onColorMappingChange={handleColorMappingChange}
                isGantt={isGantt}
                colorMode={colorMode}
                onColorModeChange={handleColorModeChange}
                showInheritedBadges={false}
              />

              {/* Sidebar Fields */}
              {isGantt && allFields.length > 0 && (
                <>
                  <SectionLabel>Sidebar Badges</SectionLabel>
                  <FieldListBox>
                    {allFields.map((f) => (
                      <FieldToggle
                        key={f.name}
                        label={f.name}
                        checked={sidebarFields.includes(f.name)}
                        onChange={(checked) => toggleSidebarField(f.name, checked)}
                      />
                    ))}
                  </FieldListBox>
                </>
              )}

              {/* Bar Fields */}
              {isGantt && allFields.length > 0 && (
                <>
                  <SectionLabel>Bar Labels</SectionLabel>
                  <p style={{ fontSize: 10, color: C.darkMuted, margin: "0 0 6px" }}>
                    Properties shown as text inside Gantt bars. Bars resize vertically to fit.
                  </p>
                  <FieldListBox>
                    {allFields.map((f) => (
                      <FieldToggle
                        key={f.name}
                        label={f.name}
                        checked={barFields.includes(f.name)}
                        onChange={(checked) => toggleBarField(f.name, checked)}
                      />
                    ))}
                  </FieldListBox>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer with Save/Reset (unified mode only) */}
        {isUnifiedMode && !databaseSections && renderFooter(draftDirty, handleSaveUnified, handleResetUnified)}
      </div>
    </>
  );
}

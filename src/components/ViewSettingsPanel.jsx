// ─── View Settings Panel ───
// Per-view configuration panel for color coding, visible properties, sort, card size, and bar labels.
// Shared across all view types — sections render conditionally based on viewType.

import React, { useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW, VIEW_PALETTE } from "../design/tokens.js";
import { IconClose, IconGear } from "../design/icons.jsx";

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

function PalettePicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {VIEW_PALETTE.map((p, idx) => {
        const isActive = value === idx;
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
              border: isActive ? "2px solid #fff" : "2px solid transparent",
              outline: isActive ? `2px solid ${C.accent}` : "none",
              cursor: "pointer",
              transition: "all 0.1s",
              flexShrink: 0,
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
            borderRadius: RADIUS.md,
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
        borderRadius: RADIUS.md,
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

// ─── Main Panel ───

export default function ViewSettingsPanel({
  viewConfig,      // { type, label, config }
  schema,          // classified schema from PageShell
  onConfigChange,  // (configUpdates) => void
  onClose,
}) {
  const viewType = viewConfig?.type;
  const config = viewConfig?.config || {};
  const isGantt = viewType === "gantt";
  const isCardGrid = viewType === "cardGrid";
  const isKanban = viewType === "kanban";
  const isTable = viewType === "table";
  const showVisibleProps = isCardGrid || isKanban || isTable;

  // Collect select/status/multi_select fields for color source dropdown
  const colorableFields = useMemo(() => {
    if (!schema) return [];
    const fields = [];
    for (const f of (schema.statuses || [])) fields.push(f);
    for (const f of (schema.selects || [])) fields.push(f);
    for (const f of (schema.multiSelects || [])) fields.push(f);
    return fields;
  }, [schema]);

  // Collect all displayable fields
  const allFields = useMemo(() => {
    if (!schema) return [];
    return (schema.allFields || []).filter(
      (f) => f.type !== "relation" && f.type !== "rollup" && f.type !== "files" && f.type !== "created_by" && f.type !== "last_edited_by"
    );
  }, [schema]);

  // Sortable fields (all fields)
  const sortableFields = allFields;

  // Current color field's options
  const colorField = config.colorField || null;
  const colorFieldSchema = colorableFields.find((f) => f.name === colorField);
  const colorOptions = colorFieldSchema?.options || [];

  // Current config values
  const colorMode = config.colorMode || "dateField";
  const colorMapping = config.colorMapping || {};
  const sidebarFields = config.sidebarFields || [];
  const barFields = config.barFields || [];
  const visibleFields = config.visibleFields || [];
  const sortField = config.sortField || null;
  const sortDir = config.sortDir || "asc";
  const cardSize = config.cardSize || "standard";

  // ─── Handlers ───

  const handleColorFieldChange = useCallback((fieldName) => {
    onConfigChange({ colorField: fieldName, colorMapping: {} });
  }, [onConfigChange]);

  const handleColorModeChange = useCallback((mode) => {
    onConfigChange({ colorMode: mode });
  }, [onConfigChange]);

  const handleColorMappingChange = useCallback((optionName, paletteIdx) => {
    onConfigChange({
      colorMapping: { ...colorMapping, [optionName]: paletteIdx },
    });
  }, [onConfigChange, colorMapping]);

  const toggleSidebarField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...sidebarFields.filter((f) => f !== fieldName), fieldName]
      : sidebarFields.filter((f) => f !== fieldName);
    onConfigChange({ sidebarFields: updated });
  }, [onConfigChange, sidebarFields]);

  const toggleBarField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...barFields.filter((f) => f !== fieldName), fieldName]
      : barFields.filter((f) => f !== fieldName);
    onConfigChange({ barFields: updated });
  }, [onConfigChange, barFields]);

  const toggleVisibleField = useCallback((fieldName, checked) => {
    const updated = checked
      ? [...visibleFields.filter((f) => f !== fieldName), fieldName]
      : visibleFields.filter((f) => f !== fieldName);
    onConfigChange({ visibleFields: updated });
  }, [onConfigChange, visibleFields]);

  const handleSortFieldChange = useCallback((field) => {
    onConfigChange({ sortField: field });
  }, [onConfigChange]);

  const handleSortDirChange = useCallback((dir) => {
    onConfigChange({ sortDir: dir });
  }, [onConfigChange]);

  const handleCardSizeChange = useCallback((size) => {
    onConfigChange({ cardSize: size });
  }, [onConfigChange]);

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
              {viewConfig?.label || viewType}
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

          {/* ─── Visible Properties (CardGrid, Kanban, Table) ─── */}
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

          {/* ─── Sort (all views) ─── */}
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

          {/* ─── Card Size (CardGrid only) ─── */}
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

          {/* ─── Color Mode (Gantt only) ─── */}
          {isGantt && (
            <>
              <SectionLabel>Color Mode</SectionLabel>
              <ToggleButtons
                options={[
                  { key: "dateField", label: "By Date Field" },
                  { key: "property", label: "By Property" },
                ]}
                value={colorMode}
                onChange={handleColorModeChange}
              />
            </>
          )}

          {/* ─── Color Source ─── */}
          {colorableFields.length > 0 && (
            <>
              <SectionLabel>Color Source</SectionLabel>
              <StyledSelect
                value={colorField}
                onChange={handleColorFieldChange}
                placeholder="Auto-detect"
              >
                {colorableFields.map((f) => (
                  <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                ))}
              </StyledSelect>
            </>
          )}

          {/* ─── Color Mapping ─── */}
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
                        {/* Current color dot */}
                        <span style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: currentIdx !== undefined
                            ? VIEW_PALETTE[currentIdx].hex
                            : C.darkMuted,
                          flexShrink: 0,
                        }} />
                        {opt.name}
                      </div>
                      <PalettePicker
                        value={currentIdx}
                        onChange={(idx) => handleColorMappingChange(opt.name, idx)}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ─── Sidebar Fields (Gantt only) ─── */}
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

          {/* ─── Bar Fields (Gantt only) ─── */}
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
        </div>
      </div>
    </>
  );
}

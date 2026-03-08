// ─── Folder Dropdown ───
// Sidebar-top dropdown for folder navigation + global dashboard.
// Replaces the old TopHeader center dropdown and Navigation breadcrumb.
// Shows: Dashboard, folder tree (max 3 levels, with color dots), + Create New Folder.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, VIEW_PALETTE } from "../design/tokens.js";
import { IconPlus, IconFolder, IconChevronDown, IconStar } from "../design/icons.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";

// ── Folder color helper ──
function getFolderColor(folder) {
  const idx = folder.colorIndex ?? 0;
  return VIEW_PALETTE[idx % VIEW_PALETTE.length];
}

// ── Check if folder or children contain the active folder ──
function containsActiveFolder(folder, activeFolderId) {
  if (folder.id === activeFolderId) return true;
  return (folder.childFolders || []).some((cf) => containsActiveFolder(cf, activeFolderId));
}

// ── Recursive folder tree renderer ──
function FolderTreeItem({ folder, depth, activeFolder, activePage, onSelect, onRename, onDelete, collapsed }) {
  const isActive = activeFolder === folder.id;
  const color = getFolderColor(folder);
  const indent = depth * 18;
  const hasChildren = (folder.childFolders || []).length > 0;
  const [editing, setEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(folder.name || "");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const editRef = React.useRef(null);
  const clickTimer = React.useRef(null);
  const menuRef = React.useRef(null);

  // Auto-expand if this branch contains the active folder
  const [expanded, setExpanded] = React.useState(
    () => hasChildren && containsActiveFolder(folder, activeFolder)
  );

  // Re-expand when active folder changes into this subtree
  React.useEffect(() => {
    if (hasChildren && containsActiveFolder(folder, activeFolder)) {
      setExpanded(true);
    }
  }, [activeFolder, folder, hasChildren]);

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name && onRename) {
      onRename(folder.id, trimmed);
    }
    setEditing(false);
  };

  // Close menu on outside click
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <>
      <div
        style={{ display: "flex", alignItems: "center", position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Expand/collapse chevron (only if has child folders) */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              outline: "none",
              padding: "0 0 0 " + (8 + indent) + "px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <IconChevronDown
              size={8}
              color={C.darkMuted}
              style={{
                transition: "transform 0.15s",
                transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
              }}
            />
          </button>
        ) : (
          <div style={{ width: 8 + indent + 8, flexShrink: 0 }} />
        )}

        <button
          onClick={(e) => {
            if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
              e.preventDefault();
              e.stopPropagation();
              dispatchNeuronSelect({ node_type: "folder", node_id: folder.id, node_label: folder.name || "Untitled Folder" });
              return;
            }
            if (clickTimer.current) {
              clearTimeout(clickTimer.current);
              clickTimer.current = null;
              return;
            }
            clickTimer.current = setTimeout(() => {
              clickTimer.current = null;
              onSelect(folder.id);
            }, 250);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (clickTimer.current) {
              clearTimeout(clickTimer.current);
              clickTimer.current = null;
            }
            setEditName(folder.name || "");
            setEditing(true);
          }}
          style={{
            flex: 1,
            border: "none",
            cursor: "pointer",
            outline: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 16px 7px 4px",
            textAlign: "left",
            background: isActive ? C.accent + "22" : "transparent",
            transition: "background 0.1s",
            fontFamily: FONT,
          }}
          onMouseEnter={(e) => {
            if (!isActive) e.currentTarget.style.background = C.darkSurf2;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isActive ? C.accent + "22" : "transparent";
          }}
        >
          {/* Color dot */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color.hex,
              flexShrink: 0,
            }}
          />
          {editing ? (
            <input
              ref={editRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                color: C.darkText,
                background: C.dark,
                border: `1px solid ${C.accent}`,
                borderRadius: RADIUS.sm,
                padding: "1px 6px",
                outline: "none",
                fontFamily: FONT,
                minWidth: 0,
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.accent : C.darkText,
                letterSpacing: "0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
            >
              {folder.name || "Untitled"}
            </span>
          )}
          {/* Page count badge */}
          {!collapsed && !editing && !hovered && (
            <span style={{ fontSize: 10, color: C.darkBorder, flexShrink: 0 }}>
              {folder.children?.filter((c) => c.type !== "folder").length || 0}
            </span>
          )}
        </button>

        {/* Three-dot menu button (visible on hover) */}
        {hovered && !editing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              outline: "none",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              opacity: 0.6,
              transition: "opacity 0.1s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.6; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="2" cy="6" r="1.2" fill={C.darkMuted} />
              <circle cx="6" cy="6" r="1.2" fill={C.darkMuted} />
              <circle cx="10" cy="6" r="1.2" fill={C.darkMuted} />
            </svg>
          </button>
        )}

        {/* Folder action menu */}
        {menuOpen && (
          <div
            ref={menuRef}
            style={{
              position: "absolute",
              top: "100%",
              right: 4,
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.lg,
              boxShadow: SHADOW.dropdown,
              zIndex: 400,
              minWidth: 120,
              padding: "4px 0",
              marginTop: 2,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setEditName(folder.name || "");
                setEditing(true);
              }}
              style={{
                width: "100%",
                border: "none",
                cursor: "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                background: "transparent",
                fontFamily: FONT,
                fontSize: 12,
                color: C.darkText,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete?.(folder);
              }}
              style={{
                width: "100%",
                border: "none",
                cursor: "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                background: "transparent",
                fontFamily: FONT,
                fontSize: 12,
                color: "#E05252",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {/* Nested child folders (expanded) */}
      {expanded && (folder.childFolders || []).map((child) => (
        <FolderTreeItem
          key={child.id}
          folder={child}
          depth={depth + 1}
          activeFolder={activeFolder}
          activePage={activePage}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          collapsed={collapsed}
        />
      ))}
    </>
  );
}

// ── Find folder at any depth in tree ──
function findFolderInTree(tree, folderId) {
  for (const folder of tree) {
    if (folder.id === folderId) return folder;
    const found = findFolderInTree(folder.childFolders || [], folderId);
    if (found) return found;
  }
  return null;
}

export default function FolderDropdown({
  activeFolder,
  activePage,
  onSelectFolder,
  onSelectDashboard,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  pageTree,
  collapsed,
  onExpandSidebar,
}) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef(null);
  const dropRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        pillRef.current && !pillRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Determine pill label — search at any depth
  const isDashboard = activePage === "dashboard";
  const activeObj = activeFolder
    ? findFolderInTree(pageTree, activeFolder)
    : null;
  const pillLabel = isDashboard
    ? "Dashboard"
    : activeObj
    ? activeObj.name
    : "Select Folder";

  const pillColor = activeObj ? getFolderColor(activeObj) : null;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {/* ── Pill button ── */}
      <button
        ref={pillRef}
        onClick={() => {
          if (collapsed && onExpandSidebar) {
            onExpandSidebar();
          } else {
            setOpen((o) => !o);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: collapsed ? 0 : 8,
          width: "100%",
          background: open ? C.darkSurf2 : "transparent",
          border: "none",
          borderBottom: `1px solid ${C.darkBorder}`,
          padding: collapsed ? "12px 0" : "12px 14px",
          cursor: "pointer",
          outline: "none",
          fontFamily: FONT,
          transition: "background 0.12s",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = C.darkSurf2;
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Icon: dashboard star or folder color dot */}
        {isDashboard ? (
          <IconStar size={collapsed ? 16 : 12} color={C.accent} />
        ) : pillColor ? (
          <div
            style={{
              width: collapsed ? 10 : 8,
              height: collapsed ? 10 : 8,
              borderRadius: "50%",
              background: pillColor.hex,
              flexShrink: 0,
            }}
          />
        ) : (
          <IconFolder size={collapsed ? 14 : 12} color={C.darkMuted} />
        )}

        {/* Label + chevron (hidden when collapsed) */}
        {!collapsed && (
          <>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: C.darkText,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                textAlign: "left",
              }}
            >
              {pillLabel}
            </span>
            <IconChevronDown
              size={10}
              color={C.darkMuted}
              style={{
                transition: "transform 0.15s",
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                flexShrink: 0,
              }}
            />
          </>
        )}
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 299 }}
          />
          <div
            ref={dropRef}
            style={{
              position: "absolute",
              top: "100%",
              left: collapsed ? 0 : 8,
              right: collapsed ? "auto" : 8,
              minWidth: collapsed ? 220 : undefined,
              background: C.darkSurf2,
              borderRadius: 12,
              border: `1px solid ${C.darkBorder}`,
              boxShadow: SHADOW.dropdown,
              overflow: "hidden",
              zIndex: 300,
              animation: "snapDown 0.25s cubic-bezier(0.22, 1.2, 0.36, 1)",
              marginTop: 4,
            }}
          >
            {/* Gradient edge */}
            <div
              style={{
                height: 2,
                background: `linear-gradient(90deg, ${C.dark}, ${C.accent}, ${C.dark})`,
              }}
            />

            <div style={{ padding: "4px 0 6px", maxHeight: 380, overflowY: "auto" }}>
              {/* ── Dashboard ── */}
              <button
                onClick={() => {
                  onSelectDashboard?.();
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  cursor: "pointer",
                  outline: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  textAlign: "left",
                  background: isDashboard ? C.accent + "22" : "transparent",
                  transition: "background 0.1s",
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => {
                  if (!isDashboard) e.currentTarget.style.background = C.darkSurf2;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isDashboard ? C.accent + "22" : "transparent";
                }}
              >
                <IconStar size={12} color={isDashboard ? C.accent : C.darkMuted} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isDashboard ? 600 : 400,
                    color: isDashboard ? C.accent : C.darkText,
                    letterSpacing: "0.01em",
                  }}
                >
                  Dashboard
                </span>
              </button>

              {/* Separator */}
              {pageTree.length > 0 && (
                <div
                  style={{
                    height: 1,
                    background: C.darkBorder,
                    margin: "4px 12px",
                  }}
                />
              )}

              {/* ── Folder tree ── */}
              {pageTree.map((folder) => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  activeFolder={activeFolder}
                  activePage={activePage}
                  onSelect={(id) => {
                    onSelectFolder?.(id);
                    setOpen(false);
                  }}
                  onRename={onRenameFolder}
                  onDelete={(folder) => {
                    onDeleteFolder?.(folder);
                    setOpen(false);
                  }}
                  collapsed={false}
                />
              ))}

              {/* Separator */}
              <div
                style={{
                  height: 1,
                  background: C.darkBorder,
                  margin: "4px 12px",
                }}
              />

              {/* ── Create New Folder ── */}
              <button
                onClick={() => {
                  onCreateFolder?.();
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  cursor: "pointer",
                  outline: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  textAlign: "left",
                  background: "transparent",
                  transition: "background 0.1s",
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.darkSurf2;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <IconPlus size={11} color={C.darkMuted} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 400,
                    color: C.darkMuted,
                    letterSpacing: "0.01em",
                  }}
                >
                  New Folder
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

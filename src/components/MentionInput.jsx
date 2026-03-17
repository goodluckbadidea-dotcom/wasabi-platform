// ─── MentionInput ───
// Reusable text input/textarea with @mention autocomplete.
// On '@' keystroke, shows dropdown of active users from /users endpoint.
// Inserts @DisplayName into text on selection.
// Styled with design tokens.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { listUsers } from "../lib/api.js";

// Cache users across instances (refreshed every 60s)
let cachedUsers = null;
let cacheTime = 0;
const CACHE_TTL = 60000;

async function fetchUsers() {
  const now = Date.now();
  if (cachedUsers && now - cacheTime < CACHE_TTL) return cachedUsers;
  try {
    const { users } = await listUsers();
    cachedUsers = (users || []).filter((u) => !u.deleted_at);
    cacheTime = now;
    return cachedUsers;
  } catch {
    return cachedUsers || [];
  }
}

export default function MentionInput({
  value = "",
  onChange,
  placeholder = "",
  multiline = false,
  rows = 3,
  style = {},
  disabled = false,
  onKeyDown,
  autoFocus = false,
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Prefetch users on mount
  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);

  const filteredUsers = users.filter((u) =>
    u.display_name.toLowerCase().includes(filter.toLowerCase())
  );

  const insertMention = useCallback((user) => {
    if (mentionStart < 0) return;
    const before = value.slice(0, mentionStart);
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const after = value.slice(cursorPos);
    const mention = `@${user.display_name} `;
    const newValue = before + mention + after;
    onChange(newValue);
    setShowDropdown(false);
    setFilter("");
    setMentionStart(-1);

    // Restore cursor after mention
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const pos = before.length + mention.length;
        inputRef.current.selectionStart = pos;
        inputRef.current.selectionEnd = pos;
        inputRef.current.focus();
      }
    });
  }, [value, mentionStart, onChange]);

  const handleChange = useCallback((e) => {
    const newVal = e.target.value;
    onChange(newVal);

    const cursor = e.target.selectionStart;
    // Check if we're in a mention context
    const textBefore = newVal.slice(0, cursor);
    const lastAt = textBefore.lastIndexOf("@");

    if (lastAt >= 0) {
      // Check that @ is at start or preceded by whitespace
      const charBefore = lastAt > 0 ? textBefore[lastAt - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || lastAt === 0) {
        const query = textBefore.slice(lastAt + 1);
        // Only show dropdown if no space before cursor (still typing mention)
        if (!query.includes("\n")) {
          setFilter(query);
          setMentionStart(lastAt);
          setShowDropdown(true);
          setSelectedIdx(0);
          return;
        }
      }
    }

    setShowDropdown(false);
    setMentionStart(-1);
  }, [onChange]);

  const handleKeyDownInternal = useCallback((e) => {
    if (showDropdown && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filteredUsers.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredUsers[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowDropdown(false);
        return;
      }
    }
    if (onKeyDown) onKeyDown(e);
  }, [showDropdown, filteredUsers, selectedIdx, insertMention, onKeyDown]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const Tag = multiline ? "textarea" : "input";

  const baseStyle = {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "10px 14px",
    fontSize: 13,
    fontFamily: FONT,
    borderRadius: RADIUS.md,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    resize: multiline ? "vertical" : "none",
    ...style,
  };

  return (
    <div style={{ position: "relative" }}>
      <Tag
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        style={baseStyle}
        {...(multiline ? { rows } : { type: "text" })}
      />

      {showDropdown && filteredUsers.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            width: "100%",
            maxHeight: 200,
            overflowY: "auto",
            background: C.darkSurf,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md,
            boxShadow: SHADOW.dropdown,
            zIndex: 1000,
            marginBottom: 4,
          }}
        >
          {filteredUsers.map((user, i) => (
            <div
              key={user.id}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(user);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontFamily: FONT,
                color: C.darkText,
                cursor: "pointer",
                background: i === selectedIdx ? C.accent + "22" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {/* Avatar initial */}
              <span style={{
                width: 22, height: 22,
                borderRadius: "50%",
                background: C.accent + "33",
                color: C.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {user.display_name.charAt(0).toUpperCase()}
              </span>
              <span>{user.display_name}</span>
              <span style={{ fontSize: 11, color: C.darkMuted, marginLeft: "auto" }}>
                {user.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

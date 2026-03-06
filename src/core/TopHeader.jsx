// ─── Top Header Bar ───
// WASABI branding left, centered page dropdown pill, matches original app header.
// No emojis — all SVG icons.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconGear, IconChevronDown, IconPage, IconPlus, IconDiamond } from "../design/icons.jsx";

// ── NavGlyph: icon for each page type in dropdown ──
function NavGlyph({ type, size = 14, color }) {
  if (type === "system") return <IconGear size={size} color={color} />;
  if (type === "add") return <IconPlus size={size} color={color} />;
  return <IconPage size={size} color={color} />;
}

export default function TopHeader({ onAddPage }) {
  const { pages, activePage, setActivePage } = usePlatform();
  const [dropOpen, setDropOpen] = useState(false);
  const pillRef = useRef(null);
  const dropRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (
        pillRef.current && !pillRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  // Build nav sections from pages + system
  const topLevelPages = pages.filter((p) => !p.parentId);
  const currentPage = topLevelPages.find((p) => p.id === activePage);
  const currentLabel = currentPage
    ? currentPage.name
    : activePage === "system"
    ? "System Manager"
    : activePage === "wasabi"
    ? "New Page"
    : topLevelPages.length > 0
    ? "Select Page"
    : "Home";

  return (
    <header
      style={{
        flexShrink: 0,
        height: 54,
        background: C.dark,
        borderBottom: `1px solid ${C.edgeLine}`,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        position: "relative",
        zIndex: 200,
      }}
    >
      {/* Left: Wordmark */}
      <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto", gap: 8 }}>
        <span
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: C.darkText,
          }}
        >
          Wasabi
        </span>
      </div>

      {/* Center: Section nav pill dropdown */}
      <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
        <button
          ref={pillRef}
          onClick={() => setDropOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: 999,
            padding: "7px 18px 7px 14px",
            cursor: "pointer",
            outline: "none",
            userSelect: "none",
            fontFamily: "'Outfit',sans-serif",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.darkMuted;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.darkBorder;
          }}
        >
          {/* Green indicator dot */}
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: C.accent,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "'Outfit',sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: C.darkText,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            {currentLabel}
          </span>
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            style={{
              marginLeft: 2,
              transition: "transform 0.15s",
              transform: dropOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <path
              d="M1 1L5 5L9 1"
              stroke={C.darkMuted}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Dropdown */}
        {dropOpen && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setDropOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 299 }}
            />
            <div
              ref={dropRef}
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#2D2D2D",
                borderRadius: 16,
                border: "1px solid #333",
                boxShadow:
                  "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
                minWidth: 220,
                overflow: "hidden",
                zIndex: 300,
                animation: "navDrop 0.18s cubic-bezier(0.16,1,0.3,1)",
              }}
            >
              {/* Wasabi gradient edge */}
              <div
                style={{
                  height: 3,
                  background: `linear-gradient(90deg, ${C.dark}, ${C.accent}, ${C.dark})`,
                }}
              />
              <div style={{ padding: "6px 0 8px" }}>
                {/* User pages */}
                {topLevelPages.map((page) => {
                  const isActive = activePage === page.id;
                  return (
                    <button
                      key={page.id}
                      onClick={() => {
                        setActivePage(page.id);
                        setDropOpen(false);
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        cursor: "pointer",
                        outline: "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 18px",
                        textAlign: "left",
                        background: isActive ? C.accent + "18" : "transparent",
                        transition: "background 0.1s",
                        fontFamily: "'Outfit',sans-serif",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = C.darkSurf2;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isActive
                          ? C.accent + "18"
                          : "transparent";
                      }}
                    >
                      <NavGlyph type="page" size={14} color={isActive ? C.accent : "#888"} />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? C.accent : "#E8E8E8",
                          letterSpacing: "0.01em",
                        }}
                      >
                        {page.name}
                      </span>
                      {isActive && (
                        <div
                          style={{
                            marginLeft: "auto",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: C.accent,
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </button>
                  );
                })}

                {/* Separator */}
                {topLevelPages.length > 0 && (
                  <div
                    style={{
                      height: 1,
                      background: C.darkBorder,
                      margin: "6px 14px",
                    }}
                  />
                )}

                {/* Add page */}
                <button
                  onClick={() => {
                    onAddPage?.();
                    setDropOpen(false);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    cursor: "pointer",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    textAlign: "left",
                    background: "transparent",
                    transition: "background 0.1s",
                    fontFamily: "'Outfit',sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = C.darkSurf2;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <IconPlus size={14} color={C.darkMuted} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: C.darkMuted,
                      letterSpacing: "0.01em",
                    }}
                  >
                    New Page
                  </span>
                </button>

                {/* System */}
                <button
                  onClick={() => {
                    setActivePage("system");
                    setDropOpen(false);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    cursor: "pointer",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 18px",
                    textAlign: "left",
                    background:
                      activePage === "system" ? C.accent + "18" : "transparent",
                    transition: "background 0.1s",
                    fontFamily: "'Outfit',sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    if (activePage !== "system")
                      e.currentTarget.style.background = C.darkSurf2;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      activePage === "system"
                        ? C.accent + "18"
                        : "transparent";
                  }}
                >
                  <IconGear
                    size={14}
                    color={activePage === "system" ? C.accent : "#888"}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: activePage === "system" ? 600 : 400,
                      color:
                        activePage === "system" ? C.accent : "#E8E8E8",
                      letterSpacing: "0.01em",
                    }}
                  >
                    System Manager
                  </span>
                  {activePage === "system" && (
                    <div
                      style={{
                        marginLeft: "auto",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: C.accent,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right spacer */}
      <div style={{ marginLeft: "auto" }} />
    </header>
  );
}

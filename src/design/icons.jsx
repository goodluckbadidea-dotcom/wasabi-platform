// ─── Wasabi SVG Icon Library ───
// All icons are inline SVGs. No emojis anywhere in the app.

import React from "react";

const d = "currentColor"; // default fill

// Helper: wraps a path in an SVG element
function Icon({ size = 20, color = d, viewBox = "0 0 24 24", children, style, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      {children}
    </svg>
  );
}

// ─── Navigation / UI Icons ───

export function IconWasabi({ size = 20, color = "#7DC143", ...rest }) {
  // Stylized leaf/flame
  return (
    <Icon size={size} {...rest}>
      <path
        d="M12 2C8 7 4 10 4 14.5C4 18.64 7.58 22 12 22C16.42 22 20 18.64 20 14.5C20 10 16 7 12 2Z"
        fill={color}
        opacity="0.85"
      />
      <path
        d="M12 6C10 9.5 8 11.5 8 14C8 16.21 9.79 18 12 18C14.21 18 16 16.21 16 14C16 11.5 14 9.5 12 6Z"
        fill={color}
        opacity="0.5"
      />
    </Icon>
  );
}

export function IconGear({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path
        d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
    </Icon>
  );
}

export function IconQueue({ size = 20, color = d, ...rest }) {
  // Stacked list / clipboard
  return (
    <Icon size={size} {...rest}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="9" y="3" width="6" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="9" y1="12" x2="15" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="16" x2="13" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconPlus({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconChevronLeft({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="15 18 9 12 15 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconChevronRight({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="9 18 15 12 9 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconPaperclip({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </Icon>
  );
}

export function IconWarning({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="12" y1="9" x2="12" y2="13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill={color} />
    </Icon>
  );
}

export function IconPage({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke={color} strokeWidth="1.5" fill="none" />
      <polyline points="14 2 14 8 20 8" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="8" y1="13" x2="16" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="17" x2="14" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

// ─── Template Icons ───

export function IconChart({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="12" width="4" height="9" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="10" y="7" width="4" height="14" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="17" y="3" width="4" height="18" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconHandshake({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M20 8l-3-3H7L4 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M4 8l4 9h1l3-3 3 3h1l4-9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M9 17l-3 3M15 17l3 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconBox({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke={color} strokeWidth="1.5" fill="none" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="12" y1="22.08" x2="12" y2="12" stroke={color} strokeWidth="1.5" />
    </Icon>
  );
}

export function IconBolt({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconDollar({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="12" y1="1" x2="12" y2="23" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconCheck({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.5" fill="none" />
      <polyline points="9 12 11 14 15 10" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconSend({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="22" y1="2" x2="11" y2="13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconMenu({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="18" x2="21" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconRefresh({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="23 4 23 10 17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

// ─── Layout / Navigation Icons ───

export function IconDiamond({ size = 8, color = d, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill={color} style={{ flexShrink: 0, transition: "fill 0.12s" }} {...rest}>
      <path d="M4 0L8 4L4 8L0 4Z" />
    </svg>
  );
}

export function IconClose({ size = 12, color = d, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }} {...rest}>
      <line x1="1" y1="1" x2="11" y2="11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="11" y1="1" x2="1" y2="11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevronDown({ size = 10, color = d, ...rest }) {
  return (
    <svg width={size} height={Math.round(size * 0.6)} viewBox="0 0 10 6" fill="none" style={{ flexShrink: 0 }} {...rest}>
      <path d="M1 1L5 5L9 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconBell({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconChat({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconLog({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="8" y="2" width="8" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="9" y1="12" x2="15" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="16" x2="13" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconHamburger({ size = 18, color = d, ...rest }) {
  return (
    <svg width={size} height={Math.round(size * 0.78)} viewBox="0 0 18 14" fill="none" style={{ flexShrink: 0 }} {...rest}>
      <line x1="1" y1="2" x2="17" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="1" y1="7" x2="17" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="1" y1="12" x2="17" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Phase 5 Icons ───

export function IconSearch({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconTrash({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="3 6 5 6 21 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconArchive({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="4" width="18" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="10" y1="12" x2="14" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconExport({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={color} strokeWidth="1.5" fill="none" />
      <polyline points="7 10 12 15 17 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="12" y1="15" x2="12" y2="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconFilter({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconEyeOff({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <line x1="1" y1="1" x2="23" y2="23" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconArrowUp({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="12" y1="19" x2="12" y2="5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="5 12 12 5 19 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconArrowDown({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="19 12 12 19 5 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

// ─── Phase 6 Icons ───

export function IconDatabase({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <ellipse cx="12" cy="5" rx="9" ry="3" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconCalendar({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="16" y1="2" x2="16" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="2" x2="8" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="1.5" />
    </Icon>
  );
}

export function IconKanban({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="5" height="14" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="10" y="3" width="5" height="10" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="17" y="3" width="5" height="17" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconTable({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="3" y1="9" x2="21" y2="9" stroke={color} strokeWidth="1.5" />
      <line x1="3" y1="15" x2="21" y2="15" stroke={color} strokeWidth="1.5" />
      <line x1="9" y1="3" x2="9" y2="21" stroke={color} strokeWidth="1.5" />
      <line x1="15" y1="3" x2="15" y2="21" stroke={color} strokeWidth="1.5" />
    </Icon>
  );
}

export function IconTimeline({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="18" x2="21" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="5" y="4" width="8" height="4" rx="2" fill={color} opacity="0.7" />
      <rect x="10" y="10" width="6" height="4" rx="2" fill={color} opacity="0.7" />
      <rect x="7" y="16" width="10" height="4" rx="2" fill={color} opacity="0.7" />
    </Icon>
  );
}

export function IconForm({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="4" y="2" width="16" height="20" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="8" y1="7" x2="16" y2="7" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="11" x2="14" y2="11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="15" x2="12" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconCards({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="2" y="3" width="9" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="13" y="3" width="9" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="2" y="13" width="9" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="13" y="13" width="9" height="8" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconStar({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
    </Icon>
  );
}

export function IconUsers({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconInbox({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconFolder({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconEdit({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconExpand({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="9 21 3 21 3 15" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="21" y1="3" x2="14" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="21" x2="10" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

// Inverse of IconExpand — arrows pointing inward toward the center.
// Used by the panel maximize/minimize toggle when a panel is currently maximized.
export function IconCollapse({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polyline points="20 9 14 9 14 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="4 15 10 15 10 21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="14" y1="9" x2="21" y2="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="3" y1="22" x2="10" y2="15" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

// ─── Node Editor Icons ───

export function IconPlay({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <polygon points="6 3 20 12 6 21" fill={color} stroke="none" />
    </Icon>
  );
}

export function IconCondition({ size = 20, color = d, ...rest }) {
  // Diamond / branch shape
  return (
    <Icon size={size} {...rest}>
      <path d="M12 2L22 12L12 22L2 12Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M12 8v8M9 12h6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconTransform({ size = 20, color = d, ...rest }) {
  // Shuffle / arrows
  return (
    <Icon size={size} {...rest}>
      <polyline points="16 3 21 3 21 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="4" y1="20" x2="21" y2="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="21 16 21 21 16 21" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="15" y1="15" x2="21" y2="21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="4" y1="4" x2="9" y2="9" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconConnect({ size = 20, color = d, ...rest }) {
  // Two linked circles
  return (
    <Icon size={size} {...rest}>
      <circle cx="7" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="17" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="11" y1="12" x2="13" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconWasabiNode({ size = 20, color = "#F5B724", ...rest }) {
  // Stylized W for Wasabi AI node
  return (
    <Icon size={size} {...rest}>
      <path d="M3 6L7 18L12 10L17 18L21 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconUpload({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="17 8 12 3 7 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <line x1="12" y1="3" x2="12" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconSheet({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="3" y1="9" x2="21" y2="9" stroke={color} strokeWidth="1.5" />
      <line x1="3" y1="15" x2="21" y2="15" stroke={color} strokeWidth="1.5" />
      <line x1="9" y1="3" x2="9" y2="21" stroke={color} strokeWidth="1.5" />
    </Icon>
  );
}

export function IconSun({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconMoon({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconBrain({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      {/* Left hemisphere */}
      <path d="M12 2C9.5 2 7.2 3.1 5.8 5c-1 1.4-1.6 3-1.6 4.8 0 1.5.4 2.8 1.2 4 .6.9 1.2 1.7 1.6 2.7.5 1.2.7 2.5.8 3.5h4.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Right hemisphere */}
      <path d="M12 2c2.5 0 4.8 1.1 6.2 3 1 1.4 1.6 3 1.6 4.8 0 1.5-.4 2.8-1.2 4-.6.9-1.2 1.7-1.6 2.7-.5 1.2-.7 2.5-.8 3.5h-4.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Center divide */}
      <path d="M12 2v18" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      {/* Brain folds */}
      <path d="M5.5 8.5c2 .5 4 0 6.5-1M18.5 8.5c-2 .5-4 0-6.5-1M6 13c2-.8 3.5-.3 6 .5M18 13c-2-.8-3.5-.3-6 .5" stroke={color} strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5" />
      {/* Stem */}
      <path d="M10 20h4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconGlobe({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconGrid({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconMail({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M3 7l9 6 9-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Icon>
  );
}

export function IconFunction({ size = 20, color = d, ...rest }) {
  // Curly braces with horizontal bar — represents code/function
  return (
    <Icon size={size} {...rest}>
      <path d="M8 3C6.34 3 5 4.34 5 6v4H4v4h1v4c0 1.66 1.34 3 3 3" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M16 3c1.66 0 3 1.34 3 3v4h1v4h-1v4c0 1.66-1.34 3-3 3" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M9 12h6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Icon>
  );
}

// ─── Sprint 13: Notification & Status Icons ───

export function IconMention({ size = 20, color = d, ...rest }) {
  // @ symbol
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.13" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconLightbulb({ size = 20, color = d, ...rest }) {
  // Lightbulb — for insights/attention
  return (
    <Icon size={size} {...rest}>
      <path d="M9 21h6M10 17h4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 14.5C7.2 13.3 6 11.3 6 9a6 6 0 1 1 12 0c0 2.3-1.2 4.3-3 5.5v2.5H9v-2.5z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconHourglass({ size = 20, color = d, ...rest }) {
  // Hourglass — for stale/waiting
  return (
    <Icon size={size} {...rest}>
      <path d="M6 2h12v5l-4 5 4 5v5H6v-5l4-5-4-5V2z" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M6 2h12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 22h12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconBlocked({ size = 20, color = d, ...rest }) {
  // Circle with line through — for blocked
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M5.5 5.5l13 13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconAlarm({ size = 20, color = d, ...rest }) {
  // Alarm clock — for overdue/due soon
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="13" r="8" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M12 9v4l3 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 3l-2 2M19 3l2 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconClipboard({ size = 20, color = d, ...rest }) {
  // Clipboard — for summary
  return (
    <Icon size={size} {...rest}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="8" y="2" width="8" height="4" rx="1" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M8 12h8M8 16h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Icon>
  );
}

export function IconLink({ size = 20, color = d, ...rest }) {
  // Chain link — for blocking/dependencies
  return (
    <Icon size={size} {...rest}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconUser({ size = 20, color = d, ...rest }) {
  // Single person — for assignment
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </Icon>
  );
}

export function IconPhone({ size = 20, color = d, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke={color} strokeWidth="1.5" fill="none" />
    </Icon>
  );
}

export function IconStatusDot({ size = 20, color = d, ...rest }) {
  // Filled circle with ring — for status fields
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="7" stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="12" r="3" fill={color} />
    </Icon>
  );
}

export function IconCheckSquare({ size = 20, color = d, ...rest }) {
  // Checkbox — for checkbox column type
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.5" fill="none" />
      <path d="M9 12l2 2 4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function IconSubItems({ size = 20, color = d, ...rest }) {
  // Two stacked L-shapes ending in dots — sub-item / subtask hierarchy glyph
  return (
    <Icon size={size} {...rest}>
      <path
        d="M6 5 V18 H12"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M6 11 H12"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="14" cy="11" r="1.6" fill={color} stroke="none" />
      <circle cx="14" cy="18" r="1.6" fill={color} stroke="none" />
    </Icon>
  );
}

// ─── Figma geometric logo ───
// Five-shape glyph in Figma's official palette. Used by FigmaView, the
// figma_files cell type, and anywhere we need to mark "this is a Figma file".
export function IconFigma({ size = 16, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...rest}>
      <path d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4z" fill="#0ACF83" />
      <path d="M4 12c0-2.2 1.8-4 4-4h4v8H8c-2.2 0-4-1.8-4-4z" fill="#A259FF" />
      <path d="M4 4c0-2.2 1.8-4 4-4h4v8H8C5.8 8 4 6.2 4 4z" fill="#F24E1E" />
      <path d="M12 0h4c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V0z" fill="#FF7262" />
      <path d="M20 12c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z" fill="#1ABCFE" />
    </svg>
  );
}

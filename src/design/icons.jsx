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

export function IconWarning({ size = 20, color = "#FF6B3D", ...rest }) {
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

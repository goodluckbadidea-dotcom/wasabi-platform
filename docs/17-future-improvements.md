# 17 — Future Improvements

Tracked improvements and UX refinements. Not bugs — the current implementation works, but these would make it better.

---

## Figma Integration

### Figma Team ID setup is clunky
**Current:** Team ID is a separate connection row in Settings → Connections. User must find the raw ID from their Figma team URL and paste it as a separate entry.

**Problem:** Feels like two disconnected setup steps. Users shouldn't need to know what a "Team ID" is.

**Proposed fix:** Move the team ID input into FigmaView itself as a one-time onboarding prompt. Accept a full Figma team URL (e.g. `figma.com/files/team/12345/...`) and extract the ID automatically. Store as metadata on the `figma` connection key instead of a separate row. Remove `figma_team_id` from ConnectionsTab.

### Thumbnail URL expiration
**Current:** Figma CDN thumbnail URLs stored in Design Assets records expire after ~14 days.

**Proposed fix:** Add a "Refresh thumbnails" action in FigmaView or the Design Assets database that re-fetches current URLs from the Figma API. Alternatively, cache thumbnails in R2 for permanence.

---

## Unified Inbox

### Outlook attachment parsing
**Current (2026-05-04):** AI tools `search_outlook_messages`, `get_outlook_message`, and `get_outlook_thread` return body text only — attachments are invisible. Surfaced when Graham hit a Premier Press email chain where the latest quantities lived in a PDF attachment and the AI confidently summarized stale numbers from the body text.

**Proposed fix:** Add `list_outlook_attachments` and `get_outlook_attachment` tools (Microsoft Graph `/messages/{id}/attachments` exists for both list + download). Wire downstream PDF/xlsx parsing — could reuse the existing PDF tooling. Same gap exists on Gmail; address both at the same time.

### Decide whether to delete OutlookView.jsx and GmailView.jsx
**Current (2026-05-04):** Both component files retained on disk but no longer wired in `App.jsx` routing or `Navigation.jsx` (commit `8dd0445`). Per CLAUDE.md "never delete working code without explicit permission" they're preserved in case the unified inbox is dialed back.

**Proposed:** Once the unified inbox has stabilized for some time and Graham is confident in it, decide whether to delete both files (~1400 lines). Do not delete unprompted.

---

## Cell Links

### Variable row height + virtualization
**Current (2026-05-04):** `Table.jsx` virtualization math computes scroll positions via `ROW_HEIGHT * idx` (idx-based row positioning). Row heights are now variable (`minHeight` instead of `height` so wrapped multi-pill cells can grow). `VIRT_BUFFER = 200` absorbs the slop for typical workspaces, but very tall rows in a large table (1000+ rows with many multi-line cells) could cause scroll-position drift or off-screen-rendering inaccuracy.

**Proposed fix:** measure row heights as they mount (e.g. `ResizeObserver`) and accumulate per-row offsets so virtualization can compute exact positions. AG Grid does this; can crib the pattern. Defer until someone hits a real bug — current behavior works for everything Graham has tested.

### Long thread message-count understated
**Current (2026-05-04):** Thread row's `messageCount` reflects only messages currently in the loaded inbox window (40 per provider). A 12-message thread with 5 messages outside the window shows "(7)" in the badge. The full thread loads correctly on expand — only the at-a-glance count is affected.

**Proposed fix:** call provider thread/conversation list endpoints upfront for any thread with multiple visible messages to get the true count. Or accept the same limitation Gmail/Outlook native UIs have. Low priority.

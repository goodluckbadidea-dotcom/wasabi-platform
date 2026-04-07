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

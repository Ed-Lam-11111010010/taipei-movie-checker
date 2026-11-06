---
version: alpha
name: "Movie Checker"
description: "A Traditional Chinese, cinema-first guide to sourced Taipei and New Taipei showtimes."
colors:
  primary: "#1d1e1a"
  secondary: "#5c45a4"
  paper: "#f4f1e9"
  card: "#fffefa"
  ink: "#1d1e1a"
  muted: "#74766d"
  line: "#deded4"
  highlight: "#d8ff70"
  warning: "#fff1cd"
typography:
  sans:
    fontFamily: 'Aptos, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif'
  display:
    fontFamily: 'Georgia, "Noto Serif TC", "Songti TC", serif'
rounded:
  control: "9px"
  card: "12px"
  section: "18px"
spacing:
  page-max: "1320px"
  section-gap: "26px"
components:
  date-button: {}
  movie-tile: {}
  cinema-card: {}
  booking-link: {}
---

# Movie Checker design context

## Overview
**North Star:** a compact Taiwan movie guide, like scanning a cinema timetable and choosing a screening at a ticket counter. The primary job is to find a film or time, choose a venue, and follow a trustworthy external booking or information link. Target audience: Traditional Chinese readers comparing cinemas in Taipei City and New Taipei City, often on mobile.

The existing warm paper/ink identity is already established in `app.css` and `movie-pages.css`; preserve it rather than applying a generic rebrand. The distinctive move is the **date strip with known screening counts**, not decorative motion. Search, film details, addresses, formats and trustworthy booking labels take priority over visual effects. Avoid technical-status walls, false ticket-availability promises, and dense tiny controls.

## Colors
`app.css :root` is the **runtime source of truth**; frontmatter mirrors current CSS tokens. Ink is for readable information; purple marks links and keyboard focus; acid green highlights selected states and primary actions; warning tones are reserved for source-data caveats. Keep meaningful contrast and never depend on hue alone for sync status.

## Typography
Traditional Chinese body copy uses the existing sans stack. Serif display type is for page headings and film/cinema titles only; showtime numbers use tabular numerals. Controls and source disclaimers must remain readable at phone sizes, not miniature developer labels.

## Layout
Shared four-page navigation (Movies, Showtimes, Cinemas, Map) stays consistent. A 1320px centered shell adapts to a stacked mobile layout. The showtime calendar belongs near the seven-day shortcuts; filters may collapse on phones but must show how many are active. Posters retain a stable 2:3 footprint; cinema action links must wrap and remain touch-friendly.

## Elevation & Depth
Prefer contrast, thin borders and spacing. Shadows only emphasize selected navigation or actionable surfaces; avoid heavy shadows and layered floating panels.

## Shapes
Controls use modest rounded corners; cards and movie explorer have larger radii. Do not add decorative pills for every metric.

## Components
- **Date strip:** seven days, calendar shortcut, counts of *retrieved* upcoming screenings. Zero means "尚無資料", not "no screenings exist".
- **Filters:** native search/select controls; show the count of applied filters. Keep reset visible when expanded.
- **Movie card:** poster, readable title, venue/screening count, one clear link to details.
- **Showtime/booking action:** link text differentiates verified online portals from source or booking-information pages. Never claim a seat is reserved.
- **Read-only diagnostics:** behind a disclosure, not in the primary task flow.
- **States:** selected/focus-visible, disabled, loading/stale, and no-data remain legible; respect `prefers-reduced-motion`.

## Do's and Don'ts
- **Do** preserve real-source transparency and Taiwan-local dates/time.
- **Do** apply the same navigation, terms and source caveats across all four pages.
- **Don't** reintroduce public demo/test datasets or developer-only status logs into the browsing flow.
- **Don't** imply all dates, prices, or seats are live just because a venue was synchronized.

# Movie Checker UX contract

## Product and source of truth
- Audience: Traditional Chinese users looking for films and sessions in Taipei / New Taipei, often on a phone.
- Jobs: browse films, search sessions by date or cinema, compare venues, open a trustworthy external ticketing/information page.
- Current data: `catalog.json` is a scheduled, **non-live** source snapshot produced by `scripts/sync-showtimes.cjs`; `theater-directory.js` keeps directory records. Missing source rows never mean a cinema has no screenings.
- Runtime UI owners: `app-core.js` (date/filter/route state, error/status), `movie-pages.js` (movie list/detail + booking-link classification), `app.css` and `movie-pages.css` (tokens/layout). `DESIGN.md` records visual intent, not alternative runtime constants.

## Navigation
- Four named browser pages: Movies (`index.html`), Showtimes (`showtimes.html`), Cinemas (`cinemas.html`), Map (`map.html`). Use one active navigation label.
- Shareable film detail uses `#movie=<encoded title>`; venue-to-showtime links use `showtimes.html?cinema=<cinemaId>`.
- Within movie detail, changing date/venue filters the chosen film without changing the shared source data.
- Browser navigation and original sources remain reachable; no booking operation or payment is performed on Movie Checker.

## Canonical UI map
| Capability | Owner | Choice | Verify |
| --- | --- | --- | --- |
| Date | `app-core.js` + native date input | Asia/Taipei; seven-day strip + later-date picker | UI smoke test, mobile/keyboard |
| Filters/select | `app-core.js` + native controls | Search, district, cinema, format, optional movie selection | Filter/change/reset test |
| Movie list/detail | `movie-pages.js` | Poster grid → film detail → venue session | Routing test |
| External ticket/link label | `movie-pages.js` | Verified portal vs neutral source-info link | Booking regression |
| Source states | `app-core.js` | Pending, partial, stale, unavailable; read-only detail collapsed | Catalog error/retry test |
| Scroll/visual | `app.css`, `movie-pages.css` | Document scroll + bounded horizontal date strip | Phone/desktop review |

## Behavior and trust
- **Date:** selecting a day updates the Showtimes listing; counts reflect *retrieved future records* for that day, not total screenings or seats. No retrieved rows must say "尚無資料" and suggest checking a different date/source.
- **Filters:** desktop filters start expanded; on phone widths ≤620px they start collapsed but show the count of active conditions. Native controls remain keyboard-accessible. Selected movie versions show all available dates and temporarily disable the date picker with an explanation.
- **Booking:** show a direct-session label only for a validated session URL; venue portals require reselecting film/date/time; where online buying is unverified retain a neutral cinema information/source link. Municipal registration/ticket-claim venues use appropriate labels.
- **Refresh:** visibly indicate loading, keep an already valid snapshot on refresh failure, and expose a retry. Never substitute fake sessions in the public hosted site.
- **Status:** detailed per-source diagnostics remain behind an expandable read-only disclosure.
- **Responsive:** usable touch targets are at least 44px for the revised primary date, filter, cinema and booking interactions; visible keyboard focus must remain. Reduced-motion preferences respected.

## Verification and limitations
- Existing source/parser automation remains untouched by the interface pass.
- CI: `.github/workflows/test-pages.yml`, `scripts/test-pages.cjs` covers all four page routes and shared interactions.
- Before a release, check 375px / 620px / 1024px / 1440px widths, keyboard navigation, empty/error states, film detail, cinema links, and one future-date jump in a rendered browser. Static code and jsdom cannot prove screenshot or tap-target geometry.
- Do not merge/publish an interface redesign on the strength of a CI run alone when no visual QA has been possible.

# Project Context

## Scope
Mobile app ("Daybook"): 4 bottom-tab research app — Markets, Portfolio, Watchlist, Manage — plus a Calendar quick-link from the masthead. **Now a real installable PWA**, not just a mockup: live at https://theotverner.github.io/daybook-research-app/, installable via Safari → Share → Add to Home Screen on iPhone. Still running entirely on mock/placeholder data — no real market data, news, or Spotify connection yet.

**Personal use only.** Theo confirmed this app is for himself and will not be published/distributed to anyone else. This meaningfully changes the risk profile: no app-store review process, no multi-user privacy law exposure (GDPR/CCPA etc. are triggered by processing *other people's* data, not your own), no need to worry about terms-of-service clauses aimed at commercial/public redistribution. Don't over-apply general regulatory caution that's really aimed at public products — but revisit this if Theo ever considers sharing or publishing it.

## Hosting / infrastructure
- **Repo**: github.com/TheoTVerner/daybook-research-app (public, main branch, served via GitHub Pages from branch root)
- **Live URL**: https://theotverner.github.io/daybook-research-app/
- **Local project folder**: `~/Desktop/Theo's Research App` — this *is* the git repo; working directly in it pushes straight to the live site (`git push` after committing updates to main)
- **SSH auth**: a dedicated deploy key was generated at `~/.ssh/id_ed25519_daybook`, registered in `~/.ssh/config` for github.com, and added to macOS Keychain — the public half is on Theo's GitHub account's SSH keys. No GitHub CLI (`gh`) or Homebrew installed on this Mac; Xcode Command Line Tools were installed mid-session to get `git` working.
- App structure: `index.html` / `styles.css` / `app.js` (plain, no build step, no framework) + `manifest.json` + `sw.js` (basic app-shell service worker) + `icons/` (generated locally via Pillow, not hand-designed).
- To ship an update: edit the files, `git add -A && git commit -m "..." && git push` from the project folder — GitHub Pages rebuilds automatically in under a minute, and the installed home-screen app picks up changes next time Theo opens it (no reinstall needed).

## Decisions made
- "Navy football" / earlier "Navy Gold" turned out to mean the US Naval Academy (Navy Midshipmen) colors — but current direction reverted the main content area back to white/black/crimson, with gold reserved narrowly for news-outlet byline text only. Masthead/tab bar remain navy; the index ticker stays its own near-black "Bloomberg terminal" styling (intentional contrast, separate from the rest of the palette).
- Hub model confirmed: news items and podcasts are short summary + link-out only, never full article text or in-app audio playback. This meaningfully reduces the earlier copyright/licensing concern — this is closer to an RSS reader than a republisher.
- Podcast cards link out to Spotify (no fake in-app play button) — consistent with the hub model and with the fact Spotify's API can't stream audio in a third-party app anyway. Podcast art is a generated monogram placeholder (no real cover art pulled yet).
- Portfolio holdings are manually editable (shares + dollar amount invested, via an inline edit toggle per row). No brokerage account linking (e.g. Schwab) — confirmed manual entry is sufficient.
- Added a Calendar view (month grid + upcoming events list) reachable from the masthead icon (replaced the old shortcut to Manage). Shows earnings calls/investor events for portfolio + watchlist tickers.
- Bottom tab bar is icon-only, no text labels; active tab shows a red rounded highlight behind the icon (not a top bar indicator).
- Chose PWA over native (Swift/SwiftUI) specifically to avoid Apple Developer account cost/overhead, at the cost of no true background refresh or push notifications while the app is closed.

## Connectors needed for a real build
- News: RSS feeds or a licensed news aggregator API per source (WSJ/NYT license content tightly — no free public API for full articles; Yahoo Finance has no official public API either). Since the hub model only needs headline + short summary + link, RSS is realistically sufficient and low-risk even commercially, let alone for personal use.
- Market data/prices: IEX Cloud, Polygon.io, or Alpha Vantage. See note below on live updates.
- Podcasts: Spotify Web API can read a user's saved shows/episodes via OAuth for the hub listing; actual playback happens in Spotify, not in-app.
- Earnings/events calendar: a financial calendar API (e.g. Finnhub's earnings calendar endpoint, or Nasdaq's) could feed the Calendar tab's event list for real tickers.
- Auth/storage: account + database to hold portfolio and watchlist data.
- **Important for next phase**: any real API keys (market data, news aggregator, Spotify client secret) must NOT go directly into this static site's client-side JS — it's public on GitHub Pages and the keys would be visible to anyone. Will need a small backend/serverless proxy (e.g. a Cloudflare Worker or Vercel function) to hold secrets once real data is wired up.

## Guidance given
- **Live price updates**: recommended polling a market-data API on an interval (e.g. every 15–60s while the app is open) rather than a persistent websocket/streaming connection — simpler, cheaper, and plenty for a single-user personal app. True real-time (sub-second) streaming (Polygon.io, Finnhub) is overkill here and often costs more; also note most free-tier market data is 15-minute delayed unless paying for a real-time add-on.

## Open questions / roadblocks
- Next step would be scoping which specific market-data, news, and calendar APIs to use, and standing up the small backend proxy needed to hold their keys, when this moves from static mockup data to real data.

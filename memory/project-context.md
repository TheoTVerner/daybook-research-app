# Project Context

## Scope
Mobile app mockup ("Daybook"): 4 bottom-tab research app — Markets, Portfolio, Watchlist, Manage — plus a Calendar quick-link from the masthead. Current stage is design/flow mockup only (see [daybook-mockup.html artifact](https://claude.ai/artifact/Sn1HAjnird9657niVBgGEG)), not a working build.

**Personal use only.** Theo confirmed this app is for himself and will not be published/distributed to anyone else. This meaningfully changes the risk profile: no app-store review process, no multi-user privacy law exposure (GDPR/CCPA etc. are triggered by processing *other people's* data, not your own), no need to worry about terms-of-service clauses aimed at commercial/public redistribution. Don't over-apply general regulatory caution that's really aimed at public products — but revisit this if Theo ever considers sharing or publishing it.

## Decisions made
- "Navy football" / earlier "Navy Gold" turned out to mean the US Naval Academy (Navy Midshipmen) colors — but current direction reverted the main content area back to white/black/crimson, with gold reserved narrowly for news-outlet byline text only. Masthead/tab bar/status bar remain navy; the index ticker stays its own near-black "Bloomberg terminal" styling (intentional contrast, separate from the rest of the palette).
- Hub model confirmed: news items and podcasts are short summary + link-out only, never full article text or in-app audio playback. This meaningfully reduces the earlier copyright/licensing concern — this is closer to an RSS reader than a republisher.
- Podcast cards link out to Spotify (no fake in-app play button) — consistent with the hub model and with the fact Spotify's API can't stream audio in a third-party app anyway.
- Portfolio holdings are manually editable (shares + dollar amount invested, via an inline edit toggle per row). No brokerage account linking (e.g. Schwab) — confirmed manual entry is sufficient.
- Added a Calendar view (month grid + upcoming events list) reachable from the masthead icon (replaced the old shortcut to Manage). Shows earnings calls/investor events for portfolio + watchlist tickers.
- Bottom tab bar is icon-only, no text labels (aria-labels kept for accessibility).

## Connectors needed for a real build
- News: RSS feeds or a licensed news aggregator API per source (WSJ/NYT license content tightly — no free public API for full articles; Yahoo Finance has no official public API either). Since the hub model only needs headline + short summary + link, RSS is realistically sufficient and low-risk even commercially, let alone for personal use.
- Market data/prices: IEX Cloud, Polygon.io, or Alpha Vantage. See note below on live updates.
- Podcasts: Spotify Web API can read a user's saved shows/episodes via OAuth for the hub listing; actual playback happens in Spotify, not in-app.
- Earnings/events calendar: a financial calendar API (e.g. Finnhub's earnings calendar endpoint, or Nasdaq's) could feed the Calendar tab's event list for real tickers.
- Auth/storage: account + database to hold portfolio and watchlist data.

## Guidance given
- **Live price updates**: recommended polling a market-data API on an interval (e.g. every 15–60s while the app is open) rather than a persistent websocket/streaming connection — simpler, cheaper, and plenty for a single-user personal app. True real-time (sub-second) streaming (Polygon.io, Finnhub) is overkill here and often costs more; also note most free-tier market data is 15-minute delayed unless paying for a real-time add-on.

## Open questions / roadblocks
- None blocking at this stage — next step would be scoping which specific market-data and calendar APIs to use when this moves from mockup to a real build.

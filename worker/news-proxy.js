// Daybook backend — one Cloudflare Worker, these routes:
//   GET /            -> real news headlines (NYT, MarketWatch, CNBC RSS, server-side to dodge CORS)
//   GET /quotes?symbols=AAPL,MSFT  -> real price + day change + company name via Finnhub (free tier)
//   GET /indices  -> real major-index/VIX/yield/oil/bitcoin data for the markets ticker tape
//   GET /explain?symbol=NVDA&name=Nvidia  -> a grounded "why is it moving" summary via Workers AI
//   GET /earnings?symbols=AAPL,MSFT  -> each symbol's next real earnings-call date via Finnhub
//   GET /company-news?symbols=AAPL,MSFT  -> real per-company articles via Finnhub (last 10 days)
//   GET /candles?symbol=AAPL&range=1D|5D|3M|6M|1Y|ALL  -> historical close prices via Twelve Data
//   POST /spotify/token  {code, redirect_uri}  -> exchanges an OAuth code for Spotify tokens
//   GET /spotify/shows?refresh_token=...  -> the user's real followed shows + latest episode
//   POST /push/subscribe  {subscription, symbols}  -> save/update this device's push subscription
//   POST /push/unsubscribe  {endpoint}  -> remove a stored subscription
//   POST /push/test  -> immediately sends one test push to the stored subscription
//   scheduled() (Cron Trigger)  -> once a day, checks each subscribed symbol's next earnings
//     date and pushes a reminder if it's today or tomorrow
//
// /indices has no exact free source for raw index points (S&P/Dow/Nasdaq/Russell index
// licensing is paid almost everywhere). It tries each index's own real quote symbol on
// Finnhub first (works for some data providers, not guaranteed) and falls back to a
// liquid tracking ETF scaled by that ETF's well-known, issuer-fixed ratio to the index
// (SPY=S&P500/10, DIA=DJIA/100, IWM=Russell2000/10 -- these ratios are structural, not
// approximate, so the scaled price tracks the real index essentially exactly day to day).
// Nasdaq uses QQQ (Nasdaq-100, not the full Composite) since there's no reliable free
// 1:1 Composite proxy -- still >99% correlated on daily moves. VIX has no good proxy
// (volatility ETPs decay and diverge from spot VIX), so it's real-symbol-or-nothing.
// Oil uses the USO ETF's own real price directly (no proxy ETF for WTI itself). The 10-
// year yield comes straight from the US Treasury's own public daily-rates CSV feed (no
// key needed). Bitcoin comes from CoinGecko's public, keyless simple-price endpoint.
//
// Requires these set in the Cloudflare dashboard (Worker > Settings):
//   - Secret "FINNHUB_API_KEY": a free key from finnhub.io
//   - Secret "TWELVEDATA_API_KEY": a free key from twelvedata.com (used only for /candles --
//     Finnhub's free tier doesn't include historical candles at all, confirmed via Finnhub's
//     own docs and independent reports of free keys getting a 403 on /stock/candle. Twelve
//     Data's free Basic plan (800 requests/day, 8/min) covers intraday and daily/weekly
//     history, which is enough for one person's single-ticker chart views.)
//   - Binding "AI": the built-in Workers AI binding (free tier, no extra signup)
//   - Secret "SPOTIFY_CLIENT_SECRET": from the app registered at developer.spotify.com/dashboard
//   - Secret "VAPID_PRIVATE_KEY": generated alongside VAPID_PUBLIC_KEY below, for Web Push
//   - KV namespace binding "PUSH_SUBS": Settings > Bindings > Add > KV Namespace
//   - A Cron Trigger (Settings > Triggers > Cron Triggers), e.g. "0 13 * * *" (~8am ET) for the
//     scheduled() handler to actually run on its own
//
// Reuters shut down its public RSS feeds a few years back and Yahoo Finance never
// offered an official API, so neither is included. Dow Jones' WSJ feeds
// (feeds.a.dj.com) are also dead in practice -- every endpoint tested returns content
// frozen at January 2025. NYT, MarketWatch, and CNBC all still run active public feeds.

const ALLOWED_ORIGIN = 'https://theotverner.github.io';

// Not secret (Spotify Client IDs are public by design) -- set once you've registered the app.
const SPOTIFY_CLIENT_ID = 'REPLACE_WITH_YOUR_SPOTIFY_CLIENT_ID';

// Not secret -- the matching VAPID_PRIVATE_KEY is a Cloudflare secret, never in this file.
const VAPID_PUBLIC_KEY = 'BIm-iTQBPacSFStOaDaOL-Vgp64I-_0dlw4rJVGG_OiRTi1nk5f8CBYNdZ1Dw7MhtDi_IMUpSt5HBGSE_7JNAz8';
const VAPID_SUBJECT = 'https://theotverner.github.io/daybook-research-app/';

// Podcast lookups against itunes.apple.com now happen client-side, in app.js -- Apple
// returns access-control-allow-origin:* on that endpoint (meant to be called from a browser)
// and 403s Cloudflare Workers' shared egress IPs, so this Worker can't do that fetch reliably.

// id values are stable keys the client uses to say which sources are enabled (?sources=nyt,cnbc).
// WSJ and Yahoo Finance are deliberately excluded: WSJ's feeds are dead (frozen since Jan 2025,
// re-verified), Yahoo Finance has no working public feed at all (every endpoint tested 404/400).
const FEEDS = [
  { id: 'nyt', source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { id: 'marketwatch', source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'cnbc', source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'bloomberg', source: 'Bloomberg', url: 'https://www.bloomberg.com/feeds/markets/news.rss' },
  { id: 'ft', source: 'Financial Times', url: 'https://www.ft.com/world?format=rss' }
];

const EXPLAIN_MODEL = '@cf/meta/llama-3.2-3b-instruct';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === '/quotes') return await handleQuotes(url, env);
      if (url.pathname === '/indices') return await handleIndices(env);
      if (url.pathname === '/explain') return await handleExplain(url, env);
      if (url.pathname === '/earnings') return await handleEarnings(url, env);
      if (url.pathname === '/company-news') return await handleCompanyNews(url, env);
      if (url.pathname === '/candles') return await handleCandles(url, env);
      if (url.pathname === '/spotify/token' && request.method === 'POST') return await handleSpotifyToken(request, env);
      if (url.pathname === '/spotify/shows') return await handleSpotifyShows(url, env);
      if (url.pathname === '/push/subscribe' && request.method === 'POST') return await handlePushSubscribe(request, env);
      if (url.pathname === '/push/unsubscribe' && request.method === 'POST') return await handlePushUnsubscribe(request, env);
      if (url.pathname === '/push/test' && request.method === 'POST') return await handlePushTest(env);
      return await handleNews(url);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },

  // Cron Trigger entry point -- runs on its own schedule, independent of any request.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkEarningsAndNotify(env));
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(body, status, cacheSeconds) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders() };
  if (cacheSeconds) headers['Cache-Control'] = 'public, max-age=' + cacheSeconds;
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

// ---- /  (news) ----

async function handleNews(url) {
  const requested = (url.searchParams.get('sources') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const feeds = requested.length ? FEEDS.filter((f) => requested.includes(f.id)) : FEEDS;
  const perFeed = await Promise.all(feeds.map(fetchFeed));
  // Don't trust each feed's own document order -- Bloomberg's, for one, is actually
  // oldest-first, the opposite of the usual RSS convention. Sort explicitly per source.
  const sortedPerFeed = perFeed.map((list) => list.slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)));
  const items = interleaveBySource(sortedPerFeed).slice(0, 24);
  return json({ items }, 200, 300);
}

// Round-robin by source (each source's Nth-most-recent item, sorted by recency within that
// round) instead of a flat global sort -- a prolific source like Bloomberg would otherwise
// crowd every other source out of the top N just by posting more often.
function interleaveBySource(perFeedLists) {
  const maxLen = perFeedLists.reduce((max, list) => Math.max(max, list.length), 0);
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const round = perFeedLists.map((list) => list[i]).filter(Boolean);
    round.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    result.push(...round);
  }
  return result;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaybookNewsProxy/1.0)' } });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseItems(xml, feed.source);
  } catch (err) {
    return [];
  }
}

function parseItems(xml, source) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks.slice(0, 10)) {
    const body = block.split('</item>')[0];
    const title = extractTag(body, 'title');
    const link = extractTag(body, 'link');
    const description = extractTag(body, 'description');
    const pubDate = extractTag(body, 'pubDate');
    if (title && link) {
      items.push({
        source,
        title: cleanText(title),
        summary: cleanText(description).slice(0, 220),
        link: cleanText(link),
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }
  return items;
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : '';
}

function cleanText(str) {
  return str
    .replace('<![CDATA[', '')
    .replace(']]>', '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex){ return String.fromCodePoint(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function(_, dec){ return String.fromCodePoint(parseInt(dec, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

// ---- /quotes (Finnhub) ----

async function handleQuotes(url, env) {
  const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return json({ error: 'no symbols given' }, 400);
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 500);

  const pairs = await Promise.all(symbols.map(async (sym) => {
    try {
      const [quoteRes, profileRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_API_KEY}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_API_KEY}`)
      ]);
      if (!quoteRes.ok) return [sym, null];
      const quote = await quoteRes.json();
      if (typeof quote.c !== 'number' || quote.c === 0) return [sym, null];

      let name = null;
      if (profileRes.ok) {
        const profile = await profileRes.json();
        if (profile && profile.name) name = profile.name;
      }

      return [sym, { price: quote.c, change: quote.d, changePercent: quote.dp, name }];
    } catch (err) {
      return [sym, null];
    }
  }));

  const quotes = {};
  for (const [sym, quote] of pairs) quotes[sym] = quote;
  return json({ quotes }, 200, 60);
}

// ---- /indices (real major-index/VIX/yield/oil/bitcoin data -- see note at top) ----

const INDEX_DEFS = [
  { key: 'sp500', label: 'S&P 500', realSymbol: '^GSPC', proxySymbol: 'SPY', proxyMultiplier: 10 },
  { key: 'dow', label: 'DOW', realSymbol: '^DJI', proxySymbol: 'DIA', proxyMultiplier: 100 },
  { key: 'nasdaq', label: 'NASDAQ', realSymbol: '^IXIC', proxySymbol: 'QQQ', proxyMultiplier: null },
  { key: 'russell2000', label: 'RUSSELL 2K', realSymbol: '^RUT', proxySymbol: 'IWM', proxyMultiplier: 10 },
  { key: 'vix', label: 'VIX', realSymbol: '^VIX', proxySymbol: null, proxyMultiplier: null }
];

async function finnhubQuote(sym, env) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_API_KEY}`);
    if (!res.ok) return null;
    const q = await res.json();
    if (typeof q.c !== 'number' || q.c === 0) return null;
    return q;
  } catch (err) {
    return null;
  }
}

async function resolveIndex(def, env) {
  const real = await finnhubQuote(def.realSymbol, env);
  if (real) {
    return { key: def.key, label: def.label, value: real.c, changePercent: real.dp, format: 'index2dp', deltaDisplay: 'percent', source: 'index' };
  }
  if (def.proxySymbol) {
    const proxy = await finnhubQuote(def.proxySymbol, env);
    if (proxy) {
      const mult = def.proxyMultiplier || 1;
      return { key: def.key, label: def.label, value: proxy.c * mult, changePercent: proxy.dp, format: 'index2dp', deltaDisplay: 'percent', source: 'proxy:' + def.proxySymbol };
    }
  }
  return { key: def.key, label: def.label, value: null, changePercent: null, format: 'index2dp', deltaDisplay: 'percent', source: 'unavailable' };
}

async function resolveOil(env) {
  const proxy = await finnhubQuote('USO', env);
  if (!proxy) return { key: 'wti', label: 'WTI CRUDE', value: null, changePercent: null, format: 'currency2dp', deltaDisplay: 'percent', source: 'unavailable' };
  return { key: 'wti', label: 'WTI CRUDE', value: proxy.c, changePercent: proxy.dp, format: 'currency2dp', deltaDisplay: 'percent', source: 'proxy:USO' };
}

async function resolveBitcoin() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
    if (!res.ok) return { key: 'btc', label: 'BITCOIN', value: null, changePercent: null, format: 'currency0dp', deltaDisplay: 'percent', source: 'unavailable' };
    const data = await res.json();
    const btc = data && data.bitcoin;
    if (!btc || typeof btc.usd !== 'number') return { key: 'btc', label: 'BITCOIN', value: null, changePercent: null, format: 'currency0dp', deltaDisplay: 'percent', source: 'unavailable' };
    return { key: 'btc', label: 'BITCOIN', value: btc.usd, changePercent: btc.usd_24h_change, format: 'currency0dp', deltaDisplay: 'percent', source: 'coingecko' };
  } catch (err) {
    return { key: 'btc', label: 'BITCOIN', value: null, changePercent: null, format: 'currency0dp', deltaDisplay: 'percent', source: 'unavailable' };
  }
}

// US Treasury's own public daily par-yield-curve feed -- no key, CSV, newest row first.
async function resolveTenYearYield() {
  try {
    const year = new Date().getFullYear();
    const feedUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error('bad response');
    const csv = await res.text();
    const lines = csv.trim().split('\n').filter(Boolean);
    if (lines.length < 2) throw new Error('empty feed');
    const header = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
    const idx10 = header.findIndex((h) => h === '10 Yr');
    if (idx10 === -1) throw new Error('10 Yr column not found');
    const cols = (line) => line.split(',').map((c) => c.replace(/"/g, '').trim());
    const latest = parseFloat(cols(lines[1])[idx10]);
    const prev = lines.length > 2 ? parseFloat(cols(lines[2])[idx10]) : NaN;
    if (isNaN(latest)) throw new Error('no 10yr value');
    const pointChange = isNaN(prev) ? null : +(latest - prev).toFixed(2);
    return { key: 'tenY', label: '10Y YIELD', value: latest, pointChange, format: 'percent2dp', deltaDisplay: 'points', source: 'treasury.gov' };
  } catch (err) {
    return { key: 'tenY', label: '10Y YIELD', value: null, pointChange: null, format: 'percent2dp', deltaDisplay: 'points', source: 'unavailable' };
  }
}

async function handleIndices(env) {
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 500);
  const [sp500, dow, nasdaq, russell2000, vix, tenY, wti, btc] = await Promise.all([
    resolveIndex(INDEX_DEFS[0], env),
    resolveIndex(INDEX_DEFS[1], env),
    resolveIndex(INDEX_DEFS[2], env),
    resolveIndex(INDEX_DEFS[3], env),
    resolveIndex(INDEX_DEFS[4], env),
    resolveTenYearYield(),
    resolveOil(env),
    resolveBitcoin()
  ]);
  return json({ items: [sp500, dow, nasdaq, russell2000, vix, tenY, wti, btc] }, 200, 45);
}

// ---- /earnings (Finnhub earnings calendar) ----

async function handleEarnings(url, env) {
  const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return json({ error: 'no symbols given' }, 400);
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 500);

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  // ~5 months out: companies report quarterly, so this window reliably catches the next one.
  const to = new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const pairs = await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_API_KEY}`);
      if (!res.ok) return [sym, null];
      const data = await res.json();
      const list = (data && data.earningsCalendar) || [];
      const upcoming = list.filter((e) => e.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (!upcoming) return [sym, null];
      return [sym, { date: upcoming.date, hour: upcoming.hour || '' }];
    } catch (err) {
      return [sym, null];
    }
  }));

  const earnings = {};
  for (const [sym, info] of pairs) earnings[sym] = info;
  return json({ earnings }, 200, 3600);
}

// ---- /company-news (Finnhub, real per-company articles) ----

async function fetchCompanyNews(sym, env) {
  const to = new Date();
  const from = new Date(to.getTime() - 10 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${fmt(from)}&to=${fmt(to)}&token=${env.FINNHUB_API_KEY}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, 8).map((item) => ({
      source: item.source || 'Finnhub',
      title: item.headline || '',
      summary: (item.summary || '').slice(0, 220),
      link: item.url || '',
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : new Date().toISOString(),
      symbol: sym
    })).filter((item) => item.title && item.link);
  } catch (err) {
    return [];
  }
}

async function handleCompanyNews(url, env) {
  const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return json({ error: 'no symbols given' }, 400);
  if (!env.FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY not configured' }, 500);

  const perSymbol = await Promise.all(symbols.map((sym) => fetchCompanyNews(sym, env)));
  const items = perSymbol.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return json({ items }, 200, 300);
}

// ---- /candles (historical close prices via Twelve Data -- see note at top on why not Finnhub) ----

const CANDLE_RANGE_CONFIG = {
  '1D': { interval: '5min', outputsize: 80, cacheSeconds: 120 },
  '5D': { interval: '30min', outputsize: 65, cacheSeconds: 300 },
  '3M': { interval: '1day', outputsize: 65, cacheSeconds: 1800 },
  '6M': { interval: '1day', outputsize: 130, cacheSeconds: 1800 },
  '1Y': { interval: '1day', outputsize: 252, cacheSeconds: 1800 },
  'ALL': { interval: '1week', outputsize: 5000, cacheSeconds: 3600 }
};

async function handleCandles(url, env) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const range = (url.searchParams.get('range') || '1D').trim().toUpperCase();
  const config = CANDLE_RANGE_CONFIG[range] || CANDLE_RANGE_CONFIG['1D'];
  if (!symbol) return json({ error: 'symbol required' }, 400);
  if (!env.TWELVEDATA_API_KEY) return json({ error: 'TWELVEDATA_API_KEY not configured' }, 500);

  try {
    const apiUrl = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(symbol) +
      '&interval=' + config.interval + '&outputsize=' + config.outputsize + '&apikey=' + env.TWELVEDATA_API_KEY;
    const res = await fetch(apiUrl);
    const data = await res.json();
    if (!data.values) return json({ points: [], error: data.message || 'no data available' }, 200, 60);

    // Twelve Data returns newest-first; the chart wants oldest-first.
    const points = data.values
      .map((v) => ({ t: v.datetime, c: parseFloat(v.close) }))
      .filter((p) => !isNaN(p.c))
      .reverse();
    return json({ points }, 200, config.cacheSeconds);
  } catch (err) {
    return json({ points: [], error: String(err) }, 200, 60);
  }
}

// ---- /explain (news match + Workers AI, grounded only) ----

async function handleExplain(url, env) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const name = (url.searchParams.get('name') || '').trim();
  if (!symbol || !name) return json({ error: 'symbol and name are required' }, 400);

  // Prefer Finnhub's real per-company news (much better hit rate for anything beyond the
  // largest names) and only fall back to matching the general market-news pool if Finnhub
  // has nothing for this symbol.
  let matches = env.FINNHUB_API_KEY ? await fetchCompanyNews(symbol, env) : [];
  matches = matches.slice(0, 4);

  if (matches.length === 0) {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const pool = results.flat();
    const nameLower = name.toLowerCase();
    matches = pool.filter((item) => item.title.toLowerCase().includes(nameLower)).slice(0, 4);
  }

  if (matches.length === 0) {
    return json({
      summary: 'No recent headlines mention ' + name + ' in the feeds this app pulls from — no grounded explanation available.',
      sources: []
    }, 200, 300);
  }

  const headlineList = matches.map((m, i) => (i + 1) + '. ' + m.title + ' (' + m.source + ')').join('\n');
  const prompt = 'Stock: ' + name + ' (' + symbol + ').\n' +
    'Recent real headlines that mention this company:\n' + headlineList + '\n\n' +
    'In one or two short sentences, explain the likely reason for the stock\'s recent move based ONLY on these headlines. ' +
    'Do not invent any reason not supported by them. If the headlines don\'t clearly explain a price move, say so plainly.';

  try {
    const aiResponse = await env.AI.run(EXPLAIN_MODEL, {
      messages: [
        { role: 'system', content: 'You are a terse financial news summarizer. Be factual and concise. Never speculate beyond the given headlines.' },
        { role: 'user', content: prompt }
      ]
    });
    const summary = (aiResponse && aiResponse.response) ? aiResponse.response.trim() : 'Could not generate a summary right now.';
    return json({
      summary,
      sources: matches.map((m) => ({ title: m.title, source: m.source, link: m.link }))
    }, 200, 300);
  } catch (err) {
    return json({
      summary: "Couldn't reach the summarizer right now. Recent related headlines are listed below.",
      sources: matches.map((m) => ({ title: m.title, source: m.source, link: m.link }))
    }, 200, 60);
  }
}

// ---- /spotify/token and /spotify/shows ----

async function handleSpotifyToken(request, env) {
  if (!env.SPOTIFY_CLIENT_SECRET) return json({ error: 'SPOTIFY_CLIENT_SECRET not configured' }, 500);
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid request body' }, 400);
  }
  const code = body && body.code;
  const redirectUri = body && body.redirect_uri;
  if (!code || !redirectUri) return json({ error: 'code and redirect_uri are required' }, 400);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (!res.ok) return json({ error: data.error_description || 'token exchange failed' }, 400);

  return json({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }, 200);
}

async function spotifyAccessTokenFromRefresh(refreshToken, env) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function handleSpotifyShows(url, env) {
  if (!env.SPOTIFY_CLIENT_SECRET) return json({ error: 'SPOTIFY_CLIENT_SECRET not configured' }, 500);
  const refreshToken = url.searchParams.get('refresh_token');
  if (!refreshToken) return json({ error: 'refresh_token is required' }, 400);

  const accessToken = await spotifyAccessTokenFromRefresh(refreshToken, env);
  if (!accessToken) return json({ error: 'could not refresh the Spotify session' }, 401);

  const showsRes = await fetch('https://api.spotify.com/v1/me/shows?limit=20', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  if (!showsRes.ok) return json({ error: 'Spotify shows request failed' }, 502);
  const showsData = await showsRes.json();
  const items = (showsData && showsData.items) || [];

  const shows = await Promise.all(items.map(async (entry) => {
    const show = entry.show;
    let latestEpisode = null;
    try {
      const epRes = await fetch(`https://api.spotify.com/v1/shows/${show.id}/episodes?limit=1`, {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (epRes.ok) {
        const epData = await epRes.json();
        const ep = epData && epData.items && epData.items[0];
        if (ep) {
          latestEpisode = {
            name: ep.name,
            releaseDate: ep.release_date,
            url: ep.external_urls && ep.external_urls.spotify
          };
        }
      }
    } catch (err) {
      // leave latestEpisode null, the show itself still renders
    }
    return {
      id: show.id,
      name: show.name,
      publisher: show.publisher,
      image: (show.images && show.images[0] && show.images[0].url) || null,
      url: show.external_urls && show.external_urls.spotify,
      latestEpisode
    };
  }));

  return json({ shows }, 200, 300);
}

// ---- /push/* (Web Push subscription management + earnings-reminder logic) ----

const PUSH_SUB_KEY = 'push_subscription';

async function handlePushSubscribe(request, env) {
  if (!env.PUSH_SUBS) return json({ error: 'PUSH_SUBS KV binding not configured' }, 500);
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid request body' }, 400);
  }
  const subscription = body && body.subscription;
  const symbols = (body && Array.isArray(body.symbols)) ? body.symbols : [];
  if (!subscription || !subscription.endpoint) return json({ error: 'subscription is required' }, 400);

  const existingRaw = await env.PUSH_SUBS.get(PUSH_SUB_KEY);
  const existing = existingRaw ? JSON.parse(existingRaw) : {};
  const record = { subscription, symbols, notified: existing.notified || {} };
  await env.PUSH_SUBS.put(PUSH_SUB_KEY, JSON.stringify(record));
  return json({ ok: true }, 200);
}

async function handlePushUnsubscribe(request, env) {
  if (!env.PUSH_SUBS) return json({ error: 'PUSH_SUBS KV binding not configured' }, 500);
  await env.PUSH_SUBS.delete(PUSH_SUB_KEY);
  return json({ ok: true }, 200);
}

async function handlePushTest(env) {
  if (!env.PUSH_SUBS) return json({ error: 'PUSH_SUBS KV binding not configured' }, 500);
  const raw = await env.PUSH_SUBS.get(PUSH_SUB_KEY);
  if (!raw) return json({ error: 'no stored subscription -- enable notifications in the app first' }, 404);
  const record = JSON.parse(raw);
  try {
    await sendWebPush(record.subscription, {
      title: 'Daybook test notification',
      body: 'If you can see this, push notifications are working.',
      url: VAPID_SUBJECT
    }, env);
    return json({ ok: true }, 200);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 500);
  }
}

// Cron-triggered: checks every subscribed symbol's next earnings date and sends a push for
// anything landing today or tomorrow, deduped per symbol+date so it only fires once each.
async function checkEarningsAndNotify(env) {
  if (!env.PUSH_SUBS || !env.FINNHUB_API_KEY) return;
  const raw = await env.PUSH_SUBS.get(PUSH_SUB_KEY);
  if (!raw) return;
  const record = JSON.parse(raw);
  const symbols = record.symbols || [];
  if (!symbols.length) return;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrowStr = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const notified = record.notified || {};
  let changed = false;

  for (const sym of symbols) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${todayStr}&to=${tomorrowStr}&symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_API_KEY}`);
      if (!res.ok) continue;
      const data = await res.json();
      const list = (data && data.earningsCalendar) || [];
      for (const e of list) {
        if (e.date !== todayStr && e.date !== tomorrowStr) continue;
        const dedupeKey = sym + '|' + e.date;
        if (notified[dedupeKey]) continue;

        const when = e.date === todayStr ? 'Today' : 'Tomorrow';
        const hourLabel = e.hour === 'bmo' ? ' (before market open)' : e.hour === 'amc' ? ' (after market close)' : '';
        await sendWebPush(record.subscription, {
          title: 'Earnings ' + when + ': ' + sym,
          body: sym + ' reports earnings ' + when.toLowerCase() + hourLabel + '.',
          url: VAPID_SUBJECT + '#calendar'
        }, env);

        notified[dedupeKey] = true;
        changed = true;
      }
    } catch (err) {
      // skip this symbol, keep checking the rest
    }
  }

  if (changed) {
    record.notified = notified;
    await env.PUSH_SUBS.put(PUSH_SUB_KEY, JSON.stringify(record));
  }
}

// ---- Web Push (RFC 8291 payload encryption + RFC 8292 VAPID auth), hand-rolled with the
// Workers runtime's built-in Web Crypto API since there's no Node/npm here to use the
// standard `web-push` library. HKDF is implemented directly over HMAC (not WebCrypto's
// combined 'HKDF' algorithm) so each extract/expand step matches the RFC exactly. ----

function base64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, length) {
  // Every length needed here is <= 32 bytes (SHA-256's output size), so a single HMAC round
  // (RFC 5869's T(1)) is always sufficient -- no need for the general multi-round case.
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

async function encryptPushPayload(payloadObj, p256dhB64, authB64) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const uaPublicBytes = base64urlToBytes(p256dhB64);
  const authSecret = base64urlToBytes(authB64);

  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256));

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPublicBytes, asPublicBytes);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const padded = concatBytes(payloadBytes, new Uint8Array([2])); // 0x02 = final/only record
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublicBytes.length;
  header.set(asPublicBytes, 21);

  return concatBytes(header, ciphertext);
}

async function buildVapidAuthHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = { typ: 'JWT', alg: 'ES256' };
  const jwtPayload = { aud, exp: now + 12 * 3600, sub: VAPID_SUBJECT };
  const signingInput = bytesToBase64url(new TextEncoder().encode(JSON.stringify(jwtHeader))) + '.' +
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(jwtPayload)));

  const privBytes = base64urlToBytes(env.VAPID_PRIVATE_KEY);
  const pubBytes = base64urlToBytes(VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToBase64url(pubBytes.slice(1, 33)),
    y: bytesToBase64url(pubBytes.slice(33, 65)),
    d: bytesToBase64url(privBytes)
  };
  const signKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(signingInput)
  ));
  const jwt = signingInput + '.' + bytesToBase64url(signature);
  return 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC_KEY;
}

async function sendWebPush(subscription, payloadObj, env) {
  if (!env.VAPID_PRIVATE_KEY) throw new Error('VAPID_PRIVATE_KEY not configured');
  const body = await encryptPushPayload(payloadObj, subscription.keys.p256dh, subscription.keys.auth);
  const authHeader = await buildVapidAuthHeader(subscription.endpoint, env);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': authHeader
    },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('push service returned ' + res.status + ': ' + text);
  }
}

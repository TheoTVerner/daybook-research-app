// Daybook backend — one Cloudflare Worker, these routes:
//   GET /            -> real news headlines (NYT, MarketWatch, CNBC RSS, server-side to dodge CORS)
//   GET /quotes?symbols=AAPL,MSFT  -> real price + day change + company name via Finnhub (free tier)
//   GET /explain?symbol=NVDA&name=Nvidia  -> a grounded "why is it moving" summary via Workers AI
//   GET /earnings?symbols=AAPL,MSFT  -> each symbol's next real earnings-call date via Finnhub
//   POST /spotify/token  {code, redirect_uri}  -> exchanges an OAuth code for Spotify tokens
//   GET /spotify/shows?refresh_token=...  -> the user's real followed shows + latest episode
//
// Requires these set in the Cloudflare dashboard (Worker > Settings):
//   - Secret "FINNHUB_API_KEY": a free key from finnhub.io
//   - Binding "AI": the built-in Workers AI binding (free tier, no extra signup)
//   - Secret "SPOTIFY_CLIENT_SECRET": from the app registered at developer.spotify.com/dashboard
//
// Reuters shut down its public RSS feeds a few years back and Yahoo Finance never
// offered an official API, so neither is included. Dow Jones' WSJ feeds
// (feeds.a.dj.com) are also dead in practice -- every endpoint tested returns content
// frozen at January 2025. NYT, MarketWatch, and CNBC all still run active public feeds.

const ALLOWED_ORIGIN = 'https://theotverner.github.io';

// Not secret (Spotify Client IDs are public by design) -- set once you've registered the app.
const SPOTIFY_CLIENT_ID = 'REPLACE_WITH_YOUR_SPOTIFY_CLIENT_ID';

const FEEDS = [
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' }
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
      if (url.pathname === '/explain') return await handleExplain(url, env);
      if (url.pathname === '/earnings') return await handleEarnings(url, env);
      if (url.pathname === '/spotify/token' && request.method === 'POST') return await handleSpotifyToken(request, env);
      if (url.pathname === '/spotify/shows') return await handleSpotifyShows(url, env);
      return await handleNews();
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
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

async function handleNews() {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const items = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 24);
  return json({ items }, 200, 300);
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

// ---- /explain (news match + Workers AI, grounded only) ----

async function handleExplain(url, env) {
  const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const name = (url.searchParams.get('name') || '').trim();
  if (!symbol || !name) return json({ error: 'symbol and name are required' }, 400);

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const pool = results.flat();
  const nameLower = name.toLowerCase();
  const matches = pool.filter((item) => item.title.toLowerCase().includes(nameLower)).slice(0, 4);

  if (matches.length === 0) {
    return json({
      summary: 'No recent headlines mention ' + name + ' in the general market feeds this app pulls from — no grounded explanation available.',
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

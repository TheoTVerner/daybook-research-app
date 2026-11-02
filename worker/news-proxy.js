// Daybook news proxy — fetches public RSS feeds server-side (browsers can't due to CORS)
// and returns clean JSON. Deploy as a Cloudflare Worker (paste into the dashboard's
// online editor, no local tooling needed).
//
// Reuters shut down its public RSS feeds a few years back and Yahoo Finance never
// offered an official API, so neither is included here. Dow Jones' WSJ feeds
// (feeds.a.dj.com) are also dead in practice -- every endpoint tested returns content
// frozen at January 2025, so WSJ is left out too until/unless they bring a feed back.
// NYT, MarketWatch, and CNBC all still run active public RSS feeds.

const ALLOWED_ORIGIN = 'https://theotverner.github.io';

const FEEDS = [
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' }
];

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    try {
      const results = await Promise.all(FEEDS.map(fetchFeed));
      const items = results
        .flat()
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 24);
      return new Response(JSON.stringify({ items }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders()
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DaybookNewsProxy/1.0)' }
    });
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

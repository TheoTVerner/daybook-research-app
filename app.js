var NEWS_API = 'https://daybook-research.ttverner.workers.dev/';
var SPOTIFY_CLIENT_ID = 'REPLACE_WITH_YOUR_SPOTIFY_CLIENT_ID';
var SPOTIFY_REDIRECT_URI = 'https://theotverner.github.io/daybook-research-app/';
var SPOTIFY_TOKEN_KEY = 'daybook_spotify_refresh_token';

function collectHeldSymbols(){
  var rows = document.querySelectorAll('#portfolioStocks [data-sym], #portfolioETFs [data-sym], #portfolioFunds [data-sym], #watchlistList [data-sym]');
  var syms = [];
  rows.forEach(function(li){ if(syms.indexOf(li.dataset.sym) === -1) syms.push(li.dataset.sym); });
  return syms;
}

function collectSymbolsFrom(selector){
  var rows = document.querySelectorAll(selector);
  var syms = [];
  rows.forEach(function(li){ if(syms.indexOf(li.dataset.sym) === -1) syms.push(li.dataset.sym); });
  return syms;
}
function collectPortfolioSymbols(){
  return collectSymbolsFrom('#portfolioStocks [data-sym], #portfolioETFs [data-sym], #portfolioFunds [data-sym]');
}
function collectWatchlistSymbols(){
  return collectSymbolsFrom('#watchlistList [data-sym]');
}

function switchTab(name){
  document.querySelectorAll('.panel').forEach(function(p){ p.hidden = p.id !== 'panel-' + name; });
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === name); });
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ switchTab(t.dataset.tab); });
});

function updateDate(){
  try{
    document.getElementById('todayDate').textContent =
      new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }).toUpperCase();
  }catch(e){}
}
updateDate();

var CAL_MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

function earningsHourLabel(hour){
  if(hour === 'bmo') return 'Before Open';
  if(hour === 'amc') return 'After Close';
  if(hour === 'dmh') return 'During Market';
  return '';
}

function renderCalGrid(year, month, todayDate, eventDaysThisMonth){
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  for(var i = 0; i < firstDay; i++){
    var empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }
  for(var d = 1; d <= daysInMonth; d++){
    var cell = document.createElement('div');
    cell.className = 'cal-day' + (d === todayDate ? ' today' : '');
    cell.innerHTML = d + ((eventDaysThisMonth && eventDaysThisMonth[d]) ? '<span class="cal-dot"></span>' : '');
    grid.appendChild(cell);
  }
}

function buildCalendar(){
  var now = new Date();
  var year = now.getFullYear(), month = now.getMonth(), todayDate = now.getDate();
  document.getElementById('calMonthLabel').textContent = CAL_MONTH_NAMES[month] + ' ' + year;

  var list = document.getElementById('calEventsList');
  var syms = collectHeldSymbols();

  if(!syms.length){
    renderCalGrid(year, month, todayDate, null);
    emptyState(list, 'Add stocks to your portfolio or watchlist to see upcoming earnings dates.');
    return;
  }

  fetch(NEWS_API + 'earnings?symbols=' + encodeURIComponent(syms.join(',')))
    .then(function(res){ return res.json(); })
    .then(function(data){
      var earningsBySym = data.earnings || {};
      var events = [];
      syms.forEach(function(sym){
        var e = earningsBySym[sym];
        if(!e || !e.date) return;
        var parts = e.date.split('-');
        events.push({
          sym: sym,
          year: parseInt(parts[0], 10),
          month: parseInt(parts[1], 10) - 1,
          day: parseInt(parts[2], 10),
          time: earningsHourLabel(e.hour)
        });
      });
      events.sort(function(a, b){
        return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
      });

      var eventDaysThisMonth = {};
      events.forEach(function(e){ if(e.year === year && e.month === month) eventDaysThisMonth[e.day] = true; });
      renderCalGrid(year, month, todayDate, eventDaysThisMonth);

      list.innerHTML = '';
      if(events.length === 0){
        emptyState(list, 'No upcoming earnings dates found for your current holdings and watchlist in the next few months.');
        return;
      }
      events.forEach(function(e){
        var li = document.createElement('li');
        var dateLabel = CAL_MONTH_NAMES[e.month].slice(0, 3) + ' ' + e.day;
        li.innerHTML = '<span class="cal-date">' + dateLabel + '</span>' +
          '<span class="cal-pill">' + e.sym + '</span><span class="cal-title">Earnings Call</span>' +
          '<span class="cal-time">' + (e.time || '') + '</span>';
        list.appendChild(li);
      });
    })
    .catch(function(){
      renderCalGrid(year, month, todayDate, null);
      emptyState(list, "Couldn't load earnings dates right now.");
    });
}

// Heuristic only (no real security-type data source wired up yet): mutual funds are
// conventionally a 5-letter ticker ending in X; everything else known here is a short
// list of common ETFs, otherwise default to a plain stock.
var KNOWN_ETFS = ['SPY','VOO','QQQ','VTI','IVV','IWM','DIA','ARKK','VXUS','SCHD','VYM','XLK','XLF','GLD','BND','AGG'];
function guessSecurityType(sym){
  if(/^[A-Z]{4}X$/.test(sym)) return 'fund';
  if(KNOWN_ETFS.indexOf(sym) !== -1) return 'etf';
  return 'stock';
}
var GROUP_LIST_IDS = { stock:'portfolioStocks', etf:'portfolioETFs', fund:'portfolioFunds' };

var currentEditLi = null;

function openEditOverlay(btn){
  var li = btn.closest('li');
  currentEditLi = li;
  var isWatchlist = !!li.closest('#watchlistList');

  document.getElementById('editSym').textContent = li.dataset.sym;
  document.getElementById('editName').textContent = li.dataset.name;
  document.getElementById('editPrice').textContent = li.querySelector('.price').textContent;

  var chgEl = li.querySelector('.chg');
  var editChg = document.getElementById('editChg');
  editChg.textContent = chgEl.textContent;
  editChg.className = 'edit-chg ' + (chgEl.classList.contains('up') ? 'up' : 'down');

  document.getElementById('editHeaderTitle').textContent = isWatchlist ? 'Stock Detail' : 'Edit Position';
  document.getElementById('editSaveBtn').hidden = isWatchlist;
  document.getElementById('editFieldsWrap').hidden = isWatchlist;
  document.getElementById('editRemoveBtn').textContent = isWatchlist ? 'Remove from Watchlist' : 'Remove from Portfolio';

  if(!isWatchlist){
    document.getElementById('editSharesInput').value = parseFloat(li.querySelector('.qty-display').textContent) || 0;
    document.getElementById('editInvestedInput').value = parseFloat(li.querySelector('.val-display').textContent.replace(/[^0-9.]/g, '')) || 0;
    document.getElementById('editTypeInput').value = li.dataset.type || 'stock';
  }

  document.getElementById('editOverlay').hidden = false;
  loadExplain(li.dataset.sym, NAME_HINTS[li.dataset.sym] || li.dataset.name);
}

function loadExplain(sym, name){
  var textEl = document.getElementById('editExplainText');
  var sourcesEl = document.getElementById('editExplainSources');
  textEl.textContent = 'Loading…';
  sourcesEl.innerHTML = '';
  fetch(NEWS_API + 'explain?symbol=' + encodeURIComponent(sym) + '&name=' + encodeURIComponent(name))
    .then(function(res){ return res.json(); })
    .then(function(data){
      textEl.textContent = data.summary || 'No summary available.';
      (data.sources || []).forEach(function(s){
        var sLi = document.createElement('li');
        var a = document.createElement('a');
        a.href = s.link; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = s.title + ' — ' + s.source;
        sLi.appendChild(a);
        sourcesEl.appendChild(sLi);
      });
    })
    .catch(function(){
      textEl.textContent = "Couldn't load a summary right now.";
    });
}

function closeEditOverlay(){
  document.getElementById('editOverlay').hidden = true;
  currentEditLi = null;
}

function saveEditOverlay(){
  if(!currentEditLi) return;
  var shares = parseFloat(document.getElementById('editSharesInput').value) || 0;
  var invested = parseFloat(document.getElementById('editInvestedInput').value) || 0;
  var newType = document.getElementById('editTypeInput').value;

  currentEditLi.querySelector('.qty-display').textContent = shares + ' sh';
  currentEditLi.querySelector('.val-display').textContent = '$' + invested.toLocaleString();

  if(newType !== currentEditLi.dataset.type){
    currentEditLi.dataset.type = newType;
    var target = document.getElementById(GROUP_LIST_IDS[newType]);
    if(target) target.appendChild(currentEditLi);
  }
  closeEditOverlay();
}

function removeEditPosition(){
  var wasWatchlist = currentEditLi && !!currentEditLi.closest('#watchlistList');
  if(currentEditLi) currentEditLi.remove();
  closeEditOverlay();
  buildCalendar();
  syncPushSymbols();
  if(wasWatchlist) loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
  else loadCompanyNews('portfolioStories', collectPortfolioSymbols(), PORTFOLIO_MATCH, 'holdings');
}

function toggleConnector(btn){
  var card = btn.closest('.connector-card');
  var connected = card.classList.toggle('connected');
  btn.textContent = connected ? 'Disconnect' : 'Connect';
  var status = card.querySelector('.connector-status');
  if(status) status.textContent = connected ? 'Connected' : 'Not connected';
}

var addForm = document.getElementById('addForm');
addForm.addEventListener('submit', function(e){
  e.preventDefault();
  var target = (e.submitter && e.submitter.dataset.target) || 'watchlist';
  var input = document.getElementById('symInput');
  var sym = input.value.trim().toUpperCase();
  if(!sym) return;
  input.value = '';
  fetchQuote(sym).then(function(quote){
    var priceStr = quote ? ('$' + quote.price.toFixed(2)) : '—';
    var chgVal = quote ? quote.changePercent : null;
    var chgStr = (chgVal === null) ? '—' : (chgVal >= 0 ? '+' : '') + chgVal.toFixed(1) + '%';
    var chgClass = (chgVal === null) ? '' : (chgVal >= 0 ? 'up' : 'down');

    // Prefer Finnhub's real company name; fall back to the curated hints, then the bare symbol.
    var displayName = (quote && quote.name) || NAME_HINTS[sym] || sym;
    var matchKeyword = NAME_HINTS[sym] || deriveMatchKeyword(displayName) || sym;
    NAME_HINTS[sym] = matchKeyword;

    if(target === 'portfolio'){
      var type = guessSecurityType(sym);
      var li1 = document.createElement('li');
      li1.dataset.sym = sym;
      li1.dataset.name = displayName;
      li1.dataset.type = type;
      li1.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + displayName + '</span>' +
        '<span class="qty-display">1 sh</span><span class="price">' + priceStr + '</span>' +
        '<span class="chg ' + chgClass + '">' + chgStr + '</span>' +
        '<span class="val-display">' + priceStr + '</span>' +
        '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="Edit position">✎</button>';
      document.getElementById(GROUP_LIST_IDS[type]).appendChild(li1);
      PORTFOLIO_MATCH[sym] = matchKeyword;
      loadCompanyNews('portfolioStories', collectPortfolioSymbols(), PORTFOLIO_MATCH, 'holdings');
    } else {
      var li2 = document.createElement('li');
      li2.dataset.sym = sym;
      li2.dataset.name = displayName;
      li2.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + displayName + '</span>' +
        '<span class="price">' + priceStr + '</span><span class="chg ' + chgClass + '">' + chgStr + '</span>' +
        '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="View details">›</button>' +
        '<button class="remove-btn" onclick="removeWatchlistRow(this)">✕</button>';
      document.getElementById('watchlistList').appendChild(li2);
      WATCHLIST_MATCH[sym] = matchKeyword;
      loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
    }
    buildCalendar();
    syncPushSymbols();
  });
});

function removeWatchlistRow(btn){
  btn.closest('li').remove();
  buildCalendar();
  syncPushSymbols();
  loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
}

// ---- Real news, fetched from the Cloudflare Worker RSS proxy ----
var newsPool = [];

var PORTFOLIO_MATCH = { AAPL:'Apple', MSFT:'Microsoft', NVDA:'Nvidia', AMZN:'Amazon', JPM:'JPMorgan', VOO:'Vanguard', FXAIX:'Fidelity' };
var WATCHLIST_MATCH = { TSLA:'Tesla', PLTR:'Palantir', COIN:'Coinbase', SOFI:'SoFi' };
var NAME_HINTS = Object.assign({}, PORTFOLIO_MATCH, WATCHLIST_MATCH);

// ---- Real quotes, fetched from the same Worker (Finnhub under the hood) ----
function fetchQuote(sym){
  return fetch(NEWS_API + 'quotes?symbols=' + encodeURIComponent(sym))
    .then(function(res){ return res.json(); })
    .then(function(data){ return (data.quotes && data.quotes[sym]) || null; })
    .catch(function(){ return null; });
}

// Strips common corporate suffixes to get a short keyword that's more likely to
// actually appear in a headline ("Apple" matches "Apple reports..."; "Apple Inc"
// usually doesn't). Used only as a fallback for tickers NAME_HINTS doesn't cover.
function deriveMatchKeyword(fullName){
  if(!fullName) return '';
  var stripped = fullName.replace(/,?\s*(Incorporated|Inc|Corporation|Corp|Company|Co|Limited|Ltd|PLC|Holdings|Group|Technologies|Technology|Industries|Enterprises)\.?\s*$/i, '').trim();
  return stripped.split(' ')[0];
}

function applyQuoteToLi(li, quote){
  if(!quote) return;
  var priceEl = li.querySelector('.price');
  var chgEl = li.querySelector('.chg');
  var nameEl = li.querySelector('.name');
  if(priceEl) priceEl.textContent = '$' + quote.price.toFixed(2);
  if(chgEl && typeof quote.changePercent === 'number'){
    var pct = quote.changePercent;
    chgEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    chgEl.classList.remove('up', 'down');
    chgEl.classList.add(pct >= 0 ? 'up' : 'down');
  }
  if(quote.name){
    if(nameEl) nameEl.textContent = quote.name;
    li.dataset.name = quote.name;
  }
}

function loadQuotes(){
  var rows = document.querySelectorAll('#portfolioStocks [data-sym], #portfolioETFs [data-sym], #portfolioFunds [data-sym], #watchlistList [data-sym]');
  var syms = collectHeldSymbols();
  if(!syms.length) return;
  fetch(NEWS_API + 'quotes?symbols=' + encodeURIComponent(syms.join(',')))
    .then(function(res){ return res.json(); })
    .then(function(data){
      var quotes = data.quotes || {};
      rows.forEach(function(li){ applyQuoteToLi(li, quotes[li.dataset.sym]); });
    })
    .catch(function(){ /* leave existing values in place rather than show an error for every row */ });
}

function timeAgo(iso){
  var diffMs = Date.now() - new Date(iso).getTime();
  var mins = Math.round(diffMs / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return mins + 'm ago';
  var hrs = Math.round(mins / 60);
  if(hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

// Built via DOM APIs (not innerHTML) since this renders real, untrusted feed content.
function createStoryElement(item, tickerPill){
  var article = document.createElement('article');
  article.className = 'story';

  var meta = document.createElement('div');
  meta.className = 'story-meta';
  var source = document.createElement('span'); source.className = 'source'; source.textContent = item.source;
  var dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '·';
  var time = document.createElement('span'); time.className = 'time'; time.textContent = timeAgo(item.publishedAt);
  meta.appendChild(source); meta.appendChild(dot); meta.appendChild(time);
  if(tickerPill){
    var pill = document.createElement('span'); pill.className = 'ticker-pill'; pill.textContent = tickerPill;
    meta.appendChild(pill);
  }

  var head = document.createElement('h3'); head.className = 'story-head';
  var a = document.createElement('a'); a.href = item.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = item.title;
  head.appendChild(a);

  var dek = document.createElement('p'); dek.className = 'story-dek'; dek.textContent = item.summary;

  article.appendChild(meta); article.appendChild(head); article.appendChild(dek);
  return article;
}

function emptyState(container, msg){
  container.innerHTML = '';
  var p = document.createElement('p');
  p.className = 'story-empty';
  p.textContent = msg;
  container.appendChild(p);
}

function renderMarketsStories(){
  var container = document.getElementById('marketsStories');
  container.innerHTML = '';
  var top = newsPool.slice(0, 6);
  if(top.length === 0){ emptyState(container, 'No headlines available right now.'); return; }
  top.forEach(function(item){ container.appendChild(createStoryElement(item, null)); });
}

function renderFilteredStories(containerId, matchMap, label){
  var container = document.getElementById(containerId);
  container.innerHTML = '';
  var matched = [];
  newsPool.forEach(function(item){
    for(var sym in matchMap){
      if(item.title.toLowerCase().indexOf(matchMap[sym].toLowerCase()) !== -1){
        matched.push({ item: item, sym: sym });
        break;
      }
    }
  });
  if(matched.length === 0){
    emptyState(container, 'No real headlines currently mention your ' + label + ' — general market feeds mostly cover large caps and breaking news.');
    return;
  }
  matched.slice(0, 6).forEach(function(m){ container.appendChild(createStoryElement(m.item, m.sym)); });
}

// Real per-company articles via Finnhub -- much better coverage than matching your holdings
// against general market headlines. Falls back to that general-pool match only if Finnhub
// has nothing for any of the given symbols.
function loadCompanyNews(containerId, symbols, fallbackMatchMap, label){
  var container = document.getElementById(containerId);
  if(!symbols.length){
    emptyState(container, 'Add stocks to see news about them here.');
    return;
  }
  fetch(NEWS_API + 'company-news?symbols=' + encodeURIComponent(symbols.join(',')))
    .then(function(res){ return res.json(); })
    .then(function(data){
      var items = data.items || [];
      if(items.length === 0){
        renderFilteredStories(containerId, fallbackMatchMap, label);
        return;
      }
      container.innerHTML = '';
      items.slice(0, 8).forEach(function(item){
        container.appendChild(createStoryElement(item, item.symbol));
      });
    })
    .catch(function(){
      renderFilteredStories(containerId, fallbackMatchMap, label);
    });
}

var ALL_NEWS_SOURCES = ['nyt', 'marketwatch', 'cnbc', 'bloomberg', 'ft'];
var NEWS_SOURCES_KEY = 'daybook_enabled_news_sources';

function getEnabledNewsSources(){
  try{
    var stored = localStorage.getItem(NEWS_SOURCES_KEY);
    if(stored) return JSON.parse(stored);
  }catch(e){}
  return ALL_NEWS_SOURCES.slice();
}

function setEnabledNewsSources(list){
  try{ localStorage.setItem(NEWS_SOURCES_KEY, JSON.stringify(list)); }catch(e){}
}

function toggleNewsSource(btn){
  var card = btn.closest('.connector-card');
  var id = card.dataset.sourceId;
  var enabled = getEnabledNewsSources();
  var connected;
  if(enabled.indexOf(id) !== -1){
    enabled = enabled.filter(function(s){ return s !== id; });
    connected = false;
  } else {
    enabled.push(id);
    connected = true;
  }
  setEnabledNewsSources(enabled);
  card.classList.toggle('connected', connected);
  card.querySelector('.connector-status').textContent = connected ? 'Connected' : 'Not connected';
  btn.textContent = connected ? 'Disconnect' : 'Connect';
  loadNews();
}

function applyNewsSourceCardStates(){
  var enabled = getEnabledNewsSources();
  document.querySelectorAll('.connector-card[data-source-id]').forEach(function(card){
    var connected = enabled.indexOf(card.dataset.sourceId) !== -1;
    card.classList.toggle('connected', connected);
    card.querySelector('.connector-status').textContent = connected ? 'Connected' : 'Not connected';
    card.querySelector('.connector-toggle').textContent = connected ? 'Disconnect' : 'Connect';
  });
}

function loadNews(){
  // Portfolio/Watchlist news comes primarily from Finnhub's per-company endpoint now, which
  // doesn't depend on which general sources are enabled -- always load it regardless.
  loadCompanyNews('portfolioStories', collectPortfolioSymbols(), PORTFOLIO_MATCH, 'holdings');
  loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');

  var enabled = getEnabledNewsSources();
  if(enabled.length === 0){
    newsPool = [];
    emptyState(document.getElementById('marketsStories'), 'No news sources are connected. Turn one on in Manage → Connectors.');
    return;
  }
  var url = NEWS_API + '?sources=' + encodeURIComponent(enabled.join(','));
  fetch(url)
    .then(function(res){ return res.json(); })
    .then(function(data){
      newsPool = data.items || [];
      renderMarketsStories();
    })
    .catch(function(){
      emptyState(document.getElementById('marketsStories'), "Couldn't load live headlines right now. Check your connection and reopen the app.");
    });
}
applyNewsSourceCardStates();
loadNews();
loadQuotes();
buildCalendar();

// ---- Spotify: real OAuth login, real followed shows ----

function setSpotifyConnectorUI(connected){
  var card = document.getElementById('spotifyConnectorCard');
  if(card){
    card.classList.toggle('connected', connected);
    var status = card.querySelector('.connector-status');
    if(status) status.textContent = connected ? 'Connected' : 'Not connected';
    var btn = card.querySelector('.connector-toggle');
    if(btn) btn.textContent = connected ? 'Disconnect' : 'Connect';
  }
  var label = document.getElementById('podcastSectionLabel');
  if(label) label.textContent = connected ? 'From Your Spotify' : 'Podcasts';
}

function connectSpotify(){
  var state = Math.random().toString(36).slice(2);
  try{ sessionStorage.setItem('daybook_spotify_state', state); }catch(e){}
  var params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: 'user-library-read',
    state: state
  });
  window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
}

function disconnectSpotify(){
  try{ localStorage.removeItem(SPOTIFY_TOKEN_KEY); }catch(e){}
  setSpotifyConnectorUI(false);
  loadPodcastFeeds();
}

function handleSpotifyConnectorClick(btn){
  var connected = btn.closest('.connector-card').classList.contains('connected');
  if(connected) disconnectSpotify(); else connectSpotify();
}

function createSpotifyShowCard(show){
  var card = document.createElement('div');
  card.className = 'podcast-card';

  var episodeUrl = (show.latestEpisode && show.latestEpisode.url) || show.url || 'https://open.spotify.com';
  var art = document.createElement('a');
  art.className = 'pod-art';
  art.href = episodeUrl; art.target = '_blank'; art.rel = 'noopener';
  art.setAttribute('aria-label', 'Open ' + show.name + ' in Spotify');
  if(show.image){
    var img = document.createElement('img');
    img.className = 'pod-art-img';
    img.src = show.image;
    img.alt = show.name;
    art.appendChild(img);
  } else {
    var mono = document.createElement('span');
    mono.className = 'pod-mono';
    mono.textContent = (show.name || '?').slice(0, 3).toUpperCase();
    art.appendChild(mono);
  }
  var play = document.createElement('span');
  play.className = 'play-btn';
  play.textContent = '▶';
  art.appendChild(play);
  card.appendChild(art);

  var title = document.createElement('p');
  title.className = 'pod-title';
  title.textContent = (show.latestEpisode && show.latestEpisode.name) || show.name;
  var sub = document.createElement('p');
  sub.className = 'pod-show';
  sub.textContent = show.name;
  card.appendChild(title);
  card.appendChild(sub);
  return card;
}

// Curated real podcast feeds (no Spotify login needed) -- the default when Spotify isn't connected.
function createPodcastCard(show, variantIndex){
  var card = document.createElement('div');
  card.className = 'podcast-card';

  var ep = show.episode;
  var link = (ep && ep.link) || 'https://open.spotify.com/search/' + encodeURIComponent(show.name);
  var art = document.createElement('a');
  art.className = 'pod-art v' + ((variantIndex % 4) + 1);
  art.href = link; art.target = '_blank'; art.rel = 'noopener';
  art.setAttribute('aria-label', 'Listen to ' + show.name);
  if(ep && ep.image){
    var img = document.createElement('img');
    img.className = 'pod-art-img';
    img.src = ep.image;
    img.alt = show.name;
    art.appendChild(img);
  } else {
    var mono = document.createElement('span');
    mono.className = 'pod-mono';
    mono.textContent = show.name.split(' ').map(function(w){ return w[0] || ''; }).join('').slice(0, 3).toUpperCase();
    art.appendChild(mono);
  }
  var play = document.createElement('span');
  play.className = 'play-btn';
  play.textContent = '▶';
  art.appendChild(play);
  card.appendChild(art);

  var title = document.createElement('p');
  title.className = 'pod-title';
  title.textContent = (ep && ep.title) || 'Latest episode unavailable';
  var sub = document.createElement('p');
  sub.className = 'pod-show';
  sub.textContent = show.name;
  card.appendChild(title);
  card.appendChild(sub);
  return card;
}

// Fetched directly from Apple's iTunes Lookup API (not via the Worker): Apple returns
// access-control-allow-origin:* on this endpoint, meaning it's meant to be called from a
// browser -- and it 403s Cloudflare Workers' shared IP range, so this must run client-side.
var PODCAST_SHOWS = [
  { name: 'In Good Company', appleId: 1614211565 },
  { name: 'Wall Street Breakfast', appleId: 1358381502 },
  { name: 'Goldman Sachs Exchanges', appleId: 948913991 },
  { name: 'WSJ Tech News Briefing', appleId: 74844126 },
  { name: 'Odd Lots', appleId: 1056200096 },
  { name: 'Planet Money', appleId: 290783428 },
  { name: 'Motley Fool Money', appleId: 1118867383 }
];

function fetchApplePodcastEpisode(show){
  var url = 'https://itunes.apple.com/lookup?id=' + show.appleId + '&entity=podcastEpisode&limit=1';
  return fetch(url)
    .then(function(res){ return res.json(); })
    .then(function(data){
      var results = data.results || [];
      var episode = results.filter(function(r){ return r.kind === 'podcast-episode'; })[0];
      var showEntry = results.filter(function(r){ return r.kind === 'podcast'; })[0];
      if(episode){
        return {
          name: show.name,
          episode: {
            title: episode.trackName || null,
            publishedAt: episode.releaseDate || null,
            link: episode.trackViewUrl || null,
            image: episode.artworkUrl600 || episode.artworkUrl100 || null
          }
        };
      }
      if(showEntry){
        return {
          name: show.name,
          episode: {
            title: null,
            publishedAt: null,
            link: showEntry.collectionViewUrl || null,
            image: showEntry.artworkUrl600 || showEntry.artworkUrl100 || null
          }
        };
      }
      return { name: show.name, episode: null };
    })
    .catch(function(){ return { name: show.name, episode: null }; });
}

function loadPodcastFeeds(){
  var hasSpotify = false;
  try{ hasSpotify = !!localStorage.getItem(SPOTIFY_TOKEN_KEY); }catch(e){}
  if(hasSpotify) return; // real connected Spotify data takes priority when present

  var row = document.getElementById('podcastRow');
  Promise.all(PODCAST_SHOWS.map(fetchApplePodcastEpisode))
    .then(function(shows){
      if(!shows.length){ emptyState(row, "Couldn't load podcasts right now."); return; }
      row.innerHTML = '';
      shows.forEach(function(show, i){ row.appendChild(createPodcastCard(show, i)); });
    })
    .catch(function(){ emptyState(row, "Couldn't load podcasts right now."); });
}

function loadSpotifyShows(){
  var token = null;
  try{ token = localStorage.getItem(SPOTIFY_TOKEN_KEY); }catch(e){}
  if(!token) return;
  fetch(NEWS_API + 'spotify/shows?refresh_token=' + encodeURIComponent(token))
    .then(function(res){ return res.json(); })
    .then(function(data){
      if(!data.shows || !data.shows.length) return;
      var row = document.getElementById('podcastRow');
      row.innerHTML = '';
      data.shows.forEach(function(show){ row.appendChild(createSpotifyShowCard(show)); });
    })
    .catch(function(){ /* leave the placeholder cards in place */ });
}

function handleSpotifyCallback(){
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var state = params.get('state');
  if(!code) return;

  var expectedState = null;
  try{ expectedState = sessionStorage.getItem('daybook_spotify_state'); sessionStorage.removeItem('daybook_spotify_state'); }catch(e){}
  // Clear the query string either way so a refresh never tries to reuse a spent code.
  window.history.replaceState({}, document.title, window.location.pathname);
  if(!state || state !== expectedState) return;

  fetch(NEWS_API + 'spotify/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, redirect_uri: SPOTIFY_REDIRECT_URI })
  })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if(data.refresh_token){
        try{ localStorage.setItem(SPOTIFY_TOKEN_KEY, data.refresh_token); }catch(e){}
        setSpotifyConnectorUI(true);
        loadSpotifyShows();
      }
    })
    .catch(function(){});
}

handleSpotifyCallback();
(function(){
  var hasToken = false;
  try{ hasToken = !!localStorage.getItem(SPOTIFY_TOKEN_KEY); }catch(e){}
  if(hasToken){
    setSpotifyConnectorUI(true);
    loadSpotifyShows();
  } else {
    loadPodcastFeeds();
  }
})();

// ---- Push notifications (earnings reminders) ----
var PUSH_VAPID_PUBLIC_KEY = 'BIm-iTQBPacSFStOaDaOL-Vgp64I-_0dlw4rJVGG_OiRTi1nk5f8CBYNdZ1Dw7MhtDi_IMUpSt5HBGSE_7JNAz8';

function urlBase64ToUint8Array(base64String){
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for(var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function setPushConnectorUI(connected){
  var card = document.getElementById('pushConnectorCard');
  if(!card) return;
  card.classList.toggle('connected', connected);
  card.querySelector('.connector-status').textContent = connected ? 'Connected' : 'Not connected';
  card.querySelector('.connector-toggle').textContent = connected ? 'Disconnect' : 'Connect';
}

function enablePushNotifications(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    var card = document.getElementById('pushConnectorCard');
    if(card) card.querySelector('.connector-status').textContent = 'Not supported on this device';
    return;
  }
  Notification.requestPermission().then(function(permission){
    if(permission !== 'granted'){
      var card = document.getElementById('pushConnectorCard');
      if(card) card.querySelector('.connector-status').textContent = 'Permission denied';
      return;
    }
    navigator.serviceWorker.ready.then(function(reg){
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
      });
    }).then(function(sub){
      return fetch(NEWS_API + 'push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), symbols: collectHeldSymbols() })
      });
    }).then(function(){
      setPushConnectorUI(true);
    }).catch(function(){
      var card = document.getElementById('pushConnectorCard');
      if(card) card.querySelector('.connector-status').textContent = "Couldn't enable";
    });
  });
}

function disablePushNotifications(){
  navigator.serviceWorker.ready.then(function(reg){
    return reg.pushManager.getSubscription();
  }).then(function(sub){
    if(!sub){ setPushConnectorUI(false); return; }
    var endpoint = sub.endpoint;
    return sub.unsubscribe().then(function(){
      return fetch(NEWS_API + 'push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint })
      });
    }).then(function(){ setPushConnectorUI(false); });
  }).catch(function(){ setPushConnectorUI(false); });
}

function togglePushNotifications(btn){
  var connected = btn.closest('.connector-card').classList.contains('connected');
  if(connected) disablePushNotifications(); else enablePushNotifications();
}

// Keeps the server's stored symbol list current -- call after any portfolio/watchlist change.
function syncPushSymbols(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(function(reg){
    return reg.pushManager.getSubscription();
  }).then(function(sub){
    if(!sub) return;
    fetch(NEWS_API + 'push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), symbols: collectHeldSymbols() })
    }).catch(function(){});
  }).catch(function(){});
}

function sendTestPush(){
  var btn = document.getElementById('pushTestBtn');
  var original = btn.textContent;
  btn.textContent = 'Sending…';
  fetch(NEWS_API + 'push/test', { method: 'POST' })
    .then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
    .then(function(result){
      btn.textContent = result.ok ? 'Sent!' : 'Failed — see Manage';
      setTimeout(function(){ btn.textContent = original; }, 2500);
    })
    .catch(function(){
      btn.textContent = 'Failed';
      setTimeout(function(){ btn.textContent = original; }, 2500);
    });
}

if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').then(function(reg){
      return reg.pushManager.getSubscription();
    }).then(function(sub){
      setPushConnectorUI(!!sub);
    }).catch(function(){});
  });
}

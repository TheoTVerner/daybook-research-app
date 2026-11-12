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

var PANEL_ORDER = ['markets', 'portfolio', 'watchlist', 'manage', 'calendar'];
var currentPanelName = 'markets';
var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// NOTE: iOS Safari (including installed PWAs like this one) has never implemented the
// Vibration API -- navigator.vibrate() is always undefined there, so this is a guaranteed
// no-op on an iPhone. It's wired up anyway since it costs nothing and works on browsers
// that do support it (Android Chrome, etc.); there's no public web API for real haptics on iOS.
function haptic(style){
  try{
    if(!navigator.vibrate) return;
    navigator.vibrate(style === 'light' ? 8 : style === 'success' ? [10, 30, 10] : 15);
  }catch(e){}
}

function triggerTabPillAnim(tabEl){
  var pill = tabEl.querySelector('.tab-icon-pill');
  if(!pill) return;
  pill.classList.remove('pill-anim');
  void pill.offsetWidth; // force reflow so the animation restarts on repeat taps
  pill.classList.add('pill-anim');
}

// Slides the outgoing panel out while the incoming one slides in from the matching side,
// mirroring iOS's paging transitions -- direction follows each panel's position in
// PANEL_ORDER rather than always sliding one way.
function animatePanelSlide(fromPanel, toPanel, forward){
  if(!fromPanel || fromPanel === toPanel || prefersReducedMotion){
    document.querySelectorAll('.panel').forEach(function(p){ p.hidden = p !== toPanel; });
    return;
  }
  var dir = forward ? 1 : -1;
  toPanel.hidden = false;
  toPanel.style.transition = 'none';
  toPanel.style.transform = 'translateX(' + (100 * dir) + '%)';
  fromPanel.style.transition = 'none';
  fromPanel.style.transform = 'translateX(0)';
  void toPanel.offsetWidth; // force reflow before enabling the transition
  toPanel.style.transition = 'transform .42s cubic-bezier(.25,.8,.35,1)';
  fromPanel.style.transition = 'transform .42s cubic-bezier(.25,.8,.35,1)';
  toPanel.style.transform = 'translateX(0)';
  fromPanel.style.transform = 'translateX(' + (-100 * dir) + '%)';
  var finished = false;
  function finish(){
    if(finished) return;
    finished = true;
    fromPanel.hidden = true;
    fromPanel.style.transition = '';
    fromPanel.style.transform = '';
    toPanel.style.transition = '';
    toPanel.style.transform = '';
    toPanel.removeEventListener('transitionend', finish);
  }
  toPanel.addEventListener('transitionend', finish);
  setTimeout(finish, 520); // safety net in case transitionend never fires
}

function switchTab(name){
  var toPanel = document.getElementById('panel-' + name);
  if(!toPanel) return;
  if(name !== currentPanelName){
    var fromPanel = document.getElementById('panel-' + currentPanelName);
    var forward = PANEL_ORDER.indexOf(name) > PANEL_ORDER.indexOf(currentPanelName);
    animatePanelSlide(fromPanel, toPanel, forward);
    currentPanelName = name;
  }
  document.querySelectorAll('.tab').forEach(function(t){
    var isActive = t.dataset.tab === name;
    t.classList.toggle('active', isActive);
    if(isActive) triggerTabPillAnim(t);
  });
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ haptic('light'); switchTab(t.dataset.tab); });
});

// Collapses the masthead up as the active panel scrolls down, like an iOS large-title bar.
function initMastheadCollapse(){
  var masthead = document.querySelector('.masthead');
  var tabbar = document.querySelector('.tabbar');
  if(!masthead) return;
  var lastScrollTop = new WeakMap();
  function handleScroll(e){
    var panel = e.currentTarget;
    var top = panel.scrollTop;
    masthead.classList.toggle('collapsed', top > 12);
    if(tabbar){
      var last = lastScrollTop.has(panel) ? lastScrollTop.get(panel) : 0;
      if(top <= 4){
        tabbar.classList.remove('collapsed'); // always show it once back at the top
      } else if(top > last + 2){
        tabbar.classList.add('collapsed'); // scrolling down -- hide it
      } else if(top < last - 2){
        tabbar.classList.remove('collapsed'); // scrolling up -- bring it back
      }
    }
    lastScrollTop.set(panel, top);
  }
  document.querySelectorAll('.panel').forEach(function(p){
    p.addEventListener('scroll', handleScroll, { passive: true });
  });
}
initMastheadCollapse();

// ---- Pull-to-refresh on the three live-data panels -- custom gesture since Safari's own
// overscroll bounce is suppressed app-wide (overscroll-behavior:none). Fire-and-forget: the
// loaders below already work that way everywhere else in this app, so the spinner's own
// minimum-visible time is what makes the refresh feel complete, not a promise chain. ----
var PULL_THRESHOLD = 64; // px of drag past the top before a release triggers a refresh
var PULL_MAX = 90; // visual cap on how far the indicator can be dragged

function performPullRefresh(){
  loadMarketIndices();
  loadQuotes();
  loadNews();
  loadPodcastFeeds();
}

function setupPullToRefresh(panelId, indicatorId){
  var panel = document.getElementById(panelId);
  var indicator = document.getElementById(indicatorId);
  if(!panel || !indicator) return;
  var startY = 0, dragging = false, ready = false, refreshing = false;

  panel.addEventListener('touchstart', function(e){
    if(panel.scrollTop > 0 || refreshing){ dragging = false; return; }
    startY = e.touches[0].clientY;
    dragging = true;
    ready = false;
    indicator.classList.remove('snap');
  }, { passive: true });

  panel.addEventListener('touchmove', function(e){
    if(!dragging) return;
    var dy = e.touches[0].clientY - startY;
    if(dy <= 0){ indicator.style.height = '0px'; return; }
    var pulled = Math.min(dy * 0.45, PULL_MAX);
    indicator.style.height = pulled + 'px';
    var nowReady = pulled >= PULL_THRESHOLD;
    if(nowReady && !ready) haptic('light');
    ready = nowReady;
    indicator.classList.toggle('ready', ready);
  }, { passive: true });

  function endDrag(){
    if(!dragging) return;
    dragging = false;
    indicator.classList.add('snap');
    if(ready && !refreshing){
      refreshing = true;
      indicator.style.height = '44px';
      indicator.classList.add('refreshing');
      indicator.classList.remove('ready');
      performPullRefresh();
      setTimeout(function(){
        indicator.style.height = '0px';
        indicator.classList.remove('refreshing');
        refreshing = false;
      }, 700);
    } else {
      indicator.style.height = '0px';
      indicator.classList.remove('ready');
    }
  }
  panel.addEventListener('touchend', endDrag, { passive: true });
  panel.addEventListener('touchcancel', endDrag, { passive: true });
}

setupPullToRefresh('panel-markets', 'pullRefreshMarkets');
setupPullToRefresh('panel-portfolio', 'pullRefreshPortfolio');
setupPullToRefresh('panel-watchlist', 'pullRefreshWatchlist');

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

// Any tap on a portfolio row opens its detail page, not just the pencil button -- delegated
// on the list containers so it covers both the static demo rows and ones rebuilt later from
// localStorage or added through the form. The pencil's own onclick leads to the exact same
// place, so it's excluded here rather than left to fire twice.
Object.keys(GROUP_LIST_IDS).forEach(function(type){
  var list = document.getElementById(GROUP_LIST_IDS[type]);
  if(!list) return;
  list.addEventListener('click', function(e){
    if(e.target.closest('.edit-btn')) return;
    var li = e.target.closest('li[data-sym]');
    if(!li) return;
    haptic('light');
    openEditOverlayForLi(li);
  });
});

var currentEditLi = null;

function openEditOverlay(btn){
  openEditOverlayForLi(btn.closest('li'));
}

function openStockDetailBySymbol(sym){
  var li = document.querySelector(
    '#portfolioStocks [data-sym="' + sym + '"], #portfolioETFs [data-sym="' + sym + '"], ' +
    '#portfolioFunds [data-sym="' + sym + '"], #watchlistList [data-sym="' + sym + '"]'
  );
  if(li) openEditOverlayForLi(li);
}

// Position value is always computed as shares x live price -- never manually entered -- so it
// can't go stale the way a typed-in "amount invested" figure would the moment the price moves.
function computePositionValue(li, shares){
  var priceNum = parseFloat((li.querySelector('.price').textContent || '').replace(/[^0-9.]/g, ''));
  if(isNaN(priceNum)) return null;
  return shares * priceNum;
}

function formatPositionValue(value){
  if(value === null || value === undefined || isNaN(value)) return '—';
  return '$' + value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

var editSharesInputEl = document.getElementById('editSharesInput');
if(editSharesInputEl){
  editSharesInputEl.addEventListener('input', function(){
    if(!currentEditLi) return;
    var shares = parseFloat(editSharesInputEl.value) || 0;
    document.getElementById('editValueReadout').textContent = formatPositionValue(computePositionValue(currentEditLi, shares));
  });
}

function openEditOverlayForLi(li){
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
    var currentShares = parseFloat(li.querySelector('.qty-display').textContent) || 0;
    document.getElementById('editSharesInput').value = currentShares;
    document.getElementById('editValueReadout').textContent = formatPositionValue(computePositionValue(li, currentShares));
    document.getElementById('editTypeInput').value = li.dataset.type || 'stock';
  }

  document.getElementById('editOverlay').hidden = false;
  loadExplain(li.dataset.sym, NAME_HINTS[li.dataset.sym] || li.dataset.name);
  loadResearchNotes(li.dataset.sym);

  currentChartRange = '1D';
  document.querySelectorAll('.chart-tab').forEach(function(b){ b.classList.toggle('active', b.dataset.range === '1D'); });
  loadChart(li.dataset.sym, '1D');
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

// ---- Historical chart (via the Worker's /candles route, Twelve Data under the hood --
// Finnhub's free tier doesn't include historical candles at all) ----
var currentChartRange = '1D';

function loadChart(sym, range){
  var svg = document.getElementById('chartSvg');
  var loading = document.getElementById('chartLoading');
  svg.innerHTML = '';
  document.getElementById('chartYAxis').innerHTML = '';
  document.getElementById('chartXAxis').innerHTML = '';
  loading.hidden = false;
  loading.textContent = 'Loading chart…';
  fetch(NEWS_API + 'candles?symbol=' + encodeURIComponent(sym) + '&range=' + encodeURIComponent(range))
    .then(function(res){ return res.json(); })
    .then(function(data){
      var points = data.points || [];
      if(points.length < 2){ loading.textContent = 'No chart data available for this range.'; return; }
      drawChart(points, range);
      loading.hidden = true;
    })
    .catch(function(){ loading.textContent = "Couldn't load chart data right now."; });
}

function drawChart(points, range){
  var svg = document.getElementById('chartSvg');
  var w = 320, h = 120, pad = 4;
  var closes = points.map(function(p){ return p.c; });
  var min = Math.min.apply(null, closes);
  var max = Math.max.apply(null, closes);
  var span = (max - min) || 1;
  var stepX = (w - pad * 2) / (points.length - 1);

  var coords = points.map(function(p, i){
    var x = pad + i * stepX;
    var y = pad + (h - pad * 2) * (1 - (p.c - min) / span);
    return x.toFixed(2) + ',' + y.toFixed(2);
  });

  var up = closes[closes.length - 1] >= closes[0];
  var color = up ? '#3ad17a' : '#ff5f5f';

  svg.innerHTML = '';
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

  var fillPts = coords.concat([(w - pad) + ',' + (h - pad), pad + ',' + (h - pad)]);
  var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', fillPts.join(' '));
  poly.setAttribute('fill', color);
  poly.setAttribute('opacity', '0.12');
  svg.appendChild(poly);

  var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', coords.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(line);

  renderChartAxes(points, min, max, range);
}

// Axis labels are plain HTML siblings of the SVG, not SVG <text> -- the chart's
// preserveAspectRatio="none" stretches x and y independently (correct for a price-over-time
// line), which would visibly distort any text drawn inside the SVG itself.
function formatChartAxisPrice(val){
  if(val >= 1000) return '$' + Math.round(val).toLocaleString();
  if(val >= 10) return '$' + val.toFixed(1);
  return '$' + val.toFixed(2);
}

var CHART_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatChartAxisDate(t, range){
  var hasTime = t.indexOf(' ') !== -1;
  if(hasTime){
    var timeParts = t.split(' ')[1].split(':');
    var hh = parseInt(timeParts[0], 10);
    var h12 = hh % 12; if(h12 === 0) h12 = 12;
    return h12 + ':' + timeParts[1] + (hh >= 12 ? ' PM' : ' AM');
  }
  var dateParts = t.split('-');
  var month = CHART_MONTH_ABBR[parseInt(dateParts[1], 10) - 1];
  if(range === '1Y' || range === 'ALL') return month + " '" + dateParts[0].slice(2);
  return month + ' ' + parseInt(dateParts[2], 10);
}

function renderChartAxes(points, min, max, range){
  var yAxis = document.getElementById('chartYAxis');
  yAxis.innerHTML = '';
  [max, (min + max) / 2, min].forEach(function(val){
    var span = document.createElement('span');
    span.textContent = formatChartAxisPrice(val);
    yAxis.appendChild(span);
  });

  var xAxis = document.getElementById('chartXAxis');
  xAxis.innerHTML = '';
  var n = points.length;
  var idxs = n <= 4
    ? points.map(function(_, i){ return i; })
    : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  idxs.forEach(function(idx){
    var span = document.createElement('span');
    span.textContent = formatChartAxisDate(points[idx].t, range);
    xAxis.appendChild(span);
  });
}

var chartTabsEl = document.getElementById('chartTabs');
if(chartTabsEl){
  chartTabsEl.addEventListener('click', function(e){
    var btn = e.target.closest('.chart-tab');
    if(!btn || !currentEditLi) return;
    currentChartRange = btn.dataset.range;
    document.querySelectorAll('.chart-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
    loadChart(currentEditLi.dataset.sym, currentChartRange);
  });
}

// ---- My Research: the user's own notes on a company, persisted locally per symbol ----
var RESEARCH_NOTES_KEY = 'daybook_research_notes';

function getResearchNotes(){
  try{ return JSON.parse(localStorage.getItem(RESEARCH_NOTES_KEY) || '{}'); }catch(e){ return {}; }
}

function loadResearchNotes(sym){
  var notes = getResearchNotes();
  document.getElementById('researchNotesInput').value = notes[sym] || '';
  document.getElementById('researchSavedHint').hidden = true;
}

function saveResearchNotes(){
  if(!currentEditLi) return;
  var sym = currentEditLi.dataset.sym;
  var notes = getResearchNotes();
  var text = document.getElementById('researchNotesInput').value;
  if(text.trim()) notes[sym] = text; else delete notes[sym];
  try{ localStorage.setItem(RESEARCH_NOTES_KEY, JSON.stringify(notes)); }catch(e){}
  haptic('success');
  var hint = document.getElementById('researchSavedHint');
  hint.hidden = false;
  clearTimeout(saveResearchNotes._t);
  saveResearchNotes._t = setTimeout(function(){ hint.hidden = true; }, 1800);
}

function saveEditOverlay(){
  if(!currentEditLi) return;
  var shares = parseFloat(document.getElementById('editSharesInput').value) || 0;
  var newType = document.getElementById('editTypeInput').value;

  currentEditLi.querySelector('.qty-display').textContent = shares + ' sh';
  currentEditLi.querySelector('.val-display').textContent = formatPositionValue(computePositionValue(currentEditLi, shares));

  if(newType !== currentEditLi.dataset.type){
    currentEditLi.dataset.type = newType;
    var target = document.getElementById(GROUP_LIST_IDS[newType]);
    if(target) target.appendChild(currentEditLi);
  }
  persistPortfolio();
  syncAllTickerTapes();
  haptic('success');
  closeEditOverlay();
}

function removeEditPosition(){
  var wasWatchlist = currentEditLi && !!currentEditLi.closest('#watchlistList');
  if(currentEditLi) currentEditLi.remove();
  haptic('medium');
  closeEditOverlay();
  buildCalendar();
  syncPushSymbols();
  syncAllTickerTapes();
  if(wasWatchlist){
    persistWatchlist();
    loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
  } else {
    persistPortfolio();
    loadCompanyNews('portfolioStories', collectPortfolioSymbols(), PORTFOLIO_MATCH, 'holdings');
  }
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
      var li1 = buildPortfolioLi(sym, displayName, type, priceStr, chgStr, chgClass);
      document.getElementById(GROUP_LIST_IDS[type]).appendChild(li1);
      PORTFOLIO_MATCH[sym] = matchKeyword;
      loadCompanyNews('portfolioStories', collectPortfolioSymbols(), PORTFOLIO_MATCH, 'holdings');
      persistPortfolio();
    } else {
      var li2 = buildWatchlistLi(sym, displayName, priceStr, chgStr, chgClass);
      document.getElementById('watchlistList').appendChild(li2);
      WATCHLIST_MATCH[sym] = matchKeyword;
      loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
      persistWatchlist();
    }
    buildCalendar();
    syncPushSymbols();
    syncAllTickerTapes();
  });
});

function removeWatchlistRow(btn){
  btn.closest('li').remove();
  haptic('medium');
  buildCalendar();
  syncPushSymbols();
  syncAllTickerTapes();
  persistWatchlist();
  loadCompanyNews('watchlistStories', collectWatchlistSymbols(), WATCHLIST_MATCH, 'watchlist');
}

// ---- Real news, fetched from the Cloudflare Worker RSS proxy ----
var newsPool = [];

var PORTFOLIO_MATCH = { AAPL:'Apple', MSFT:'Microsoft', NVDA:'Nvidia', AMZN:'Amazon', JPM:'JPMorgan', VOO:'Vanguard', FXAIX:'Fidelity' };
var WATCHLIST_MATCH = { TSLA:'Tesla', PLTR:'Palantir', COIN:'Coinbase', SOFI:'SoFi' };
var NAME_HINTS = Object.assign({}, PORTFOLIO_MATCH, WATCHLIST_MATCH);

// ---- Portfolio/watchlist persistence: previously the DOM was the only copy of this data,
// so edits/adds/removes were silently lost on every reload. Saved to localStorage, keyed
// per browser/device (there's no account system, so nothing syncs across devices). ----
var PORTFOLIO_STORE_KEY = 'daybook_portfolio_state_v1';
var WATCHLIST_STORE_KEY = 'daybook_watchlist_state_v1';

function buildPortfolioLi(sym, name, type, priceStr, chgStr, chgClass){
  var li = document.createElement('li');
  li.dataset.sym = sym;
  li.dataset.name = name;
  li.dataset.type = type;
  li.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + name + '</span>' +
    '<span class="qty-display">1 sh</span><span class="price">' + priceStr + '</span>' +
    '<span class="chg ' + chgClass + '">' + chgStr + '</span>' +
    '<span class="val-display">' + priceStr + '</span>' +
    '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="Edit position">✎</button>';
  return li;
}

function buildWatchlistLi(sym, name, priceStr, chgStr, chgClass){
  var li = document.createElement('li');
  li.dataset.sym = sym;
  li.dataset.name = name;
  li.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + name + '</span>' +
    '<span class="price">' + priceStr + '</span><span class="chg ' + chgClass + '">' + chgStr + '</span>' +
    '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="View details">›</button>' +
    '<button class="remove-btn" onclick="removeWatchlistRow(this)">✕</button>';
  return li;
}

function serializePortfolio(){
  var items = [];
  document.querySelectorAll('#portfolioStocks li, #portfolioETFs li, #portfolioFunds li').forEach(function(li){
    var chgEl = li.querySelector('.chg');
    items.push({
      sym: li.dataset.sym,
      name: li.dataset.name,
      type: li.dataset.type,
      matchKeyword: NAME_HINTS[li.dataset.sym] || '',
      shares: parseFloat(li.querySelector('.qty-display').textContent) || 0,
      value: parseFloat(li.querySelector('.val-display').textContent.replace(/[^0-9.]/g, '')) || 0,
      price: li.querySelector('.price').textContent,
      chg: chgEl.textContent,
      chgClass: chgEl.classList.contains('up') ? 'up' : 'down'
    });
  });
  return items;
}

function persistPortfolio(){
  try{ localStorage.setItem(PORTFOLIO_STORE_KEY, JSON.stringify(serializePortfolio())); }catch(e){}
}

function serializeWatchlist(){
  var items = [];
  document.querySelectorAll('#watchlistList li').forEach(function(li){
    var chgEl = li.querySelector('.chg');
    items.push({
      sym: li.dataset.sym,
      name: li.dataset.name,
      matchKeyword: NAME_HINTS[li.dataset.sym] || '',
      price: li.querySelector('.price').textContent,
      chg: chgEl.textContent,
      chgClass: chgEl.classList.contains('up') ? 'up' : 'down'
    });
  });
  return items;
}

function persistWatchlist(){
  try{ localStorage.setItem(WATCHLIST_STORE_KEY, JSON.stringify(serializeWatchlist())); }catch(e){}
}

// On first-ever visit there's nothing saved yet -- snapshot the hardcoded demo rows as the
// initial saved state so from this point on localStorage is always the source of truth.
function hydratePortfolioFromStorage(){
  var raw = null;
  try{ raw = localStorage.getItem(PORTFOLIO_STORE_KEY); }catch(e){}
  if(!raw){ persistPortfolio(); return; }
  var items;
  try{ items = JSON.parse(raw); }catch(e){ return; }
  ['portfolioStocks', 'portfolioETFs', 'portfolioFunds'].forEach(function(id){ document.getElementById(id).innerHTML = ''; });
  items.forEach(function(it){
    var li = buildPortfolioLi(it.sym, it.name, it.type, it.price, it.chg, it.chgClass);
    li.querySelector('.qty-display').textContent = it.shares + ' sh';
    var savedValue = (it.value === undefined || it.value === null) ? computePositionValue(li, it.shares) : it.value;
    li.querySelector('.val-display').textContent = formatPositionValue(savedValue);
    document.getElementById(GROUP_LIST_IDS[it.type] || 'portfolioStocks').appendChild(li);
    if(it.matchKeyword){ PORTFOLIO_MATCH[it.sym] = it.matchKeyword; NAME_HINTS[it.sym] = it.matchKeyword; }
  });
}

function hydrateWatchlistFromStorage(){
  var raw = null;
  try{ raw = localStorage.getItem(WATCHLIST_STORE_KEY); }catch(e){}
  if(!raw){ persistWatchlist(); return; }
  var items;
  try{ items = JSON.parse(raw); }catch(e){ return; }
  document.getElementById('watchlistList').innerHTML = '';
  items.forEach(function(it){
    var li = buildWatchlistLi(it.sym, it.name, it.price, it.chg, it.chgClass);
    document.getElementById('watchlistList').appendChild(li);
    if(it.matchKeyword){ WATCHLIST_MATCH[it.sym] = it.matchKeyword; NAME_HINTS[it.sym] = it.matchKeyword; }
  });
}

hydratePortfolioFromStorage();
hydrateWatchlistFromStorage();

// ---- Ticker-tape chips on the Portfolio/Watchlist tabs: previously static mock data with
// no connection to actual holdings. Now mirrors the real list rows (sym/price/chg) and each
// chip opens that stock's detail page, same as tapping the row in Manage. ----
function buildTickerChips(lis){
  var html = '';
  lis.forEach(function(li){
    var chgEl = li.querySelector('.chg');
    var chgClass = chgEl.classList.contains('up') ? 'up' : 'down';
    var pctDisplay = chgEl.textContent.replace(/^[+-]/, '');
    var arrow = chgClass === 'up' ? '▲' : '▼';
    html += '<button type="button" class="tick" onclick="openStockDetailBySymbol(\'' + li.dataset.sym + '\')">' +
      '<b>' + li.dataset.sym + '</b> ' + li.querySelector('.price').textContent +
      ' <i class="' + chgClass + '">' + arrow + pctDisplay + '</i></button>';
  });
  return html;
}

function syncTickerTape(trackId, selector){
  var track = document.getElementById(trackId);
  if(!track) return;
  var lis = Array.prototype.slice.call(document.querySelectorAll(selector));
  if(!lis.length){ track.innerHTML = ''; return; }
  var html = buildTickerChips(lis);
  track.innerHTML = html + html; // doubled for the seamless scroll loop
}

function syncAllTickerTapes(){
  syncTickerTape('portfolioTickerTrack', '#portfolioStocks [data-sym], #portfolioETFs [data-sym], #portfolioFunds [data-sym]');
  syncTickerTape('watchlistTickerTrack', '#watchlistList [data-sym]');
}

syncAllTickerTapes();

// ---- Real major-index data for the Markets tab's top ticker tape (see /indices on the
// Worker for how each value is sourced -- real index symbol where available, otherwise a
// tracking ETF scaled by its fixed, issuer-defined ratio to the index). Last-good values are
// cached in localStorage so a reload shows real (if slightly stale) numbers immediately
// instead of the hardcoded placeholder ever reappearing. ----
var MARKET_INDICES_KEY = 'daybook_market_indices_v1';

function formatIndexValue(item){
  if(item.value === null || item.value === undefined || isNaN(item.value)) return '—';
  if(item.format === 'currency0dp') return '$' + Math.round(item.value).toLocaleString();
  if(item.format === 'currency2dp') return '$' + item.value.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
  if(item.format === 'percent2dp') return item.value.toFixed(2) + '%';
  return item.value.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function formatIndexDelta(item){
  if(item.deltaDisplay === 'points'){
    var pc = item.pointChange;
    if(pc === null || pc === undefined || isNaN(pc)) return { text:'—', up:true };
    return { text:(pc >= 0 ? '▲' : '▼') + Math.abs(pc).toFixed(2), up: pc >= 0 };
  }
  var pct = item.changePercent;
  if(pct === null || pct === undefined || isNaN(pct)) return { text:'—', up:true };
  return { text:(pct >= 0 ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%', up: pct >= 0 };
}

function renderMarketIndices(items){
  var track = document.getElementById('marketIndicesTrack');
  if(!track || !items || !items.length) return;
  var html = '';
  items.forEach(function(item){
    var delta = formatIndexDelta(item);
    html += '<span class="tick"><b>' + item.label + '</b> ' + formatIndexValue(item) +
      ' <i class="' + (delta.up ? 'up' : 'down') + '">' + delta.text + '</i></span>';
  });
  track.innerHTML = html + html; // doubled for the seamless scroll loop
}

function hydrateMarketIndicesFromStorage(){
  try{
    var raw = localStorage.getItem(MARKET_INDICES_KEY);
    if(raw) renderMarketIndices(JSON.parse(raw));
  }catch(e){}
}

function loadMarketIndices(){
  fetch(NEWS_API + 'indices')
    .then(function(res){ return res.json(); })
    .then(function(data){
      if(!data || !Array.isArray(data.items)) return;
      renderMarketIndices(data.items);
      try{ localStorage.setItem(MARKET_INDICES_KEY, JSON.stringify(data.items)); }catch(e){}
    })
    .catch(function(){ /* leave whatever's already showing in place */ });
}

hydrateMarketIndicesFromStorage();
loadMarketIndices();
setInterval(loadMarketIndices, 60000);

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
  // Portfolio rows only (watchlist rows have no qty-display/val-display) -- keeps the
  // displayed position value exactly in sync with the live price, every refresh.
  var qtyEl = li.querySelector('.qty-display');
  var valEl = li.querySelector('.val-display');
  if(qtyEl && valEl){
    var shares = parseFloat(qtyEl.textContent) || 0;
    valEl.textContent = formatPositionValue(computePositionValue(li, shares));
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
      syncAllTickerTapes();
      persistPortfolio();
      persistWatchlist();
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

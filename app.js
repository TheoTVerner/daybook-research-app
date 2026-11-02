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
      new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }).toUpperCase();
  }catch(e){}
}
updateDate();

function buildCalendar(){
  var events = [
    {day:6, sym:'AMZN', title:'Q3 Earnings Call', time:'4:30 PM ET'},
    {day:12, sym:'TSLA', title:'Investor Day', time:''},
    {day:13, sym:'COIN', title:'Q3 Earnings Call', time:'5:00 PM ET'},
    {day:18, sym:'JPM', title:'Investor Conference', time:''},
    {day:19, sym:'NVDA', title:'Q3 Earnings Call', time:'4:30 PM ET'},
    {day:21, sym:'PLTR', title:'Investor Update', time:''},
    {day:24, sym:'AAPL', title:'Q4 Earnings Call', time:'5:00 PM ET'},
    {day:25, sym:'MSFT', title:'Q2 Earnings Call', time:'5:00 PM ET'},
    {day:28, sym:'SOFI', title:'Investor Day', time:''}
  ];
  var monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  var now = new Date();
  var year = now.getFullYear(), month = now.getMonth(), todayDate = now.getDate();
  document.getElementById('calMonthLabel').textContent = monthNames[month] + ' ' + year;

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var eventDays = {};
  events.forEach(function(e){ eventDays[e.day] = true; });

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
    cell.innerHTML = d + (eventDays[d] ? '<span class="cal-dot"></span>' : '');
    grid.appendChild(cell);
  }

  var list = document.getElementById('calEventsList');
  list.innerHTML = '';
  events.sort(function(a, b){ return a.day - b.day; }).forEach(function(e){
    var li = document.createElement('li');
    li.innerHTML = '<span class="cal-date">' + monthNames[month].slice(0, 3) + ' ' + e.day + '</span>' +
      '<span class="cal-pill">' + e.sym + '</span><span class="cal-title">' + e.title + '</span>' +
      '<span class="cal-time">' + (e.time || '') + '</span>';
    list.appendChild(li);
  });
}
buildCalendar();

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
  if(currentEditLi) currentEditLi.remove();
  closeEditOverlay();
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
  var displayName = NAME_HINTS[sym] || sym;

  fetchQuote(sym).then(function(quote){
    var priceStr = quote ? ('$' + quote.price.toFixed(2)) : '—';
    var chgVal = quote ? quote.changePercent : null;
    var chgStr = (chgVal === null) ? '—' : (chgVal >= 0 ? '+' : '') + chgVal.toFixed(1) + '%';
    var chgClass = (chgVal === null) ? '' : (chgVal >= 0 ? 'up' : 'down');

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
    } else {
      var li2 = document.createElement('li');
      li2.dataset.sym = sym;
      li2.dataset.name = displayName;
      li2.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + displayName + '</span>' +
        '<span class="price">' + priceStr + '</span><span class="chg ' + chgClass + '">' + chgStr + '</span>' +
        '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="View details">›</button>' +
        '<button class="remove-btn" onclick="this.closest(\'li\').remove()">✕</button>';
      document.getElementById('watchlistList').appendChild(li2);
    }
  });
});

// ---- Real news, fetched from the Cloudflare Worker RSS proxy ----
var NEWS_API = 'https://daybook-research.ttverner.workers.dev/';
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

function applyQuoteToLi(li, quote){
  if(!quote) return;
  var priceEl = li.querySelector('.price');
  var chgEl = li.querySelector('.chg');
  if(priceEl) priceEl.textContent = '$' + quote.price.toFixed(2);
  if(chgEl && typeof quote.changePercent === 'number'){
    var pct = quote.changePercent;
    chgEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    chgEl.classList.remove('up', 'down');
    chgEl.classList.add(pct >= 0 ? 'up' : 'down');
  }
}

function loadQuotes(){
  var rows = document.querySelectorAll('#portfolioStocks [data-sym], #portfolioETFs [data-sym], #portfolioFunds [data-sym], #watchlistList [data-sym]');
  var syms = [];
  rows.forEach(function(li){ if(syms.indexOf(li.dataset.sym) === -1) syms.push(li.dataset.sym); });
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

function loadNews(){
  fetch(NEWS_API)
    .then(function(res){ return res.json(); })
    .then(function(data){
      newsPool = data.items || [];
      renderMarketsStories();
      renderFilteredStories('portfolioStories', PORTFOLIO_MATCH, 'holdings');
      renderFilteredStories('watchlistStories', WATCHLIST_MATCH, 'watchlist');
    })
    .catch(function(){
      ['marketsStories', 'portfolioStories', 'watchlistStories'].forEach(function(id){
        emptyState(document.getElementById(id), "Couldn't load live headlines right now. Check your connection and reopen the app.");
      });
    });
}
loadNews();
loadQuotes();

if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}

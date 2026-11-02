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
  document.getElementById('editSym').textContent = li.dataset.sym;
  document.getElementById('editName').textContent = li.dataset.name;
  document.getElementById('editPrice').textContent = li.querySelector('.price').textContent;

  var chgEl = li.querySelector('.chg');
  var editChg = document.getElementById('editChg');
  editChg.textContent = chgEl.textContent;
  editChg.className = 'edit-chg ' + (chgEl.classList.contains('up') ? 'up' : 'down');

  document.getElementById('editSharesInput').value = parseFloat(li.querySelector('.qty-display').textContent) || 0;
  document.getElementById('editInvestedInput').value = parseFloat(li.querySelector('.val-display').textContent.replace(/[^0-9.]/g, '')) || 0;
  document.getElementById('editTypeInput').value = li.dataset.type || 'stock';

  document.getElementById('editOverlay').hidden = false;
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
  var price = (Math.random() * 300 + 10).toFixed(2);
  var chgVal = Math.random() * 6 - 3;
  var chgStr = (chgVal >= 0 ? '+' : '') + chgVal.toFixed(1) + '%';
  var chgClass = chgVal >= 0 ? 'up' : 'down';

  if(target === 'portfolio'){
    var type = guessSecurityType(sym);
    var li1 = document.createElement('li');
    li1.dataset.sym = sym;
    li1.dataset.name = 'New Holding';
    li1.dataset.type = type;
    li1.innerHTML = '<span class="sym">' + sym + '</span><span class="name">New Holding</span>' +
      '<span class="qty-display">1 sh</span><span class="price">$' + price + '</span>' +
      '<span class="chg ' + chgClass + '">' + chgStr + '</span>' +
      '<span class="val-display">$' + price + '</span>' +
      '<button class="edit-btn" onclick="openEditOverlay(this)" aria-label="Edit position">✎</button>';
    document.getElementById(GROUP_LIST_IDS[type]).appendChild(li1);
  } else {
    var li2 = document.createElement('li');
    li2.innerHTML = '<span class="sym">' + sym + '</span><span class="name">Watching</span>' +
      '<span class="price">$' + price + '</span><span class="chg ' + chgClass + '">' + chgStr + '</span>' +
      '<button class="remove-btn" onclick="this.closest(\'li\').remove()">✕</button>';
    document.getElementById('watchlistList').appendChild(li2);
  }
  input.value = '';
});

if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}

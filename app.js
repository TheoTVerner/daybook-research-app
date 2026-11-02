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

function toggleEdit(btn){
  var li = btn.closest('li');
  var editing = li.classList.toggle('editing');
  var qtyDisplay = li.querySelector('.qty-display'), qtyInput = li.querySelector('.qty-input');
  var valDisplay = li.querySelector('.val-display'), valInput = li.querySelector('.val-input');
  if(editing){
    qtyDisplay.hidden = true; qtyInput.hidden = false; qtyInput.focus();
    valDisplay.hidden = true; valInput.hidden = false;
    btn.textContent = '✓';
  } else {
    var shares = parseFloat(qtyInput.value) || 0;
    var invested = parseFloat(valInput.value) || 0;
    qtyDisplay.textContent = shares + ' sh';
    valDisplay.textContent = '$' + invested.toLocaleString();
    qtyDisplay.hidden = false; qtyInput.hidden = true;
    valDisplay.hidden = false; valInput.hidden = true;
    btn.textContent = '✎';
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
  var price = (Math.random() * 300 + 10).toFixed(2);
  var chgVal = Math.random() * 6 - 3;
  var chgStr = (chgVal >= 0 ? '+' : '') + chgVal.toFixed(1) + '%';
  var chgClass = chgVal >= 0 ? 'up' : 'down';

  if(target === 'portfolio'){
    var li1 = document.createElement('li');
    li1.innerHTML = '<span class="sym">' + sym + '</span><span class="name">New Holding</span>' +
      '<span class="qty-display">1 sh</span><input class="qty-input" type="number" min="0" step="1" value="1" hidden>' +
      '<span class="price">$' + price + '</span><span class="chg ' + chgClass + '">' + chgStr + '</span>' +
      '<span class="val-display">$' + price + '</span><input class="val-input" type="number" min="0" step="1" value="' + price + '" hidden>' +
      '<button class="edit-btn" onclick="toggleEdit(this)" aria-label="Edit position">✎</button>';
    document.getElementById('portfolioList').appendChild(li1);
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

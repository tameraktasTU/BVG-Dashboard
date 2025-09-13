const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const API_BASE = 'https://v6.bvg.transport.rest';

const productBadgeClass = (line) => {
  const product = line?.product;
  const tag = String(line?.name || line?.id || '');
  if (product === 'subway') {
    const match = /U\s?(55|[1-9])\b/i.exec(tag);
    if (match) {
      const key = `U${match[1].toUpperCase()}`;
      const map = {
        U1: { bg: '#7DAD4C', text: 'black' },
        U2: { bg: '#DA421E', text: 'white' },
        U3: { bg: '#007A5B', text: 'white' },
        U4: { bg: '#F0D722', text: 'black' },
        U55: { bg: '#7E5330', text: 'white' },
        U6: { bg: '#8C6DAB', text: 'white' },
        U7: { bg: '#528DBA', text: 'white' },
        U8: { bg: '#224F86', text: 'white' },
        U9: { bg: '#F3791D', text: 'white' },
      };
      const conf = map[key];
      if (conf) return `bg-[${conf.bg}] text-${conf.text}`;
    }
  }
  switch (product) {
    case 'subway':
      return 'badge-primary';
    case 'suburban':
      return 'badge-success';
    case 'tram':
      return 'badge-error';
    case 'bus':
      return 'badge-warning';
    case 'ferry':
      return 'badge-info';
    case 'regional':
      return 'badge-neutral';
    case 'express':
      return 'badge-secondary';
    default:
      return 'badge-ghost';
  }
};

const fmtTime = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

const fmtDelay = (secs) => {
  if (secs == null) return '';
  const mins = Math.round(secs / 60);
  if (mins === 0) return 'On time';
  const sign = mins > 0 ? '+' : '';
  return `${sign}${mins}m`;
};

const computeDelaySecs = (when, plannedWhen) => {
  if (!when || !plannedWhen) return null;
  const a = new Date(when).getTime();
  const b = new Date(plannedWhen).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((a - b) / 1000);
};

const showToast = (msg, type = 'error') => {
  const t = document.createElement('div');
  t.className = `alert alert-${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

const setHidden = (el, hidden) => el.classList.toggle('hidden', hidden);
const setLastUpdate = () => {
  $('#last-update').textContent = new Date().toLocaleTimeString();
};

const searchInput = $('#search');
const resultsBox = $('#results');
let searchPrevValue = '';
let suppressBlur = false;

let searchAbort = null;
let searchTimer = null;
function debounce(fn, ms = 300) {
  return (...args) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fn(...args), ms);
  };
}

async function searchStops(q) {
  if (!q || q.trim().length < 2) {
    resultsBox.classList.add('hidden');
    resultsBox.innerHTML = '';
    return;
  }
  if (searchAbort) searchAbort.abort();
  const ctl = new AbortController();
  searchAbort = ctl;
  const url = `${API_BASE}/locations?query=${encodeURIComponent(q)}&results=8&stops=true&addresses=false&poi=false&language=en&pretty=false`;
  resultsBox.innerHTML = '<progress class="progress w-full"></progress>';
  resultsBox.classList.remove('hidden');
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('Search failed');
    const items = await res.json();
    renderSearchResults(items.filter((x) => x.type === 'stop'));
  } catch (e) {
    if (ctl.signal.aborted) return;
    resultsBox.innerHTML = '';
    resultsBox.classList.add('hidden');
    showToast('Search error. Try again.', 'error');
    console.error(e);
  }
}

function renderSearchResults(stops) {
  if (!stops.length) {
    resultsBox.innerHTML = '<div class="p-3 text-sm opacity-70">No results</div>';
    return;
  }
  resultsBox.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'menu bg-base-200 rounded-box';
  stops.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<a class="justify-between">
      <span>
        <span class="font-medium">${s.name}</span>
      </span>
    </a>`;
    li.addEventListener('click', () => {
      selectStop(s);
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
      searchInput.value = s.name;
      searchPrevValue = s.name;
      suppressBlur = false;
      searchInput.blur();
      setTimeout(() => {
        if (document.activeElement === searchInput) {
          const btn = document.getElementById('refresh-now');
          if (btn) btn.focus();
        }
      }, 0);
    });
    ul.appendChild(li);
  });
  resultsBox.appendChild(ul);
}

$('#use-location').addEventListener('click', async () => {
  if (!('geolocation' in navigator)) {
    showToast('Geolocation not supported', 'warning');
    return;
  }
  resultsBox.classList.remove('hidden');
  resultsBox.innerHTML = '<div class="p-3">Locating… <progress class="progress w-24 ml-2"></progress></div>';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const url = `${API_BASE}/locations/nearby?latitude=${latitude}&longitude=${longitude}&results=8&stops=true&poi=false&language=en&pretty=false`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('Nearby failed');
        const items = await res.json();
        renderSearchResults(items.filter((x) => x.type === 'stop'));
      } catch (e) {
        showToast('Failed to fetch nearby stops', 'error');
        resultsBox.classList.add('hidden');
        resultsBox.innerHTML = '';
      }
    },
    (err) => {
      showToast('Location permission denied', 'warning');
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
});

searchInput.addEventListener('input', debounce(() => searchStops(searchInput.value), 250));
searchInput.addEventListener('focus', () => {
  searchPrevValue = searchInput.value;
  searchInput.value = '';
});
searchInput.addEventListener('blur', () => {
  if (suppressBlur) return;
  if (!searchInput.value.trim()) {
    searchInput.value = searchPrevValue;
  }
  resultsBox.classList.add('hidden');
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    searchInput.value = searchPrevValue;
    resultsBox.classList.add('hidden');
    searchInput.blur();
  }
});
resultsBox.addEventListener('mousedown', () => { suppressBlur = true; });
resultsBox.addEventListener('mouseup', () => { setTimeout(() => { suppressBlur = false; }, 0); });

let state = {
  stop: null,
  refreshTimerId: null,
};

function selectStop(stop) {
  state.stop = stop;
  const badge = $('#departures-stop');
  if (badge) {
    badge.innerHTML = `
      <span class="inline-flex items-center gap-2 min-w-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 opacity-70"><path d="M12 2C8.134 2 5 5.134 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7Z"/><circle cx="12" cy="9" r="2.5"/></svg>
  <span class="truncate block max-w-[60vw] md:max-w-none">${stop.name}</span>
      </span>`;
    badge.classList.remove('hidden');
  }
  localStorage.setItem('selectedStop', JSON.stringify({ id: stop.id, name: stop.name }));
  refreshAll();
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function loadDepartures(stopId, duration) {
  setHidden($('#departures-loading'), false);
  setHidden($('#departures-empty'), true);
  const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/departures?duration=${duration}&remarks=true&language=en&pretty=false`;
  try {
    const list = await fetchJSON(url);
    const items = Array.isArray(list) ? list : list?.departures || list?.results || [];
    items.sort((a, b) => new Date(a.plannedWhen || a.when || 0) - new Date(b.plannedWhen || b.when || 0));
    renderDepartures(items);
  } catch (e) {
    console.error(e);
    showToast('Failed to load departures', 'error');
  } finally {
    setHidden($('#departures-loading'), true);
  }
}

function renderDepartures(items) {
  const tbody = $('#departures-body');
  tbody.innerHTML = '';
  $('#departures-count').textContent = items.length;
  if (!items.length) {
    setHidden($('#departures-empty'), false);
    const msgEl = document.getElementById('departures-empty-msg');
    if (msgEl) msgEl.textContent = 'No departures in this time window.';
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach((it) => {
    const delay = it.delay ?? computeDelaySecs(it.when, it.plannedWhen);
    let delayBadge = '';
    if (delay != null) {
      const mins = Math.round(delay / 60);
  if (mins === 0) delayBadge = '';
      else if (mins > 0) delayBadge = `<span class=\"badge badge-sm badge-warning whitespace-nowrap\">+${mins}m</span>`;
      else delayBadge = `<span class=\"badge badge-sm badge-info whitespace-nowrap\">${mins}m</span>`;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-mono p-2 md:p-3 text-[0.92rem] md:text-base">${fmtTime(it.when || it.plannedWhen)}</td>
      <td class="p-2 md:p-3 text-[0.92rem] md:text-base">
        <div class="flex items-center gap-0.5 md:gap-2">
          <span class="badge badge-xs md:badge-sm ${productBadgeClass(it.line)} whitespace-nowrap">${it.line?.name || it.line?.id || '?'}</span>
        </div>
      </td>
  <td class="truncate max-w-[8rem] md:max-w-none p-2 md:p-3 text-[0.92rem] md:text-base">${it.direction || '—'}</td>
  <td class="text-right whitespace-nowrap p-2 md:p-3 text-[0.92rem] md:text-base">${delayBadge}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

async function refreshAll() {
  if (!state.stop) {
    $('#departures-body').innerHTML = '';
    $('#departures-count').textContent = '0';
    setHidden($('#departures-empty'), false);
    const msgEl = document.getElementById('departures-empty-msg');
    if (msgEl) msgEl.textContent = 'No stop/station selected.';
    return;
  }
  const activeTab = $('#duration-tabs .tab.tab-active');
  const duration = activeTab ? Number(activeTab.getAttribute('data-minutes')) : 30;
  await loadDepartures(state.stop.id, duration);
  setLastUpdate();
}

$('#duration-tabs')?.addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  $$('#duration-tabs .tab').forEach((el) => el.classList.remove('tab-active'));
  t.classList.add('tab-active');
  refreshAll();
});
$('#refresh-now').addEventListener('click', refreshAll);

function startFixedRefresh() {
  if (state.refreshTimerId) clearInterval(state.refreshTimerId);
  state.refreshTimerId = setInterval(refreshAll, 30000);
}

const themeToggle = $('#theme-toggle');
let initialTheme = localStorage.getItem('theme');
if (!initialTheme) {
  initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
document.documentElement.setAttribute('data-theme', initialTheme);
themeToggle.checked = initialTheme === 'dark';
themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
});

setInterval(() => {
  $('#local-time').textContent = new Date().toLocaleString();
}, 1000);

(function init() {
  try {
  const last = JSON.parse(localStorage.getItem('selectedStop') || 'null');
  const stop = last;
    if (stop) {
      selectStop(stop);
      $('#search').value = stop.name;
    }
  } catch {}
  startFixedRefresh();
  $('#local-time').textContent = new Date().toLocaleString();
})();

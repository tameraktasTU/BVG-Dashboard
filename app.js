const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const API_BASE = 'https://v6.bvg.transport.rest';

const productBadgeClass = (line) => {
  const product = line?.product;
  const tag = String(line?.name || line?.id || '');
  if (product === 'subway') {
    const match = /U\s?([1-9])\b/i.exec(tag);
    if (match) {
      const key = `U${match[1]}`;
      const map = {
        U1: { bg: '#57A639', text: 'white' },  // RAL 6018 - Yellow Green
        U2: { bg: '#C63927', text: 'white' },  // RAL 2002 - Vermillion
        U3: { bg: '#00694C', text: 'white' },  // RAL 6016 - Turquoise Green
        U4: { bg: '#F9A800', text: 'black' },  // RAL 1023 - Traffic Yellow
        U5: { bg: '#6F4A28', text: 'white' },  // RAL 8007 - Fawn Brown
        U6: { bg: '#6C4675', text: 'white' },  // RAL 4005 - Blue Lilac
        U7: { bg: '#0080AB', text: 'white' },  // RAL 5012 - Light Blue
        U8: { bg: '#004F7C', text: 'white' },  // RAL 5010 - Gentian Blue
        U9: { bg: '#FA842B', text: 'white' },  // RAL 2003 - Pastel Orange
      };
      const conf = map[key];
      if (conf) return `bg-[${conf.bg}] text-${conf.text}`;
    }
  }
  switch (product) {
    case 'subway':
      return 'badge-primary';
    case 'suburban':
      return 'bg-[#006E34] text-white';  // S-Bahn official green
    case 'tram':
      return 'bg-[#CC0000] text-white';  // Tram official red
    case 'bus':
      return 'bg-[#A3007C] text-white';  // Bus official purple/magenta
    case 'ferry':
      return 'bg-[#009EE0] text-white';  // Ferry blue
    case 'regional':
      return 'bg-[#D50000] text-white';  // DB Regional red
    case 'express':
      return 'bg-[#EC0016] text-white';  // DB Express red
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

searchInput.addEventListener('input', debounce(() => searchStops(searchInput.value), 350));
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
  lastRefreshTime: null,
  allDepartures: [], // Cache all 60min departures
};

function selectStop(stop) {
  state.stop = stop;
  state.allDepartures = []; // Clear cache when selecting new stop
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

async function loadDepartures(stopId, duration, forceRefresh = false) {
  setHidden($('#departures-loading'), false);
  setHidden($('#departures-empty'), true);
  
  // Always fetch 60 minutes of data, only make API call if forced or cache is empty
  if (forceRefresh || state.allDepartures.length === 0) {
    const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/departures?duration=60&remarks=true&language=en&pretty=false`;
    try {
      const list = await fetchJSON(url);
      const items = Array.isArray(list) ? list : list?.departures || list?.results || [];
      items.sort((a, b) => new Date(a.plannedWhen || a.when || 0) - new Date(b.plannedWhen || b.when || 0));
      state.allDepartures = items;
    } catch (e) {
      showToast('Failed to load departures', 'error');
      setHidden($('#departures-loading'), true);
      return;
    }
  }
  
  // Filter departures based on selected duration
  const now = Date.now();
  const maxTime = now + (duration * 60 * 1000);
  const filteredItems = state.allDepartures.filter(item => {
    const departureTime = new Date(item.when || item.plannedWhen).getTime();
    return departureTime <= maxTime;
  });
  
  renderDepartures(filteredItems);
  setHidden($('#departures-loading'), true);
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
      if (mins === 0) {
        delayBadge = '';
      } else if (mins > 0) {
        delayBadge = `<span class="delay-badge delay-badge-warning inline-flex items-center justify-center px-1 py-0.5 rounded text-xs font-semibold border whitespace-nowrap w-[2.75rem]">+${mins}</span>`;
      } else {
        delayBadge = `<span class="delay-badge delay-badge-info inline-flex items-center justify-center px-1 py-0.5 rounded text-xs font-semibold border whitespace-nowrap w-[2.75rem]">${mins}</span>`;
      }
    }
    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer hover:bg-base-300 transition-colors';
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
    // Add click handler to show line overview
    tr.addEventListener('click', () => showLineOverview(it));
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

async function fetchTripDetails(tripId) {
  const url = `${API_BASE}/trips/${encodeURIComponent(tripId)}?stopovers=true&remarks=true&language=en&pretty=false`;
  return await fetchJSON(url);
}

async function showLineOverview(departure) {
  const modal = $('#line-overview-modal');
  const lineBadge = $('#modal-line-badge');
  const lineDirection = $('#modal-line-direction');
  const loading = $('#modal-loading');
  const errorDiv = $('#modal-error');
  const container = $('#stopovers-container');

  // Set header info
  lineBadge.className = `badge badge-lg ${productBadgeClass(departure.line)}`;
  lineBadge.textContent = departure.line?.name || departure.line?.id || '?';
  lineDirection.textContent = departure.direction || 'Unknown';

  // Show modal and loading state
  modal.showModal();
  setHidden(loading, false);
  setHidden(errorDiv, true);
  container.innerHTML = '';

  try {
    // Try to fetch trip details using tripId
    if (!departure.tripId) {
      throw new Error('No trip ID available');
    }

    const trip = await fetchTripDetails(departure.tripId);
    
    // Get stopovers from the trip response - try multiple possible locations
    const stopovers = trip?.stopovers || trip?.trip?.stopovers || [];
    
    if (!stopovers.length) {
      throw new Error('No stopovers found');
    }

    renderStopovers(stopovers, departure);
  } catch (e) {
    setHidden(errorDiv, false);
  } finally {
    setHidden(loading, true);
  }
}

function renderStopovers(stopovers, departure) {
  const container = $('#stopovers-container');
  container.innerHTML = '';

  // Find the current stop index - try multiple strategies
  const currentStopId = state.stop?.id;
  const currentStopName = state.stop?.name;
  const departureStopId = departure.stop?.id;
  const departureStopName = departure.stop?.name;
  
  let currentIndex = -1;
  
  // Strategy 1: Try exact ID match with state.stop
  if (currentStopId) {
    currentIndex = stopovers.findIndex(s => s.stop?.id === currentStopId);
  }
  
  // Strategy 2: Try exact ID match with departure.stop (the actual stop where departure occurs)
  if (currentIndex === -1 && departureStopId) {
    currentIndex = stopovers.findIndex(s => s.stop?.id === departureStopId);
  }
  
  // Strategy 3: Try name matching with state.stop
  if (currentIndex === -1 && currentStopName) {
    currentIndex = stopovers.findIndex(s => 
      s.stop?.name?.toLowerCase().includes(currentStopName.toLowerCase()) ||
      currentStopName.toLowerCase().includes(s.stop?.name?.toLowerCase())
    );
  }
  
  // Strategy 4: Try name matching with departure.stop
  if (currentIndex === -1 && departureStopName) {
    currentIndex = stopovers.findIndex(s => 
      s.stop?.name?.toLowerCase().includes(departureStopName.toLowerCase()) ||
      departureStopName.toLowerCase().includes(s.stop?.name?.toLowerCase())
    );
  }

  // Get the line color from the badge class
  const badgeClass = productBadgeClass(departure.line);
  let lineColor = '#0080AB'; // Default accent color
  
  // Extract color from badge class if it contains bg-[#...]
  const colorMatch = badgeClass.match(/bg-\[([#\w]+)\]/);
  if (colorMatch) {
    lineColor = colorMatch[1];
  } else if (badgeClass.includes('badge-primary')) {
    lineColor = '#0080AB'; // Primary color for generic subway
  }

  // Create timeline container
  const timeline = document.createElement('div');
  timeline.className = 'flex flex-col gap-0 pl-2';

  stopovers.forEach((stopover, idx) => {
    const isPassed = currentIndex !== -1 && idx < currentIndex;
    const isCurrent = idx === currentIndex;
    const isFuture = currentIndex === -1 || idx > currentIndex;
    
    const stopDiv = document.createElement('div');
    stopDiv.className = 'flex items-stretch gap-3 relative mb-2';
    
    if (isCurrent) {
      stopDiv.className += ' rounded-lg';
      stopDiv.id = 'current-stop-item'; // Add ID for scrolling
    }

    // Timeline indicator
    const timelineIndicator = document.createElement('div');
    timelineIndicator.className = 'flex flex-col items-center flex-shrink-0 relative';
    timelineIndicator.innerHTML = `
      ${idx > 0 ? `<div class="w-0.5 h-2 absolute top-0" style="background-color: ${isPassed || isCurrent ? '#9ca3af' : lineColor};"></div>` : ''}
      <div class="w-3 h-3 rounded-full z-10 my-2 ${isCurrent ? 'ring-4 ring-primary/30' : ''}" style="background-color: ${isCurrent ? lineColor : isPassed ? '#9ca3af' : lineColor};"></div>
      ${idx < stopovers.length - 1 ? `<div class="w-0.5 absolute top-2" style="height: calc(100% + 0.5rem); background-color: ${isPassed ? '#9ca3af' : lineColor};"></div>` : ''}
    `;

    // Stop info
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1 min-w-0 flex items-center px-3';
    
    const departureTime = stopover.departure ? fmtTime(stopover.departure) : stopover.arrival ? fmtTime(stopover.arrival) : '—';
    const platform = stopover.platform || stopover.plannedPlatform;
    
    // Calculate delay for this stopover
    const delay = stopover.departureDelay ?? stopover.arrivalDelay ?? computeDelaySecs(
      stopover.departure || stopover.arrival,
      stopover.plannedDeparture || stopover.plannedArrival
    );
    
    let delayBadge = '';
    if (delay != null) {
      const mins = Math.round(delay / 60);
      if (mins > 0) {
        delayBadge = `<span class="delay-badge delay-badge-warning inline-flex items-center justify-center px-0.5 rounded text-[0.65rem] leading-none font-semibold border w-[2.25rem]" style="padding-top: 1px; padding-bottom: 1px;">
          +${mins}
        </span>`;
      } else if (mins < 0) {
        delayBadge = `<span class="delay-badge delay-badge-info inline-flex items-center justify-center px-0.5 rounded text-[0.65rem] leading-none font-semibold border w-[2.25rem]" style="padding-top: 1px; padding-bottom: 1px;">
          ${mins}
        </span>`;
      }
    }
    
    let timeDisplay = `<span class="font-mono font-medium">${departureTime}</span>`;

    infoDiv.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap flex-1">
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate ${isCurrent ? 'font-bold' : isPassed ? 'opacity-40' : ''}">${stopover.stop?.name || 'Unknown'}</div>
          <div class="text-sm flex items-center gap-2 flex-wrap mt-0.5 ${isPassed ? 'opacity-30' : 'opacity-70'}">
            ${timeDisplay}
            ${delayBadge}
            ${platform ? `<span class="badge badge-xs badge-outline">Platform ${platform}</span>` : ''}
            ${isCurrent ? `<span class="badge badge-xs text-white" style="background-color: ${lineColor};">Current Stop</span>` : ''}
          </div>
        </div>
      </div>
    `;

    stopDiv.appendChild(timelineIndicator);
    stopDiv.appendChild(infoDiv);
    timeline.appendChild(stopDiv);
  });

  container.appendChild(timeline);
  
  // Auto-scroll to current stop
  setTimeout(() => {
    const currentStopElement = document.getElementById('current-stop-item');
    if (currentStopElement) {
      currentStopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
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
  await loadDepartures(state.stop.id, duration, true); // Force refresh on auto-refresh
  setLastUpdate();
  state.lastRefreshTime = Date.now();
}

// Update sliding indicator position
function updateTabIndicator() {
  const activeTab = $('#duration-tabs .tab.tab-active');
  const container = $('#duration-tabs');
  if (!activeTab || !container) return;
  
  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  const left = tabRect.left - containerRect.left;
  const width = tabRect.width;
  
  container.style.setProperty('--indicator-left', `${left}px`);
  container.style.setProperty('--indicator-width', `${width}px`);
}

$('#duration-tabs')?.addEventListener('click', async (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  $$('#duration-tabs .tab').forEach((el) => el.classList.remove('tab-active'));
  t.classList.add('tab-active');
  updateTabIndicator();
  
  // Just filter cached data, don't make API call
  if (state.stop) {
    const duration = Number(t.getAttribute('data-minutes'));
    await loadDepartures(state.stop.id, duration, false); // false = use cache
  }
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

// Pause auto-refresh when tab is hidden to reduce API calls
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab is hidden - pause refresh
    if (state.refreshTimerId) clearInterval(state.refreshTimerId);
  } else {
    // Tab is visible again
    const timeSinceLastRefresh = Date.now() - (state.lastRefreshTime || 0);
    
    // Only refresh if 30+ seconds have passed since last update
    if (timeSinceLastRefresh >= 30000) {
      refreshAll();
    }
    // Always restart the auto-refresh interval
    startFixedRefresh();
  }
});

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
  
  // Initialize tab indicator position
  updateTabIndicator();
  // Update indicator on window resize
  window.addEventListener('resize', updateTabIndicator);
})();

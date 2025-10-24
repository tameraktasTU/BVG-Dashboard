// ============================================================================
// DOM UTILITIES
// ============================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const setHidden = (el, hidden) => el?.classList.toggle('hidden', hidden);

// ============================================================================
// CONSTANTS
// ============================================================================

const API_BASE = 'https://v6.bvg.transport.rest';
const REFRESH_INTERVAL_MS = 30000; // 30 seconds
const CACHE_DURATION_MINUTES = 60; // Always fetch 60 minutes of departures
const SEARCH_DEBOUNCE_MS = 350;

// U-Bahn line color mapping (Berlin official colors)
const U_BAHN_COLORS = {
  U1: { bg: '#57A639', text: 'white' },  // Yellow Green
  U2: { bg: '#C63927', text: 'white' },  // Vermillion
  U3: { bg: '#00694C', text: 'white' },  // Turquoise Green
  U4: { bg: '#F9A800', text: 'black' },  // Traffic Yellow
  U5: { bg: '#6F4A28', text: 'white' },  // Fawn Brown
  U6: { bg: '#6C4675', text: 'white' },  // Blue Lilac
  U7: { bg: '#0080AB', text: 'white' },  // Light Blue
  U8: { bg: '#004F7C', text: 'white' },  // Gentian Blue
  U9: { bg: '#FA842B', text: 'white' },  // Pastel Orange
};

// Transport type color mapping
const PRODUCT_COLORS = {
  subway: 'badge-primary',
  suburban: 'bg-[#006E34] text-white',   // S-Bahn green
  tram: 'bg-[#CC0000] text-white',       // Tram red
  bus: 'bg-[#A3007C] text-white',        // Bus purple
  ferry: 'bg-[#009EE0] text-white',      // Ferry blue
  regional: 'bg-[#D50000] text-white',   // DB Regional red
  express: 'bg-[#EC0016] text-white',    // DB Express red
};

// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
  stop: null,
  refreshTimerId: null,
  lastRefreshTime: null,
  allDepartures: [], // Cached 60-minute departure data
  currentView: 'journey', // 'departures', 'journey', 'settings'
  journey: {
    origin: null,
    destination: null,
    journeys: [],
  }
};

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch {
    return '—';
  }
};

const fmtDelay = (secs) => {
  if (secs == null) return '';
  const mins = Math.round(secs / 60);
  if (mins === 0) return 'On time';
  return `${mins > 0 ? '+' : ''}${mins}m`;
};

const computeDelaySecs = (when, plannedWhen) => {
  if (!when || !plannedWhen) return null;
  const actualTime = new Date(when).getTime();
  const plannedTime = new Date(plannedWhen).getTime();
  if (isNaN(actualTime) || isNaN(plannedTime)) return null;
  return Math.round((actualTime - plannedTime) / 1000);
};

// ============================================================================
// UI UTILITIES
// ============================================================================

const showToast = (msg, type = 'error') => {
  const toast = document.createElement('div');
  toast.className = `alert alert-${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  $('#toast').appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

const setLastUpdate = () => {
  $('#last-update').textContent = new Date().toLocaleTimeString();
};

// ============================================================================
// PRODUCT BADGE STYLING
// ============================================================================

const productBadgeClass = (line) => {
  const product = line?.product;
  const tag = String(line?.name || line?.id || '');
  
  // Handle U-Bahn lines with specific colors
  if (product === 'subway') {
    const match = /U\s?([1-9])\b/i.exec(tag);
    if (match) {
      const lineKey = `U${match[1]}`;
      const colors = U_BAHN_COLORS[lineKey];
      if (colors) {
        return `bg-[${colors.bg}] text-${colors.text}`;
      }
    }
  }
  
  return PRODUCT_COLORS[product] || 'badge-ghost';
};

// Extract color from badge class for timeline visualization
const extractLineColor = (badgeClass) => {
  const colorMatch = badgeClass.match(/bg-\[([#\w]+)\]/);
  if (colorMatch) return colorMatch[1];
  if (badgeClass.includes('badge-primary')) return '#0080AB';
  return '#0080AB'; // Default fallback
};

// ============================================================================
// DELAY BADGE RENDERING
// ============================================================================

const renderDelayBadge = (delay, size = 'normal') => {
  if (delay == null) return '';
  
  const mins = Math.round(delay / 60);
  if (mins === 0) return '';
  
  const isLate = mins > 0;
  const badgeType = isLate ? 'warning' : 'info';
  const displayText = isLate ? `+${mins}` : `${mins}`;
  
  if (size === 'small') {
    return `<span class="delay-badge delay-badge-${badgeType} inline-flex items-center justify-center px-0.5 rounded text-[0.65rem] leading-none font-semibold border w-[2.25rem]" style="padding-top: 1px; padding-bottom: 1px;">${displayText}</span>`;
  }
  
  return `<span class="delay-badge delay-badge-${badgeType} inline-flex items-center justify-center px-1 py-0.5 rounded text-xs font-semibold border whitespace-nowrap w-[2.75rem]">${displayText}</span>`;
};

// ============================================================================
// API COMMUNICATION
// ============================================================================

const fetchJSON = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
};

// ============================================================================
// SEARCH FUNCTIONALITY
// ============================================================================

const searchInput = $('#search');
const resultsBox = $('#results');
let searchPrevValue = '';
let suppressBlur = false;
let searchAbort = null;

const debounce = (fn, ms = 300) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const searchStops = async (query) => {
  const trimmedQuery = query?.trim();
  
  if (!trimmedQuery || trimmedQuery.length < 2) {
    resultsBox.classList.add('hidden');
    resultsBox.innerHTML = '';
    return;
  }
  
  if (searchAbort) searchAbort.abort();
  const controller = new AbortController();
  searchAbort = controller;
  
  const url = `${API_BASE}/locations?query=${encodeURIComponent(trimmedQuery)}&results=8&stops=true&addresses=false&poi=false&language=en&pretty=false`;
  resultsBox.innerHTML = '<progress class="progress w-full"></progress>';
  resultsBox.classList.remove('hidden');
  
  try {
    const res = await fetch(url, { 
      signal: controller.signal, 
      headers: { accept: 'application/json' } 
    });
    
    if (!res.ok) throw new Error('Search failed');
    
    const items = await res.json();
    const stops = items.filter(x => x.type === 'stop');
    renderSearchResults(stops);
  } catch (e) {
    if (controller.signal.aborted) return;
    resultsBox.innerHTML = '';
    resultsBox.classList.add('hidden');
    showToast('Search error. Try again.', 'error');
  }
};

const renderSearchResults = (stops) => {
  if (!stops.length) {
    resultsBox.innerHTML = '<div class="p-3 text-sm opacity-70">No results</div>';
    return;
  }
  
  resultsBox.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'menu bg-base-200 rounded-box';
  
  stops.forEach(stop => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a class="justify-between">
        <span><span class="font-medium">${stop.name}</span></span>
      </a>
    `;
    
    li.addEventListener('click', () => {
      selectStop(stop);
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
      searchInput.value = stop.name;
      searchPrevValue = stop.name;
      suppressBlur = false;
      searchInput.blur();
      
      setTimeout(() => {
        if (document.activeElement === searchInput) {
          $('#refresh-now')?.focus();
        }
      }, 0);
    });
    
    ul.appendChild(li);
  });
  
  resultsBox.appendChild(ul);
};

// ============================================================================
// GEOLOCATION FUNCTIONALITY
// ============================================================================

const findNearbyStops = async () => {
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
        
        if (!res.ok) throw new Error('Nearby search failed');
        
        const items = await res.json();
        const stops = items.filter(x => x.type === 'stop');
        renderSearchResults(stops);
      } catch (e) {
        showToast('Failed to fetch nearby stops', 'error');
        resultsBox.classList.add('hidden');
        resultsBox.innerHTML = '';
      }
    },
    () => {
      showToast('Location permission denied', 'warning');
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
};

// ============================================================================
// SEARCH INPUT EVENT HANDLERS
// ============================================================================

searchInput.addEventListener('input', debounce(() => searchStops(searchInput.value), SEARCH_DEBOUNCE_MS));

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
resultsBox.addEventListener('mouseup', () => { 
  setTimeout(() => { suppressBlur = false; }, 0); 
});

// ============================================================================
// STOP SELECTION
// ============================================================================

const selectStop = (stop) => {
  state.stop = stop;
  state.allDepartures = [];
  
  const badge = $('#departures-stop');
  if (badge) {
    badge.innerHTML = `
      <span class="inline-flex items-center gap-2 min-w-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 opacity-70">
          <path d="M12 2C8.134 2 5 5.134 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7Z"/>
          <circle cx="12" cy="9" r="2.5"/>
        </svg>
        <span class="truncate block max-w-[60vw] md:max-w-none">${stop.name}</span>
      </span>
    `;
    badge.classList.remove('hidden');
  }
  
  localStorage.setItem('selectedStop', JSON.stringify({ 
    id: stop.id, 
    name: stop.name,
    location: stop.location
  }));
  
  refreshAll();
};

// ============================================================================
// DEPARTURES LOADING & RENDERING
// ============================================================================

const loadDepartures = async (stopId, duration, forceRefresh = false) => {
  setHidden($('#departures-loading'), false);
  setHidden($('#departures-empty'), true);
  
  // Fetch fresh data if forced or cache is empty
  if (forceRefresh || state.allDepartures.length === 0) {
    const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/departures?duration=${CACHE_DURATION_MINUTES}&remarks=true&language=en&pretty=false`;
    
    try {
      const list = await fetchJSON(url);
      const items = Array.isArray(list) ? list : (list?.departures || list?.results || []);

      items.sort((a, b) => {
        const timeA = new Date(a.when || a.plannedWhen || 0).getTime();
        const timeB = new Date(b.when || b.plannedWhen || 0).getTime();
        return timeA - timeB;
      });
      
      state.allDepartures = items;
    } catch (e) {
      showToast('Failed to load departures', 'error');
      setHidden($('#departures-loading'), true);
      return;
    }
  }
  
  // Filter cached departures based on selected duration
  const now = Date.now();
  const maxTime = now + (duration * 60 * 1000);
  const filteredItems = state.allDepartures.filter(item => {
    const departureTime = new Date(item.when || item.plannedWhen).getTime();
    return departureTime <= maxTime;
  });
  
  renderDepartures(filteredItems);
  setHidden($('#departures-loading'), true);
};

const renderDepartures = (items) => {
  const tbody = $('#departures-body');
  tbody.innerHTML = '';
  $('#departures-count').textContent = items.length;
  
  if (!items.length) {
    setHidden($('#departures-empty'), false);
    const msgEl = $('#departures-empty-msg');
    if (msgEl) msgEl.textContent = 'No departures in this time window.';
    return;
  }
  
  const fragment = document.createDocumentFragment();
  
  items.forEach(departure => {
    const delay = departure.delay ?? computeDelaySecs(departure.when, departure.plannedWhen);
    const hasDelayData = delay !== null;
    const hasSignificantDelay = hasDelayData && Math.abs(delay) >= 60;

    const plannedTimeDisplay = hasSignificantDelay
      ? `<span class="line-through opacity-40">${fmtTime(departure.plannedWhen)}</span>`
      : `<span>${fmtTime(departure.plannedWhen || departure.when)}</span>`;

    const actualTimeDisplay = hasDelayData
      ? `<span class="${delay > 0 ? 'text-error' : delay < 0 ? 'text-info' : 'text-success'} font-semibold">
           ${hasSignificantDelay ? fmtTime(departure.when) : fmtTime(departure.plannedWhen || departure.when)}
         </span>`
      : `<span>${fmtTime(departure.when || departure.plannedWhen)}</span>`;
    
    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer hover:bg-base-300 transition-colors';
    tr.innerHTML = `
      <td class="font-mono px-2 md:px-3 py-2 md:py-3 text-[0.92rem] md:text-base">
        ${plannedTimeDisplay}
      </td>
      <td class="font-mono px-1 md:px-3 py-2 md:py-3 text-[0.92rem] md:text-base">
        ${actualTimeDisplay}
      </td>
      <td class="px-2 md:px-3 py-2 md:py-3 text-[0.92rem] md:text-base">
        <div class="flex items-center gap-0.5 md:gap-2">
          <span class="badge badge-xs md:badge-sm ${productBadgeClass(departure.line)} whitespace-nowrap">
            ${departure.line?.name || departure.line?.id || '?'}
          </span>
        </div>
      </td>
      <td class="truncate max-w-[8rem] md:max-w-none px-2 md:px-3 py-2 md:py-3 text-[0.92rem] md:text-base">
        ${departure.direction || '—'}
      </td>
    `;
    
    tr.addEventListener('click', () => showLineOverview(departure));
    fragment.appendChild(tr);
  });
  
  tbody.appendChild(fragment);
};

// ============================================================================
// LINE OVERVIEW MODAL
// ============================================================================

const fetchTripDetails = async (tripId) => {
  const url = `${API_BASE}/trips/${encodeURIComponent(tripId)}?stopovers=true&remarks=true&language=en&pretty=false`;
  return await fetchJSON(url);
};

const showLineOverview = async (departure) => {
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
    if (!departure.tripId) {
      throw new Error('No trip ID available');
    }
    
    const trip = await fetchTripDetails(departure.tripId);
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
};

// ============================================================================
// STOPOVERS RENDERING
// ============================================================================

const findCurrentStopIndex = (stopovers, departure) => {
  const currentStopId = state.stop?.id;
  const currentStopName = state.stop?.name;
  const departureStopId = departure.stop?.id;
  const departureStopName = departure.stop?.name;
  
  // Strat 1: Exact ID match with state.stop
  if (currentStopId) {
    const idx = stopovers.findIndex(s => s.stop?.id === currentStopId);
    if (idx !== -1) return idx;
  }
  
  // Strat 2: Exact ID match with departure.stop
  if (departureStopId) {
    const idx = stopovers.findIndex(s => s.stop?.id === departureStopId);
    if (idx !== -1) return idx;
  }
  
  // Strat 3: Name matching with state.stop
  if (currentStopName) {
    const idx = stopovers.findIndex(s => {
      const stopName = s.stop?.name?.toLowerCase() || '';
      const current = currentStopName.toLowerCase();
      return stopName.includes(current) || current.includes(stopName);
    });
    if (idx !== -1) return idx;
  }
  
  // Strat 4: Name matching with departure.stop
  if (departureStopName) {
    const idx = stopovers.findIndex(s => {
      const stopName = s.stop?.name?.toLowerCase() || '';
      const depName = departureStopName.toLowerCase();
      return stopName.includes(depName) || depName.includes(stopName);
    });
    if (idx !== -1) return idx;
  }
  
  return -1;
};

const renderStopovers = (stopovers, departure) => {
  const container = $('#stopovers-container');
  container.innerHTML = '';
  
  const currentIndex = findCurrentStopIndex(stopovers, departure);
  const badgeClass = productBadgeClass(departure.line);
  const lineColor = extractLineColor(badgeClass);
  
  const timeline = document.createElement('div');
  timeline.className = 'flex flex-col gap-0 pl-2';
  
  stopovers.forEach((stopover, idx) => {
    const isPassed = currentIndex !== -1 && idx < currentIndex;
    const isCurrent = idx === currentIndex;
    
    const stopDiv = document.createElement('div');
    stopDiv.className = 'flex items-stretch gap-3 relative mb-2';
    
    if (isCurrent) {
      stopDiv.className += ' rounded-lg';
      stopDiv.id = 'current-stop-item';
    }

    const indicatorColor = (isPassed || isCurrent) ? '#9ca3af' : lineColor;
    const lineColorValue = isPassed ? '#9ca3af' : lineColor;
    
    const timelineIndicator = document.createElement('div');
    timelineIndicator.className = 'flex flex-col items-center flex-shrink-0 relative';
    timelineIndicator.innerHTML = `
      ${idx > 0 ? `<div class="w-0.5 h-2 absolute top-0" style="background-color: ${indicatorColor};"></div>` : ''}
      <div class="w-3 h-3 rounded-full z-10 my-2 ${isCurrent ? 'ring-4 ring-primary/30' : ''}" style="background-color: ${isCurrent ? lineColor : indicatorColor};"></div>
      ${idx < stopovers.length - 1 ? `<div class="w-0.5 absolute top-2" style="height: calc(100% + 0.5rem); background-color: ${lineColorValue};"></div>` : ''}
    `;

    const actualTime = stopover.departure || stopover.arrival;
    const plannedTime = stopover.plannedDeparture || stopover.plannedArrival;
    const platform = stopover.platform || stopover.plannedPlatform;
    
    const delay = stopover.departureDelay ?? stopover.arrivalDelay ?? 
                  computeDelaySecs(actualTime, plannedTime);
    
    const hasDelayData = delay !== null;
    const hasSignificantDelay = hasDelayData && Math.abs(delay) >= 60;

    let timeDisplay = '';
    if (hasSignificantDelay) {
      const delayColor = delay > 0 ? 'text-error' : delay < 0 ? 'text-info' : 'text-success';
      timeDisplay = `
        <span class="font-mono font-medium line-through opacity-40">${fmtTime(plannedTime)}</span>
        <span class="font-mono font-semibold ${delayColor}">${fmtTime(actualTime)}</span>
      `;
    } else if (hasDelayData && delay === 0) {
      timeDisplay = `<span class="font-mono font-semibold text-success">${fmtTime(actualTime || plannedTime)}</span>`;
    } else {
      timeDisplay = `<span class="font-mono font-medium">${fmtTime(actualTime || plannedTime) || '—'}</span>`;
    }
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1 min-w-0 flex items-center px-3';
    infoDiv.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap flex-1">
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate ${isCurrent ? 'font-bold' : isPassed ? 'opacity-40' : ''}">
            ${stopover.stop?.name || 'Unknown'}
          </div>
          <div class="text-sm flex items-center gap-2 flex-wrap mt-0.5 ${isPassed ? 'opacity-30' : 'opacity-70'}">
            ${timeDisplay}
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
    const currentStopElement = $('#current-stop-item');
    if (currentStopElement) {
      currentStopElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
};

// ============================================================================
// REFRESH FUNCTIONALITY
// ============================================================================

const refreshAll = async () => {
  if (!state.stop) {
    $('#departures-body').innerHTML = '';
    $('#departures-count').textContent = '0';
    setHidden($('#departures-empty'), false);
    const msgEl = $('#departures-empty-msg');
    if (msgEl) msgEl.textContent = 'No stop/station selected.';
    return;
  }
  
  const activeTab = $('#duration-tabs .tab.tab-active');
  const duration = activeTab ? Number(activeTab.getAttribute('data-minutes')) : 30;
  await loadDepartures(state.stop.id, duration, true);
  setLastUpdate();
  state.lastRefreshTime = Date.now();
};

const startFixedRefresh = () => {
  if (state.refreshTimerId) clearInterval(state.refreshTimerId);
  state.refreshTimerId = setInterval(refreshAll, REFRESH_INTERVAL_MS);
};

// ============================================================================
// TIME WINDOW TABS
// ============================================================================

const updateTabIndicator = () => {
  const activeTab = $('#duration-tabs .tab.tab-active');
  const container = $('#duration-tabs');
  if (!activeTab || !container) return;
  
  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  const left = tabRect.left - containerRect.left;
  const width = tabRect.width;
  
  container.style.setProperty('--indicator-left', `${left}px`);
  container.style.setProperty('--indicator-width', `${width}px`);
};

$('#duration-tabs')?.addEventListener('click', async (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  
  $$('#duration-tabs .tab').forEach(el => el.classList.remove('tab-active'));
  tab.classList.add('tab-active');
  updateTabIndicator();
  
  const duration = tab.getAttribute('data-minutes');
  localStorage.setItem('selectedDuration', duration);
  
  if (state.stop) {
    await loadDepartures(state.stop.id, Number(duration), false);
  }
});

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

const initTheme = () => {
  const themeToggle = $('#theme-toggle');
  let theme = localStorage.getItem('theme');
  
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.checked = theme === 'dark';
  
  themeToggle.addEventListener('change', () => {
    const newTheme = themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
};

// ============================================================================
// VISIBILITY CHANGE HANDLING
// ============================================================================

const handleVisibilityChange = () => {
  if (document.hidden) {
    if (state.refreshTimerId) clearInterval(state.refreshTimerId);
  } else {
    const timeSinceLastRefresh = Date.now() - (state.lastRefreshTime || 0);
    
    if (timeSinceLastRefresh >= REFRESH_INTERVAL_MS) {
      refreshAll();
    }
    
    startFixedRefresh();
  }
};

// ============================================================================
// RADAR MAP
// ============================================================================

const radarState = {
  map: null,
  markers: [],
  stopMarker: null,
  vehicles: [],
  refreshTimerId: null
};

const RADAR_CONFIG = {
  DEFAULT_ZOOM: 14,
  SEARCH_RADIUS: 0.09, // Fixed search radius (~10km)
  MAX_RESULTS: 1024,
  MAP_INIT_DELAY: 100,
  REFRESH_INTERVAL: 10000
};

// Extract hex colors from PRODUCT_COLORS for use in SVG markers
const PRODUCT_HEX_COLORS = {
  subway: '#57A639',
  suburban: '#006E34',
  tram: '#CC0000',
  bus: '#A3007C',
  ferry: '#009EE0',
  regional: '#D50000',
  express: '#EC0016',
  default: '#64748b'
};

const getVehicleColor = (product, lineName) => {
  if (!product) return PRODUCT_HEX_COLORS.default;
  
  const productType = product.toLowerCase();
  
  if (productType.includes('subway') || productType.includes('u-bahn')) {
    if (lineName) {
      const uBahnColor = U_BAHN_COLORS[lineName.toUpperCase()];
      if (uBahnColor) return uBahnColor.bg;
    }
    return PRODUCT_HEX_COLORS.subway;
  }
  
  if (productType.includes('suburban') || productType.includes('s-bahn')) return PRODUCT_HEX_COLORS.suburban;
  if (productType.includes('tram') || productType.includes('strassenbahn')) return PRODUCT_HEX_COLORS.tram;
  if (productType.includes('bus')) return PRODUCT_HEX_COLORS.bus;
  if (productType.includes('ferry') || productType.includes('fähre')) return PRODUCT_HEX_COLORS.ferry;
  if (productType.includes('regional')) return PRODUCT_HEX_COLORS.regional;
  if (productType.includes('express')) return PRODUCT_HEX_COLORS.express;
  
  return PRODUCT_HEX_COLORS.default;
};

const createVehicleIcon = (color, lineName) => {
  const iconSize = 32;
  const svg = `
    <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="${color}" stroke="white" stroke-width="2"/>
      <text x="16" y="20" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="white">${lineName}</text>
    </svg>
  `;
  
  return L.divIcon({
    html: svg,
    className: 'vehicle-marker',
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize / 2]
  });
};

const createStopIcon = () => {
  const iconSize = 40;
  const svg = `
    <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="3" opacity="0.3">
        <animate attributeName="r" from="18" to="8" dur="1.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" from="0.3" to="0" dur="1.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="20" cy="20" r="8" fill="currentColor"/>
    </svg>
  `;
  
  return L.divIcon({
    html: svg,
    className: 'stop-marker',
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize / 2]
  });
};

// ============================================================================
// Popup Content Builders
// ============================================================================

const getProductDisplayName = (product) => {
  if (!product) return 'Vehicle';
  
  const productLower = product.toLowerCase();
  
  if (productLower.includes('subway') || productLower.includes('u-bahn')) return 'U-Bahn';
  if (productLower.includes('suburban') || productLower.includes('s-bahn')) return 'S-Bahn';
  if (productLower.includes('tram') || productLower.includes('strassenbahn')) return 'Tram';
  if (productLower.includes('bus')) return 'Bus';
  if (productLower.includes('ferry') || productLower.includes('fähre')) return 'Ferry';
  if (productLower.includes('regional')) return 'Regional';
  if (productLower.includes('express')) return 'Express';
  
  return product; // Return original if no match
};

const getUpcomingStopover = (vehicle) => {
  if (!vehicle.nextStopovers || vehicle.nextStopovers.length === 0) {
    return null;
  }
  
  const now = Date.now();
  
  for (const stopover of vehicle.nextStopovers) {
    const departureTime = stopover.departure || stopover.plannedDeparture;
    
    if (departureTime) {
      const depTime = new Date(departureTime).getTime();
      if (depTime > now) {
        return stopover;
      }
    } else if (stopover.arrival || stopover.plannedArrival) {
      const arrivalTime = stopover.arrival || stopover.plannedArrival;
      const arrTime = new Date(arrivalTime).getTime();
      if (arrTime > now) {
        return stopover;
      }
    }
  }
  
  return vehicle.nextStopovers[0];
};

const createStopPopupContent = (stopName) => {
  return `
    <div class="radar-popup-container">
      <div class="radar-popup-header">
        <div class="radar-popup-icon">📍</div>
        <div class="radar-popup-title">Your Stop</div>
      </div>
      <div class="radar-popup-body">
        <div class="radar-popup-stop-name">${stopName}</div>
      </div>
    </div>
  `;
};

const createVehiclePopupContent = (vehicle) => {
  const lineName = vehicle.line?.name || '?';
  const productType = vehicle.line?.product || 'Vehicle';
  const displayName = getProductDisplayName(productType);
  const color = getVehicleColor(productType, lineName);

  const lastStopover = vehicle.nextStopovers?.[vehicle.nextStopovers.length - 1];
  const destination = lastStopover?.stop?.name || 'In Service';

  const nextStopover = getUpcomingStopover(vehicle);
  const nextStop = nextStopover?.stop?.name;
  
  // Get actual and planned times
  const actualTime = nextStopover?.arrival || nextStopover?.departure;
  const plannedTime = nextStopover?.plannedArrival || nextStopover?.plannedDeparture;
  
  const speed = vehicle.speed ? `${Math.round(vehicle.speed)} km/h` : null;

  const delay = nextStopover?.arrivalDelay ?? nextStopover?.departureDelay ?? 
                computeDelaySecs(actualTime, plannedTime);
  
  const hasDelayData = delay !== null;
  const hasSignificantDelay = hasDelayData && Math.abs(delay) >= 60;

  let timeDisplay = '';
  if (actualTime || plannedTime) {
    if (hasSignificantDelay) {
      const delayColor = delay > 0 ? 'text-error' : delay < 0 ? 'text-info' : 'text-success';
      timeDisplay = `
        <span class="line-through opacity-40">${fmtTime(plannedTime)}</span>
        <span class="${delayColor} font-semibold">${fmtTime(actualTime)}</span>
      `;
    } else if (hasDelayData && delay === 0) {
      timeDisplay = `<span class="text-success font-semibold">${fmtTime(actualTime || plannedTime)}</span>`;
    } else {
      timeDisplay = `<span>${fmtTime(actualTime || plannedTime)}</span>`;
    }
  }
  
  return `
    <div class="radar-popup-container">
      <div class="radar-popup-header">
        <div class="radar-popup-badge" style="background-color: ${color};">
          ${lineName}
        </div>
        <div class="radar-popup-product">${displayName}</div>
      </div>
      
      <div class="radar-popup-body">
        <div class="radar-popup-route">
          <span class="radar-popup-destination">${destination}</span>
        </div>
        
        ${nextStop ? `
          <div class="radar-popup-divider"></div>
          <div class="radar-popup-info-grid">
            <div class="radar-popup-info-item">
              <div class="radar-popup-info-label">Next Stop</div>
              <div class="radar-popup-info-value">${nextStop}</div>
              ${timeDisplay ? `<div class="radar-popup-info-time">${timeDisplay}</div>` : ''}
            </div>
            ${speed ? `
              <div class="radar-popup-info-item">
                <div class="radar-popup-info-label">Speed</div>
                <div class="radar-popup-info-value">${speed}</div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
};

const createPopup = (content) => {
  return L.popup({
    className: 'radar-popup',
    closeButton: true,
    autoClose: false,
    closeOnClick: false,
    maxWidth: 280,
    minWidth: 240
  }).setContent(content);
};

const initRadarMap = () => {
  if (radarState.map) return;
  
  const mapElement = $('#radar-map');
  if (!mapElement) return;
  
  radarState.map = L.map('radar-map', {
    zoomControl: false,
    attributionControl: true
  });
  
  const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
  const tileLayer = isDarkTheme
    ? L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      })
    : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      });
  
  tileLayer.addTo(radarState.map);
  radarState.map.setView([52.52, 13.405], 13);
};

const clearRadarMarkers = () => {
  radarState.markers.forEach(marker => marker.remove());
  radarState.markers = [];
  
  if (radarState.stopMarker) {
    radarState.stopMarker.remove();
    radarState.stopMarker = null;
  }
};

const addStopMarker = (stop) => {
  if (!radarState.map || !stop?.location?.latitude || !stop?.location?.longitude) return;
  
  radarState.stopMarker = L.marker(
    [stop.location.latitude, stop.location.longitude],
    { icon: createStopIcon() }
  ).addTo(radarState.map);
  
  const popupContent = createStopPopupContent(stop.name);
  radarState.stopMarker.bindPopup(createPopup(popupContent));
};

const addVehicleMarker = (vehicle) => {
  if (!radarState.map || !vehicle.location?.latitude || !vehicle.location?.longitude) return;
  
  const lineName = vehicle.line?.name || '?';
  const color = getVehicleColor(vehicle.line?.product, lineName);
  
  const marker = L.marker(
    [vehicle.location.latitude, vehicle.location.longitude],
    { icon: createVehicleIcon(color, lineName) }
  ).addTo(radarState.map);
  
  const popupContent = createVehiclePopupContent(vehicle);
  marker.bindPopup(createPopup(popupContent));
  
  radarState.markers.push(marker);
};

const updateRadarMarkers = () => {
  if (!radarState.map) return;
  
  clearRadarMarkers();
  
  if (state.stop) {
    addStopMarker(state.stop);
  }
  
  radarState.vehicles.forEach(addVehicleMarker);
};

const getStopFromStateOrStorage = () => {
  if (state.stop?.location?.latitude && state.stop?.location?.longitude) {
    return state.stop;
  }
  
  try {
    const savedStop = JSON.parse(localStorage.getItem('selectedStop') || 'null');
    if (savedStop?.location?.latitude && savedStop?.location?.longitude) {
      state.stop = savedStop;
      return savedStop;
    }
  } catch (error) {
    console.error('Failed to restore stop from localStorage:', error);
  }
  
  return null;
};

const updateRadarStats = (vehicleCount) => {
  const statsDiv = $('#radar-stats');
  if (!statsDiv) return;
  
  statsDiv.innerHTML = `
    <div class="text-xs opacity-70">Vehicles: <span class="font-bold">${vehicleCount}</span></div>
  `;
};

const filterVehiclesByTripIds = (vehicles, tripIds) => {
  if (!tripIds || tripIds.size === 0) return [];
  
  return vehicles.filter(vehicle => {
    return vehicle.tripId && tripIds.has(vehicle.tripId);
  });
};

const fetchRadarData = async (showLoading = true) => {
  const radarLoading = $('#radar-loading');
  const radarError = $('#radar-error');
  
  if (showLoading) {
    setHidden(radarLoading, false);
  }
  setHidden(radarError, true);
  
  try {
    const stop = getStopFromStateOrStorage();
    if (!stop) {
      throw new Error('No stop available');
    }

    // If cache is empty, fetch fresh data
    if (state.allDepartures.length === 0) {
      const deptUrl = `${API_BASE}/stops/${encodeURIComponent(stop.id)}/departures?duration=${CACHE_DURATION_MINUTES}&remarks=true&language=en&pretty=false`;
      const deptData = await fetchJSON(deptUrl);
      const items = Array.isArray(deptData) ? deptData : (deptData?.departures || deptData?.results || []);
      state.allDepartures = items;
    }
    
    // Extract all tripIds from departures
    const tripIds = new Set(
      state.allDepartures
        .filter(dep => dep.tripId)
        .map(dep => dep.tripId)
    );
    
    if (tripIds.size === 0) {
      radarState.vehicles = [];
      updateRadarStats(0);
      updateRadarMarkers();
      if (showLoading) {
        setHidden(radarLoading, true);
      }
      return;
    }
    
    const { latitude: lat, longitude: lon } = stop.location;
    const radius = RADAR_CONFIG.SEARCH_RADIUS;
    
    const url = `${API_BASE}/radar?north=${lat + radius}&west=${lon - radius}&south=${lat - radius}&east=${lon + radius}&results=${RADAR_CONFIG.MAX_RESULTS}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    const allVehicles = Array.isArray(data) ? data : (data.movements || []);

    const matchedVehicles = filterVehiclesByTripIds(allVehicles, tripIds);
    
    radarState.vehicles = matchedVehicles;
    updateRadarStats(matchedVehicles.length);
    updateRadarMarkers();
    
    if (showLoading) {
      setHidden(radarLoading, true);
    }
    
  } catch (error) {
    console.error('Failed to fetch radar data:', error);
    if (showLoading) {
      setHidden(radarLoading, true);
    }
    setHidden(radarError, false);
  }
};

const centerMapOnStop = () => {
  if (!radarState.map || !state.stop?.location) return;
  
  const { latitude, longitude } = state.stop.location;
  radarState.map.setView([latitude, longitude], RADAR_CONFIG.DEFAULT_ZOOM);
};

const openRadarModal = async () => {
  const stop = getStopFromStateOrStorage();
  
  if (!stop) {
    showToast('Please select a stop first', 'warning');
    return;
  }
  
  const modal = $('#radar-modal');
  if (!modal) return;
  
  modal.showModal();
  
  if (!radarState.map) {
    setTimeout(async () => {
      initRadarMap();
      await fetchRadarData();
      centerMapOnStop();
      startRadarAutoRefresh();
    }, RADAR_CONFIG.MAP_INIT_DELAY);
  } else {
    await fetchRadarData();
    centerMapOnStop();
    startRadarAutoRefresh();
  }
};

const startRadarAutoRefresh = () => {

  if (radarState.refreshTimerId) {
    clearInterval(radarState.refreshTimerId);
  }

  radarState.refreshTimerId = setInterval(async () => {
    await fetchRadarData(false);
  }, RADAR_CONFIG.REFRESH_INTERVAL);
};

const stopRadarAutoRefresh = () => {
  if (radarState.refreshTimerId) {
    clearInterval(radarState.refreshTimerId);
    radarState.refreshTimerId = null;
  }
};

const recenterRadar = () => {
  if (!radarState.map || !state.stop?.location) return;
  
  const { latitude, longitude } = state.stop.location;
  radarState.map.setView([latitude, longitude], RADAR_CONFIG.DEFAULT_ZOOM, { animate: true });
};

const closeRadarModal = () => {
  stopRadarAutoRefresh();
};

// ============================================================================
// DOCK NAVIGATION
// ============================================================================

const switchView = (viewName) => {
  state.currentView = viewName;

  const views = {
    departures: { element: $('#departures-view'), onShow: () => {
      setTimeout(() => requestAnimationFrame(updateTabIndicator), 0);
    }},
    journey: { element: $('#journey-view') },
    settings: { element: $('#settings-view') }
  };

  Object.entries(views).forEach(([name, config]) => {
    const isActive = name === viewName;
    setHidden(config.element, !isActive);
    if (isActive && config.onShow) {
      config.onShow();
    }
  });

  $$('.dock button').forEach(btn => btn.classList.remove('dock-active'));
  $(`#dock-${viewName}`)?.classList.add('dock-active');
  
  localStorage.setItem('currentView', viewName);
};

// ============================================================================
// JOURNEY SEARCH
// ============================================================================

const journeySearchState = {
  origin: { prevValue: '', suppressBlur: false, abort: null },
  destination: { prevValue: '', suppressBlur: false, abort: null }
};

const setupJourneyInputListeners = (input, resultsBox, fieldState, isOrigin) => {
  if (!input || !resultsBox) return;
  
  input.addEventListener('input', debounce(() => {
    if (fieldState.abort) fieldState.abort.abort();
    const controller = new AbortController();
    fieldState.abort = controller;
    searchJourneyStops(input.value, resultsBox, controller);
  }, SEARCH_DEBOUNCE_MS));

  input.addEventListener('focus', () => {
    fieldState.prevValue = input.value;
    input.value = '';
  });

  input.addEventListener('blur', () => {
    if (fieldState.suppressBlur) return;
    if (!input.value.trim()) {
      input.value = fieldState.prevValue;
    }
    resultsBox.classList.add('hidden');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      input.value = fieldState.prevValue;
      resultsBox.classList.add('hidden');
      input.blur();
    }
  });

  resultsBox.addEventListener('mousedown', () => { fieldState.suppressBlur = true; });
  resultsBox.addEventListener('mouseup', () => { 
    setTimeout(() => { fieldState.suppressBlur = false; }, 0); 
  });
};

const setupJourneySearchListeners = () => {
  const journeyOriginInput = $('#journey-origin');
  const journeyDestinationInput = $('#journey-destination');
  const journeyOriginResults = $('#journey-origin-results');
  const journeyDestinationResults = $('#journey-destination-results');
  
  if (!journeyOriginInput || !journeyDestinationInput) return;
  
  setupJourneyInputListeners(journeyOriginInput, journeyOriginResults, journeySearchState.origin, true);
  setupJourneyInputListeners(journeyDestinationInput, journeyDestinationResults, journeySearchState.destination, false);
};

const searchJourneyStops = async (query, resultsBox, controller) => {
  const trimmedQuery = query?.trim();
  
  if (!trimmedQuery || trimmedQuery.length < 2) {
    resultsBox.classList.add('hidden');
    resultsBox.innerHTML = '';
    return;
  }
  
  const url = `${API_BASE}/locations?query=${encodeURIComponent(trimmedQuery)}&results=8&stops=true&addresses=true&poi=true&language=en&pretty=false`;
  resultsBox.innerHTML = '<progress class="progress w-full"></progress>';
  resultsBox.classList.remove('hidden');
  
  try {
    const res = await fetch(url, { 
      signal: controller.signal, 
      headers: { accept: 'application/json' } 
    });
    
    if (!res.ok) throw new Error('Search failed');
    
    const items = await res.json();
    renderJourneySearchResults(items, resultsBox);
  } catch (e) {
    if (controller.signal.aborted) return;
    resultsBox.innerHTML = '';
    resultsBox.classList.add('hidden');
    showToast('Search error. Try again.', 'error');
  }
};

const handleJourneyLocationSelect = (location, isOrigin, input, resultsBox, fieldState, nextFocusElement) => {
  if (isOrigin) {
    state.journey.origin = location;
  } else {
    state.journey.destination = location;
  }
  
  resultsBox.classList.add('hidden');
  resultsBox.innerHTML = '';
  input.value = location.name;
  fieldState.prevValue = location.name;
  fieldState.suppressBlur = false;
  input.blur();
  
  setTimeout(() => {
    if (document.activeElement === input) {
      nextFocusElement?.focus();
    }
  }, 0);
};

const renderJourneySearchResults = (locations, resultsBox) => {
  if (!locations.length) {
    resultsBox.innerHTML = '<div class="p-3 text-sm opacity-70">No results</div>';
    return;
  }
  
  resultsBox.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'menu bg-base-200 rounded-box';
  
  const journeyOriginResults = $('#journey-origin-results');
  const journeyOriginInput = $('#journey-origin');
  const journeyDestinationInput = $('#journey-destination');
  const isOrigin = resultsBox === journeyOriginResults;
  
  const currentInput = isOrigin ? journeyOriginInput : journeyDestinationInput;
  const fieldState = isOrigin ? journeySearchState.origin : journeySearchState.destination;
  const nextFocus = isOrigin ? journeyDestinationInput : $('#journey-search-btn');
  
  locations.forEach(location => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a class="justify-between">
        <span><span class="font-medium">${location.name}</span></span>
      </a>
    `;
    
    li.addEventListener('click', () => {
      handleJourneyLocationSelect(location, isOrigin, currentInput, resultsBox, fieldState, nextFocus);
    });
    
    ul.appendChild(li);
  });
  
  resultsBox.appendChild(ul);
};

const findNearbyForJourney = async () => {
  if (!('geolocation' in navigator)) {
    showToast('Geolocation not supported', 'warning');
    return;
  }
  
  const journeyOriginResults = $('#journey-origin-results');
  if (!journeyOriginResults) return;
  
  journeyOriginResults.classList.remove('hidden');
  journeyOriginResults.innerHTML = '<div class="p-3">Locating… <progress class="progress w-24 ml-2"></progress></div>';
  
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const url = `${API_BASE}/locations/nearby?latitude=${latitude}&longitude=${longitude}&results=8&stops=true&poi=false&language=en&pretty=false`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        
        if (!res.ok) throw new Error('Nearby search failed');
        
        const items = await res.json();
        renderJourneySearchResults(items, journeyOriginResults);
      } catch (e) {
        showToast('Failed to fetch nearby stops', 'error');
        journeyOriginResults.classList.add('hidden');
        journeyOriginResults.innerHTML = '';
      }
    },
    () => {
      showToast('Location permission denied', 'warning');
      journeyOriginResults.classList.add('hidden');
      journeyOriginResults.innerHTML = '';
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
};

// ============================================================================
// JOURNEY API
// ============================================================================

const searchJourneys = async () => {
  if (!state.journey.origin || !state.journey.destination) {
    showToast('Please select both origin and destination', 'warning');
    return;
  }
  
  setHidden($('#journey-empty'), true);
  setHidden($('#journey-error'), true);
  setHidden($('#journey-loading'), false);
  $('#journeys-list').innerHTML = '';
  
  try {
    const fromId = state.journey.origin.id || `${state.journey.origin.latitude},${state.journey.origin.longitude}`;
    const toId = state.journey.destination.id || `${state.journey.destination.latitude},${state.journey.destination.longitude}`;
    
    const params = new URLSearchParams({
      results: '5',
      stopovers: 'true',
      remarks: 'true',
      language: 'en',
      pretty: 'false',
      scheduledDays: 'false'
    });
    
    // Get departure time from time picker
    const timePicker = $('#journey-time-picker');
    if (timePicker && timePicker.value) {
      const now = new Date();
      const [hours, minutes] = timePicker.value.split(':');
      const departureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours), parseInt(minutes));
      
      params.append('departure', departureDate.toISOString());
    } else {
      params.append('departure', 'now');
    }
    
    const url = `${API_BASE}/journeys?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&${params.toString()}`;
    const data = await fetchJSON(url);
    
    const journeys = data.journeys || [];
    state.journey.journeys = journeys;
    
    setHidden($('#journey-loading'), true);
    
    if (journeys.length === 0) {
      $('#journey-error-msg').textContent = 'No journeys found. Try different locations or times.';
      setHidden($('#journey-error'), false);
      return;
    }
    
    renderJourneys(journeys);
  } catch (e) {
    console.error('Journey search failed:', e);
    setHidden($('#journey-loading'), true);
    $('#journey-error-msg').textContent = 'Failed to load journeys. Please try again.';
    setHidden($('#journey-error'), false);
  }
};

const renderJourneys = (journeys) => {
  const container = $('#journeys-list');
  container.innerHTML = '';
  
  journeys.forEach((journey, index) => {
    const card = createJourneyCard(journey, index);
    container.appendChild(card);
  });
};

const createJourneyCard = (journey, index) => {
  const card = document.createElement('div');
  card.className = 'journey-card collapsed card bg-base-100 shadow-elevated';
  card.dataset.index = index;
  
  const firstLeg = journey.legs[0];
  const lastLeg = journey.legs[journey.legs.length - 1];
  
  const departureTime = firstLeg?.departure || firstLeg?.plannedDeparture;
  const plannedDepartureTime = firstLeg?.plannedDeparture;
  const arrivalTime = lastLeg?.arrival || lastLeg?.plannedArrival;
  const plannedArrivalTime = lastLeg?.plannedArrival;
  
  // Calculate departure delay
  const departureDelay = firstLeg?.departureDelay ?? computeDelaySecs(firstLeg?.departure, firstLeg?.plannedDeparture);
  const arrivalDelay = lastLeg?.arrivalDelay ?? computeDelaySecs(lastLeg?.arrival, lastLeg?.plannedArrival);
  
  const duration = Math.round((new Date(arrivalTime) - new Date(departureTime)) / 60000);
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  const transitLegs = journey.legs.filter(leg => leg.mode !== 'walking' && leg.line);
  const transfers = Math.max(0, transitLegs.length - 1);
  
  // Check if any leg has a delay
  const hasDelays = journey.legs.some(leg => {
    const depDelay = leg.departureDelay ?? computeDelaySecs(leg.departure, leg.plannedDeparture);
    const arrDelay = leg.arrivalDelay ?? computeDelaySecs(leg.arrival, leg.plannedArrival);
    return (depDelay !== null && Math.abs(depDelay) >= 60) || (arrDelay !== null && Math.abs(arrDelay) >= 60);
  });
  
  const lineBadges = journey.legs
    .filter(leg => leg.line)
    .map((leg, idx, arr) => {
      const lineName = leg.line.name || leg.line.id || '?';
      const badgeClass = productBadgeClass(leg.line);
      const badge = `<div class="badge ${badgeClass} badge-sm gap-1">${lineName}</div>`;
      const arrow = idx < arr.length - 1 ? '<span class="opacity-40 text-sm mx-0.5">›</span>' : '';
      return badge + arrow;
    })
    .join('');
  
  card.innerHTML = `
    <div class="card-body p-4 sm:p-5">
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
          <div class="flex items-center gap-2">
            ${departureDelay !== null && Math.abs(departureDelay) >= 60 ? `
              <div class="text-xl font-bold tabular-nums line-through opacity-40">${fmtTime(firstLeg?.plannedDeparture || departureTime)}</div>
              <div class="text-xl font-bold tabular-nums ${departureDelay > 0 ? 'text-error' : departureDelay < 0 ? 'text-info' : 'text-success'}">${fmtTime(departureTime)}</div>
            ` : `
              <div class="text-xl font-bold tabular-nums">${fmtTime(departureTime)}</div>
            `}
          </div>
          <svg class="w-5 h-5 opacity-30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
          <div class="flex items-center gap-2">
            ${arrivalDelay !== null && Math.abs(arrivalDelay) >= 60 ? `
              <div class="text-xl font-bold tabular-nums line-through opacity-40">${fmtTime(lastLeg?.plannedArrival || arrivalTime)}</div>
              <div class="text-xl font-bold tabular-nums ${arrivalDelay > 0 ? 'text-error' : arrivalDelay < 0 ? 'text-info' : 'text-success'}">${fmtTime(arrivalTime)}</div>
            ` : `
              <div class="text-xl font-bold tabular-nums">${fmtTime(arrivalTime)}</div>
            `}
          </div>
        </div>
        
        <button class="btn btn-ghost btn-circle btn-sm journey-expand-btn flex-shrink-0" aria-label="Toggle details">
          <svg class="w-5 h-5 journey-expand-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
      </div>

      <div class="flex items-center gap-2 flex-wrap mb-3">
        <div class="badge badge-ghost gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke-width="2"/>
            <path stroke-width="2" stroke-linecap="round" d="M12 6v6l4 2"/>
          </svg>
          ${durationStr}
        </div>
        ${transfers > 0 ? `<div class="badge badge-ghost gap-1.5">${transfers} ${transfers > 1 ? 'transfers' : 'transfer'}</div>` : '<div class="badge badge-ghost">Direct</div>'}
      </div>

      <div class="flex items-center gap-1.5 flex-wrap">
        ${lineBadges}
      </div>
      
      <div class="journey-details">
        ${renderJourneyLegs(journey.legs)}
      </div>
    </div>
  `;
  
  card.querySelector('.journey-expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Close all other expanded journey cards
    const allCards = document.querySelectorAll('.journey-card');
    allCards.forEach(otherCard => {
      if (otherCard !== card && otherCard.classList.contains('expanded')) {
        otherCard.classList.remove('expanded');
        otherCard.classList.add('collapsed');
      }
    });
    
    // Toggle current card
    card.classList.toggle('collapsed');
    card.classList.toggle('expanded');
  });
  
  return card;
};

const renderJourneyLegs = (legs) => {
  return `<div class="mt-5 pt-5 border-t border-base-300">
    ${legs.map((leg, index) => {
      const isWalking = leg.mode === 'walking' || !leg.line;
      const departureTime = leg.departure || leg.plannedDeparture;
      const arrivalTime = leg.arrival || leg.plannedArrival;
      const isLastLeg = index === legs.length - 1;
      
      if (isWalking) {
        const prevLeg = index > 0 ? legs[index - 1] : null;
        const nextLeg = index < legs.length - 1 ? legs[index + 1] : null;
        const isTransfer = (prevLeg && (prevLeg.mode !== 'walking' && prevLeg.line)) && 
                          (nextLeg && (nextLeg.mode !== 'walking' && nextLeg.line));
        
        if (isTransfer) {
          // Calculate transfer time from previous leg's arrival to next leg's departure
          let duration = 0;
          const prevArrival = prevLeg.arrival || prevLeg.plannedArrival;
          const nextDeparture = nextLeg.departure || nextLeg.plannedDeparture;
          
          if (prevArrival && nextDeparture) {
            duration = Math.round((new Date(nextDeparture) - new Date(prevArrival)) / 60000);
          }

          return `
            <div class="flex items-center gap-3 pb-2 ${!isLastLeg ? 'mb-4 pb-4 border-b border-base-200' : ''}">
              <div class="flex flex-col items-center flex-shrink-0" style="width: 44px;">
                <div class="w-0.5 h-6 bg-base-300"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="badge badge-ghost badge-sm gap-1.5">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
                  </svg>
                  Transfer (${duration > 0 ? duration + ' min' : '—'})
                </div>
              </div>
            </div>
          `;
        }

        let duration = 0;
        if (departureTime && arrivalTime) {
          const depTime = new Date(departureTime);
          const arrTime = new Date(arrivalTime);
          duration = Math.round((arrTime - depTime) / 60000);
        }

        return `
          <div class="flex gap-3 pb-5 ${!isLastLeg ? 'mb-4 border-b border-base-200' : ''}">
            <div class="flex flex-col items-center flex-shrink-0" style="width: 44px;">
              <div class="w-3 h-3 rounded-full border-2 border-base-100 shadow-sm bg-neutral-400 dark:bg-base-600"></div>
              <div class="w-0.5 flex-1 my-1 bg-neutral-400 dark:bg-base-600" style="min-height: 40px;"></div>
              <div class="w-3 h-3 rounded-full border-2 border-base-100 shadow-sm bg-neutral-400 dark:bg-base-600"></div>
            </div>
            
            <div class="flex-1 min-w-0 -mt-1">
              <div class="mb-3">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold tabular-nums opacity-60">${fmtTime(departureTime)}</span>
                  <div class="badge badge-info badge-xs gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 17l-4 4m0 0l-4-4m4 4V3"/>
                    </svg>
                    Walk ${duration} min
                  </div>
                </div>
                <div class="font-semibold text-sm">${leg.origin?.name || 'Start'}</div>
              </div>

              <div>
                <div class="text-xs font-semibold tabular-nums opacity-60 mb-1">${fmtTime(arrivalTime)}</div>
                <div class="font-semibold text-sm">${leg.destination?.name || 'End'}</div>
              </div>
            </div>
          </div>
        `;
      }
      
      const lineName = leg.line?.name || leg.line?.id || '?';
      const badgeClass = productBadgeClass(leg.line);
      const direction = leg.direction || leg.destination?.name || '—';
      const lineColor = extractLineColor(badgeClass);
      
      // Calculate delays
      const departureDelay = leg.departureDelay ?? computeDelaySecs(leg.departure, leg.plannedDeparture);
      const arrivalDelay = leg.arrivalDelay ?? computeDelaySecs(leg.arrival, leg.plannedArrival);
      
      // Calculate number of stops (excluding destination)
      const stopCount = leg.stopovers ? Math.max(0, leg.stopovers.length - 1) : null;
      const stopText = stopCount !== null && stopCount > 0 ? `${stopCount} stop${stopCount > 1 ? 's' : ''}` : '';
      
      return `
        <div class="flex gap-3 pb-5 ${!isLastLeg ? 'mb-4 border-b border-base-200' : ''}">
          <div class="flex flex-col items-center flex-shrink-0" style="width: 44px;">
            <div class="w-3 h-3 rounded-full border-2 border-base-100 shadow-sm" style="background-color: ${lineColor};"></div>
            <div class="flex-1 flex flex-col items-center my-1" style="min-height: 40px;">
              <div class="w-0.5 flex-1" style="background-color: ${lineColor}; opacity: 0.4;"></div>
              <div class="badge ${badgeClass} badge-xs my-1 px-1.5 py-2 min-h-0 h-auto">${lineName}</div>
              <div class="w-0.5 flex-1" style="background-color: ${lineColor}; opacity: 0.4;"></div>
            </div>
            <div class="w-3 h-3 rounded-full border-2 border-base-100 shadow-sm" style="background-color: ${lineColor};"></div>
          </div>

          <div class="flex-1 min-w-0 -mt-1">
            <div class="mb-3">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                ${departureDelay !== null && Math.abs(departureDelay) >= 60 ? `
                  <span class="text-xs font-semibold tabular-nums opacity-40 line-through">${fmtTime(leg.plannedDeparture || departureTime)}</span>
                  <span class="text-xs font-semibold tabular-nums ${departureDelay > 0 ? 'text-error' : departureDelay < 0 ? 'text-info' : 'text-success'}">${fmtTime(departureTime)}</span>
                ` : `
                  <span class="text-xs font-semibold tabular-nums opacity-60">${fmtTime(departureTime)}</span>
                `}
                ${stopText ? `<div class="badge badge-ghost badge-xs">${stopText}</div>` : ''}
              </div>
              <div class="font-semibold text-sm mb-0.5">${leg.origin?.name || 'Departure'}</div>
              <div class="text-xs opacity-60 truncate">→ ${direction}</div>
            </div>
            
            <div>
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                ${arrivalDelay !== null && Math.abs(arrivalDelay) >= 60 ? `
                  <span class="text-xs font-semibold tabular-nums opacity-40 line-through">${fmtTime(leg.plannedArrival || arrivalTime)}</span>
                  <span class="text-xs font-semibold tabular-nums ${arrivalDelay > 0 ? 'text-error' : arrivalDelay < 0 ? 'text-info' : 'text-success'}">${fmtTime(arrivalTime)}</span>
                ` : `
                  <span class="text-xs font-semibold tabular-nums opacity-60">${fmtTime(arrivalTime)}</span>
                `}
              </div>
              <div class="font-semibold text-sm">${leg.destination?.name || 'Arrival'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
};

$('#journey-search-btn')?.addEventListener('click', searchJourneys);
$('#journey-use-location')?.addEventListener('click', findNearbyForJourney);

// Time picker handlers
const setCurrentTime = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timePicker = $('#journey-time-picker');
  if (timePicker) {
    timePicker.value = `${hours}:${minutes}`;
  }
};

$('#journey-time-now')?.addEventListener('click', setCurrentTime);

setCurrentTime();

// ============================================================================
// EVENT LISTENERS
// ============================================================================

$('#use-location')?.addEventListener('click', findNearbyStops);
$('#refresh-now')?.addEventListener('click', refreshAll);
$('#open-radar')?.addEventListener('click', openRadarModal);
$('#radar-recenter')?.addEventListener('click', recenterRadar);
$('#radar-modal')?.addEventListener('close', closeRadarModal);

// Dock navigation
$('#dock-departures')?.addEventListener('click', () => switchView('departures'));
$('#dock-journey')?.addEventListener('click', () => switchView('journey'));
$('#dock-settings')?.addEventListener('click', () => switchView('settings'));

// Settings theme toggle
$('#settings-theme-toggle')?.addEventListener('change', () => {
  const themeToggle = $('#theme-toggle');
  if (themeToggle) {
    themeToggle.checked = $('#settings-theme-toggle').checked;
    themeToggle.dispatchEvent(new Event('change'));
  }
});

document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('resize', updateTabIndicator);

// ============================================================================
// INITIALIZATION HELPERS
// ============================================================================

const getStoredJSON = (key, fallback = null) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    console.error(`Failed to parse localStorage key "${key}":`, e);
    return fallback;
  }
};

const setActiveTab = (containerSelector, tabSelector) => {
  const container = $(containerSelector);
  if (!container) return;
  
  $$(containerSelector + ' .tab').forEach(el => el.classList.remove('tab-active'));
  const tab = $(tabSelector);
  if (tab) tab.classList.add('tab-active');
};

const syncThemeToggles = () => {
  const headerToggle = $('#theme-toggle');
  const settingsToggle = $('#settings-theme-toggle');
  const themeLabel = $('#theme-label');
  
  if (headerToggle && settingsToggle) {
    settingsToggle.checked = headerToggle.checked;
    if (themeLabel) {
      themeLabel.textContent = headerToggle.checked ? 'Dark Mode' : 'Light Mode';
    }
  }
};

const TAB_INDICATOR_DELAY = 50;

// ============================================================================
// INITIALIZATION
// ============================================================================

(function init() {
  const saveJourneyLocations = () => {
    if (state.journey.origin) {
      localStorage.setItem('journeyOrigin', JSON.stringify(state.journey.origin));
    }
    if (state.journey.destination) {
      localStorage.setItem('journeyDestination', JSON.stringify(state.journey.destination));
    }
  };
  
  Object.defineProperty(state.journey, 'origin', {
    get() { return this._origin; },
    set(value) {
      this._origin = value;
      saveJourneyLocations();
    }
  });
  
  Object.defineProperty(state.journey, 'destination', {
    get() { return this._destination; },
    set(value) {
      this._destination = value;
      saveJourneyLocations();
    }
  });
  
  // Setup journey search listeners
  setupJourneySearchListeners();
  
  // Restore view preference
  const savedView = localStorage.getItem('currentView') || 'journey';
  switchView(savedView);
  
  // Restore duration tab
  const savedDuration = localStorage.getItem('selectedDuration') || '30';
  setActiveTab('#duration-tabs', `#duration-tabs .tab[data-minutes="${savedDuration}"]`);
  
  // Restore departure stop
  const savedStop = getStoredJSON('selectedStop');
  if (savedStop) {
    selectStop(savedStop);
    const searchInput = $('#search');
    if (searchInput) searchInput.value = savedStop.name;
  }
  
  // Restore journey locations
  const savedOrigin = getStoredJSON('journeyOrigin');
  const savedDestination = getStoredJSON('journeyDestination');
  const journeyOriginInput = $('#journey-origin');
  const journeyDestinationInput = $('#journey-destination');
  
  if (savedOrigin && journeyOriginInput) {
    state.journey.origin = savedOrigin;
    journeyOriginInput.value = savedOrigin.name;
    journeySearchState.origin.prevValue = savedOrigin.name;
  }
  
  if (savedDestination && journeyDestinationInput) {
    state.journey.destination = savedDestination;
    journeyDestinationInput.value = savedDestination.name;
    journeySearchState.destination.prevValue = savedDestination.name;
  }
  
  // Initialize theme
  initTheme();
  
  // Sync and setup theme toggles
  syncThemeToggles();
  $('#theme-toggle')?.addEventListener('change', syncThemeToggles);
  
  // Start auto-refresh for departures
  startFixedRefresh();
  
  // Initialize tab indicator position
  setTimeout(() => requestAnimationFrame(updateTabIndicator), TAB_INDICATOR_DELAY);
})();

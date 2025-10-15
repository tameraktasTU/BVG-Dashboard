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
      
      // Sort by planned departure time
      items.sort((a, b) => {
        const timeA = new Date(a.plannedWhen || a.when || 0).getTime();
        const timeB = new Date(b.plannedWhen || b.when || 0).getTime();
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
    const delayBadge = renderDelayBadge(delay);
    
    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer hover:bg-base-300 transition-colors';
    tr.innerHTML = `
      <td class="font-mono p-2 md:p-3 text-[0.92rem] md:text-base">
        ${fmtTime(departure.when || departure.plannedWhen)}
      </td>
      <td class="p-2 md:p-3 text-[0.92rem] md:text-base">
        <div class="flex items-center gap-0.5 md:gap-2">
          <span class="badge badge-xs md:badge-sm ${productBadgeClass(departure.line)} whitespace-nowrap">
            ${departure.line?.name || departure.line?.id || '?'}
          </span>
        </div>
      </td>
      <td class="truncate max-w-[8rem] md:max-w-none p-2 md:p-3 text-[0.92rem] md:text-base">
        ${departure.direction || '—'}
      </td>
      <td class="text-right whitespace-nowrap p-2 md:p-3 text-[0.92rem] md:text-base">
        ${delayBadge}
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
    
    // Timeline indicator (dot and connecting line)
    const indicatorColor = (isPassed || isCurrent) ? '#9ca3af' : lineColor;
    const lineColorValue = isPassed ? '#9ca3af' : lineColor;
    
    const timelineIndicator = document.createElement('div');
    timelineIndicator.className = 'flex flex-col items-center flex-shrink-0 relative';
    timelineIndicator.innerHTML = `
      ${idx > 0 ? `<div class="w-0.5 h-2 absolute top-0" style="background-color: ${indicatorColor};"></div>` : ''}
      <div class="w-3 h-3 rounded-full z-10 my-2 ${isCurrent ? 'ring-4 ring-primary/30' : ''}" style="background-color: ${isCurrent ? lineColor : indicatorColor};"></div>
      ${idx < stopovers.length - 1 ? `<div class="w-0.5 absolute top-2" style="height: calc(100% + 0.5rem); background-color: ${lineColorValue};"></div>` : ''}
    `;
    
    // Stop information
    const departureTime = stopover.departure ? fmtTime(stopover.departure) : 
                         stopover.arrival ? fmtTime(stopover.arrival) : '—';
    const platform = stopover.platform || stopover.plannedPlatform;
    
    const delay = stopover.departureDelay ?? stopover.arrivalDelay ?? 
                  computeDelaySecs(
                    stopover.departure || stopover.arrival,
                    stopover.plannedDeparture || stopover.plannedArrival
                  );
    
    const delayBadge = renderDelayBadge(delay, 'small');
    
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1 min-w-0 flex items-center px-3';
    infoDiv.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap flex-1">
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate ${isCurrent ? 'font-bold' : isPassed ? 'opacity-40' : ''}">
            ${stopover.stop?.name || 'Unknown'}
          </div>
          <div class="text-sm flex items-center gap-2 flex-wrap mt-0.5 ${isPassed ? 'opacity-30' : 'opacity-70'}">
            <span class="font-mono font-medium">${departureTime}</span>
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
  const nextStopTime = nextStopover?.arrival || nextStopover?.plannedArrival 
    ? fmtTime(nextStopover.arrival || nextStopover.plannedArrival)
    : null;

  const speed = vehicle.speed ? `${Math.round(vehicle.speed)} km/h` : null;

  const delay = nextStopover?.arrivalDelay || nextStopover?.departureDelay;
  const delayMins = delay != null ? Math.round(delay / 60) : null;
  const delayBadge = delayMins != null && delayMins !== 0
    ? `<span class="radar-popup-delay ${delayMins > 0 ? 'radar-popup-delay-late' : 'radar-popup-delay-early'}">
         ${delayMins > 0 ? '+' : ''}${delayMins}m
       </span>`
    : '';
  
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
              ${nextStopTime ? `<div class="radar-popup-info-time">${nextStopTime} ${delayBadge}</div>` : ''}
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
    
    // Get 60-minute departures for this stop
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
// EVENT LISTENERS
// ============================================================================

$('#use-location').addEventListener('click', findNearbyStops);
$('#refresh-now').addEventListener('click', refreshAll);
$('#open-radar')?.addEventListener('click', openRadarModal);
$('#radar-recenter')?.addEventListener('click', recenterRadar);
$('#radar-modal')?.addEventListener('close', closeRadarModal);
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('resize', updateTabIndicator);

setInterval(() => {
  $('#local-time').textContent = new Date().toLocaleString();
}, 1000);

// ============================================================================
// INITIALIZATION
// ============================================================================

(function init() {
  // Restore previously selected stop from localStorage
  try {
    const savedStop = JSON.parse(localStorage.getItem('selectedStop') || 'null');
    if (savedStop) {
      selectStop(savedStop);
      $('#search').value = savedStop.name;
    }
  } catch (e) {
    console.error('Failed to restore saved stop:', e);
  }
  
  // Restore previously selected time window from localStorage
  try {
    const savedDuration = localStorage.getItem('selectedDuration');
    if (savedDuration) {
      const tab = $(`#duration-tabs .tab[data-minutes="${savedDuration}"]`);
      if (tab) {
        $$('#duration-tabs .tab').forEach(el => el.classList.remove('tab-active'));
        tab.classList.add('tab-active');
      }
    }
  } catch (e) {
    console.error('Failed to restore saved duration:', e);
  }
  
  // Initialize theme
  initTheme();
  
  // Start auto-refresh
  startFixedRefresh();
  
  // Set initial time displays
  $('#local-time').textContent = new Date().toLocaleString();
  
  // Initialize tab indicator position
  updateTabIndicator();
})();

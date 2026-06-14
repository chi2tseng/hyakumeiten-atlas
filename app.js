// ===== Hyakumeiten Atlas — Main App =====
'use strict';

// state
const STATE = {
  lang: 'zh',
  data: [],
  filtered: [],
  filter: {
    q: '',
    pref: '',
    cat: '',
    maxPrice: null,
    minRating: 0,
  },
  map: null,
  cluster: null,
  markers: new Map(), // url → marker
  userLocation: null,
};

// ===== Init =====
window.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupListeners();
  applyI18n(STATE.lang);
  await loadData();
  populateFilters();
  applyFilters();
});

// ===== Map =====
function initMap() {
  STATE.map = L.map('map', { zoomControl: true }).setView([36.5, 138], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(STATE.map);
  if (window.L && L.markerClusterGroup) {
    STATE.cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50, spiderfyOnMaxZoom: true });
    STATE.map.addLayer(STATE.cluster);
  }
  // re-render list whenever viewport moves/zooms (debounced — longer for smoother zoom)
  let renderTo;
  const reschedule = () => {
    clearTimeout(renderTo);
    renderTo = setTimeout(() => renderList(), 350);
  };
  STATE.map.on('moveend', reschedule);
  STATE.map.on('zoomend', reschedule);
}

function isInViewport(r) {
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return false;
  if (!STATE.map) return true;
  return STATE.map.getBounds().contains([r.lat, r.lng]);
}

function customPin(rating) {
  const cls = rating && rating >= 3.7 ? 'pin-marker high-rating' : 'pin-marker';
  return L.divIcon({ html: `<div class="${cls}"></div>`, iconSize: [28, 28], iconAnchor: [14, 28], className: 'pin-wrapper' });
}

function renderMarkers() {
  if (!STATE.cluster) {
    // markercluster not loaded yet, retry once it's available
    setTimeout(renderMarkers, 200);
    return;
  }
  STATE.cluster.clearLayers();
  STATE.markers.clear();
  const layers = [];
  for (const r of STATE.filtered) {
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
    const m = L.marker([r.lat, r.lng], { icon: customPin(r.r) });
    m.on('click', () => openDetail(r));
    STATE.markers.set(r.u, m);
    layers.push(m);
  }
  STATE.cluster.addLayers(layers);
}

// ===== Data loading =====
async function loadData() {
  const list = document.getElementById('result-list');
  list.innerHTML = `<div class="loading"><div class="spinner"></div><div>${window.I18N[STATE.lang].loading}</div></div>`;
  try {
    const res = await fetch('./data/restaurants.json');
    if (!res.ok) throw new Error(res.statusText);
    STATE.data = await res.json();
  } catch (err) {
    console.warn('failed to load data:', err);
    STATE.data = [];
    list.innerHTML = `<div class="loading"><div>資料載入失敗 / Failed to load</div></div>`;
    return;
  }
}

// ===== Filters =====
function populateFilters() {
  // collect unique prefectures + categories
  const prefs = new Set();
  const cats = new Set();
  for (const r of STATE.data) {
    if (r.p) prefs.add(r.p);
    if (r.c) for (const c of r.c.split('/')) cats.add(c.trim());
  }
  // prefecture order — major first
  const major = ['東京','大阪','京都','北海道','沖縄','福岡','愛知','神奈川','兵庫','広島','千葉','埼玉'];
  const others = [...prefs].filter(p => !major.includes(p)).sort();
  STATE.prefList = [...major.filter(p => prefs.has(p)), ...others];
  STATE.catList = [...cats].sort();
  renderFilterOptions();
}

function renderFilterOptions() {
  const dict = window.I18N[STATE.lang];
  const prefSel = document.getElementById('pref-select');
  const catSel  = document.getElementById('cat-select');
  // remember selected
  const prevPref = prefSel.value;
  const prevCat  = catSel.value;
  prefSel.innerHTML = `<option value="">${dict.all}</option>`;
  for (const p of STATE.prefList) {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = window.translatePref(p, STATE.lang);
    if (p === prevPref) o.selected = true;
    prefSel.appendChild(o);
  }
  catSel.innerHTML = `<option value="">${dict.all}</option>`;
  for (const c of STATE.catList) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = window.translateCat(c, STATE.lang);
    if (c === prevCat) o.selected = true;
    catSel.appendChild(o);
  }
}

function setupListeners() {
  // lang
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      STATE.lang = b.dataset.lang;
      applyI18n(STATE.lang);
      // re-render UI that contains translated content
      if (STATE.prefList) renderFilterOptions();
      renderList();
      if (STATE.openRest) openDetail(STATE.openRest);
    });
  });

  // search input (debounced)
  let to;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(to);
    to = setTimeout(() => { STATE.filter.q = e.target.value.trim().toLowerCase(); applyFilters(); }, 200);
  });

  document.getElementById('pref-select').addEventListener('change', (e) => {
    STATE.filter.pref = e.target.value;
    applyFilters();
  });
  document.getElementById('cat-select').addEventListener('change', (e) => {
    STATE.filter.cat = e.target.value;
    applyFilters();
  });

  // price pills
  document.querySelectorAll('#price-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#price-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const v = p.dataset.price;
      STATE.filter.maxPrice = v ? parseInt(v, 10) : null;
      applyFilters();
    });
  });
  // rating pills
  document.querySelectorAll('#rating-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#rating-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.filter.minRating = parseFloat(p.dataset.rating) || 0;
      applyFilters();
    });
  });

  // drawer close
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // locate
  document.getElementById('locate-btn').addEventListener('click', () => locateUser(false));
  document.getElementById('recenter-btn').addEventListener('click', () => locateUser(true));

  // mobile filter sheet toggle
  const sidebar = document.getElementById('sidebar');
  const fab = document.getElementById('mobile-filter-fab');
  const closeBtn = document.getElementById('sheet-close-mobile');
  if (fab) fab.addEventListener('click', () => sidebar.classList.add('mobile-open'));
  if (closeBtn) closeBtn.addEventListener('click', () => sidebar.classList.remove('mobile-open'));
  // also auto-close after clicking a card on mobile
  document.getElementById('result-list').addEventListener('click', (e) => {
    if (window.matchMedia('(max-width: 767px)').matches && e.target.closest('.rest-card')) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

function isFilterActive() {
  const f = STATE.filter;
  return !!(f.q || f.pref || f.cat || (f.maxPrice != null) || f.minRating > 0);
}

function applyFilters() {
  const f = STATE.filter;
  STATE.filtered = STATE.data.filter(r => {
    if (f.pref && r.p !== f.pref) return false;
    if (f.cat && (!r.c || !r.c.includes(f.cat))) return false;
    if (f.minRating > 0) {
      const rating = parseFloat(r.r);
      if (!rating || rating < f.minRating) return false;
    }
    if (f.maxPrice != null) {
      // try dinner lower bound first
      if (r.dl != null) {
        if (r.dl > f.maxPrice) return false;
      } else {
        // no lower bound: try parsing upper bound from dinner/lunch text
        // e.g. "～￥999" or "～¥1,999" → upper bound only
        const ub = parseUpperBound(r.d) ?? parseUpperBound(r.l);
        if (ub != null) {
          if (ub > f.maxPrice) return false;
        }
        // if no price info at all, include (don't filter out unknowns)
      }
    }
    if (f.q) {
      const hay = ((r.n||'') + ' ' + (r.a||'') + ' ' + (r.c||'')).toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
  // stats
  document.getElementById('stats-count').textContent = STATE.filtered.length.toLocaleString();
  renderList();
  renderMarkers();
}

// ===== Sidebar list =====
function renderList() {
  const list = document.getElementById('result-list');
  // viewport-scoped: only items currently visible on map
  const inView = STATE.filtered.filter(isInViewport);
  // update stats: shown only when filter active OR viewport is sub-sampling
  const total = STATE.filtered.length;
  const visible = inView.length;
  const statsRow = document.getElementById('stats-row');
  const filterActive = isFilterActive();
  const viewportClipping = visible < total;
  if (statsRow) statsRow.style.display = (filterActive || viewportClipping) ? '' : 'none';
  const statsEl = document.getElementById('stats-count');
  if (statsEl) {
    statsEl.textContent = visible === total
      ? total.toLocaleString()
      : `${visible.toLocaleString()} / ${total.toLocaleString()}`;
  }
  // sort by rating, cap at 200 for DOM perf
  const top = inView
    .sort((a, b) => (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0))
    .slice(0, 200);
  if (top.length === 0) {
    list.innerHTML = `<div class="loading"><div>—</div></div>`;
    return;
  }
  list.innerHTML = top.map(r => {
    const prefTr = window.translatePref(r.p||'', STATE.lang);
    const firstCat = (r.c||'').split('/')[0] || '';
    const catTr = window.translateCat(firstCat, STATE.lang);
    const thumb = r.cv || (r.ph && r.ph[0]) || '';
    return `
    <div class="rest-card" data-url="${encodeURIComponent(r.u)}">
      ${thumb ? `<div class="rest-card-thumb"><img loading="lazy" src="${escapeHtml(thumb)}" alt=""/></div>` : `<div class="rest-card-thumb"></div>`}
      <div class="rest-card-body">
        <div class="rest-card-name">${escapeHtml(r.n)}</div>
        <div class="rest-card-meta">
          <span>${escapeHtml(prefTr)}</span>
          <span>·</span>
          <span>${escapeHtml(catTr)}</span>
          <span>·</span>
          <span class="rest-card-rating">★ ${escapeHtml(r.r||'')}</span>
          ${r.dl ? `<span>·</span><span>¥${(r.dl/1000).toFixed(0)}k~</span>` : ''}
        </div>
      </div>
    </div>`;}).join('');
  list.querySelectorAll('.rest-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = decodeURIComponent(card.dataset.url);
      const r = STATE.data.find(x => x.u === url);
      if (r) openDetail(r);
    });
  });
}

// ===== Detail drawer =====
function openDetail(r) {
  STATE.openRest = r;
  const drawer = document.getElementById('detail-drawer');
  const dict = window.I18N[STATE.lang];

  // pan to marker
  if (typeof r.lat === 'number' && typeof r.lng === 'number') {
    STATE.map.flyTo([r.lat, r.lng], Math.max(STATE.map.getZoom(), 14), { duration: 0.6 });
  }

  // build query for google maps & Tabelog
  const mapsQuery = encodeURIComponent(`${r.n} ${r.a || r.p || ''}`);
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const reviewsHtml = (r.rv && r.rv.length)
    ? r.rv.map(rv => {
        // rv is either an object {t, b, r, d} OR legacy string "title｜body"
        let title, body, rating, date;
        if (typeof rv === 'string') {
          [title, body] = rv.split('｜');
        } else {
          ({ t: title, b: body, r: rating, d: date } = rv);
        }
        return `<div class="review-item">
          <div class="review-head">
            ${rating ? `<span class="review-rating">★ ${escapeHtml(rating)}</span>` : ''}
            ${date ? `<span class="review-date">${escapeHtml(date)}</span>` : ''}
          </div>
          ${title ? `<div class="review-title">${escapeHtml(title)}</div>` : ''}
          ${body ? `<div class="review-body">${escapeHtml(body)}</div>` : ''}
        </div>`;
      }).join('')
    : `<div class="review-body" style="color:var(--steel)">${dict['detail-no-reviews']}</div>`;

  const cats = (r.c||'').split('/').filter(Boolean);

  document.getElementById('drawer-content').innerHTML = `
    <div class="detail-name">${escapeHtml(r.n)}</div>

    <div class="detail-cat-row">
      ${cats.map(c => `<span class="badge badge-cream">${escapeHtml(window.translateCat(c, STATE.lang))}</span>`).join('')}
      ${r.w > 1 ? `<span class="badge badge-orange">${dict['detail-awards']} ${r.w} ${dict['detail-times']}</span>` : ''}
    </div>

    <div class="detail-meta-row">
      ${r.r ? `<div><div class="detail-rating">★ ${escapeHtml(r.r)}</div></div>` : ''}
      ${r.y ? `<div class="detail-rating-sub">${escapeHtml(r.y)}</div>` : ''}
    </div>

    <div class="info-rows">
      ${r.a ? `<div class="info-row"><span class="label"><span class="msi size-16">place</span> ${dict['detail-address']}</span><span class="value">${escapeHtml(r.a)}</span></div>` : ''}
      ${r.d ? `<div class="info-row"><span class="label"><span class="msi size-16">restaurant</span> ${dict['detail-dinner']}</span><span class="value">${escapeHtml(r.d)}</span></div>` : ''}
      ${r.l ? `<div class="info-row"><span class="label"><span class="msi size-16">brunch_dining</span> ${dict['detail-lunch']}</span><span class="value">${escapeHtml(r.l)}</span></div>` : ''}
      ${r.y ? `<div class="info-row"><span class="label"><span class="msi size-16">emoji_events</span> ${dict['detail-awards']}</span><span class="value">${escapeHtml(r.y)}</span></div>` : ''}
    </div>

    <div class="action-row">
      <a class="action-btn action-btn-primary" href="${gmaps}" target="_blank" rel="noopener">
        <span class="msi size-16">map</span>
        ${dict['detail-gmap']}
      </a>
      <a class="action-btn" href="${escapeHtml(r.u)}" target="_blank" rel="noopener">
        <span class="msi size-16">open_in_new</span>
        ${dict['detail-tabelog']}
      </a>
    </div>

    ${(r.cv || (r.ph && r.ph.length)) ? `
      ${r.cv ? `<div class="photo-cover"><img loading="lazy" src="${escapeHtml(r.cv)}" alt=""/></div>` : ''}
      <div class="section-title"><span class="msi size-16">photo_library</span> ${dict['detail-photos']}${r.ph ? ` <span class="count">${r.ph.length}</span>` : ''}</div>
      ${r.ph && r.ph.length ? `
        <div class="photo-grid">
          ${r.ph.slice(0, 12).map(p => `<a class="photo-tile" href="${escapeHtml(p)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(p)}" alt=""/></a>`).join('')}
        </div>
      ` : ''}
    ` : `
      <div class="section-title"><span class="msi size-16">photo_library</span> ${dict['detail-photos']}</div>
      <div class="photo-placeholder">
        <span class="msi size-24">image_search</span>
        <p>${dict['detail-photos-soon']}</p>
      </div>
    `}

    <div class="section-title"><span class="msi size-16">reviews</span> ${dict['detail-reviews']}</div>
    ${reviewsHtml}
  `;
  drawer.classList.add('open');
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
}

// ===== Geolocation =====
function setUserMarker(lat, lng) {
  STATE.userLocation = { lat, lng };
  // remove old layers
  if (STATE.userAccLayer) STATE.map.removeLayer(STATE.userAccLayer);
  if (STATE.userDotLayer) STATE.map.removeLayer(STATE.userDotLayer);
  // outer pulsing accuracy ring (soft blue glow)
  STATE.userAccLayer = L.circleMarker([lat, lng], {
    radius: 22, color: '#4285F4', fillColor: '#4285F4', fillOpacity: 0.15, weight: 0,
    className: 'user-pulse',
  }).addTo(STATE.map);
  // inner solid blue dot (Google-style)
  STATE.userDotLayer = L.circleMarker([lat, lng], {
    radius: 8, color: '#ffffff', fillColor: '#4285F4', fillOpacity: 1, weight: 3,
    className: 'user-dot',
  }).addTo(STATE.map);
  // show recenter button
  document.getElementById('recenter-btn').classList.add('visible');
}

function locateUser(recenter) {
  if (!navigator.geolocation) {
    alert('Geolocation not supported in this browser');
    return;
  }
  const btn = recenter ? document.getElementById('recenter-btn') : document.getElementById('locate-btn');
  const original = btn.innerHTML;
  btn.classList.add('loading');
  btn.disabled = true;
  // if already located + recenter just flies to known location
  if (recenter && STATE.userLocation) {
    STATE.map.flyTo([STATE.userLocation.lat, STATE.userLocation.lng], 14, { duration: 0.6 });
    btn.classList.remove('loading');
    btn.disabled = false;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserMarker(latitude, longitude);
      STATE.map.flyTo([latitude, longitude], 14, { duration: 0.6 });
      btn.classList.remove('loading');
      btn.disabled = false;
    },
    (err) => {
      console.warn(err);
      alert('無法取得位置 / Cannot get location: ' + err.message);
      btn.classList.remove('loading');
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Parse "～￥999" / "~¥1,999" patterns → upper bound number, or null if no upper-only pattern
function parseUpperBound(txt) {
  if (!txt) return null;
  const m = String(txt).match(/[～〜~]\s*[￥¥]?\s*([\d,]+)/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

// ===== Util =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

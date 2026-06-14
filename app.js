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
  const prefList = [...major.filter(p => prefs.has(p)), ...others];

  const prefSel = document.getElementById('pref-select');
  for (const p of prefList) {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    prefSel.appendChild(o);
  }
  const catSel = document.getElementById('cat-select');
  for (const c of [...cats].sort()) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
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
  document.getElementById('locate-btn').addEventListener('click', locateUser);
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
      if (r.dl == null) return false;
      if (r.dl > f.maxPrice) return false;
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
  // virtualize: show only first 200 in DOM
  const top = STATE.filtered
    .filter(r => r.r) // has rating
    .sort((a, b) => (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0))
    .slice(0, 200);
  if (top.length === 0) {
    list.innerHTML = `<div class="loading"><div>—</div></div>`;
    return;
  }
  list.innerHTML = top.map(r => `
    <div class="rest-card" data-url="${encodeURIComponent(r.u)}">
      <div class="rest-card-name">${escapeHtml(r.n)}</div>
      <div class="rest-card-meta">
        <span>${escapeHtml(r.p||'')}</span>
        <span>·</span>
        <span>${escapeHtml((r.c||'').split('/')[0]||'')}</span>
        <span>·</span>
        <span class="rest-card-rating">★ ${escapeHtml(r.r||'')}</span>
        ${r.dl ? `<span>·</span><span>夜¥${(r.dl/1000).toFixed(0)}k~</span>` : ''}
      </div>
    </div>`).join('');
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
        // rv is "title｜body" string
        const [title, body] = (rv || '').split('｜');
        return `<div class="review-item"><div class="review-title">${escapeHtml(title || '')}</div>${body ? `<div class="review-body">${escapeHtml(body)}</div>` : ''}</div>`;
      }).join('')
    : `<div class="review-body" style="color:var(--steel)">${dict['detail-no-reviews']}</div>`;

  const cats = (r.c||'').split('/').filter(Boolean);

  document.getElementById('drawer-content').innerHTML = `
    <div class="detail-name">${escapeHtml(r.n)}</div>

    <div class="detail-cat-row">
      ${cats.map(c => `<span class="badge badge-cream">${escapeHtml(c)}</span>`).join('')}
      ${r.w > 1 ? `<span class="badge badge-orange">${dict['detail-awards']} ${r.w} ${dict['detail-times']}</span>` : ''}
    </div>

    <div class="detail-meta-row">
      ${r.r ? `<div><div class="detail-rating">★ ${escapeHtml(r.r)}</div></div>` : ''}
      ${r.y ? `<div class="detail-rating-sub">${escapeHtml(r.y)}</div>` : ''}
    </div>

    <div class="info-rows">
      ${r.a ? `<div class="info-row"><span class="label">${dict['detail-address']}</span><span class="value">${escapeHtml(r.a)}</span></div>` : ''}
      ${r.d ? `<div class="info-row"><span class="label">${dict['detail-dinner']}</span><span class="value">${escapeHtml(r.d)}</span></div>` : ''}
      ${r.l ? `<div class="info-row"><span class="label">${dict['detail-lunch']}</span><span class="value">${escapeHtml(r.l)}</span></div>` : ''}
    </div>

    <div class="action-row">
      <a class="action-btn action-btn-primary" href="${gmaps}" target="_blank" rel="noopener">
        🗺 ${dict['detail-gmap']}
      </a>
      <a class="action-btn" href="${escapeHtml(r.u)}" target="_blank" rel="noopener">
        ✦ ${dict['detail-tabelog']}
      </a>
    </div>

    <div class="section-title">${dict['detail-reviews']}</div>
    ${reviewsHtml}
  `;
  drawer.classList.add('open');
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
}

// ===== Geolocation =====
function locateUser() {
  if (!navigator.geolocation) {
    alert('Geolocation not supported in this browser');
    return;
  }
  const btn = document.getElementById('locate-btn');
  const original = btn.innerHTML;
  btn.innerHTML = '<span>…</span>';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      STATE.userLocation = { lat: latitude, lng: longitude };
      STATE.map.flyTo([latitude, longitude], 13, { duration: 0.6 });
      L.circleMarker([latitude, longitude], {
        radius: 8, color: '#fa520f', fillColor: '#fa520f', fillOpacity: 0.7, weight: 2,
      }).addTo(STATE.map);
      btn.innerHTML = original;
      btn.disabled = false;
    },
    (err) => {
      console.warn(err);
      alert('無法取得位置 / Cannot get location: ' + err.message);
      btn.innerHTML = original;
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ===== Util =====
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

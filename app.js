// ===== Hyakumeiten Atlas — Main App =====
'use strict';

// bump when data/ changes so browsers don't serve stale index/shards (cache-bust)
const DATA_VERSION = '20260616p';

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
    reserve: '',
  },
  map: null,
  cluster: null,
  markers: new Map(), // url → marker
  userLocation: null,
};

// Wheel zoom uses Leaflet's NATIVE animated zoom (tuned in initMap). The old custom
// per-frame setView(animate:false) plugin glided continuously but reloaded tiles every
// frame, so the whole map blanked while scrolling. Native zoom keeps the old tiles
// CSS-scaled through the animation and only swaps tiles once it settles — no blanking.

// ===== Category → Material Symbol icon (Google icons, for quick scanning) =====
const CATEGORY_ICONS = [
  [/寿司|鮨|すし/, 'set_meal'],
  [/ラーメン|拉麺|つけ麺|油そば/, 'ramen_dining'],
  [/そば|蕎麦|うどん|麺/, 'ramen_dining'],
  [/焼肉|ホルモン|ステーキ|鉄板/, 'outdoor_grill'],
  [/焼鳥|串揚げ|串焼|串/, 'kebab_dining'],
  [/天ぷら|天麩羅|とんかつ|フライ|揚/, 'lunch_dining'],
  [/うなぎ|鰻|あなご|穴子/, 'set_meal'],
  [/海鮮|魚|割烹|懐石|会席|日本料理|和食|京料理|料亭/, 'restaurant'],
  [/カレー|スパイス/, 'rice_bowl'],
  [/ハンバーガー|バーガー/, 'lunch_dining'],
  [/ピザ|ピッツァ/, 'local_pizza'],
  [/パスタ|イタリア|スパゲ/, 'dinner_dining'],
  [/フレンチ|フランス|ビストロ|欧州|ヨーロッパ/, 'dinner_dining'],
  [/中華|中国|餃子|点心|飲茶|四川|広東/, 'ramen_dining'],
  [/韓国|焼酎|サムギョプサル/, 'outdoor_grill'],
  [/カフェ|喫茶|珈琲|コーヒー/, 'local_cafe'],
  [/パン|ベーカリー|サンド/, 'bakery_dining'],
  [/ケーキ|洋菓子|和菓子|スイーツ|デザート|チョコ/, 'cake'],
  [/アイス|ジェラート|かき氷/, 'icecream'],
  [/バー|ワイン|居酒屋|酒場|ビア|ダイニングバー/, 'local_bar'],
  [/定食|食堂|丼|お弁当|弁当/, 'rice_bowl'],
  [/鍋|しゃぶ|すき焼|もつ鍋|水炊き/, 'soup_kitchen'],
  [/お好み焼き|もんじゃ|たこ焼/, 'outdoor_grill'],
];
function categoryIcon(jpCat) {
  if (!jpCat) return 'restaurant';
  for (const [re, ic] of CATEGORY_ICONS) if (re.test(jpCat)) return ic;
  return 'restaurant';
}

// ===== Init =====
window.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupListeners();
  setupSheetGrip();
  setupMobileSheet();
  setupLightbox();
  applyI18n(STATE.lang);
  await loadData();
  populateFilters();
  applyFilters();
  // try silent auto-locate after data is ready (no alert on deny / unavailable)
  setTimeout(() => locateUser(false, true), 500);
});

// ===== Map =====
// Stepless smooth wheel zoom (mutsuyuki/Leaflet.SmoothWheelZoom): each animation frame
// transforms the existing tiles via map._move (NO tile reload mid-gesture) and reloads
// once at the end → continuous "no-step" zoom with no repeated map flashing.
if (window.L && L.Handler && !L.Map.SmoothWheelZoom) {
  L.Map.mergeOptions({ smoothWheelZoom: true, smoothSensitivity: 1 });
  L.Map.SmoothWheelZoom = L.Handler.extend({
    addHooks: function () { L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this); },
    removeHooks: function () { L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this); },
    _onWheelScroll: function (e) { if (!this._isWheeling) this._onWheelStart(e); this._onWheeling(e); },
    _onWheelStart: function (e) {
      var map = this._map;
      this._isWheeling = true;
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._centerPoint = map.getSize()._divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
      this._startZoom = map.getZoom();
      this._moved = false;
      this._zooming = true;
      map._stop();
      if (map._panAnim) map._panAnim.stop();
      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();
      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
      L.DomEvent.on(document, 'mousemove', this._onWheelEnd, this);
      L.DomEvent.preventDefault(e);
    },
    _onWheeling: function (e) {
      var map = this._map;
      this._goalZoom = this._goalZoom - e.deltaY * 0.003 * map.options.smoothSensitivity;
      if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) this._goalZoom = map._limitZoom(this._goalZoom);
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      clearTimeout(this._timeoutId);
      this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);
      L.DomEvent.preventDefault(e);
    },
    _onWheelEnd: function () {
      this._isWheeling = false;
      cancelAnimationFrame(this._zoomAnimationId);
      this._map._moveEnd(true);
      L.DomEvent.off(document, 'mousemove', this._onWheelEnd, this);
    },
    _updateWheelZoom: function () {
      var map = this._map;
      if (!map.getCenter() || this._goalZoom == null) return;
      var zoom = map.getZoom();
      zoom = zoom + (this._goalZoom - zoom) * 0.3;
      zoom = Math.round(zoom * 100) / 100;
      var center = map.unproject(
        map.project(this._wheelStartLatLng, zoom).subtract(this._wheelMousePosition).add(this._centerPoint), zoom);
      map._move(center, zoom, { flyTo: true });
      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },
  });
  L.Map.addInitHook('addHandler', 'smoothWheelZoom', L.Map.SmoothWheelZoom);
}

function initMap() {
  STATE.map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: false,       // replaced by the stepless smoothWheelZoom handler above
    smoothWheelZoom: true,
    smoothSensitivity: 3,         // wheel sensitivity (higher = faster zoom per scroll)
    zoomSnap: 0,                  // fractional zooms — smooth glide
    zoomDelta: 0.6,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: false,   // don't re-animate every pin during zoom
  }).setView([36.5, 138], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
    keepBuffer: 12,              // hold a big ring of already-loaded tiles as a zoom buffer
    updateWhenZooming: false,    // hold the scaled old tiles through the zoom; swap after
    updateWhenIdle: false,
  }).addTo(STATE.map);
  if (window.L && L.markerClusterGroup) {
    STATE.cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      animate: false,                  // don't re-animate clusters mid-zoom (smoother)
      removeOutsideVisibleBounds: true,
    });
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
  // recenter button reverts to grey once the user pans away from their location
  STATE.map.on('dragstart', () => {
    const rb = document.getElementById('recenter-btn');
    if (rb) rb.classList.remove('located');
  });
}

function isInViewport(r) {
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return false;
  if (!STATE.map) return true;
  return STATE.map.getBounds().contains([r.lat, r.lng]);
}

function customPin(r) {
  const cat = (r.c || '').split('/')[0] || '';
  const ic = categoryIcon(cat);
  const hi = r.r && r.r >= 3.7 ? ' high-rating' : '';
  return L.divIcon({
    html: `<div class="pin-bg${hi}"></div><span class="msi pin-ico">${ic}</span>`,
    iconSize: [34, 44],
    iconAnchor: [17, 41],
    className: 'pin-wrapper',
  });
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
    const m = L.marker([r.lat, r.lng], { icon: customPin(r) });
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
    const res = await fetch(`./data/index.json?v=${DATA_VERSION}`);
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
  // reveal the reservation filter only once enough records carry the field
  const rsCount = STATE.data.reduce((n, r) => n + (r.rs ? 1 : 0), 0);
  const rg = document.getElementById('reserve-group');
  if (rg) rg.style.display = rsCount > 50 ? '' : 'none';
  renderFilterOptions();
}

function renderFilterOptions() {
  const dict = window.I18N[STATE.lang];
  const fill = (sel, emptyLabel, items, translate) => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">${emptyLabel}</option>`;
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it;
      o.textContent = translate(it, STATE.lang);
      if (it === prev) o.selected = true;
      sel.appendChild(o);
    }
  };
  // desktop selects show "全部" when empty; mobile chips show the dimension name
  fill(document.getElementById('pref-select'), dict.all, STATE.prefList, window.translatePref);
  fill(document.getElementById('cat-select'),  dict.all, STATE.catList,  window.translateCat);
  fill(document.getElementById('m-pref'), dict['pref-label'], STATE.prefList, window.translatePref);
  fill(document.getElementById('m-cat'),  dict['cat-label'],  STATE.catList,  window.translateCat);
  syncChipActive();
}

// size each mobile filter chip <select> to fit its CURRENT label — a native
// <select> otherwise reserves the width of its widest option, making chips too wide
let _chipSizer = null;
function fitChipWidth(sel) {
  if (!sel) return;
  if (!_chipSizer) {
    _chipSizer = document.createElement('span');
    _chipSizer.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;';
    document.body.appendChild(_chipSizer);
  }
  const cs = getComputedStyle(sel);
  _chipSizer.style.fontFamily = cs.fontFamily;
  _chipSizer.style.fontSize = cs.fontSize;
  _chipSizer.style.fontWeight = cs.fontWeight;
  _chipSizer.style.letterSpacing = cs.letterSpacing;
  const opt = sel.options[sel.selectedIndex];
  _chipSizer.textContent = opt ? opt.textContent : '';
  // border-box: text + left-pad 14 + right-pad 30 (caret) + borders 2 (+1 fudge)
  sel.style.width = Math.ceil(_chipSizer.getBoundingClientRect().width) + 47 + 'px';
}
function fitAllChips() {
  ['m-pref', 'm-cat', 'm-price', 'm-rating', 'm-reserve']
    .forEach(id => fitChipWidth(document.getElementById(id)));
}

// highlight a mobile chip when its filter is active
function syncChipActive() {
  const f = STATE.filter;
  const setA = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', !!on); };
  setA('m-pref', f.pref);
  setA('m-cat', f.cat);
  setA('m-price', f.maxPrice != null);
  setA('m-rating', f.minRating > 0);
  setA('m-reserve', f.reserve);
  const ms = document.getElementById('m-search');
  if (ms && ms.parentElement) ms.parentElement.classList.toggle('active', !!f.q);
  fitAllChips();
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
  // reservation pills
  document.querySelectorAll('#reserve-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#reserve-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.filter.reserve = p.dataset.reserve || '';
      applyFilters();
    });
  });

  // mobile single-row filter chips → same STATE.filter, then refresh chip highlights
  const wireChip = (id, apply) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { apply(el.value); applyFilters(); syncChipActive(); });
  };
  wireChip('m-pref',    v => STATE.filter.pref = v);
  wireChip('m-cat',     v => STATE.filter.cat = v);
  wireChip('m-price',   v => STATE.filter.maxPrice = v ? parseInt(v, 10) : null);
  wireChip('m-rating',  v => STATE.filter.minRating = parseFloat(v) || 0);
  wireChip('m-reserve', v => STATE.filter.reserve = v);
  const msearch = document.getElementById('m-search');
  if (msearch) {
    let mt;
    msearch.addEventListener('input', (e) => {
      clearTimeout(mt);
      mt = setTimeout(() => { STATE.filter.q = e.target.value.trim().toLowerCase(); applyFilters(); syncChipActive(); }, 200);
    });
  }

  // copy buttons inside the detail (delegated — works for both the drawer and the sheet)
  for (const cid of ['drawer-content', 'sheet-detail-content']) {
    const el = document.getElementById(cid);
    if (el) el.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      e.preventDefault();
      copyToClipboard(btn.getAttribute('data-copy') || '', btn);
    });
  }

  // drawer close
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // locate
  document.getElementById('locate-btn').addEventListener('click', () => locateUser(false));
  document.getElementById('recenter-btn').addEventListener('click', () => locateUser(true));

  // mobile bottom-sheet controls
  const fab = document.getElementById('mobile-filter-fab');
  const closeBtn = document.getElementById('sheet-close-mobile');
  // filter FAB: leave any open detail, show the filters (full sheet)
  if (fab) fab.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('detail-mode');
    setSheetState('full');
  });
  if (closeBtn) closeBtn.addEventListener('click', () => setSheetState('peek'));
  // mobile detail back button → return to the list view in the sheet
  const sdBack = document.getElementById('sheet-detail-back');
  if (sdBack) sdBack.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('detail-mode');
    setSheetState('peek');
  });
}

function isFilterActive() {
  const f = STATE.filter;
  return !!(f.q || f.pref || f.cat || (f.maxPrice != null) || f.minRating > 0 || f.reserve);
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
    if (f.reserve && r.rs !== f.reserve) return false;
    if (f.q) {
      const hay = ((r.n||'') + ' ' + (r.a||'') + ' ' + (r.c||'')).toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
  renderList();
  renderMarkers();
}

// ===== Sidebar list =====
function renderList() {
  const list = document.getElementById('result-list');
  // viewport-scoped: only items currently visible on map
  const inView = STATE.filtered.filter(isInViewport);
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
      ${thumb ? `<div class="rest-card-thumb"><img loading="lazy" src="${escapeHtml(thumb)}" alt="" onerror="this.style.display='none'"/></div>` : `<div class="rest-card-thumb"></div>`}
      <div class="rest-card-body">
        <div class="rest-card-name">${escapeHtml(r.n)}</div>
        <div class="rest-card-meta">
          <span>${escapeHtml(prefTr)}</span>
          <span>·</span>
          <span><span class="cat-ico">${categoryIcon(firstCat)}</span>${escapeHtml(catTr)}</span>
          <span>·</span>
          <span class="rest-card-rating">★ ${escapeHtml(r.r||'')}</span>
          ${r.dl ? `<span>·</span><span>¥${r.dl.toLocaleString()}~</span>` : ''}
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
// ===== Detail drawer (lazy-loads reviews + gallery from a shard) =====
const DETAIL_CACHE = new Map(); // "NN" -> parsed shard object

function tabelogId(u) {
  const m = String(u || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

async function loadDetail(r) {
  if (r._detailLoaded) return r;
  const id = tabelogId(r.u);
  if (!id) { r._detailLoaded = true; return r; }
  const key = id.slice(-2).padStart(2, '0');
  try {
    let shard = DETAIL_CACHE.get(key);
    if (!shard) {
      const res = await fetch(`./data/d/${key}.json?v=${DATA_VERSION}`);
      shard = res.ok ? await res.json() : {};
      DETAIL_CACHE.set(key, shard);
    }
    const d = shard[id];
    if (d) { if (d.rv) r.rv = d.rv; if (d.ph) r.ph = d.ph; if (d.bh) r.bh = d.bh; }
  } catch (e) {
    console.warn('detail load failed', id, e && e.message);
  }
  r._detailLoaded = true;
  return r;
}

function isMobileView() { return window.matchMedia('(max-width: 767px)').matches; }

function openDetail(r) {
  STATE.openRest = r;
  const mobile = isMobileView();
  // mobile: render the detail INSIDE the bottom sheet (map stays visible, Google-Maps style)
  // desktop: render into the left slide-in drawer
  const contentEl = document.getElementById(mobile ? 'sheet-detail-content' : 'drawer-content');
  renderDetail(r, !r._detailLoaded, contentEl);
  if (mobile) {
    document.getElementById('sidebar').classList.add('detail-mode');
    setSheetState('peek');                        // bottom stop — name/info + photos show, map above
    const sd = document.getElementById('sheet-detail'); if (sd) sd.scrollTop = 0;
  } else {
    document.getElementById('detail-drawer').classList.add('open');
    const dc = document.getElementById('drawer-content'); if (dc) dc.scrollTop = 0;
  }
  // centre the pin in the VISIBLE map strip — AFTER the sheet state is set, so the
  // offset matches the sheet's current height
  flyToPin(r);
  // lazy-fetch heavy detail (reviews + gallery) then re-render if still open
  if (!r._detailLoaded) {
    loadDetail(r).then(() => { if (STATE.openRest === r) renderDetail(r, false, contentEl); });
  }
}

// ===== Business hours (bh = { 月:"11:00 - 22:00", ..., 日:"定休日", 祝:"..." }) =====
function jstWeekdayKey() {
  const wd = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' });
  return { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' }[wd] || '月';
}
function jstNowMinutes() {
  const s = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [h, m] = s.split(':').map(Number); return h * 60 + m;
}
function isClosedDay(text) { return /定休|休み|休業/.test(text) && !/\d/.test(text); }
function isOpenNow(text) {
  if (!text || isClosedDay(text)) return false;
  const ranges = [...text.matchAll(/(\d{1,2}):(\d{2})\s*[-~〜–]\s*(\d{1,2}):(\d{2})/g)];
  if (!ranges.length) return null;
  const now = jstNowMinutes();
  for (const m of ranges) {
    const a = (+m[1]) * 60 + (+m[2]); let b = (+m[3]) * 60 + (+m[4]);
    if (b <= a) b += 1440;                          // crosses midnight
    let n = now; if (n < a && b > 1440) n += 1440;  // early-morning side of an overnight range
    if (n >= a && n < b) return true;
  }
  return false;
}
function bhLabels(lang) {
  return ({
    zh: { open: '營業中', closed: '休息中', hours: '營業時間', closedDay: '今日公休', closeAt: '營業至', openAt: '營業開始' },
    en: { open: 'Open', closed: 'Closed', hours: 'Hours', closedDay: 'Closed today', closeAt: 'Closes', openAt: 'Opens' },
    ja: { open: '営業中', closed: '営業時間外', hours: '営業時間', closedDay: '本日定休', closeAt: '営業終了', openAt: '営業開始' },
  })[lang] || { open: '營業中', closed: '休息中', hours: '營業時間', closedDay: '今日公休', closeAt: '營業至', openAt: '營業開始' };
}
function dayLabels(lang) {
  if (lang === 'en') return { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri', 土: 'Sat', 日: 'Sun', 祝: 'Hol' };
  if (lang === 'ja') return { 月: '月', 火: '火', 水: '水', 木: '木', 金: '金', 土: '土', 日: '日', 祝: '祝' };
  return { 月: '週一', 火: '週二', 水: '週三', 木: '週四', 金: '週五', 土: '週六', 日: '週日', 祝: '假日' };
}
function parseRanges(text) {
  return [...text.matchAll(/(\d{1,2}):(\d{2})\s*[-~〜–]\s*(\d{1,2}):(\d{2})/g)].map(m => {
    const a = (+m[1]) * 60 + (+m[2]); let b = (+m[3]) * 60 + (+m[4]); if (b <= a) b += 1440;  // overnight
    return { a, b, startStr: m[1].padStart(2, '0') + ':' + m[2], endStr: m[3].padStart(2, '0') + ':' + m[4] };
  });
}
// Google-Maps-style one-line status: 「營業中 · 營業至 21:00」 / 「休息中 · 營業開始 11:00」
// next time the place opens: later today (if checkToday), else scan forward to the next day with hours
function nextOpenLabel(bh, lang, checkToday) {
  const L = bhLabels(lang), dl = dayLabels(lang);
  const keys = ['月', '火', '水', '木', '金', '土', '日'];
  const todayKey = jstWeekdayKey();
  if (checkToday) {
    const laterToday = parseRanges(bh[todayKey] || '').filter(r => r.a > jstNowMinutes()).sort((x, y) => x.a - y.a)[0];
    if (laterToday) return `${L.openAt} ${laterToday.startStr}`;
  }
  const ti = keys.indexOf(todayKey);
  for (let i = 1; i <= 7; i++) {
    const k = keys[(ti + i) % 7];
    if (bh[k] == null || isClosedDay(bh[k])) continue;
    const rs = parseRanges(bh[k]);
    if (rs.length) return `${L.openAt} ${dl[k]} ${rs.sort((x, y) => x.a - y.a)[0].startStr}`;
  }
  return '';
}
// no icon — Google Maps shows the status flush-left, aligned with the name/category lines
function renderHoursTop(bh, lang) {
  if (!bh) return '';
  const text = bh[jstWeekdayKey()];
  if (text == null) return '';
  const L = bhLabels(lang);
  const wrap = (cls, status, detail) =>
    `<div class="detail-hours"><span class="bh-status ${cls}">${status}</span>${detail ? `<span class="bh-sep">·</span><span class="bh-detail">${detail}</span>` : ''}</div>`;
  if (isClosedDay(text)) return wrap('bh-closed', L.closedDay, nextOpenLabel(bh, lang, false));  // closed all day → when it next opens
  const ranges = parseRanges(text);
  if (!ranges.length) return `<div class="detail-hours"><span class="bh-detail">${escapeHtml(text)}</span></div>`;  // unparseable → raw
  const now = jstNowMinutes();
  let openR = null;
  for (const r of ranges) { let n = now; if (n < r.a && r.b > 1440) n += 1440; if (n >= r.a && n < r.b) { openR = r; break; } }
  if (openR) return wrap('bh-open', L.open, `${L.closeAt} ${openR.endStr}`);               // open now → closes at
  return wrap('bh-closed', L.closed, nextOpenLabel(bh, lang, true));                        // closed now → opens later today / next day
}
// full-week schedule as an info-row (below the photos)
function renderHoursWeek(bh, lang) {
  if (!bh) return '';
  const order = ['月', '火', '水', '木', '金', '土', '日']; if (bh['祝'] != null) order.push('祝');
  const dl = dayLabels(lang); const today = jstWeekdayKey();
  const rows = order.filter(d => bh[d] != null).map(d =>
    `<div class="bh-row${d === today ? ' bh-row-today' : ''}"><span class="bh-d">${dl[d]}</span><span class="bh-t">${escapeHtml(bh[d])}</span></div>`).join('');
  if (!rows) return '';
  const L = bhLabels(lang);
  return `<div class="info-row"><span class="label"><span class="msi size-16">schedule</span> ${L.hours}</span><div class="value"><div class="bh-week">${rows}</div></div></div>`;
}

function renderDetail(r, loading, contentEl) {
  contentEl = contentEl || document.getElementById('drawer-content');
  const dict = window.I18N[STATE.lang];
  const mapsQuery = encodeURIComponent(`${r.n} ${r.a || r.p || ''}`);
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const lang = STATE.lang;
  const reviewsHtml = (r.rv && r.rv.length)
    ? r.rv.map(rv => {
        // rv is either an object {t,b,r,d (+ tz/bz zh, te/be en)} OR legacy string "title｜body"
        let title, body, rating, date;
        if (typeof rv === 'string') {
          [title, body] = rv.split('｜');
        } else {
          rating = rv.r; date = rv.d;
          if (lang === 'zh')      { title = rv.tz || rv.t; body = rv.bz || rv.b; }
          else if (lang === 'en') { title = rv.te || rv.t; body = rv.be || rv.b; }
          else                    { title = rv.t;          body = rv.b; }   // ja = original
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
    : loading
      ? `<div class="detail-loading"><div class="spinner"></div></div>`
      : `<div class="review-body" style="color:var(--steel)">${dict['detail-no-reviews']}</div>`;

  const cats = (r.c || '').split('/').filter(Boolean);
  const firstCat = cats[0] || '';
  const price = r.d || r.l || '';
  const photos = photosOf(r);
  const copyTitle = dict['copy'] || '複製';

  contentEl.innerHTML = `
    <div class="detail-head">
      <div class="detail-name-row">
        <div class="detail-name">${escapeHtml(r.n)}</div>
        <button class="copy-btn" data-copy="${escapeHtml(r.n)}" title="${copyTitle}" aria-label="${copyTitle}"><span class="msi">content_copy</span></button>
      </div>
      <div class="detail-subline">
        ${r.r ? `<span class="d-rating"><span class="msi size-16 filled">star</span>${escapeHtml(r.r)}</span>` : ''}
        ${firstCat ? `${r.r ? '<span class="d-dot">·</span>' : ''}<span class="d-cat"><span class="cat-ico">${categoryIcon(firstCat)}</span>${escapeHtml(window.translateCat(firstCat, lang))}</span>` : ''}
        ${price ? `<span class="d-dot">·</span><span class="d-price">${escapeHtml(price)}</span>` : ''}
      </div>
      ${renderHoursTop(r.bh, lang)}
      ${(r.w > 1 || r.rs) ? `<div class="detail-badge-row">
        ${r.w > 1 ? `<span class="badge badge-orange">${dict['detail-awards']} ${r.w} ${dict['detail-times']}</span>` : ''}
        ${r.rs ? `<span class="badge badge-reserve-${r.rs}"><span class="cat-ico">${reserveIcon(r.rs)}</span>${reserveLabel(r.rs, lang)}</span>` : ''}
      </div>` : ''}
    </div>

    ${photos.length
      ? `<div class="detail-photos">${photos.slice(0, 20).map((p, i) => `<button class="detail-photo" data-photo="${i}"><img loading="lazy" src="${escapeHtml(p)}" alt="" onerror="this.closest('.detail-photo').remove()"/></button>`).join('')}</div>`
      : (loading ? `<div class="detail-photos detail-photos-loading"><div class="spinner"></div></div>` : '')}
    ${(!photos.length && !loading) ? `<div class="photo-placeholder"><span class="msi size-24">image_search</span><p>${dict['detail-photos-soon']}</p></div>` : ''}

    <div class="info-rows">
      ${r.a ? `<div class="info-row"><span class="label"><span class="msi size-16">place</span> ${dict['detail-address']}</span><span class="value"><span>${escapeHtml(r.a)}</span><button class="copy-btn" data-copy="${escapeHtml(r.a)}" title="${copyTitle}" aria-label="${copyTitle}"><span class="msi">content_copy</span></button></span></div>` : ''}
      ${r.rs ? `<div class="info-row"><span class="label"><span class="msi size-16">${reserveIcon(r.rs)}</span> ${dict['reserve-label']}</span><span class="value">${escapeHtml(reserveLabel(r.rs, lang))}</span></div>` : ''}
      ${r.d ? `<div class="info-row"><span class="label"><span class="msi size-16">restaurant</span> ${dict['detail-dinner']}</span><span class="value">${escapeHtml(r.d)}</span></div>` : ''}
      ${r.l ? `<div class="info-row"><span class="label"><span class="msi size-16">brunch_dining</span> ${dict['detail-lunch']}</span><span class="value">${escapeHtml(r.l)}</span></div>` : ''}
      ${r.y ? `<div class="info-row"><span class="label"><span class="msi size-16">emoji_events</span> ${dict['detail-awards']}</span><span class="value">${escapeHtml(r.y)}</span></div>` : ''}
      ${renderHoursWeek(r.bh, lang)}
    </div>

    <div class="action-row">
      <a class="action-btn action-btn-primary" href="${gmaps}" target="_blank" rel="noopener">
        <img class="brand-ico" src="https://www.google.com/s2/favicons?domain=maps.google.com&sz=64" alt="" loading="lazy" />
        ${dict['detail-gmap']}
      </a>
      <a class="action-btn" href="${escapeHtml(r.u)}" target="_blank" rel="noopener">
        <img class="brand-ico" src="https://www.google.com/s2/favicons?domain=tabelog.com&sz=64" alt="" loading="lazy" />
        ${dict['detail-tabelog']}
      </a>
    </div>

    <div class="section-title"><span class="msi size-16">reviews</span> ${dict['detail-reviews']}</div>
    ${reviewsHtml}
  `;
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('detail-mode');   // mobile: back to the list view in the sheet
}

// ===== Photo lightbox =====
function photosOf(r) {
  if (!r) return [];
  return [...new Set([r.cv, ...(r.ph || [])].filter(Boolean))];
}
const LIGHTBOX = { photos: [], idx: 0 };
function renderLightbox() {
  const { photos, idx } = LIGHTBOX;
  const img = document.getElementById('lightbox-img');
  if (img) img.src = photos[idx] || '';
  const cnt = document.getElementById('lightbox-count');
  if (cnt) cnt.textContent = `${idx + 1} / ${photos.length}`;
  const multi = photos.length > 1;
  document.getElementById('lightbox-prev').style.display = multi ? '' : 'none';
  document.getElementById('lightbox-next').style.display = multi ? '' : 'none';
}
function openLightbox(photos, idx) {
  if (!photos || !photos.length) return;
  LIGHTBOX.photos = photos;
  LIGHTBOX.idx = Math.max(0, Math.min(idx || 0, photos.length - 1));
  renderLightbox();
  const lb = document.getElementById('lightbox');
  lb.classList.add('open');
  lb.setAttribute('aria-hidden', 'false');
}
function lightboxStep(d) {
  const n = LIGHTBOX.photos.length;
  if (!n) return;
  LIGHTBOX.idx = (LIGHTBOX.idx + d + n) % n;     // wrap around
  renderLightbox();
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.remove('open');
  lb.setAttribute('aria-hidden', 'true');
  document.getElementById('lightbox-img').src = '';
}
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(-1); });
  document.getElementById('lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(1); });
  // tap the dark backdrop (not the photo) to close
  lb.addEventListener('click', (e) => {
    if (e.target === lb || e.target.classList.contains('lightbox-stage')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
    else if (e.key === 'ArrowRight') lightboxStep(1);
  });
  // any photo in the detail (hero or grid tile) opens the lightbox at its index
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-photo]');
    if (!el) return;
    const photos = photosOf(STATE.openRest);
    if (photos.length) { e.preventDefault(); openLightbox(photos, parseInt(el.dataset.photo, 10) || 0); }
  });
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
  // recenter button: visible + blue (centred on the user)
  const rb = document.getElementById('recenter-btn');
  rb.classList.add('visible', 'located');
}

function locateUser(recenter, silent) {
  if (!navigator.geolocation) {
    if (!silent) alert('Geolocation not supported in this browser');
    return;
  }
  const btn = recenter ? document.getElementById('recenter-btn') : document.getElementById('locate-btn');
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }
  if (recenter && STATE.userLocation) {
    centerInView(STATE.userLocation.lat, STATE.userLocation.lng, 14);
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; btn.classList.add('located'); }
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserMarker(latitude, longitude);
      centerInView(latitude, longitude, 14);
      if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    },
    (err) => {
      console.warn('geolocation:', err && err.message);
      if (!silent) alert('無法取得位置 / Cannot get location: ' + err.message);
      if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ===== Sheet grip — click or drag to cover/restore the filter panel =====
function setupSheetGrip() {
  const grip = document.getElementById('sheet-grip');
  const sidebar = document.getElementById('sidebar');
  if (!grip || !sidebar) return;

  const toggle = () => sidebar.classList.toggle('sheet-up');

  let startY = null;
  let pointerId = null;

  grip.addEventListener('pointerdown', (e) => {
    if (window.matchMedia('(max-width: 767px)').matches) return; // mobile uses its own sheet
    startY = e.clientY;
    pointerId = e.pointerId;
    try { grip.setPointerCapture(pointerId); } catch (_) {}
  });
  grip.addEventListener('pointerup', (e) => {
    if (pointerId == null) { toggle(); return; }
    const dy = e.clientY - startY;
    if (Math.abs(dy) < 6) toggle();
    else if (dy < -20) sidebar.classList.add('sheet-up');
    else if (dy > 20) sidebar.classList.remove('sheet-up');
    try { grip.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null; startY = null;
  });
  grip.addEventListener('pointercancel', () => { pointerId = null; startY = null; });

  // keyboard: Enter / Space toggles
  grip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

// ===== Mobile bottom sheet — 4 snap heights, draggable handle =====
// two stops: 'peek' (50vh, bottom — default, shows name/info + photo strip) · 'full' (top, under nav)
function navHeight() { return (document.querySelector('.top-nav') || {}).offsetHeight || 56; }
function sheetHeights() {
  const vh = window.innerHeight;
  // stops: 'collapsed' (thin bar — in a detail you can drag it down to this and explore the
  // map), 'peek' (bottom: list 25vh / detail 52vh), 'full' (top, under nav).
  const sb = document.getElementById('sidebar');
  const detail = sb && sb.classList.contains('detail-mode');
  return { collapsed: 104, peek: Math.round(vh * (detail ? 0.52 : 0.25)), full: vh - navHeight() };
}
// keep the floating buttons (filter FAB + recenter) just above the sheet's top edge so
// they stay visible while there's a map to use; once the sheet is essentially full-screen
// (no map) they fade out. Pass a live height during a drag.
function positionSheetButtons(heightPx) {
  if (!isMobileView()) return;
  const h = (heightPx != null) ? heightPx : sheetHeights()[document.getElementById('sidebar').dataset.sheet || 'peek'];
  const maxBottom = window.innerHeight - navHeight() - 64;   // highest the buttons may ride
  const hide = h > maxBottom;                                // sheet near full → no map → hide
  const bottom = Math.min(h + 12, maxBottom) + 'px';
  for (const id of ['mobile-filter-fab', 'recenter-btn']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.bottom = bottom;
    el.style.opacity = hide ? '0' : '1';
    el.style.pointerEvents = hide ? 'none' : 'auto';
  }
}
// how much of the map's bottom the sheet currently covers (0 on desktop / when full)
function sheetOffsetPx() {
  if (!isMobileView()) return 0;
  const sb = document.getElementById('sidebar');
  const state = (sb && sb.dataset.sheet) || 'peek';
  if (state === 'full') return 0;                 // sheet covers the map — no strip to centre in
  return sheetHeights()[state] || sheetHeights().peek;
}
// fly so (lat,lng) lands centered in the VISIBLE map strip above the current sheet
function centerInView(lat, lng, zoom) {
  const map = STATE.map;
  const z = zoom != null ? zoom : map.getZoom();
  const off = sheetOffsetPx();                     // push the geometric centre down by half the sheet
  const target = off > 0 ? map.unproject(map.project([lat, lng], z).add([0, off / 2]), z) : [lat, lng];
  map.flyTo(target, z, { duration: 0.6 });
}
// fly to a restaurant, centering its pin in the VISIBLE map strip above the bottom sheet
function flyToPin(r) {
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
  centerInView(r.lat, r.lng, Math.max(STATE.map.getZoom(), 14));
}
function setSheetState(s) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.remove('sheet-collapsed', 'sheet-half', 'mobile-open');
  sidebar.style.height = '';
  sidebar.style.maxHeight = '';
  if (s === 'full') {
    sidebar.classList.add('mobile-open');
  } else if (isMobileView()) {
    // 'collapsed' (thin bar) / 'peek' (bottom) → explicit px so the height is mode-aware
    const H = sheetHeights();
    const h = s === 'collapsed' ? H.collapsed : H.peek;
    sidebar.style.height = h + 'px';
    sidebar.style.maxHeight = h + 'px';
  }
  sidebar.dataset.sheet = s;       // 'peek'/'collapsed' set inline px; 'full' uses .mobile-open
  positionSheetButtons();          // buttons ride to just above the new sheet height
}
function setupMobileSheet() {
  const sidebar = document.getElementById('sidebar');
  const handle  = document.getElementById('sheet-handle');
  if (!sidebar) return;
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
  const cur = () => sidebar.dataset.sheet || 'peek';
  sidebar.dataset.sheet = 'peek';
  positionSheetButtons();

  const EPS = 2;
  const applyHeight = (h) => {
    sidebar.style.height = h + 'px';
    sidebar.style.maxHeight = h + 'px';                // max-height is the real cap
    positionSheetButtons(h);                           // floating buttons ride the finger
  };
  const snapToNearest = (h) => {
    const H = sheetHeights();
    // detail has a 3rd 'collapsed' stop (thin bar → explore the map); the list has two
    const stops = sidebar.classList.contains('detail-mode')
      ? [['collapsed', H.collapsed], ['peek', H.peek], ['full', H.full]]
      : [['peek', H.peek], ['full', H.full]];
    let best = stops[0];
    for (const s of stops) if (Math.abs(s[1] - h) < Math.abs(best[1] - h)) best = s;
    setSheetState(best[0]);
  };
  // the element that actually scrolls in the current state
  const activeScroller = () => {
    if (sidebar.classList.contains('detail-mode')) return document.getElementById('sheet-detail-content');
    if (sidebar.classList.contains('mobile-open'))  return sidebar;          // full list = sidebar scrolls
    return document.getElementById('result-list');                           // partial list (non-scroll)
  };

  // Google-Maps nested scroll: while the sheet isn't full, dragging the list/detail
  // GROWS the sheet (up) or SHRINKS it (down); once full, the content scrolls natively
  // and only a pull-down at the very TOP collapses the sheet again.
  let sY = 0, sX = 0, sH = 0, sTop = 0, mode = null, decided = false, onHandle = false;
  const begin = (clientY, clientX, target) => {
    if (!isMobile()) { mode = 'disabled'; return; }
    sY = clientY; sX = clientX;
    sH = sidebar.getBoundingClientRect().height;
    onHandle = !!(handle && (target === handle || handle.contains(target)));
    const sc = activeScroller();
    sTop = sc ? sc.scrollTop : 0;
    mode = null; decided = false;
  };
  const drag = (clientY, clientX, ev) => {
    if (mode === 'disabled' || !isMobile()) return;
    const dy = sY - clientY;                            // up = positive
    const dx = clientX - sX;                            // horizontal delta
    const H = sheetHeights();
    const isFull = sH >= H.full - EPS;
    if (!decided) {
      if (Math.abs(dy) < 4 && Math.abs(dx) < 4) return;               // wait for a real move
      decided = true;
      if (!onHandle && Math.abs(dx) > Math.abs(dy)) mode = 'native';  // horizontal swipe (photo strip) → scroll, NEVER resize
      else if (onHandle) mode = 'resize';                             // handle always resizes
      else if (!isFull)  mode = 'resize';                             // partial: drag grows/shrinks sheet
      else if (dy > 0)   mode = 'native';                             // full + up: scroll the content
      else               mode = (sTop <= 0) ? 'resize' : 'native';    // full + down: collapse only at top
      if (mode === 'resize') sidebar.classList.add('dragging');       // transition off → follow finger
    }
    if (mode === 'resize') {
      if (ev.cancelable) ev.preventDefault();
      // detail can be dragged down to the thin 'collapsed' bar; the list floor is peek
      const floor = sidebar.classList.contains('detail-mode') ? H.collapsed : H.peek;
      applyHeight(Math.max(floor, Math.min(H.full, sH + dy)));
    }
    // mode 'native' → let the browser scroll the content (momentum preserved)
  };
  const finish = () => {
    if (mode === 'resize') {
      sidebar.classList.remove('dragging');
      snapToNearest(sidebar.getBoundingClientRect().height);
    } else if (!decided && onHandle) {
      const c = cur();                                                // tap the handle: collapsed→peek, else toggle peek/full
      setSheetState(c === 'collapsed' ? 'peek' : (c === 'full' ? 'peek' : 'full'));
    }
    mode = null; decided = false; onHandle = false;
  };

  sidebar.addEventListener('touchstart', (e) => { if (e.touches.length === 1) begin(e.touches[0].clientY, e.touches[0].clientX, e.target); }, { passive: true });
  sidebar.addEventListener('touchmove',  (e) => { if (e.touches.length === 1) drag(e.touches[0].clientY, e.touches[0].clientX, e); }, { passive: false });
  sidebar.addEventListener('touchend', finish);
  sidebar.addEventListener('touchcancel', finish);
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

// reservation class → localized label + icon
function reserveLabel(rs, lang) {
  const d = window.I18N[lang] || window.I18N.zh;
  if (rs === 'net')   return d['reserve-net'];
  if (rs === 'phone') return d['reserve-phone'];
  if (rs === 'no')    return d['reserve-no'];
  return '';
}
function reserveIcon(rs) {
  if (rs === 'net')   return 'event_available';
  if (rs === 'phone') return 'call';
  if (rs === 'no')    return 'event_busy';
  return 'event_available';
}

// copy text to clipboard with a brief check-mark confirmation on the button
function copyToClipboard(text, btn) {
  const flash = () => {
    if (!btn) return;
    btn.classList.add('copied');
    const ic = btn.querySelector('.msi');
    const prev = ic ? ic.textContent : '';
    if (ic) ic.textContent = 'check';
    setTimeout(() => { btn.classList.remove('copied'); if (ic) ic.textContent = prev || 'content_copy'; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash));
  } else {
    fallbackCopy(text, flash);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); done && done(); } catch (_) {}
  document.body.removeChild(ta);
}

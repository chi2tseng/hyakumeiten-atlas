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
function initMap() {
  STATE.map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: true,        // native animated wheel zoom (no tile blanking)
    zoomSnap: 0,                  // land on fractional zooms for a smooth glide
    zoomDelta: 0.5,
    wheelDebounceTime: 18,        // batch wheel events tightly → smooth chained zooms
    wheelPxPerZoomLevel: 110,     // gentle: more scroll per zoom level
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: false,   // don't re-animate every pin during zoom
  }).setView([36.5, 138], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
    keepBuffer: 6,               // keep a wide ring of tiles so panning/zoom doesn't blank
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
    const res = await fetch('./data/index.json');
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
      const res = await fetch(`./data/d/${key}.json`);
      shard = res.ok ? await res.json() : {};
      DETAIL_CACHE.set(key, shard);
    }
    const d = shard[id];
    if (d) { if (d.rv) r.rv = d.rv; if (d.ph) r.ph = d.ph; }
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
  // pan to marker — on mobile, centre the pin in the map strip left visible above the sheet
  flyToPin(r, mobile ? sheetHeights().half : 0);
  // mobile: render the detail INSIDE the bottom sheet (map stays visible, Google-Maps style)
  // desktop: render into the left slide-in drawer
  const contentEl = document.getElementById(mobile ? 'sheet-detail-content' : 'drawer-content');
  renderDetail(r, !r._detailLoaded, contentEl);
  if (mobile) {
    document.getElementById('sidebar').classList.add('detail-mode');
    setSheetState('half');                       // map stays visible above the sheet
    const sd = document.getElementById('sheet-detail'); if (sd) sd.scrollTop = 0;
  } else {
    document.getElementById('detail-drawer').classList.add('open');
    const dc = document.getElementById('drawer-content'); if (dc) dc.scrollTop = 0;
  }
  // lazy-fetch heavy detail (reviews + gallery) then re-render if still open
  if (!r._detailLoaded) {
    loadDetail(r).then(() => { if (STATE.openRest === r) renderDetail(r, false, contentEl); });
  }
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

  const cats = (r.c||'').split('/').filter(Boolean);

  const photos = photosOf(r);
  contentEl.innerHTML = `
    ${photos.length
      ? `<div class="detail-hero" data-photo="0"><img src="${escapeHtml(photos[0])}" alt=""/></div>`
      : (loading ? `<div class="detail-hero detail-hero-loading"><div class="spinner"></div></div>` : '')}

    <div class="detail-name-row">
      <div class="detail-name">${escapeHtml(r.n)}</div>
      <button class="copy-btn" data-copy="${escapeHtml(r.n)}" title="${dict['copy'] || '複製'}" aria-label="${dict['copy'] || '複製'}"><span class="msi">content_copy</span></button>
    </div>

    <div class="detail-cat-row">
      ${cats.map(c => `<span class="badge badge-cream"><span class="cat-ico">${categoryIcon(c)}</span>${escapeHtml(window.translateCat(c, STATE.lang))}</span>`).join('')}
      ${r.w > 1 ? `<span class="badge badge-orange">${dict['detail-awards']} ${r.w} ${dict['detail-times']}</span>` : ''}
      ${r.rs ? `<span class="badge badge-reserve-${r.rs}"><span class="cat-ico">${reserveIcon(r.rs)}</span>${reserveLabel(r.rs, STATE.lang)}</span>` : ''}
    </div>

    <div class="detail-meta-row">
      ${r.r ? `<div><div class="detail-rating">★ ${escapeHtml(r.r)}</div></div>` : ''}
      ${r.y ? `<div class="detail-rating-sub">${escapeHtml(r.y)}</div>` : ''}
    </div>

    <div class="info-rows">
      ${r.a ? `<div class="info-row"><span class="label"><span class="msi size-16">place</span> ${dict['detail-address']}</span><span class="value"><span>${escapeHtml(r.a)}</span><button class="copy-btn" data-copy="${escapeHtml(r.a)}" title="${dict['copy'] || '複製'}" aria-label="${dict['copy'] || '複製'}"><span class="msi">content_copy</span></button></span></div>` : ''}
      ${r.rs ? `<div class="info-row"><span class="label"><span class="msi size-16">${reserveIcon(r.rs)}</span> ${dict['reserve-label']}</span><span class="value">${escapeHtml(reserveLabel(r.rs, STATE.lang))}</span></div>` : ''}
      ${r.d ? `<div class="info-row"><span class="label"><span class="msi size-16">restaurant</span> ${dict['detail-dinner']}</span><span class="value">${escapeHtml(r.d)}</span></div>` : ''}
      ${r.l ? `<div class="info-row"><span class="label"><span class="msi size-16">brunch_dining</span> ${dict['detail-lunch']}</span><span class="value">${escapeHtml(r.l)}</span></div>` : ''}
      ${r.y ? `<div class="info-row"><span class="label"><span class="msi size-16">emoji_events</span> ${dict['detail-awards']}</span><span class="value">${escapeHtml(r.y)}</span></div>` : ''}
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

    ${(photos.length || loading) ? `
      <div class="section-title"><span class="msi size-16">photo_library</span> ${dict['detail-photos']}${photos.length ? ` <span class="count">${photos.length}</span>` : ''}</div>
      ${photos.length ? `
        <div class="photo-grid">
          ${photos.slice(0, 12).map((p, i) => `<button class="photo-tile" data-photo="${i}"><img loading="lazy" src="${escapeHtml(p)}" alt=""/></button>`).join('')}
        </div>
      ` : (loading ? `<div class="detail-loading"><div class="spinner"></div></div>` : '')}
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
    STATE.map.flyTo([STATE.userLocation.lat, STATE.userLocation.lng], 14, { duration: 0.6 });
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; btn.classList.add('located'); }
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setUserMarker(latitude, longitude);
      STATE.map.flyTo([latitude, longitude], 14, { duration: 0.6 });
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
// states: 'collapsed' (88px) · 'peek' (34vh, default) · 'half' (62vh, detail) · 'full' (86vh)
function navHeight() { return (document.querySelector('.top-nav') || {}).offsetHeight || 56; }
function sheetHeights() {
  const vh = window.innerHeight;
  // 'full' reaches right under the top nav — no leftover strip of map
  return { collapsed: 88, peek: Math.round(vh * 0.34), half: Math.round(vh * 0.62), full: vh - navHeight() };
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
// fly to a restaurant, centering its pin in the VISIBLE map area above the bottom sheet
function flyToPin(r, sheetPx) {
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
  const map = STATE.map;
  const z = Math.max(map.getZoom(), 14);
  if (sheetPx && isMobileView()) {
    // push the geometric center down by half the sheet so the pin lands in the open strip
    const pt = map.project([r.lat, r.lng], z).add([0, sheetPx / 2]);
    map.flyTo(map.unproject(pt, z), z, { duration: 0.6 });
  } else {
    map.flyTo([r.lat, r.lng], z, { duration: 0.6 });
  }
}
function setSheetState(s) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.style.height = '';
  sidebar.style.maxHeight = '';                                     // clear drag inline; class governs height
  sidebar.classList.remove('sheet-collapsed', 'sheet-half', 'mobile-open');
  if (s === 'collapsed') sidebar.classList.add('sheet-collapsed');
  else if (s === 'half') sidebar.classList.add('sheet-half');
  else if (s === 'full') sidebar.classList.add('mobile-open');
  sidebar.dataset.sheet = s;       // 'peek' has no class
  positionSheetButtons();          // buttons ride to just above the new sheet height
}
function setupMobileSheet() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sheet-handle');
  if (!sidebar || !handle) return;
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
  const cur = () => sidebar.dataset.sheet || 'peek';
  sidebar.dataset.sheet = 'peek';
  positionSheetButtons();
  const UP   = { collapsed: 'peek', peek: 'half', half: 'full', full: 'full' };       // swipe up = expand
  const DOWN = { full: 'half', half: 'peek', peek: 'collapsed', collapsed: 'collapsed' }; // swipe down = shrink

  let startY = null, startH = 0, dragging = false, moved = false, pid = null;

  handle.addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    startY = e.clientY;
    startH = sidebar.getBoundingClientRect().height;
    dragging = true; moved = false; pid = e.pointerId;
    sidebar.classList.add('dragging');                 // transition off → follow finger
    try { handle.setPointerCapture(pid); } catch (_) {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;                     // up = positive
    if (Math.abs(dy) > 4) moved = true;
    const H = sheetHeights();
    const h = Math.max(H.collapsed, Math.min(H.full, startH + dy));
    sidebar.style.height = h + 'px';                   // live-follow (both, since max-height is the cap)
    sidebar.style.maxHeight = h + 'px';
    positionSheetButtons(h);                           // buttons follow the finger too
    e.preventDefault();
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    sidebar.classList.remove('dragging');              // re-enable transition for the snap
    const dy = startY - (e.clientY != null ? e.clientY : startY);
    let target;
    if (!moved) target = cur() === 'full' ? 'peek' : 'full';   // tap toggles
    else if (dy > 30) target = UP[cur()];              // swiped up → expand
    else if (dy < -30) target = DOWN[cur()];           // swiped down → shrink
    else target = cur();                               // tiny move → settle current
    setSheetState(target);                             // clears inline + animates to class height
    try { handle.releasePointerCapture(pid); } catch (_) {}
    pid = null; startY = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
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

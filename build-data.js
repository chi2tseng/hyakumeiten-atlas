// Build data/index.json (lightweight) + data/d/NN.json (detail shards) for the app
// Merges: japan_listings.json + japan_details.json + japan_coords.ndjson + japan_reviews.ndjson + photos
// index.json keeps n,p,a,c,y,w,d,l,dl,r,u,cv,lat,lng  (≈4MB, loads on startup)
// d/NN.json keeps {<id>: {rv, ph}}  (heavy reviews+gallery, lazy-loaded by id last-2-digits)

const fs = require('fs');
const path = require('path');

const SOURCE = 'D:/Tabelog';
const OUT    = path.join(__dirname, 'data/index.json');

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });

// load
const listings = JSON.parse(fs.readFileSync(`${SOURCE}/japan_listings.json`, 'utf-8'));
const details  = JSON.parse(fs.readFileSync(`${SOURCE}/japan_details.json`, 'utf-8'));

const coords = new Map();
if (fs.existsSync(`${SOURCE}/japan_coords.ndjson`)) {
  for (const line of fs.readFileSync(`${SOURCE}/japan_coords.ndjson`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.lat && r.lng) coords.set(r.url, [r.lat, r.lng]);
    } catch {}
  }
}

const reviews = new Map();
// prefer japan_reviews20.ndjson (20+ per restaurant) over japan_reviews.ndjson (3 per)
for (const f of ['japan_reviews20.ndjson', 'japan_reviews.ndjson']) {
  if (!fs.existsSync(`${SOURCE}/${f}`)) continue;
  for (const line of fs.readFileSync(`${SOURCE}/${f}`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.reviews && r.reviews.length && !reviews.has(r.url)) reviews.set(r.url, r.reviews);
    } catch {}
  }
}

const photos = new Map(); // url → { cover, photos[] }
// HEADER photos first (cover + 6 strip thumbs from main page)
if (fs.existsSync(`${SOURCE}/japan_header_photos.ndjson`)) {
  for (const line of fs.readFileSync(`${SOURCE}/japan_header_photos.ndjson`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.cover || (r.photos && r.photos.length)) {
        const urls = [...new Set([r.cover, ...(r.photos || [])].filter(Boolean))];
        photos.set(r.url, { cover: r.cover || urls[0], photos: urls });
      }
    } catch {}
  }
}
// GALLERY photos second (up to 20 from dtlphotolst) — merge with header
if (fs.existsSync(`${SOURCE}/japan_photos.ndjson`)) {
  for (const line of fs.readFileSync(`${SOURCE}/japan_photos.ndjson`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.photos && r.photos.length) {
        const galleryUrls = r.photos.map(p => p.src || p).filter(Boolean);
        const existing = photos.get(r.url) || { cover: null, photos: [] };
        const merged = [...new Set([...existing.photos, ...galleryUrls])];
        photos.set(r.url, {
          cover: existing.cover || galleryUrls[0],
          photos: merged,
        });
      }
    } catch {}
  }
}

// reservation: 予約可否 text + net (online instant-booking) flag per restaurant
const reserve = new Map(); // url -> { rsv, net }
if (fs.existsSync(`${SOURCE}/japan_reserve.ndjson`)) {
  for (const line of fs.readFileSync(`${SOURCE}/japan_reserve.ndjson`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.url && (('net' in r) || r.rsv)) reserve.set(r.url, { rsv: r.rsv || '', net: r.net ? 1 : 0 });
    } catch {}
  }
}
// classify into: 'net' (online booking) > 'phone' (reservable, phone only) > 'no' (not reservable)
function classifyReserve(rsv, net) {
  if (net) return 'net';
  if (!rsv) return null;
  if (rsv.includes('不可')) return 'no';
  if (rsv.includes('可') || rsv.includes('予約制') || rsv.includes('優先')) return 'phone';
  return null;
}

const PREF_JP = {
  tokyo:'東京', osaka:'大阪', aichi:'愛知', kanagawa:'神奈川', kyoto:'京都',
  hokkaido:'北海道', hyogo:'兵庫', fukuoka:'福岡', saitama:'埼玉', chiba:'千葉',
  hiroshima:'広島', kagawa:'香川', shizuoka:'静岡', gifu:'岐阜', nagano:'長野',
  miyagi:'宮城', okinawa:'沖縄', ishikawa:'石川', miyazaki:'宮崎', nara:'奈良',
  mie:'三重', ibaraki:'茨城', tochigi:'栃木', niigata:'新潟', kumamoto:'熊本',
  akita:'秋田', gunma:'群馬', fukushima:'福島', shiga:'滋賀', kagoshima:'鹿児島',
  nagasaki:'長崎', toyama:'富山', ehime:'愛媛', okayama:'岡山', yamagata:'山形',
  yamanashi:'山梨', aomori:'青森', iwate:'岩手', tokushima:'徳島', oita:'大分',
  kochi:'高知', wakayama:'和歌山', saga:'佐賀', fukui:'福井', yamaguchi:'山口',
  shimane:'島根', tottori:'鳥取',
};

function cleanCat(c) {
  return c.replace(/(東京|東|西|北海道|神奈川|愛知|大阪|香川)$/, '');
}

function parsePriceLower(txt) {
  if (!txt) return null;
  const clean = txt.replace(/[,，]/g, '');
  const nums = [...clean.matchAll(/¥?\s*(\d{3,6})/g)].map(m => parseInt(m[1], 10));
  if (nums.length === 0) return null;
  if (nums.length === 1) {
    if (clean.match(/[\d]\s*[～〜~]\s*$/)) return nums[0];
    return null;
  }
  return nums[0];
}

// canonical url = strip the /dtlrvwlst/ or /dtlphotolst/ suffix some listing links carry
function canonUrl(url) {
  return String(url || '').replace(/(dtlrvwlst|dtlphotolst)\/?$/, '');
}
// trailing numeric segment of the canonical url = Tabelog restaurant id
function tabelogId(url) {
  const m = canonUrl(url).match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

// ---- DEDUPE -------------------------------------------------------------
// The source listing holds the same restaurant under several url forms: the
// real page, a wrong-prefecture mirror (e.g. /tokyo/… for a Hokkaido shop, with
// a newline-polluted name), and a /dtlrvwlst/ review-list link. Group by the
// restaurant id, keep the cleanest canonical url, and merge awards across every
// variant.  ~12,280 urls → ~10,067 distinct restaurants.
const groups = new Map(); // id -> [urls]
let droppedNoId = 0;
for (const url of Object.keys(listings)) {
  const id = tabelogId(url);
  if (!id) { droppedNoId++; continue; }
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(url);
}
function urlScore(u) {
  let s = 0;
  if (/dtlrvwlst|dtlphotolst/.test(u)) s += 1000;            // review/photo-list link — worst
  if (!/\/[a-z]+\/A\d+\/A\d+\/\d+\/?$/.test(u)) s += 100;    // not a full 2-area-code canonical
  if (!details[u]) s += 40;                                  // no detail scraped → likely the bad mirror
  const nm = (listings[u] && listings[u].name) || '';
  if (/[\n\r]/.test(nm)) s += 30;                            // polluted name (wrong-prefecture mirror)
  if (nm.length > 45) s += 10;                               // review-title-ish name
  return s + u.length * 0.001;                               // tiebreak: shorter
}

const records = [];                 // lightweight index (no rv/ph)
const shards = Array.from({ length: 100 }, () => ({})); // detail buckets by id last-2-digits
let withCoords = 0, withReviews = 0, withPhotos = 0, withReserve = 0;

// carry-forward translations: review text is stable across rebuilds, so reuse any
// tz/bz/te/be already written into the existing shards by translate-reviews.js.
const oldShards = {};
const TX_DIR = path.join(__dirname, 'data/d');
for (let i = 0; i < 100; i++) {
  const f = path.join(TX_DIR, String(i).padStart(2, '0') + '.json');
  if (fs.existsSync(f)) { try { oldShards[i] = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { oldShards[i] = {}; } }
  else oldShards[i] = {};
}
let carried = 0;

for (const [id, urls] of groups) {
  const best = urls.slice().sort((a, b) => urlScore(a) - urlScore(b))[0];
  const listing = listings[best];
  // prefer data from `best`, else any sibling variant that has it
  const pick = (map) => { for (const u of urls) { const v = map.get(u); if (v) return v; } return map.get(best) || null; };
  const pickFirst = (map) => { const v = map.get(best); if (v) return v; for (const u of urls) { const x = map.get(u); if (x) return x; } return null; };
  const d = details[best] || details[urls.find(u => details[u])] || {};

  // merge awards from every variant (dedupe by category|year)
  const awards = [];
  const seenAward = new Set();
  for (const u of urls) for (const a of (listings[u].awards || [])) {
    const k = a.category + '|' + a.year;
    if (!seenAward.has(k)) { seenAward.add(k); awards.push(a); }
  }
  const categories = [...new Set(awards.map(a => cleanCat(a.category)))];
  const years = [...new Set(awards.map(a => a.year))].sort();

  const co = pickFirst(coords);
  const rv = pickFirst(reviews);
  const ph = pickFirst(photos);
  let rsvObj = null; for (const u of [best, ...urls]) { const v = reserve.get(u); if (v) { rsvObj = v; break; } }

  const rec = {
    n: d.name || (listing.name || '').split(/[\n\r]/)[0].trim(),
    p: PREF_JP[listing.prefecture] || listing.prefecture,
    a: d.addr || '',
    c: categories.join('/'),
    y: years.join(','),
    w: awards.length,
    d: d.dinner || '',
    l: d.lunch || '',
    dl: parsePriceLower(d.dinner),
    r: d.rating || '',
    u: canonUrl(best),
  };
  if (co) { rec.lat = co[0]; rec.lng = co[1]; withCoords++; }
  if (ph && ph.cover) rec.cv = ph.cover;
  if (rsvObj) {
    if (rsvObj.rsv) rec.rsv = rsvObj.rsv;
    const rs = classifyReserve(rsvObj.rsv, rsvObj.net);
    if (rs) { rec.rs = rs; withReserve++; }
  }

  // heavy fields (reviews + full gallery) go to a lazy-loaded shard, keyed by id
  const detail = {};
  if (rv && rv.length) {
    const oldRv = (oldShards[parseInt(id.slice(-2), 10) % 100][id] || {}).rv || [];
    detail.rv = rv.slice(0, 24).map((x, k) => {
      const obj = {};
      if (x.title)  obj.t = x.title.slice(0, 100);
      if (x.body)   obj.b = x.body.slice(0, 280);
      if (x.rating) obj.r = String(x.rating);
      if (x.date)   obj.d = x.date.slice(0, 24);
      // reuse existing translations when the source text still matches
      const o = oldRv[k];
      if (o && o.t === obj.t && o.b === obj.b && (o.bz != null || o.be != null)) {
        if (o.tz != null) obj.tz = o.tz;
        if (o.bz != null) obj.bz = o.bz;
        if (o.te != null) obj.te = o.te;
        if (o.be != null) obj.be = o.be;
        carried++;
      }
      return obj;
    });
    withReviews++;
  }
  if (ph && ph.photos && ph.photos.length) {
    detail.ph = ph.photos.slice(0, 24);
    withPhotos++;
  }
  if (detail.rv || detail.ph) {
    shards[parseInt(id.slice(-2), 10) % 100][id] = detail;
  }
  records.push(rec);
}

// ---- write lightweight index ----
fs.writeFileSync(OUT, JSON.stringify(records), 'utf-8');
const idxMb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);

// ---- write detail shards ----
const SHARD_DIR = path.join(__dirname, 'data/d');
if (!fs.existsSync(SHARD_DIR)) fs.mkdirSync(SHARD_DIR, { recursive: true });
let shardBytes = 0;
for (let i = 0; i < 100; i++) {
  const name = String(i).padStart(2, '0') + '.json';
  const body = JSON.stringify(shards[i]);
  fs.writeFileSync(path.join(SHARD_DIR, name), body, 'utf-8');
  shardBytes += Buffer.byteLength(body, 'utf8');
}

console.log('Source urls:', Object.keys(listings).length, '→ distinct restaurants:', records.length, `(deduped, dropped ${droppedNoId} no-id)`);
console.log('  with coords :', withCoords,  `(${(withCoords/records.length*100).toFixed(1)}%)`);
console.log('  with reviews:', withReviews, `(${(withReviews/records.length*100).toFixed(1)}%)`);
console.log('  with photos :', withPhotos, `(${(withPhotos/records.length*100).toFixed(1)}%)`);
console.log('  with reserve:', withReserve, `(${(withReserve/records.length*100).toFixed(1)}%)`);
console.log(`Index : ${OUT}  (${idxMb} MB)`);
console.log(`Shards: 100 files in ${SHARD_DIR}  (${(shardBytes/1024/1024).toFixed(1)} MB total, ~${(shardBytes/100/1024).toFixed(0)} KB each)`);

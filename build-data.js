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

// trailing numeric segment of a Tabelog url = globally-unique restaurant id
function tabelogId(url) {
  const m = String(url || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : null;
}

const records = [];                 // lightweight index (no rv/ph)
const shards = Array.from({ length: 100 }, () => ({})); // detail buckets by id last-2-digits
let withCoords = 0, withReviews = 0, withPhotos = 0, withReserve = 0, noId = 0;

for (const [url, listing] of Object.entries(listings)) {
  const d = details[url] || {};
  const categories = [...new Set((listing.awards || []).map(a => cleanCat(a.category)))];
  const years = [...new Set((listing.awards || []).map(a => a.year))].sort();
  const dinnerLo = parsePriceLower(d.dinner);
  const co = coords.get(url);
  const rv = reviews.get(url);
  const rec = {
    n: d.name || listing.name,
    p: PREF_JP[listing.prefecture] || listing.prefecture,
    a: d.addr || '',
    c: categories.join('/'),
    y: years.join(','),
    w: (listing.awards||[]).length,
    d: d.dinner || '',
    l: d.lunch || '',
    dl: dinnerLo,
    r: d.rating || '',
    u: url,
  };
  if (co) { rec.lat = co[0]; rec.lng = co[1]; withCoords++; }

  // cover stays in the index (needed for card thumbnails + markers)
  const ph = photos.get(url);
  if (ph && ph.cover) rec.cv = ph.cover;

  // reservation (small field, lives in the index for filtering)
  const rsvObj = reserve.get(url);
  if (rsvObj) {
    if (rsvObj.rsv) rec.rsv = rsvObj.rsv;
    const rs = classifyReserve(rsvObj.rsv, rsvObj.net);
    if (rs) { rec.rs = rs; withReserve++; }
  }

  // heavy fields (reviews + full gallery) go to a lazy-loaded shard
  const detail = {};
  if (rv && rv.length) {
    detail.rv = rv.slice(0, 24).map(x => {
      const obj = {};
      if (x.title)  obj.t = x.title.slice(0, 100);
      if (x.body)   obj.b = x.body.slice(0, 280);
      if (x.rating) obj.r = String(x.rating);
      if (x.date)   obj.d = x.date.slice(0, 24);
      return obj;
    });
    withReviews++;
  }
  if (ph && ph.photos && ph.photos.length) {
    detail.ph = ph.photos.slice(0, 24);
    withPhotos++;
  }

  if (detail.rv || detail.ph) {
    const id = tabelogId(url);
    if (id) {
      const b = parseInt(id.slice(-2), 10) % 100;
      shards[b][id] = detail;
    } else {
      noId++;
    }
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

console.log('Total records:', records.length);
console.log('  with coords :', withCoords,  `(${(withCoords/records.length*100).toFixed(1)}%)`);
console.log('  with reviews:', withReviews, `(${(withReviews/records.length*100).toFixed(1)}%)`);
console.log('  with photos :', withPhotos, `(${(withPhotos/records.length*100).toFixed(1)}%)`);
console.log('  with reserve:', withReserve, `(${(withReserve/records.length*100).toFixed(1)}%)`);
if (noId) console.log('  ⚠ no id (detail dropped):', noId);
console.log(`Index : ${OUT}  (${idxMb} MB)`);
console.log(`Shards: 100 files in ${SHARD_DIR}  (${(shardBytes/1024/1024).toFixed(1)} MB total, ~${(shardBytes/100/1024).toFixed(0)} KB each)`);

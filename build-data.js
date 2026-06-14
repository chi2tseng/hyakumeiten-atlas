// Build data/restaurants.json for the app
// Merges: japan_listings.json + japan_details.json + japan_coords.ndjson + japan_reviews.ndjson
// Outputs compact JSON with short keys (n,p,a,c,y,w,d,l,dl,r,u,rv,lat,lng)

const fs = require('fs');
const path = require('path');

const SOURCE = 'D:/Tabelog';
const OUT    = path.join(__dirname, 'data/restaurants.json');

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
if (fs.existsSync(`${SOURCE}/japan_reviews.ndjson`)) {
  for (const line of fs.readFileSync(`${SOURCE}/japan_reviews.ndjson`, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.reviews && r.reviews.length) reviews.set(r.url, r.reviews);
    } catch {}
  }
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

const records = [];
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
  if (co) { rec.lat = co[0]; rec.lng = co[1]; }
  if (rv && rv.length) {
    rec.rv = rv.map(x => (x.title || '') + (x.body ? '｜' + x.body.slice(0, 200) : ''));
  }
  records.push(rec);
}

// stats
const withCoords = records.filter(r => r.lat).length;
const withReviews = records.filter(r => r.rv && r.rv.length).length;
console.log('Total records:', records.length);
console.log('  with coords:', withCoords, `(${(withCoords/records.length*100).toFixed(1)}%)`);
console.log('  with reviews:', withReviews, `(${(withReviews/records.length*100).toFixed(1)}%)`);

// write compact JSON (no whitespace)
fs.writeFileSync(OUT, JSON.stringify(records), 'utf-8');
const stat = fs.statSync(OUT);
console.log(`Written: ${OUT}  (${(stat.size/1024/1024).toFixed(1)} MB)`);

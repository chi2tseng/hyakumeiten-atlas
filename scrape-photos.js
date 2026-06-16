// Scrape gallery photos for restaurants that ended up with ZERO photos (the original
// detail scrape missed them). Pulls the working 640x640_rect_{hash}.jpg review photos
// from each Tabelog page, writes the cover (cv) into data/index.json and the gallery
// (ph) into the shards. Resumable via data/_photos.json. Run: node scrape-photos.js
const https = require('https'), fs = require('fs'), path = require('path');

const PHOTOS_FILE = path.join(__dirname, 'data/_photos.json');
const SHARD_DIR = path.join(__dirname, 'data/d');
const INDEX = path.join(__dirname, 'data/index.json');
const CONC = 10, CAP = 20;
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept-Language': 'ja,en;q=0.9' }, timeout: 15000 };
const tid = u => { const m = String(u || '').match(/\/(\d+)\/?$/); return m ? m[1] : null; };

function get(u) {
  return new Promise(res => {
    const r = https.get(u, UA, resp => {
      if (resp.statusCode !== 200) { resp.resume(); return res({ code: resp.statusCode, html: '' }); }
      let h = ''; resp.on('data', d => h += d); resp.on('end', () => res({ code: 200, html: h }));
    });
    r.on('error', () => res({ code: 'err', html: '' }));
    r.on('timeout', () => { r.destroy(); res({ code: 'to', html: '' }); });
  });
}
function extractPhotos(html) {
  const re = /https:\/\/tblg\.k-img\.com\/restaurant\/images\/Rvw\/(\d+)\/640x640_rect_([0-9a-f]+)\.jpg/g;
  const seen = new Set(), out = []; let m;
  while ((m = re.exec(html))) { const k = m[1] + '/' + m[2]; if (!seen.has(k)) { seen.add(k); out.push(m[0]); } if (out.length >= CAP) break; }
  return out;
}

async function main() {
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const arr = Array.isArray(idx) ? idx : Object.values(idx);
  const shards = {};
  for (let i = 0; i < 100; i++) { const f = path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json'); shards[i] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
  const hasPh = {};
  for (const i in shards) for (const id in shards[i]) if (Array.isArray(shards[i][id].ph) && shards[i][id].ph.length) hasPh[id] = 1;
  const photos = fs.existsSync(PHOTOS_FILE) ? JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8')) : {};
  const todo = arr.filter(r => r.u && tid(r.u) && !r.cv && !hasPh[tid(r.u)] && !(tid(r.u) in photos));
  console.log(`zero-photo to scrape: ${todo.length} (already done: ${Object.keys(photos).length})`);

  let i = 0, ok = 0, empty = 0, done = 0;
  const save = () => fs.writeFileSync(PHOTOS_FILE, JSON.stringify(photos));
  async function worker() {
    while (i < todo.length) {
      const r = todo[i++]; const id = tid(r.u);
      let pics = null;
      for (let a = 0; a < 2 && !pics; a++) { const { code, html } = await get(r.u); if (code === 200) pics = extractPhotos(html); else await new Promise(s => setTimeout(s, 400)); }
      photos[id] = pics || [];
      if (pics && pics.length) ok++; else empty++;
      done++; if (done % 200 === 0) { save(); console.log(`  ${done}/${todo.length} (ok ${ok}, empty ${empty})`); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  save();
  console.log(`scrape done: ok ${ok}, empty ${empty}`);

  // merge: cover (cv) -> index.json, gallery (ph) -> shards
  const byId = {}; for (const r of arr) { const id = tid(r.u); if (id) byId[id] = r; }
  let cvAdded = 0;
  for (const id in photos) { const p = photos[id]; if (p && p.length && byId[id] && !byId[id].cv) { byId[id].cv = p[0]; cvAdded++; } }
  fs.writeFileSync(INDEX, JSON.stringify(idx));
  let phAdded = 0; const dirty = new Set();
  for (const id in photos) {
    const p = photos[id]; if (!p || !p.length) continue;
    const k = +id.slice(-2);
    if (!shards[k]) continue;
    if (!shards[k][id]) shards[k][id] = {};
    if (!Array.isArray(shards[k][id].ph) || !shards[k][id].ph.length) { shards[k][id].ph = p; phAdded++; dirty.add(k); }
  }
  for (const k of dirty) fs.writeFileSync(path.join(SHARD_DIR, String(k).padStart(2, '0') + '.json'), JSON.stringify(shards[k]));
  console.log(`merged: index cv +${cvAdded}, shard ph +${phAdded} (${dirty.size} shards)`);
}
main();

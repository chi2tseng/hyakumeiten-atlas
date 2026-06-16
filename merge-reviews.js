// Apply translated part files (data/_txd/NNNN.json) back into the shards.
// Validates each part's JSON; malformed parts are skipped (those reviews stay
// untranslated, so a later split→workflow pass re-does them). Idempotent.

const fs = require('fs');
const path = require('path');

const SHARD_DIR = path.join(__dirname, 'data/d');
const TXD_DIR = path.join(__dirname, 'data/_txd');

const shards = {};
for (let i = 0; i < 100; i++) {
  const f = path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json');
  shards[i] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

let applied = 0, malformed = 0, missingTarget = 0;
const badParts = [];
const dirty = new Set();

if (fs.existsSync(TXD_DIR)) {
  for (const f of fs.readdirSync(TXD_DIR)) {
    if (!f.endsWith('.json')) continue;
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(TXD_DIR, f), 'utf8')); }
    catch { malformed++; badParts.push(f); continue; }
    if (!Array.isArray(arr)) { malformed++; badParts.push(f); continue; }
    for (const o of arr) {
      if (!o || typeof o.k !== 'string') continue;
      const [si, id, ri] = o.k.split(':');
      const shard = shards[+si];
      const rec = shard && shard[id];
      const r = rec && rec.rv && rec.rv[+ri];
      if (!r) { missingTarget++; continue; }
      if (o.tz != null) r.tz = o.tz;
      if (o.bz != null) r.bz = o.bz;
      if (o.te != null) r.te = o.te;
      if (o.be != null) r.be = o.be;
      dirty.add(+si);
      applied++;
    }
  }
}

for (const i of dirty) {
  fs.writeFileSync(path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json'), JSON.stringify(shards[i]), 'utf8');
}

// remaining untranslated (missing zh or en) across all shards
let total = 0, done = 0;
for (let i = 0; i < 100; i++) for (const id in shards[i]) {
  const rv = shards[i][id].rv; if (!rv) continue;
  for (const r of rv) { if (r.t || r.b) { total++; if (r.bz != null && r.be != null) done++; } }
}

console.log(`applied ${applied} translations | malformed parts ${malformed}${malformed ? ' -> ' + badParts.join(',') : ''} | missing-target ${missingTarget}`);
console.log(`reviews translated: ${done}/${total} (${(done / total * 100).toFixed(1)}%) | remaining ${total - done}`);

// Split untranslated reviews into small part files for the translation workflow.
// Each part: data/_tx/NNNN.json = [{k:"shard:id:reviewIndex", t, b}, ...] (PART_SIZE items).
// Resumable: a review that already has both bz and be is skipped (so re-running after a
// partial merge only re-splits what's still missing).

const fs = require('fs');
const path = require('path');

const SHARD_DIR = path.join(__dirname, 'data/d');
const TX_DIR = path.join(__dirname, 'data/_tx');
const PART_SIZE = 120;

if (fs.existsSync(TX_DIR)) for (const f of fs.readdirSync(TX_DIR)) fs.unlinkSync(path.join(TX_DIR, f));
else fs.mkdirSync(TX_DIR, { recursive: true });

const queue = [];
for (let i = 0; i < 100; i++) {
  const f = path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json');
  if (!fs.existsSync(f)) continue;
  const shard = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const id in shard) {
    const rv = shard[id].rv;
    if (!rv) continue;
    for (let ri = 0; ri < rv.length; ri++) {
      const r = rv[ri];
      if ((r.t || r.b) && !(r.bz != null && r.be != null)) {
        queue.push({ k: `${i}:${id}:${ri}`, t: r.t || '', b: r.b || '' });
      }
    }
  }
}

let part = 0;
for (let i = 0; i < queue.length; i += PART_SIZE) {
  const slice = queue.slice(i, i + PART_SIZE);
  fs.writeFileSync(path.join(TX_DIR, String(part).padStart(4, '0') + '.json'), JSON.stringify(slice), 'utf8');
  part++;
}

fs.writeFileSync(path.join(TX_DIR, 'manifest.json'), JSON.stringify({ parts: part, reviews: queue.length, partSize: PART_SIZE }), 'utf8');
console.log(`untranslated reviews: ${queue.length}`);
console.log(`parts written: ${part}  (PART_SIZE=${PART_SIZE}) -> data/_tx/0000.json .. ${String(part - 1).padStart(4, '0')}.json`);

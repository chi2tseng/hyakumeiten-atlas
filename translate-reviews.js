// Translate all Tabelog reviews (Japanese) → Traditional Chinese + English, in place.
// Uses the Claude Code headless CLI (`claude -p --model sonnet`) so it runs on the
// session credential (no API key) — matches the user's chosen backend.
//
// Writes tz/bz (zh title/body) + te/be (en title/body) onto each review object in
// data/d/NN.json. Resumable: a review with both bz and be is skipped. Flushes dirty
// shards periodically so an interrupted run loses at most one flush window.
//
//   node translate-reviews.js            # full run
//   node translate-reviews.js --limit 80 # translate just one batch (smoke test)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SHARD_DIR = path.join(__dirname, 'data/d');
const BATCH = 50;            // reviews per claude -p call (keeps each call < ~140s)
const CONCURRENCY = 8;       // parallel claude -p processes
const FLUSH_EVERY = 16;      // flush dirty shards every N completed batches
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity; })();

// ---- load shards ----
const shards = {};           // i -> { id: {rv:[...]} }
for (let i = 0; i < 100; i++) {
  const f = path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json');
  shards[i] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
const dirty = new Set();
function flush() {
  for (const i of dirty) {
    const f = path.join(SHARD_DIR, String(i).padStart(2, '0') + '.json');
    fs.writeFileSync(f, JSON.stringify(shards[i]), 'utf8');
  }
  dirty.clear();
}

// ---- build work queue: every review missing zh or en ----
const queue = [];            // { si, id, ri, t, b }
for (let i = 0; i < 100; i++) {
  for (const id in shards[i]) {
    const rv = shards[i][id].rv;
    if (!rv) continue;
    for (let ri = 0; ri < rv.length; ri++) {
      const r = rv[ri];
      if ((r.t || r.b) && !(r.bz != null && r.be != null)) {
        queue.push({ si: i, id, ri, t: r.t || '', b: r.b || '' });
        if (queue.length >= LIMIT) break;
      }
    }
    if (queue.length >= LIMIT) break;
  }
  if (queue.length >= LIMIT) break;
}

const batches = [];
for (let i = 0; i < queue.length; i += BATCH) batches.push(queue.slice(i, i + BATCH));

const totalReviews = (() => { let n = 0; for (let i = 0; i < 100; i++) for (const id in shards[i]) n += (shards[i][id].rv || []).length; return n; })();
console.log(`Reviews total ${totalReviews} | untranslated ${queue.length} | batches ${batches.length} (BATCH=${BATCH}, CONCURRENCY=${CONCURRENCY})`);
if (!batches.length) { console.log('Nothing to translate. Done.'); process.exit(0); }

const PROMPT_HEAD =
`你是專業的日→繁中＋英文翻譯。下面是 JSON 陣列,每元素是一則日文餐廳評論的標題(t)與內文(b)。
把每則的 t 與 b 都翻成「繁體中文」與「英文」,語氣自然、保留原意、不要逐字硬翻。
只輸出一個 JSON 陣列,每元素為 {"i":原序號,"tz":標題繁中,"bz":內文繁中,"te":標題英文,"be":內文英文}。
若某欄原文為空字串,對應翻譯也給空字串。除了這個 JSON 陣列外,不要輸出任何文字或 markdown。

輸入:
`;

function callClaude(items) {
  return new Promise((resolve) => {
    const input = items.map((x, k) => ({ i: k, t: x.t, b: x.b }));
    const prompt = PROMPT_HEAD + JSON.stringify(input);
    const child = spawn('claude', ['-p', '--model', 'sonnet'], { shell: true });
    let out = '', err = '';
    const killer = setTimeout(() => { try { child.kill(); } catch (_) {} }, 300000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', () => {
      clearTimeout(killer);
      resolve(parseJsonArray(out));
    });
    child.on('error', () => { clearTimeout(killer); resolve(null); });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseJsonArray(s) {
  if (!s) return null;
  let t = s.trim();
  // strip ```json fences / preamble: take from first '[' to last ']'
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { return null; }
}

let done = 0, applied = 0, failed = 0, nextBatch = 0;

async function worker() {
  while (nextBatch < batches.length) {
    const bi = nextBatch++;
    const items = batches[bi];
    let res = await callClaude(items);
    if (!res) { res = await callClaude(items); }           // one retry
    if (Array.isArray(res)) {
      for (const o of res) {
        const it = items[o && o.i];
        if (!it || typeof o.i !== 'number') continue;
        const r = shards[it.si][it.id].rv[it.ri];
        if (!r) continue;
        r.tz = o.tz || ''; r.bz = o.bz || '';
        r.te = o.te || ''; r.be = o.be || '';
        dirty.add(it.si);
        applied++;
      }
    } else {
      failed += items.length;
    }
    done++;
    if (done % FLUSH_EVERY === 0) { flush(); }
    if (done % 5 === 0 || done === batches.length) {
      const pct = (done / batches.length * 100).toFixed(1);
      process.stderr.write(`[${done}/${batches.length} ${pct}%] applied=${applied} failed=${failed}\n`);
    }
  }
}

(async () => {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flush();
  console.log(`\nDone. applied=${applied} failed=${failed} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  if (failed) console.log(`Re-run to retry the ${failed} that failed (already-done reviews are skipped).`);
})();

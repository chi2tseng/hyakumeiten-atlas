// Scrape Tabelog 営業時間 (business hours) for every restaurant and merge into the
// shards as a per-day object `bh` = { 月:"11:00 - 22:00", ..., 日:"定休日", 祝:"..." }.
// Hours live in a JSON-LD FAQPage block on each page. Resumable via data/_hours.json.
// Run: node scrape-hours.js   (long — ~10k pages). Re-run to retry the misses.

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOURS_FILE = path.join(__dirname, 'data/_hours.json');
const SHARD_DIR = path.join(__dirname, 'data/d');
const CONCURRENCY = 10;
const UA = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9',
  },
  timeout: 15000,
};

function tabelogId(u) { const m = String(u || '').match(/\/(\d+)\/?$/); return m ? m[1] : null; }

function get(u) {
  return new Promise((res) => {
    const req = https.get(u, UA, (r) => {
      if (r.statusCode !== 200) { r.resume(); return res({ code: r.statusCode, html: '' }); }
      let h = ''; r.on('data', (d) => h += d); r.on('end', () => res({ code: 200, html: h }));
    });
    req.on('error', () => res({ code: 'err', html: '' }));
    req.on('timeout', () => { req.destroy(); res({ code: 'timeout', html: '' }); });
  });
}

function parseHours(html) {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) {
    let d; try { d = JSON.parse(m[1]); } catch (e) { continue; }
    const items = Array.isArray(d) ? d : [d];
    for (const it of items) {
      if (it && it['@type'] === 'FAQPage' && Array.isArray(it.mainEntity)) {
        for (const q of it.mainEntity) {
          if (q.name && q.name.includes('営業時間')) {
            const t = ((q.acceptedAnswer && q.acceptedAnswer.text) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const out = {}; const dre = /\[(月|火|水|木|金|土|日|祝日|祝)\]\s*([^\[]*?)(?=\s*(?:\[|■|お店情報|$))/g; let mm;
            while ((mm = dre.exec(t))) { const day = mm[1].replace('祝日', '祝'); const v = mm[2].trim(); if (v) out[day] = v; }
            if (Object.keys(out).length) return out;
          }
        }
      }
    }
  }
  return null;
}

async function main() {
  const idx = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/index.json'), 'utf8'));
  const arr = (Array.isArray(idx) ? idx : Object.values(idx)).filter((r) => r.u && tabelogId(r.u));
  const hours = fs.existsSync(HOURS_FILE) ? JSON.parse(fs.readFileSync(HOURS_FILE, 'utf8')) : {};
  const todo = arr.filter((r) => !(tabelogId(r.u) in hours));
  console.log(`total ${arr.length} | already ${Object.keys(hours).length} | to-scrape ${todo.length}`);

  let done = 0, ok = 0, fail = 0, i = 0;
  const save = () => fs.writeFileSync(HOURS_FILE, JSON.stringify(hours));

  async function worker() {
    while (i < todo.length) {
      const r = todo[i++]; const id = tabelogId(r.u);
      let bh = null;
      for (let attempt = 0; attempt < 2 && !bh; attempt++) {
        const { code, html } = await get(r.u);
        if (code === 200) bh = parseHours(html);
        if (!bh && code !== 200) await new Promise((s) => setTimeout(s, 400));
      }
      if (bh) { hours[id] = bh; ok++; } else { hours[id] = null; fail++; }  // null = attempted, no hours
      done++;
      if (done % 300 === 0) { save(); console.log(`  ${done}/${todo.length} (ok ${ok}, fail ${fail})`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(`scrape done: ok ${ok}, fail ${fail}`);

  // merge into shards
  let merged = 0, shardsWritten = 0;
  for (let s = 0; s < 100; s++) {
    const f = path.join(SHARD_DIR, String(s).padStart(2, '0') + '.json');
    if (!fs.existsSync(f)) continue;
    const o = JSON.parse(fs.readFileSync(f, 'utf8')); let changed = false;
    for (const id in o) {
      if (hours[id]) { o[id].bh = hours[id]; merged++; changed = true; }
    }
    if (changed) { fs.writeFileSync(f, JSON.stringify(o)); shardsWritten++; }
  }
  console.log(`merged ${merged} hours into ${shardsWritten} shards`);
}

main();

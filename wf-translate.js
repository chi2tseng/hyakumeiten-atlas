export const meta = {
  name: 'translate-reviews',
  description: 'Translate Tabelog review part-files (JP→zh-TW+EN) with Sonnet sub-agents',
  phases: [{ title: 'Translate', detail: 'one Sonnet agent per ~120-review part file' }],
}

// args: { start, end } — inclusive part-index range (parts live in data/_tx/NNNN.json).
const A = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const start = A.start || 0
const end = (A.end != null) ? A.end : 0
const DIR = 'D:/Hyakumeiten/data'   // workflow agents run from the session root, so use absolute paths
const COUNT = { type: 'object', properties: { count: { type: 'integer' }, file: { type: 'string' } }, required: ['count'] }

const idxs = []
for (let p = start; p <= end; p++) idxs.push(p)
log(`translating parts ${start}..${end} (${idxs.length} files) with Sonnet`)

phase('Translate')
const results = await parallel(idxs.map((p) => () => {
  const id = String(p).padStart(4, '0')
  const prompt =
`You are a professional Japanese→(Traditional Chinese + English) translator.

1. Read the file ${DIR}/_tx/${id}.json — a JSON array of objects {k, t, b}. t = review title, b = review body, both Japanese; either may be an empty string.
2. For EVERY element, translate t and b into BOTH Traditional Chinese (zh-TW) and natural English. Faithful and fluent, not word-for-word. Keep it concise.
3. Write ${DIR}/_txd/${id}.json — a JSON array with the SAME length and order as the input. Each element MUST be {"k","tz","bz","te","be"}: k copied verbatim from the input; tz = Chinese of t; bz = Chinese of b; te = English of t; be = English of b. If a source field is empty, set its two translations to "".
4. Produce the result ONLY by writing that file with the Write tool (absolute path above). Do not print the translations in your reply.

After writing, reply with the number of elements you wrote.`
  return agent(prompt, { label: `tx:${id}`, phase: 'Translate', schema: COUNT, model: 'sonnet' })
    .then((r) => ({ p, id, count: r && r.count }))
    .catch(() => ({ p, id, count: null }))
}))

const ok = results.filter((r) => r && r.count > 0)
const bad = results.filter((r) => !r || !(r.count > 0))
log(`done: ${ok.length} parts translated, ${bad.length} failed/empty`)
return { translated: ok.length, failed: bad.length, failedParts: bad.map((b) => b && b.id).filter(Boolean) }

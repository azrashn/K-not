#!/usr/bin/env node
/**
 * The offline progress outbox on real IndexedDB in Chromium: entries survive a page reload, belong to
 * one user, are sent once, and are removed on sign-out. No servers or database are needed.
 *
 *   npm run test:e2e:outbox
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const check = (cond, msg) => { if (!cond) throw new Error(msg) }

// Serve the real modules; the source imports without extensions (Vite resolves them), so add them here.
const file = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'")
const routes = {
  '/': ['text/html', '<!doctype html><title>outbox</title><p>outbox</p>'],
  '/progress-outbox.js': ['text/javascript', file('src/lib/progress-outbox.js')],
  '/watch-tracker.js': ['text/javascript', file('src/lib/watch-tracker.js')],
}
const server = createServer((req, res) => {
  const hit = routes[req.url.split('?')[0]]
  res.writeHead(hit ? 200 : 404, { 'Content-Type': hit?.[0] ?? 'text/plain' })
  res.end(hit?.[1] ?? 'not found')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
const context = await browser.newContext()
const page = await context.newPage()
const run = (fn, arg) => page.evaluate(async ([src, a]) => {
  const { createOutbox, indexedDbStore } = await import('/progress-outbox.js')
  return await new Function('createOutbox', 'indexedDbStore', 'arg', `return (${src})(createOutbox, indexedDbStore, arg)`)(createOutbox, indexedDbStore, a)
}, [fn.toString(), arg])
let failed = false
async function step(name, f) {
  try { await f(); console.log(`  ✓ ${name}`) } catch (e) { failed = true; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

try {
  await page.goto(origin)
  check(await page.evaluate(() => typeof indexedDB !== 'undefined'), 'IndexedDB is not available')

  await step('failed saves of two users are stored', async () => {
    const n = await run(async (createOutbox, indexedDbStore) => {
      const box = createOutbox(indexedDbStore())
      const e = (userId, videoId, end) => ({ userId, courseId: 'c1', videoId, position_ms: end, intervals: [{ start_ms: 0, end_ms: end }] })
      await box.enqueue(e('u1', 'v1', 5000)); await box.enqueue(e('u1', 'v1', 12000)); await box.enqueue(e('u2', 'v9', 3000))
      return [await box.count('u1'), await box.count('u2')]
    })
    check(n[0] === 2 && n[1] === 1, `counts ${n}`)
  })

  await step('they survive a full page reload (closed tab, reopened app)', async () => {
    await page.reload()
    const n = await run(async (createOutbox, indexedDbStore) => {
      const box = createOutbox(indexedDbStore())
      return [await box.count('u1'), await box.count('u2')]
    })
    check(n[0] === 2 && n[1] === 1, `after reload ${n}`)
  })

  await step('they survive a new tab of the same browser', async () => {
    const other = await context.newPage()
    await other.goto(origin)
    const n = await other.evaluate(async () => {
      const { createOutbox, indexedDbStore } = await import('/progress-outbox.js')
      return await createOutbox(indexedDbStore()).count('u1')
    })
    await other.close()
    check(n === 2, `new tab saw ${n}`)
  })

  await step('a user drains only their own entries, merged per video, and they are gone afterwards', async () => {
    const out = await run(async (createOutbox, indexedDbStore) => {
      const box = createOutbox(indexedDbStore())
      const sent = []
      const result = await box.drain('u1', async (c, v, body) => { sent.push({ c, v, body }); return 'ok' })
      return { result, sent, left1: await box.count('u1'), left2: await box.count('u2') }
    })
    check(out.result.sent === 2 && out.sent.length === 1, JSON.stringify(out))
    check(out.sent[0].body.position_ms === 12000 && out.sent[0].body.intervals[0].end_ms === 12000, `body ${JSON.stringify(out.sent[0])}`)
    check(out.left1 === 0 && out.left2 === 1, `left ${out.left1}/${out.left2}`)
  })

  await step('a failed send keeps the entry for the next try', async () => {
    const out = await run(async (createOutbox, indexedDbStore) => {
      const box = createOutbox(indexedDbStore())
      const result = await box.drain('u2', async () => 'retry')
      return { result, left: await box.count('u2') }
    })
    check(out.result.waiting === 1 && out.left === 1, JSON.stringify(out))
  })

  await step('sign-out clears the user\'s entries', async () => {
    const out = await run(async (createOutbox, indexedDbStore) => {
      const box = createOutbox(indexedDbStore())
      return { cleared: await box.clear('u2'), left: await box.count('u2') }
    })
    check(out.cleared === 1 && out.left === 0, JSON.stringify(out))
  })
} finally {
  await browser.close()
  server.close()
}
console.log(failed ? '\nOUTBOX BROWSER TEST FAILED' : '\nOUTBOX BROWSER TEST PASSED')
process.exit(failed ? 1 : 0)

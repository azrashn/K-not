#!/usr/bin/env node
/**
 * Browser end-to-end for the notebook wire on the course cards: every card shows the same grey wire with one ring
 * per binding hole, the wire sticks out of the card without overlapping its neighbour or widening the page,
 * and the card itself (size, content, click) is unchanged.
 *
 *   npm run build && (cd backend && npm run build) && npm run test:e2e:spiral
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PASSWORD, startStack } from './lib/stack.mjs'

const check = (cond, msg) => { if (!cond) throw new Error(msg) }
const results = []
async function step(name, fn) {
  const t = Date.now()
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${Date.now() - t} ms)`) }
  catch (e) { results.push({ name, ok: false }); console.log(`  ✗ ${name}\n    ${String(e.message).split('\n')[0]}`); throw e }
}

async function login(page, web) {
  await page.goto(web)
  await page.getByLabel('E-posta').fill('ayse@knot.local')
  await page.getByLabel('Parola').fill(PASSWORD)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
  await page.getByRole('button', { name: 'Giriş yap' }).waitFor({ state: 'detached' }) // works on desktop and phone (logout sits in the menu)
}

// Computed gradients list their stops as rgb(r, g, b) or, for mixed colours, color(srgb r g b) (0..1).
const stops = (bg) => [
  ...[...bg.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
  ...[...bg.matchAll(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)/g)].map((m) => [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255))),
]
const greyish = (bg, what) => {
  const rgb = stops(bg)
  check(rgb.length >= 3, `no colour stops found in ${bg}`)
  for (const [r, g, b] of rgb) check(Math.max(r, g, b) - Math.min(r, g, b) < 40, `${what} must be grey, got rgb(${r}, ${g}, ${b})`)
  return rgb
}

async function main() {
  const stack = await startStack({ python: process.env.PYTHON })
  const { web, browser, work } = stack
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const shots = []
  const shot = async (n, opts = {}) => { await page.screenshot({ path: path.join(work, `${n}.png`), ...opts }); shots.push(n) }
  const cards = () => page.locator('.course-card')
  try {
    await login(page, web)
    await step('open the courses list with four cards', async () => {
      for (const name of ['JAVA 1', 'Computer Network', 'Algoritmalar']) {
        const r = await page.evaluate(async (n) => {
          const { token } = JSON.parse(sessionStorage.getItem('knot.session'))
          const res = await fetch('/api/courses', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) })
          return res.status
        }, name)
        check([200, 201].includes(r), `create course ${name} → ${r}`)
      }
      await page.goto(`${web}/#/dersler`)
      await page.reload()
      await cards().first().waitFor()
      await page.waitForTimeout(900)
      check((await cards().count()) >= 4, 'expected at least four cards')
    })

    await step('every card carries the same grey wire, aligned to its binding holes', async () => {
      const wires = await cards().evaluateAll((els) => els.map((el) => {
        const w = getComputedStyle(el, '::after')
        const b = getComputedStyle(el, '::before')
        return { content: w.content, width: w.width, size: w.backgroundSize, mask: w.maskImage || w.webkitMaskImage, holes: b.backgroundSize, bg: w.backgroundImage, pe: w.pointerEvents }
      }))
      for (const w of wires) {
        check(w.content !== 'none' && w.width === '40px', `wire missing or wrong width: ${JSON.stringify(w)}`)
        check(/svg/.test(w.mask), 'wire has no ring mask')
        check(w.size.split(' ')[1] === w.holes.split(' ')[1], `ring rhythm ${w.size} must equal hole rhythm ${w.holes}`)
        check(w.pe === 'none', 'the wire must not catch clicks')
      }
      check(new Set(wires.map((w) => w.bg)).size === 1, 'all cards must have the same grey wire, not their own colours')
      greyish(wires[0].bg, 'the wire')
    })

    await step('the wire sticks out of the card without touching the neighbouring card', async () => {
      const boxes = await cards().evaluateAll((els) => els.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top } }))
      const wireLeft = (b) => b.left - 12
      const rightCol = boxes.find((b, i) => i > 0 && b.left > boxes[0].right && Math.abs(b.top - boxes[0].top) < 5)
      check(rightCol, 'expected a second column of cards')
      check(wireLeft(rightCol) > boxes[0].right, 'the wire of a right-hand card overlaps its neighbour')
    })

    await step('the card itself is unchanged: same box with the wire hidden, click still opens the course', async () => {
      const withWire = await cards().first().boundingBox()
      await page.addStyleTag({ content: '.course-card::after { display: none !important }' })
      const without = await cards().first().boundingBox()
      check(withWire.width === without.width && withWire.height === without.height && withWire.x === without.x && withWire.y === without.y, `wire changed the card box: ${JSON.stringify(withWire)} vs ${JSON.stringify(without)}`)
      await page.reload()
      await cards().first().waitFor()
      await page.waitForTimeout(900)
      await shot('01-courses')
      const box = await cards().first().boundingBox()
      await page.screenshot({ path: path.join(work, '02-wire-detail.png'), clip: { x: Math.max(0, box.x - 30), y: box.y - 6, width: 150, height: 230 } })
      shots.push('02-wire-detail')
      await cards().first().locator('.course-card-main').click()
      await page.waitForURL((u) => /#\/dersler\/.+\/ogrenme/.test(u.hash), { timeout: 10000 })
    })

    await step('the page does not get a horizontal scrollbar on desktop or phone', async () => {
      await page.goto(`${web}/#/dersler`)
      await cards().first().waitFor()
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop page is wider than the window')
      const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
      const p = await phone.newPage()
      await login(p, web)
      await p.goto(`${web}/#/dersler`)
      await p.locator('.course-card').first().waitFor()
      await p.waitForTimeout(700)
      check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone page is wider than the window')
      await p.screenshot({ path: path.join(work, '03-phone.png') })
      shots.push('03-phone')
      await phone.close()
    })

    await step('the night desk keeps the wire grey and visible', async () => {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await page.waitForTimeout(400)
      const bg = await cards().first().evaluate((el) => getComputedStyle(el, '::after').backgroundImage)
      const rgb = greyish(bg, 'the dark wire')
      check(rgb.some(([r]) => r > 110), 'dark wire is too dark to see')
      await shot('04-dark')
    })
  } finally {
    const out = process.env.SPIRAL_SHOTS
    if (out) { mkdirSync(out, { recursive: true }); for (const f of shots) { try { copyFileSync(path.join(work, `${f}.png`), path.join(out, `${f}.png`)) } catch { /* optional */ } } }
    await stack.stop()
  }
  console.log(`\nEND-TO-END PASSED (${results.length} steps). Screenshots: ${work}`)
}

main().catch((e) => { console.log(`\nEND-TO-END FAILED: ${e.message}`); process.exit(1) })

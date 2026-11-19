#!/usr/bin/env node
/**
 * Browser end-to-end for the course-card spiral wire: hovering a card draws the coil down its spine (top to
 * bottom), leaving erases it bottom to top, the card itself does not change, and no hover on touch.
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

async function main() {
  const stack = await startStack({ python: process.env.PYTHON })
  const { web, browser, work } = stack
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const shot = (n) => page.screenshot({ path: path.join(work, `${n}.png`) })
  // How many loops are (mostly) visible, and which ones, right now.
  const visible = (card) => card.evaluate((el) => [...el.querySelectorAll('.card-spiral path')]
    .map((p, i) => ({ i, o: Number(getComputedStyle(p).opacity) })).filter((x) => x.o > 0.5).map((x) => x.i))
  const card = () => page.locator('.course-card').first()
  try {
    await page.goto(web)
    await step('login and open the courses list', async () => {
      await page.getByLabel('E-posta').fill('ayse@knot.local')
      await page.getByLabel('Parola').fill(PASSWORD)
      await page.getByRole('button', { name: 'Giriş yap' }).click()
      await page.getByRole('button', { name: 'Çıkış yap' }).waitFor()
      // The sample stack has one course; more cards are needed to see that every card has its own colour.
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
      await card().waitFor()
      await page.waitForTimeout(900) // let the page entrance animations settle
    })

    await step('at rest there is no spiral and the card is unchanged', async () => {
      check((await visible(card())).length === 0, 'spiral visible without hover')
    })
    const before = await card().boundingBox()
    const cardStyle = await card().evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.borderTopLeftRadius, s.paddingLeft].join('|') })

    await step('hover draws the loops one after another, from the top down', async () => {
      await card().hover()
      await page.waitForTimeout(45)
      const early = await visible(card())
      await page.waitForTimeout(400)
      const full = await visible(card())
      check(full.length === 9, `expected 9 loops after the draw, got ${full.length}`)
      check(early.length < 9, `the draw must be progressive, but ${early.length} loops were already there at 45 ms`)
      check(early.every((v, k) => v === k), `loops must appear from the top: ${early}`)
      await shot('01-hover-full')
    })

    await step('the loops stick out of the card on the left and use the card spine colour', async () => {
      const m = await card().evaluate((el) => {
        const r = el.getBoundingClientRect()
        const paths = [...el.querySelectorAll('.card-spiral path')].map((p) => p.getBoundingClientRect())
        const bar = getComputedStyle(el, '::before').backgroundColor
        return { cardLeft: r.left, minLeft: Math.min(...paths.map((b) => b.left)), maxRight: Math.max(...paths.map((b) => b.right)), stroke: getComputedStyle(el.querySelector('.card-spiral path')).stroke, bar, top: Math.min(...paths.map((b) => b.top)) - r.top, bottom: r.bottom - Math.max(...paths.map((b) => b.bottom)) }
      })
      check(m.minLeft < m.cardLeft - 20, `loops should reach left of the card: ${m.minLeft} vs ${m.cardLeft}`)
      check(m.maxRight <= m.cardLeft + 30, 'loops must end on the spine')
      check(m.stroke === m.bar, `stroke ${m.stroke} must equal the spine ${m.bar}`)
      check(m.top < 14 && m.bottom < 14, `the coil should span the whole spine (top ${m.top}, bottom ${m.bottom})`)
    })

    await step('the card content is untouched by the effect', async () => {
      const after = await card().boundingBox()
      check(Math.abs(after.width - before.width) < 0.5 && Math.abs(after.height - before.height) < 0.5, 'card size changed on hover')
      const style = await card().evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.borderTopLeftRadius, s.paddingLeft].join('|') })
      check(style.split('|')[0] === cardStyle.split('|')[0] && style.split('|')[3] === cardStyle.split('|')[3], `card style changed: ${cardStyle} → ${style}`)
    })

    await step('leaving erases the loops in reverse, from the bottom up', async () => {
      await page.mouse.move(5, 5)
      await page.waitForTimeout(45)
      const early = await visible(card())
      await page.waitForTimeout(400)
      const gone = await visible(card())
      check(gone.length === 0, `all loops must be gone, ${gone.length} left`)
      check(early.length > 0 && early.length < 9, `the erase must be progressive (${early.length} loops at 45 ms)`)
      check(early.every((v, k) => v === k), `the top loops must remain while the bottom ones go first: ${early}`)
    })

    await step('a quick in-and-out does not leave a half-drawn or stuck spiral', async () => {
      for (let k = 0; k < 6; k++) { await card().hover(); await page.waitForTimeout(25); await page.mouse.move(5, 5); await page.waitForTimeout(15) }
      await page.waitForTimeout(500)
      check((await visible(card())).length === 0, 'spiral stuck after fast hover in/out')
      await card().hover(); await page.waitForTimeout(450)
      check((await visible(card())).length === 9, 'spiral did not fully draw after the fast in/out')
      await page.mouse.move(5, 5); await page.waitForTimeout(450)
    })

    await step('each card uses its own spine colour', async () => {
      const colours = await page.locator('.course-card').evaluateAll((els) => els.map((el) => getComputedStyle(el.querySelector('.card-spiral path')).stroke))
      check(colours.length >= 4 && new Set(colours).size === 4, `the first four cards should have four spine colours: ${colours}`)
      await page.locator('.course-card').nth(1).hover(); await page.waitForTimeout(450)
      await shot('02-hover-second-card')
      await page.mouse.move(5, 5)
    })

    await step('keyboard focus draws it too, and the card still opens on click', async () => {
      await page.keyboard.press('Tab')
      for (let k = 0; k < 40 && !(await card().evaluate((el) => el.matches(':has(:focus-visible)'))); k++) await page.keyboard.press('Tab')
      await page.waitForTimeout(450)
      check((await visible(card())).length === 9, 'focus should show the spiral')
      await page.mouse.move(5, 5)
      await card().locator('.course-card-main').click()
      await page.waitForURL((u) => /#\/dersler\/.+\/ogrenme/.test(u.hash), { timeout: 10000 })
    })

    await step('no spiral on a touch device, and none with reduced motion animating', async () => {
      const touch = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
      const t = await touch.newPage()
      await t.goto(web)
      await t.getByLabel('E-posta').fill('ayse@knot.local')
      await t.getByLabel('Parola').fill(PASSWORD)
      await t.getByRole('button', { name: 'Giriş yap' }).click()
      await t.goto(`${web}/#/dersler`)
      await t.locator('.course-card').first().waitFor()
      const display = await t.locator('.card-spiral').first().evaluate((el) => getComputedStyle(el).display)
      check(display === 'none', `touch devices must not get the spiral (display: ${display})`)
      await touch.close()
      const calm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
      const c = await calm.newPage()
      await c.goto(web)
      await c.getByLabel('E-posta').fill('ayse@knot.local')
      await c.getByLabel('Parola').fill(PASSWORD)
      await c.getByRole('button', { name: 'Giriş yap' }).click()
      await c.goto(`${web}/#/dersler`)
      await c.locator('.course-card').first().waitFor()
      const dur = await c.locator('.card-spiral path').first().evaluate((el) => getComputedStyle(el).transitionDuration)
      check(/^0s(, 0s)*$/.test(dur), `reduced motion must not animate (transition-duration: ${dur})`)
      await calm.close()
    })
  } finally {
    try { mkdirSync(process.env.SPIRAL_SHOTS || work, { recursive: true }); if (process.env.SPIRAL_SHOTS) for (const f of ['01-hover-full', '02-hover-second-card']) copyFileSync(path.join(work, `${f}.png`), path.join(process.env.SPIRAL_SHOTS, `${f}.png`)) } catch { /* screenshots are optional */ }
    await stack.stop()
  }
  console.log(`\nEND-TO-END PASSED (${results.length} steps). Screenshots: ${work}`)
}

main().catch((e) => { console.log(`\nEND-TO-END FAILED: ${e.message}`); process.exit(1) })

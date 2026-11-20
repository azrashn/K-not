// Automated accessibility scan (axe-core) of the page the browser is on, in real Chromium so colour
// contrast is measured too. It cannot prove a page is accessible, only find a known class of failures.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Returns the serious and critical violations (impact), each with where it is. */
export async function scan(page) {
  // Route changes fade the page in; measuring colours mid-fade reports text as nearly invisible.
  await page.waitForTimeout(900)
  await page.evaluate((src) => { if (!window.axe) (0, eval)(src) }, AXE_SOURCE)
  const result = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS)
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
      where: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      // For colour contrast: the colours and the ratio axe measured on every failing element.
      colors: v.id === 'color-contrast'
        ? [...new Set(v.nodes.map((n) => { const d = n.any?.[0]?.data || {}; return `${d.fgColor} on ${d.bgColor} = ${d.contrastRatio} (need ${d.expectedContrastRatio}, ${d.fontSize || ''})` }))]
        : undefined,
    }))
}

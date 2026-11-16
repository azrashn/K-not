#!/usr/bin/env node
/**
 * Lists the files under src/ that the running app can never reach from src/main.jsx, so dead screens
 * and mock data are visible instead of being mistaken for the product.
 *
 *   npm run unused:modules            print the list (exit 1 when there are unreachable files with --strict)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const ENTRY = path.join(SRC, 'main.jsx')
const EXT = ['', '.js', '.jsx', '.mjs', '.json', '/index.js', '/index.jsx']
const IMPORT = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const resolve = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec)
  return EXT.map((e) => base + e).find((p) => existsSync(p) && statSync(p).isFile())
}

export function reachable(entry = ENTRY) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file) || !/\.(jsx?|mjs)$/.test(file)) { seen.add(file); continue }
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(IMPORT)) {
      const target = resolve(file, m[1] || m[2])
      if (target && !seen.has(target)) stack.push(target)
    }
  }
  return seen
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const live = reachable()
  const dead = walk(SRC)
    .filter((f) => /\.(jsx?|mjs)$/.test(f) && !live.has(f))
    .map((f) => path.relative(ROOT, f).replaceAll('\\', '/'))
    .sort()
  console.log(dead.length ? `Unreachable from src/main.jsx (${dead.length}):\n  ${dead.join('\n  ')}` : 'Every module under src/ is reachable.')
  if (process.argv.includes('--strict') && dead.length) process.exit(1)
}

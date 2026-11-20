// Answers and questions may contain code and formulas. This turns them into a small tree that React
// renders as elements; nothing is ever inserted as HTML. Unknown markup stays visible as plain text.

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', Theta: 'Θ' }
const SYMBOLS = { cdot: '·', times: '×', div: '÷', pm: '±', leq: '≤', geq: '≥', le: '≤', ge: '≥', neq: '≠', ne: '≠', approx: '≈', to: '→', rightarrow: '→', leftarrow: '←', infty: '∞', sum: 'Σ', prod: '∏', in: '∈', cup: '∪', cap: '∩', subset: '⊂', forall: '∀', exists: '∃', log: 'log', ln: 'ln', sin: 'sin', cos: 'cos', tan: 'tan', lim: 'lim', max: 'max', min: 'min' }

/** Split text into code blocks and paragraphs. A fence that is never closed is plain text. */
export function parseBlocks(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks = []
  let para = []
  const flush = () => { if (para.length) { blocks.push({ type: 'paragraph', text: para.join('\n') }); para = [] } }
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*```\s*([A-Za-z0-9_+#-]*)\s*$/)
    if (open) {
      const close = lines.findIndex((l, j) => j > i && /^\s*```\s*$/.test(l))
      if (close > i) {
        flush()
        blocks.push({ type: 'code', lang: open[1] || '', text: lines.slice(i + 1, close).join('\n') })
        i = close
        continue
      }
    }
    if (lines[i].trim() === '') flush()
    else para.push(lines[i])
  }
  flush()
  return blocks
}

const MATH_HINT = /[A-Za-z\\^_=+\-*/<>(){}]/
function isMath(body, next) {
  return body.length > 0 && body.length <= 200 && !/^\s|\s$/.test(body) && MATH_HINT.test(body) && !/\d/.test(next || '')
}

/** Inline parts: text, `code`, $math$ and \(math\). Money such as "$5 ve $6" is not math. */
export function parseInline(text) {
  const parts = []
  let rest = String(text ?? '')
  const push = (type, value) => { if (value !== '') parts.push(type === 'text' ? { type, text: value } : { type, [type === 'math' ? 'tex' : 'text']: value }) }
  while (rest) {
    const candidates = []
    const code = rest.match(/`([^`\n]+)`/)
    if (code) candidates.push({ at: code.index, len: code[0].length, type: 'code', value: code[1] })
    const paren = rest.match(/\\\((.+?)\\\)/)
    if (paren) candidates.push({ at: paren.index, len: paren[0].length, type: 'math', value: paren[1].trim() })
    const dollar = rest.match(/\$([^$\n]+)\$/)
    if (dollar && isMath(dollar[1], rest[dollar.index + dollar[0].length])) candidates.push({ at: dollar.index, len: dollar[0].length, type: 'math', value: dollar[1] })
    if (!candidates.length) { push('text', rest); break }
    candidates.sort((a, b) => a.at - b.at)
    const c = candidates[0]
    push('text', rest.slice(0, c.at))
    push(c.type, c.value)
    rest = rest.slice(c.at + c.len)
  }
  return parts
}

function group(tex, at) {
  if (tex[at] === '{') {
    let depth = 0
    for (let i = at; i < tex.length; i++) {
      if (tex[i] === '{') depth++
      else if (tex[i] === '}' && --depth === 0) return { body: tex.slice(at + 1, i), next: i + 1 }
    }
    return { body: tex.slice(at + 1), next: tex.length }
  }
  return { body: tex[at] ?? '', next: at + 1 }
}

/** A small LaTeX subset to nodes: {t:'text'|'sup'|'sub'|'sqrt'|'frac'}. Anything else is kept as typed. */
export function parseMath(tex) {
  const nodes = []
  let text = ''
  const flush = () => { if (text) { nodes.push({ t: 'text', v: text }); text = '' } }
  for (let i = 0; i < tex.length;) {
    const c = tex[i]
    if (c === '^' || c === '_') {
      flush()
      const g = group(tex, i + 1)
      nodes.push({ t: c === '^' ? 'sup' : 'sub', v: parseMath(g.body) })
      i = g.next
    } else if (c === '\\') {
      const m = tex.slice(i + 1).match(/^[A-Za-z]+/)
      if (!m) { text += tex[i + 1] ?? '\\'; i += 2; continue }
      const cmd = m[0]
      let next = i + 1 + cmd.length
      if (cmd === 'sqrt') { flush(); const g = group(tex, next); nodes.push({ t: 'sqrt', v: parseMath(g.body) }); i = g.next; continue }
      if (cmd === 'frac') { flush(); const a = group(tex, next), b = group(tex, a.next); nodes.push({ t: 'frac', n: parseMath(a.body), d: parseMath(b.body) }); i = b.next; continue }
      text += GREEK[cmd] ?? SYMBOLS[cmd] ?? '\\' + cmd
      i = next
    } else if (c === '{' || c === '}') {
      i++ // grouping only
    } else {
      text += c
      i++
    }
  }
  flush()
  return nodes
}

// Tahtaya ne yazılır, nasıl çizilir.
// - Basit matematik (=, <, ≤, ⇒, üs, indis) el yazısıyla yazılır: "x^{2} \le 4" → "x² ≤ 4".
// - El yazısıyla yazılamayan (Σ, kesir, integral, kök…) KaTeX ile çizilir.
// - Ham LaTeX ekrana asla çıkmaz.
// - Formül yalnızca tahtadaki notu tekrar etmiyorsa gösterilir.

const SYMBOLS = {
  le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥', ne: '≠', neq: '≠',
  lt: '<', gt: '>', approx: '≈', equiv: '≡', sim: '∼',
  Rightarrow: '⇒', implies: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔',
  rightarrow: '→', to: '→', leftarrow: '←', mapsto: '↦',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', infty: '∞',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  ldots: '…', dots: '…', cdots: '⋯', circ: '∘', degree: '°', partial: '∂', nabla: '∇',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  '{': '{', '}': '}', '%': '%', '&': '&', '#': '#', _: '_', $: '$',
}

// Boşluk ve boyut komutları: içerik taşımaz.
const SPACING = new Set(['left', 'right', 'displaystyle', 'textstyle', 'quad', 'qquad', ',', ';', ':', '!', ' ', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr'])
// Argümanı düz metin olan komutlar.
const TEXT_WRAPPERS = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'mathit', 'mathbf', 'operatorname', 'mbox'])

const SUP = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
  T: 'ᵀ', '*': '*', "'": '′',
}
const SUB = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}

function mapAll(text, table) {
  let out = ''
  for (const ch of text.replace(/\s+/g, '')) {
    const m = table[ch]
    if (m === undefined) return null
    out += m
  }
  return out
}

// `open` konumundaki "{" ile başlayan grup; dengesizse null.
function readGroup(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return { body: s.slice(open + 1, i), end: i + 1 }
    }
  }
  return null
}

// LaTeX'i el yazısı karakterlerine çevirir; elle yazılamayan bir şey varsa (kesir, toplam, kök…) null.
export function texToHandwriting(tex) {
  let out = ''
  let i = 0
  const s = tex
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i))
      if (!m) return null
      const name = m[1]
      i += m[0].length
      if (SPACING.has(name)) {
        if (name === 'quad' || name === 'qquad' || name === ',') out += ' '
        continue
      }
      if (TEXT_WRAPPERS.has(name)) {
        while (s[i] === ' ') i++
        if (s[i] !== '{') return null
        const g = readGroup(s, i)
        if (!g) return null
        const inner = texToHandwriting(g.body)
        if (inner === null) return null
        out += inner
        i = g.end
        continue
      }
      const sym = SYMBOLS[name]
      if (sym === undefined) return null // \frac, \sum, \int, \sqrt…
      out += sym
      // Komut sonrası boşluk yalnızca komutu bitirir ("\pi r" → "πr"); işleçler boşluğunu korur.
      if (/^[A-Za-z]/.test(name) && s[i] === ' ') {
        i++
        if (/[≤≥≠<>≈≡⇒⇐⇔→←·×÷±∈∉⊂⊆∪∩∧∨]/.test(sym)) out += ' '
      }
      continue
    }
    // "snake_case": kelime içindeki alt çizgi indis değil, adın parçası.
    if (ch === '_' && s[i + 1] !== '{' && /[A-Za-z0-9]{2}$/.test(s.slice(0, i))) {
      out += ch
      i++
      continue
    }
    if (ch === '^' || ch === '_') {
      const table = ch === '^' ? SUP : SUB
      let arg
      if (s[i + 1] === '{') {
        const g = readGroup(s, i + 1)
        if (!g) return null
        const inner = texToHandwriting(g.body)
        if (inner === null) return null
        arg = inner
        i = g.end
      } else if (s[i + 1] !== undefined && s[i + 1] !== ' ') {
        arg = s[i + 1]
        i += 2
      } else return null
      const mapped = mapAll(arg, table)
      if (mapped === null) return null
      out += mapped
      continue
    }
    if (ch === '{' || ch === '}' || ch === '$') { i++; continue }
    out += ch
    i++
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

// KaTeX'in okuyamadığı matematik için son çare: komutlar atılır, ham hâli asla gösterilmez.
export function stripTex(tex) {
  const loose = texToHandwriting(tex)
  if (loose !== null) return loose
  return tex
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\prod/g, 'Π')
    .replace(/\\int/g, '∫')
    .replace(/\\lim/g, 'lim')
    .replace(/\\([A-Za-z]+)/g, (_, name) => SYMBOLS[name] ?? '')
    .replace(/\\./g, '')
    .replace(/[{}$]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const isMathWord = (word) => /\\[A-Za-z]|[\^_{}]|^[=<>≤≥≠±+\-−*/·×⇒→]+$/.test(word)

// İki matematik kelimesinin arasında kalıp formüle ait sayılabilen kısa kelime ("x + 1 = 4").
const isMathFiller = (word) => /^[0-9A-Za-z().,|[\]]{1,4}$/.test(word) && !/^[A-Za-zçğıöşüÇĞİÖŞÜ]{3,}$/.test(word)

function braceBalance(word) {
  let d = 0
  for (let i = 0; i < word.length; i++) {
    if (word[i] === '\\') i++
    else if (word[i] === '{') d++
    else if (word[i] === '}') d--
  }
  return d
}

// Bir matematik parçası: elle yazılabiliyorsa metin, değilse KaTeX.
function mathSegment(tex) {
  const hand = texToHandwriting(tex)
  return hand !== null ? { kind: 'text', text: hand } : { kind: 'tex', tex: tex.trim() }
}

// Düz yazı içindeki çıplak LaTeX ("Toplam \sum_{k=0}^{3} k = 6 olur"): matematik kelimeleri gruplanır.
function splitBare(text) {
  const parts = text.split(/(\s+)/)
  const out = []
  let i = 0
  const pushText = (t) => {
    if (!t) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += t
    else out.push({ kind: 'text', text: t })
  }
  while (i < parts.length) {
    const word = parts[i]
    if (!/\S/.test(word) || !isMathWord(word)) {
      pushText(word)
      i++
      continue
    }
    let end = i
    let depth = braceBalance(word)
    let j = i + 1
    while (j < parts.length) {
      const next = parts[j + 1]
      if (next === undefined) break
      if (depth > 0 || isMathWord(next)) {
        depth += braceBalance(next)
        end = j + 1
        j += 2
        continue
      }
      // Ara kelimeler ancak arkasından yine matematik geliyorsa sayılır.
      let k = j + 1
      while (k < parts.length && isMathFiller(parts[k]) && !isMathWord(parts[k])) k += 2
      if (k > j + 1 && k < parts.length && isMathWord(parts[k])) {
        end = k - 2
        j = k - 1
        continue
      }
      // İşleçten hemen sonraki kısa kelime ("= 14").
      if (isMathFiller(next) && /[=<>≤≥≠±+\-−*/·×⇒→]$/.test(parts[end])) {
        end = j + 1
        j += 2
        continue
      }
      break
    }
    let tex = parts.slice(i, end + 1).join('')
    const trail = /[.,;:!?]+$/.exec(tex)?.[0] ?? ''
    if (trail && braceBalance(tex) === 0) tex = tex.slice(0, -trail.length)
    const seg = mathSegment(tex)
    if (seg.kind === 'text') pushText(seg.text)
    else out.push(seg)
    pushText(trail)
    i = end + 1
  }
  return out
}

// Tahta satırı el yazısı ve KaTeX parçalarına bölünür. $…$, \(…\), \[…\] ya da çıplak LaTeX bulunur.
export function boardSegments(text) {
  const out = []
  const pushText = (t) => {
    if (!t) return
    for (const seg of /\\[A-Za-z]|[\^_]/.test(t) ? splitBare(t) : [{ kind: 'text', text: t }]) {
      const last = out[out.length - 1]
      if (seg.kind === 'text' && last?.kind === 'text') last.text += seg.text
      else out.push(seg.kind === 'text' ? { ...seg } : seg)
    }
  }
  const delimited = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g
  let last = 0
  for (let m = delimited.exec(text); m; m = delimited.exec(text)) {
    pushText(text.slice(last, m.index))
    const seg = mathSegment(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '')
    if (seg.kind === 'text') pushText(seg.text)
    else out.push(seg)
    last = m.index + m[0].length
  }
  pushText(text.slice(last))
  return out
}

// Baştaki "1." / "1)" / "Adım 1:" atılır; tahta adımları kendisi numaralar.
export function stripStepNumber(board, index) {
  const n = index + 1
  const re = new RegExp(`^\\s*(?:(?:adım|step)\\s*${n}\\s*[:.)\\-–]|${n}\\s*[.)]|\\(${n}\\))\\s*`, 'i')
  const stripped = board.replace(re, '')
  return stripped.trim() ? stripped : board
}

// Cevap tahtada anlatılabilir mi: steps listesi var ve boş değil.
export const hasSteps = (answer) => Array.isArray(answer?.steps) && answer.steps.length > 0

// Cevaptan gelen adımlar tahtaya hazır: tekrarlanan numara atılır, eksik metin alanları boş olur.
export function boardSteps(steps) {
  return (steps || []).map((s, i) => ({
    ...s,
    board: stripStepNumber(String(s.board ?? ''), i),
    speech: String(s.speech ?? ''),
    sources: Array.isArray(s.sources) ? s.sources : [],
  }))
}

// Karşılaştırma için matematiğin özü: boşluk, \quad, virgül, parantez ve "için" / "for" atılır.
export function mathContent(text) {
  const chars = texToHandwriting(text) ?? stripTex(text)
  return chars
    .toLowerCase()
    .replace(/(^|[^\p{L}])(için|icin|for)(?=$|[^\p{L}])/gu, '$1')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/[\s,;()[\]{}$]/g, '')
}

const formulaParts = (formula) => formula
  .split(/\\(?:implies|Rightarrow|Longrightarrow)(?![A-Za-z])|⇒|=>/)
  .map(mathContent)
  .filter((part) => part.length > 0)

// Notun altında gösterilecek formül ya da null. Formülün her parçası (⇒ ile bölünmüş) tahtada
// zaten varsa formül yalnızca tekrar eder ve gösterilmez.
export function shownFormula(board, formula) {
  const f = formula?.trim()
  if (!f) return null
  if (!board.trim()) return f
  const lines = board.split('\n').map(mathContent).filter(Boolean)
  const whole = mathContent(board.replace(/\n/g, ' '))
  const onBoard = (part) => lines.some((line) => line.includes(part)) || whole.includes(part)
  return formulaParts(f).every(onBoard) ? null : f
}

// Formülün çizimi: el yazısı, KaTeX ya da hiç (bkz. shownFormula).
export function formulaView(board, formula) {
  const f = shownFormula(board, formula)
  if (!f) return null
  const inner = f.replace(/^\$\$?([\s\S]*?)\$?\$$/, '$1').trim()
  return mathSegment(inner)
}

// KaTeX çizemeyen yerler (başlık, özet) için: matematik karakter olarak, ham LaTeX asla.
export function plainMath(text) {
  return boardSegments(text)
    .map((s) => (s.kind === 'text' ? s.text : stripTex(s.tex)))
    .join('')
}

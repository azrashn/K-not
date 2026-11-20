import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { stripTex } from '../../lib/board/content'

// KaTeX ile çizilen matematik. KaTeX okuyamazsa komutlar atılıp kalan el yazısıyla yazılır:
// ham LaTeX asla gösterilmez.
export default function Formula({ tex, display = false }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false })
    } catch {
      return null
    }
  }, [tex, display])
  if (html === null) return <span>{stripTex(tex)}</span>
  // KaTeX girdiyi kaçışlar; trust:false bağlantı ve HTML'i engeller.
  return <span className={display ? 'board-tex-block' : 'board-tex-inline'} dangerouslySetInnerHTML={{ __html: html }} />
}

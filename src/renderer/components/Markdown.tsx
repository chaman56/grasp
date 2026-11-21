import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    return part
  })
}

/** Renders the small markdown subset models produce, as React elements (never raw HTML). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let code: string[] | null = null
  const flushList = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>)
        code = null
      } else {
        flushList()
        code = []
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }
    const heading = /^#{1,6}\s+(.*)/.exec(line)
    const item = /^\s*(?:[-*]|\d+[.)])\s+(.*)/.exec(line)
    if (item?.[1] !== undefined) {
      list.push(item[1])
      continue
    }
    flushList()
    if (heading?.[1] !== undefined) blocks.push(<h4 key={blocks.length}>{inline(heading[1].replace(/\*\*/g, ''))}</h4>)
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
  }
  flushList()
  if (code) blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>)
  return <div className="md">{blocks}</div>
}

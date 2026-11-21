import { useEffect, useRef } from 'react'
import type { DiffLine } from '../../shared/types'

interface Props {
  lines: DiffLine[]
  /** Line range to emphasise and scroll to. */
  focus?: { start: number; end: number }
}

export function CodeLines({ lines, focus }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focus) return
    ref.current?.querySelector(`[data-no="${focus.start}"]`)?.scrollIntoView({ block: 'center' })
  }, [focus?.start, lines])
  return (
    <div className="code" ref={ref}>
      {lines.map((line, i) => {
        const inFocus = focus && line.no !== null && line.no >= focus.start && line.no <= focus.end
        return (
          <div key={i} data-no={line.no ?? undefined} className={`code-line k${line.kind === '+' ? 'add' : line.kind === '-' ? 'del' : 'ctx'}${inFocus ? ' focus' : ''}`}>
            <span className="code-no">{line.no ?? ''}</span>
            <span className="code-sign">{line.kind === ' ' ? '' : line.kind}</span>
            <span className="code-text">{line.text || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

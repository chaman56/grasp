import type { DiffLine, FileEntry, FnNode } from '../../shared/types'
import { CodeLines } from './CodeLines'

interface Props {
  file: FileEntry | undefined
  node: FnNode | null
  lines: DiffLine[] | null
}

export function FileView({ file, node, lines }: Props) {
  if (!file || !node) return <div className="canvas-empty">Select a node to see its file.</div>
  const focus = node.kind === 'function' ? { start: node.startLine, end: node.endLine } : undefined
  return (
    <div className="file-view">
      <div className="file-view-head">
        <span className="mono">{file.path}</span>
        <span className="counts"><span className="add">+{file.added}</span> <span className="del">−{file.removed}</span></span>
      </div>
      {lines ? <CodeLines lines={lines} focus={focus} /> : <div className="skeleton" />}
    </div>
  )
}

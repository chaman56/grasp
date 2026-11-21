import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import type { FnNode } from '../../shared/types'
import { CheckIcon, FlagIcon } from '../icons'
import { CHANGE_LABEL, displayName, type ReviewState } from '../review'
import type { Role } from './stepFlow'

export type CardData = { node: FnNode; role: Role; stepIndex: number | null; review: ReviewState; selected: boolean; showChange: boolean }

function subtitle(node: FnNode, role: Role, stepIndex: number | null): string {
  const file = node.path.split('/').pop() ?? node.path
  if (role === 'context') return `${file} · unchanged`
  if (role === 'elsewhere') return `${file} · step ${(stepIndex ?? 0) + 1}`
  return `${file} · +${node.added} −${node.removed}`
}

export const Card = memo(function Card({ data }: NodeProps<Node<CardData>>) {
  const { node, role, stepIndex, review, selected, showChange } = data
  const classes = ['card', `role-${role}`, `tier-${node.tier}`, `review-${review}`, `change-${node.change}`, selected ? 'selected' : '']
  return (
    <div className={classes.join(' ')} title={`${node.name}\n${node.path}:${node.startLine}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="card-main">
        <span className="card-name mono">{displayName(node)}</span>
        <span className="card-sub">{subtitle(node, role, stepIndex)}</span>
      </div>
      <div className="card-side">
        {role !== 'context' && showChange && <span className={`change-tag ${node.change}`}>{CHANGE_LABEL[node.change]}</span>}
        {review === 'understood' && <span className="card-mark ok"><CheckIcon /></span>}
        {review === 'flagged' && <span className="card-mark flag"><FlagIcon /></span>}
        {review === 'changed' && <span className="card-mark changed" title="Changed since you reviewed it" />}
        {role === 'step' && node.tests === 0 && <span className="card-untested" title="No test calls this">untested</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})

import {
  MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, useStore,
  type Edge as FlowEdge, type Node as FlowNode,
} from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import type { Analysis, Mark, Step } from '../../shared/types'
import { FitIcon, MinusIcon, PlusIcon } from '../icons'
import { reviewState } from '../review'
import { CARD_H, CARD_W, stepFlow } from './stepFlow'
import { Card, type CardData } from './nodes'

const nodeTypes = { card: Card }
const EDGE_COLOR = { added: '#3DD68C', removed: '#FF5C5C', same: '#4A5260' }

interface Props {
  analysis: Analysis
  steps: Step[]
  step: Step
  marks: Record<string, Mark>
  selectedId: string | null
  onSelect(id: string | null): void
}

function useElements({ analysis, steps, step, marks, selectedId }: Props) {
  const flow = useMemo(() => stepFlow(step, steps, analysis), [step, steps, analysis])
  const showChange = analysis.git !== null
  const nodes = useMemo<FlowNode<CardData>[]>(
    () => flow.items.map((item) => ({
      id: item.node.id, type: 'card', position: { x: item.x, y: item.y }, width: CARD_W, height: CARD_H,
      draggable: false, selectable: false,
      data: { ...item, review: reviewState(item.node, marks), selected: item.node.id === selectedId, showChange },
    })),
    [flow, marks, selectedId, showChange],
  )
  const edges = useMemo<FlowEdge[]>(
    () => flow.edges.map((e) => {
      const active = e.from === selectedId || e.to === selectedId
      const color = EDGE_COLOR[e.change]
      return {
        id: `${e.from}>${e.to}`, source: e.from, target: e.to,
        className: `edge-${e.change}${active ? ' active' : ''}`,
        style: { stroke: color, strokeWidth: active ? 2.2 : 1.5, strokeDasharray: e.change === 'removed' ? '6 5' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }
    }),
    [flow, selectedId],
  )
  return { nodes, edges }
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  return (
    <div className="zoom-controls">
      <button className="icon-btn" onClick={() => void zoomOut()} aria-label="Zoom out"><MinusIcon /></button>
      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      <button className="icon-btn" onClick={() => void zoomIn()} aria-label="Zoom in"><PlusIcon /></button>
      <span className="zoom-sep" />
      <button className="icon-btn" onClick={() => void fitView({ duration: 300, padding: 0.15 })} aria-label="Fit to screen"><FitIcon /></button>
    </div>
  )
}

const READABLE_ZOOM = 0.8

// The canvas remounts per step (see `Flow`), so React Flow's initial fit frames the step. After that, selecting
// a card only pans when it is off-screen.
function RevealSelected({ selectedId }: { selectedId: string | null }) {
  const { getInternalNode, setCenter, getViewport } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const node = selectedId ? getInternalNode(selectedId) : undefined
    if (!node || !width) return
    const { x: px, y: py, zoom } = getViewport()
    const cx = node.internals.positionAbsolute.x + CARD_W / 2
    const cy = node.internals.positionAbsolute.y + CARD_H / 2
    const sx = cx * zoom + px
    const sy = cy * zoom + py
    if (sx > CARD_W / 2 && sx < width - CARD_W / 2 && sy > 60 && sy < height - 60) return
    void setCenter(cx, cy, { zoom: Math.max(zoom, READABLE_ZOOM), duration: 300 })
  }, [selectedId, getInternalNode, setCenter, getViewport, width, height])
  return null
}

function Legend({ showChange }: { showChange: boolean }) {
  return (
    <div className="legend">
      {showChange && (
        <>
          <span><i className="line added" />new call</span>
          <span><i className="line removed" />removed call</span>
        </>
      )}
      <span><i className="line same" />{showChange ? 'unchanged call' : 'call'}</span>
      <span><i className="ghost" />unchanged code</span>
      <span className="muted">calls are matched by name</span>
    </div>
  )
}

function Canvas(props: Props) {
  const { nodes, edges } = useElements(props)
  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => node.data.role !== 'context' && props.onSelect(node.id)}
        onPaneClick={() => props.onSelect(null)}
        nodesConnectable={false}
        nodesDraggable={false}
        fitView
        fitViewOptions={{ padding: 0.15, minZoom: READABLE_ZOOM, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <ZoomControls />
        <RevealSelected selectedId={props.selectedId} />
      </ReactFlow>
      <Legend showChange={props.analysis.git !== null} />
    </div>
  )
}

export function Flow(props: Props) {
  return (
    <ReactFlowProvider key={props.step.id}>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

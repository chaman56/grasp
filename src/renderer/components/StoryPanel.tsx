import { useState } from 'react'
import type { Analysis, FnNode, Mark, Provider, Step, Story } from '../../shared/types'
import { lens } from '../api'
import { CheckIcon, SparkIcon } from '../icons'
import { storyPrompt } from '../prompt'
import { changeKey, CHANGE_LABEL, displayName, reviewState, riskiest } from '../review'

interface Props {
  analysis: Analysis
  steps: Step[]
  story: Story | null
  /** A saved story exists, but for an earlier version of the change. */
  storyOutdated: boolean
  marks: Record<string, Mark>
  stepId: string | null
  selectedId: string | null
  provider: Provider | null
  onStep(id: string): void
  onSelect(id: string): void
  onStory(story: Story): void
  onOpenSettings(): void
}

function StoryHeader({ analysis, story, storyOutdated, provider, onStory, onOpenSettings }: Props) {
  const [status, setStatus] = useState<{ running: boolean; error: string | null }>({ running: false, error: null })
  const write = async (): Promise<void> => {
    setStatus({ running: true, error: null })
    const nodeIds = analysis.nodes.map((n) => n.id)
    const result = await lens.story(analysis.root, changeKey(analysis.nodes), nodeIds, storyPrompt(analysis))
    setStatus({ running: false, error: result.ok || result.error === 'cancelled' ? null : result.error })
    if (result.ok) onStory(result.value)
  }
  return (
    <div className="story-head">
      {story ? <p className="story-summary">{story.summary}</p> : (
        <p className="muted small">
          {storyOutdated ? 'The AI story was written for an earlier version of this change. ' : ''}
          Steps are grouped by call graph. An AI story adds a summary and orders the steps for reading.
        </p>
      )}
      {status.running && <p className="ai-waiting">Reading the whole change… this can take a minute on local models.</p>}
      {status.error && <div className="inline-error">{status.error}</div>}
      <div className="story-actions">
        {story && <span className="tag unverified" title="Written by a model from the code. Nothing was executed.">unverified · {story.model}</span>}
        {status.running ? (
          <button className="btn ghost small" onClick={() => void lens.cancelExplain()}>Stop</button>
        ) : provider ? (
          <button className="btn small" onClick={() => void write()} disabled={analysis.nodes.length === 0}>
            <SparkIcon /> {story ? 'Rewrite story' : 'Write story with AI'}
          </button>
        ) : (
          <button className="link" onClick={onOpenSettings}>Add an AI provider for a written story</button>
        )}
      </div>
    </div>
  )
}

function StepNodes({ nodes, marks, selectedId, showChange, onSelect }: { nodes: FnNode[]; marks: Record<string, Mark>; selectedId: string | null; showChange: boolean; onSelect(id: string): void }) {
  return (
    <ul className="step-nodes">
      {nodes.map((n) => (
        <li key={n.id}>
          <button className={`step-node${n.id === selectedId ? ' active' : ''}`} onClick={() => onSelect(n.id)}>
            <i className={`state state-${reviewState(n, marks)}`} />
            <span className="mono">{displayName(n)}</span>
            <span className={`risk-chip tier-${n.tier}`} title={`Risk ${n.risk} of 100`}>{n.risk}</span>
            {showChange && <span className={`change-tag ${n.change}`}>{CHANGE_LABEL[n.change]}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function StoryPanel(props: Props) {
  const { analysis, steps, marks, stepId } = props
  const byId = new Map(analysis.nodes.map((n) => [n.id, n]))
  return (
    <nav className="story">
      <div className="panel-head">
        <h2>Walkthrough</h2>
        <span className="muted small">{steps.length} steps</span>
      </div>
      <StoryHeader {...props} />
      <ol className="steps">
        {steps.map((step, i) => {
          const nodes = step.nodeIds.flatMap((id) => byId.get(id) ?? [])
          const done = nodes.filter((n) => reviewState(n, marks) === 'understood').length
          const top = riskiest(nodes)
          const open = step.id === stepId
          return (
            <li key={step.id} className={`step${open ? ' open' : ''}${done === nodes.length ? ' done' : ''}`}>
              <button className="step-row" onClick={() => props.onStep(step.id)}>
                <span className="step-index">{done === nodes.length ? <CheckIcon /> : i + 1}</span>
                <span className="step-text">
                  <span className="step-title">{step.title}</span>
                  {step.why && <span className="step-why">{step.why}</span>}
                </span>
                {top && <span className={`risk-chip step-risk tier-${top.tier}`} title={`Highest risk ${top.risk} of 100`}>{top.risk}</span>}
                <span className="step-count mono">{done}/{nodes.length}</span>
              </button>
              {open && <StepNodes nodes={nodes} marks={marks} selectedId={props.selectedId} showChange={analysis.git !== null} onSelect={props.onSelect} />}
            </li>
          )
        })}
        {steps.length === 0 && <li className="muted small step-empty">No changes to walk through.</li>}
      </ol>
    </nav>
  )
}

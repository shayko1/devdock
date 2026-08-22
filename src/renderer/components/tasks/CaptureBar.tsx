import { useMemo, useState } from 'react'
import { parseTaskInput, type ParsedTask } from '../../../shared/task-parse'

interface Props {
  onCapture: (parsed: ParsedTask, rawText: string) => void
}

function describeParsed(parsed: ParsedTask): string {
  const parts: string[] = [`P${parsed.priority}`]
  if (parsed.estimateMinutes) parts.push(`${parsed.estimateMinutes}m`)
  if (parsed.scheduleAt) parts.push(new Date(parsed.scheduleAt).toLocaleString())
  else if (parsed.dueAt) parts.push(`due ${new Date(parsed.dueAt).toLocaleDateString()}`)
  return parts.join(' · ')
}

export function CaptureBar({ onCapture }: Props) {
  const [text, setText] = useState('')

  // Reparsed on every keystroke so the hint reflects exactly what would be saved.
  const parsed = useMemo(() => parseTaskInput(text, Date.now()), [text])

  const submit = () => {
    if (!parsed.title.trim()) return
    onCapture(parsed, text)
    setText('')
  }

  return (
    <div className="tasks-capture">
      <input
        className="tasks-capture-input"
        placeholder="Add a task —  p1 Review deck tomorrow 2pm 45m"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') setText('')
        }}
      />
      {text.trim() && (
        <span className="tasks-capture-hint" data-testid="capture-hint">
          {describeParsed(parsed)}
        </span>
      )}
    </div>
  )
}

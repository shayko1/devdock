import type { StaleBlock } from '../../../shared/task-rollover'

export type SweepAction = 'rollover' | 'done' | 'drop'

interface Props {
  items: StaleBlock[]
  pushCounts: Record<string, number>
  onApply: (item: StaleBlock, action: SweepAction) => void
  onClose: () => void
}

export function SweepModal({ items, pushCounts, onApply, onClose }: Props) {
  return (
    <div className="sweep-overlay" role="dialog" aria-label="Unfinished work">
      <div className="sweep-modal">
        <div className="sweep-modal-header">
          <span>Unfinished work</span>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sweep-modal-body">
          {items.length === 0 && <div className="sweep-empty">Nothing left hanging.</div>}

          {items.map(item => (
            <div className="sweep-row" key={item.block.id}>
              <div className="sweep-row-info">
                <div className="sweep-row-title">{item.task.title}</div>
                <div className="sweep-row-meta">
                  was {new Date(item.block.startsAt).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {pushCounts[item.block.id] > 0 && (
                    <span className="sweep-pushed"> · pushed ×{pushCounts[item.block.id]}</span>
                  )}
                </div>
              </div>
              <div className="sweep-row-actions">
                <button type="button" onClick={() => onApply(item, 'rollover')}>
                  Roll over
                </button>
                <button type="button" onClick={() => onApply(item, 'done')}>Done</button>
                <button type="button" onClick={() => onApply(item, 'drop')}>Drop</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

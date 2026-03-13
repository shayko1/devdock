import React, { useState, useRef, KeyboardEvent } from 'react'
import { Project } from '../../shared/types'

interface Props {
  project: Project
  onSave: (project: Project) => void
  onClose: () => void
  onDelete: (projectId: string) => void
}

export function EditProjectModal({ project, onSave, onClose, onDelete }: Props) {
  const [form, setForm] = useState({ ...project })
  const [tagInput, setTagInput] = useState('')
  const formRef = useRef(form)
  formRef.current = form
  const tagInputRef = useRef(tagInput)
  tagInputRef.current = tagInput

  const addTag = (input: string) => {
    const tag = input.trim()
    if (tag && !formRef.current.tags.includes(tag)) {
      const updated = { ...formRef.current, tags: [...formRef.current.tags, tag] }
      setForm(updated)
      formRef.current = updated
    }
    setTagInput('')
    tagInputRef.current = ''
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    }
    if (e.key === 'Backspace' && tagInput === '' && form.tags.length > 0) {
      setForm({ ...form, tags: form.tags.slice(0, -1) })
    }
  }

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) })
  }

  const handleSave = () => {
    // Auto-add any pending tag text before saving
    if (tagInputRef.current.trim()) {
      addTag(tagInputRef.current)
    }
    // Use formRef to get the absolute latest state (including just-added tag)
    onSave(formRef.current)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Project</h2>

        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-input form-textarea"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What does this project do?"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Tags (press Enter to add)</label>
          <div className="tag-input-container">
            {form.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
                <span className="tag-chip-remove" onClick={() => removeTag(tag)}>x</span>
              </span>
            ))}
            <input
              className="tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => { if (tagInput.trim()) addTag(tagInput) }}
              placeholder={form.tags.length === 0 ? 'Add tags...' : ''}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Run Command</label>
          <input
            className="form-input"
            value={form.runCommand}
            onChange={(e) => setForm({ ...form, runCommand: e.target.value })}
            placeholder="npm run dev"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Port</label>
          <input
            className="form-input"
            type="number"
            value={form.port ?? ''}
            onChange={(e) => setForm({ ...form, port: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="3000"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Path</label>
          <input className="form-input" value={form.path} disabled style={{ opacity: 0.6 }} />
        </div>

        <div className="form-group">
          <label className="form-label">
            <input
              type="checkbox"
              checked={form.hidden}
              onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
              style={{ marginRight: 8 }}
            />
            Hidden (won't show in main view)
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => onDelete(project.id)}>
            Remove
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

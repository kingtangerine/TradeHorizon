import { useEffect, useState } from 'react'

/** Text field that commits on Enter or blur, so typing does not create one undo step per key. */
export function CommittedTextInput({ value, onCommit, label }: { value: string; onCommit(value: string): void; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className="toolbar-text-input"
      aria-label={label}
      placeholder={label}
      value={draft}
      maxLength={200}
      autoFocus={value === 'Text'}
      onFocus={(event) => {
        if (value === 'Text') event.currentTarget.select()
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          commit()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

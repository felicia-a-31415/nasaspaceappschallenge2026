import { useEffect, useRef, useState } from 'react'
import { viewUrl } from '../hooks/useView'
import type { View } from '../view'

/**
 * Copies a link that opens the page on this place, circle, period and view. Where the
 * browser will not copy for us, the link is shown, selected, to copy by hand.
 */
export function CopyLink({ view }: { view: View }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2400)
    return () => clearTimeout(timer)
  }, [state])

  // A link shown for copying by hand is out of date as soon as the view moves on.
  useEffect(() => { setState((s) => (s === 'manual' ? 'idle' : s)) }, [view])

  useEffect(() => {
    if (state === 'manual') field.current?.select()
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(viewUrl(view))
      setState('copied')
    } catch {
      setState('manual')
    }
  }

  return (
    <div className="copy-link">
      <button type="button" className="quiet" onClick={copy} title="Copy a link to this place, circle, period and view">
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      <span className="visually-hidden" role="status">{state === 'copied' ? 'Link copied' : ''}</span>
      {state === 'manual' && (
        <input
          ref={field} type="text" readOnly value={viewUrl(view)}
          aria-label="Link to this view. Copy it by hand."
          onFocus={(e) => e.target.select()}
        />
      )}
    </div>
  )
}

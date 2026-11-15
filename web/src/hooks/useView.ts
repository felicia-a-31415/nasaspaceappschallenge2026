import { useCallback, useEffect, useState } from 'react'
import { parseView, serializeView } from '../view'
import type { View } from '../view'

/** How long the view must sit still before the address is rewritten. */
const SETTLE_MS = 250

/** The address a view would have, for the "copy link" control. */
export function viewUrl(view: View): string {
  const query = serializeView(view)
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ''}`
}

/**
 * The view, mirrored in the address bar. Opening a link restores it. A change replaces
 * the current history entry rather than adding one, so dragging a slider does not fill
 * the back button; and it waits for the view to settle, because browsers refuse an
 * address rewritten a hundred times in a few seconds.
 */
export function useView(): [View, (patch: Partial<View>) => void] {
  const [view, setView] = useState<View>(() => parseView(window.location.search))

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = serializeView(view)
      const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', next)
      }
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [view])

  const update = useCallback((patch: Partial<View>) => {
    setView((current) => {
      const next = { ...current, ...patch }
      // The same view again is not a change, so nothing downstream re-asks the server.
      return serializeView(next) === serializeView(current) && next.lat === current.lat && next.lon === current.lon
        ? current
        : next
    })
  }, [])

  return [view, update]
}

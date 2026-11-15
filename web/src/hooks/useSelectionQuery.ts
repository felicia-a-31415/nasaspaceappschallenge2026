import { useEffect, useState } from 'react'
import { ApiRequestError } from '../api'

export type QueryState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; detail: string }

/**
 * Ask an endpoint about the current selection. Waits for the selection to settle before
 * asking, and ignores the answer to any request that is no longer the latest, so dragging
 * the slider cannot leave older numbers on the screen.
 */
export function useSelectionQuery<K, T>(
  key: K | null,
  run: (key: K, signal: AbortSignal) => Promise<T>,
  settleMs = 300,
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ status: 'idle' })

  useEffect(() => {
    if (key === null) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    let live = true
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
    const timer = setTimeout(() => {
      run(key, controller.signal)
        .then((data) => { if (live) setState({ status: 'ready', data }) })
        .catch((error: unknown) => {
          if (!live || controller.signal.aborted) return
          setState({
            status: 'error',
            detail: error instanceof ApiRequestError
              ? error.detail
              : 'The server did not answer. Try again in a moment.',
          })
        })
    }, settleMs)

    return () => {
      live = false
      clearTimeout(timer)
      controller.abort()
    }
    // `run` is stable by construction (a module-level function).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, settleMs])

  return state
}

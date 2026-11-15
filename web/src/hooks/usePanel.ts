import { useEffect, useState } from 'react'
import { ApiRequestError, getActivity, getOutlook, getStats } from '../api'
import type { ActivityResponse, OutlookResponse, Selection, StatsResponse } from '../types'

/** One endpoint's answer, or the sentence to show in its place. */
export type Part<T> = { ok: true; data: T } | { ok: false; detail: string }

export interface PanelAnswer {
  /** The place these numbers are for, so a new place is never shown old numbers. */
  place: string
  activity: Part<ActivityResponse>
  stats: Part<StatsResponse>
  outlook: Part<OutlookResponse>
}

export interface PanelState {
  /** Null until the first answer for this place: the panel shows its skeleton. */
  answer: PanelAnswer | null
  /** A newer question is out. The last answer for this place stays up meanwhile. */
  pending: boolean
}

const SETTLE_MS = 300
/** A place outside Quebec is fetched by the server on demand; this is how often to look. */
const FETCH_POLL_MS = 2000

export function placeKey(selection: { lat: number; lon: number }): string {
  return `${selection.lat},${selection.lon}`
}

function part<T>(request: Promise<T>): Promise<Part<T>> {
  return request.then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({
      ok: false as const,
      detail: error instanceof ApiRequestError
        ? error.detail
        : 'The server did not answer. Try again in a moment.',
    }),
  )
}

/**
 * Everything the panel says about a place, asked together and shown together. The three
 * answers land as one, so the panel changes once instead of section by section. It waits
 * for the selection to settle before asking, and an answer to a question that is no
 * longer the latest is dropped.
 */
export function usePanel(selection: Selection | null): PanelState {
  const [state, setState] = useState<PanelState>({ answer: null, pending: false })

  useEffect(() => {
    if (!selection) {
      setState({ answer: null, pending: false })
      return
    }
    const place = placeKey(selection)
    const controller = new AbortController()
    let live = true
    let timer: ReturnType<typeof setTimeout>

    setState((current) => ({
      answer: current.answer?.place === place ? current.answer : null,
      pending: true,
    }))

    const ask = async () => {
      const [activity, stats, outlook] = await Promise.all([
        part(getActivity(selection, controller.signal)),
        part(getStats(selection, controller.signal)),
        part(getOutlook(selection, controller.signal)),
      ])
      if (!live) return
      setState({ answer: { place, activity, stats, outlook }, pending: false })
      // Still being fetched from NASA: keep looking until it arrives.
      if (activity.ok && (activity.data.coverage === 'queued' || activity.data.coverage === 'fetching')) {
        timer = setTimeout(ask, FETCH_POLL_MS)
      }
    }
    timer = setTimeout(ask, SETTLE_MS)

    return () => {
      live = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [selection])

  return state
}

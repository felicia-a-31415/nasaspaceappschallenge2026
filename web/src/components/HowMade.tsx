import { useEffect, useRef } from 'react'

/**
 * "How this tool was made": who built it, how AI was used, and which NASA data it rests on.
 * The Space Apps rules ask every project to declare its use of AI and to link the NASA data
 * it uses. It opens upward from the status strip; Escape or a click elsewhere closes it.
 */
export function HowMade() {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current
      if (!el?.open) return
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !el.contains(event.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  return (
    <details ref={ref} className="howmade">
      <summary>How this tool was made</summary>
      <div className="howmade-panel">
        <h2>How this tool was made</h2>
        <p>
          This tool was built for the 2026 NASA Space Apps Challenge (Montréal local event, 14–15 November 2026),
          in answer to the challenge <i>Harmonization of MODIS and VIIRS Hot Spots</i>. It is the work of
          Felicia Aung, a first-year student at Marianopolis College, and Dennis Xue, a Secondary 5 student at
          Collège Jean-de-Brébeuf, in an iterative collaboration with Claude (Anthropic), an AI assistant.
        </p>
        <p>
          The problem, the approach to harmonizing the two sensors, the features, the design and the
          editorial choices were defined, questioned and refined by Felicia and Dennis at every step. Claude
          generated code, proposed wording and flagged inconsistencies, but every substantive decision was
          made by a human, and every result was checked by the team.
        </p>
        <p>
          This is not one-shot AI-generated content. It is the result of an extended working dialogue: each
          change was read, tested, critiqued and corrected.
        </p>
        <p>
          <b>Declared use of AI</b>: Claude (Anthropic) was used as a coding and writing assistant. It did not
          produce or alter any of the fire data; every detection shown comes unchanged from NASA's records.
        </p>
        <p>
          <b>NASA data</b>: active fire detections from{' '}
          <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a>{' '}
          (MODIS Collection 6.1; VIIRS 375 m on Suomi NPP and NOAA-20), and satellite imagery from{' '}
          <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a>.
        </p>
        <p>
          <b>Thoughtful use of AI</b>: generative AI is a working tool, not a substitute for judgment. In this
          project the humans remain the authors: AI amplified what two students could build in a weekend, but
          responsibility for the science, the design and the conclusions remains entirely ours.
        </p>
        <p className="howmade-foot">Last updated: November 2026.</p>
      </div>
    </details>
  )
}

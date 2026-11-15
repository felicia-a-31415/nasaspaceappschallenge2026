/**
 * In development the mocks are on unless they are switched off, because they need no
 * server at all:
 *
 *     VITE_USE_MOCKS=false npm run dev     # against the real server
 *
 * A production build is the opposite: it is the page the server itself serves, so it
 * talks to the real endpoints unless mocks are asked for explicitly.
 */
export const USE_MOCKS = import.meta.env.DEV
  ? (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'
  : import.meta.env.VITE_USE_MOCKS === 'true'

/**
 * The page talks to the real server, in development as in a production build. In
 * development `/api` is proxied to http://localhost:8000, so start the server first.
 *
 * The mocks answer from a 20 MB sample and need no server, but their numbers are not the
 * record's and they carry no spread model, so they are only used when asked for:
 *
 *     VITE_USE_MOCKS=true npm run dev
 */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

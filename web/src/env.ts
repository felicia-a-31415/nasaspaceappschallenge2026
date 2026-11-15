/**
 * Mocks are on unless they are explicitly switched off, because the planned endpoints
 * are not live yet. Run against the real server with:
 *
 *     VITE_USE_MOCKS=false npm run dev
 */
export const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false'

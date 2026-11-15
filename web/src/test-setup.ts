// Minimal browser bits jsdom lacks and the components touch.
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
}

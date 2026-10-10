import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia; the design tokens query it at module scope in some
// browsers. Provide a minimal stub so component tests are not environment-bound.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
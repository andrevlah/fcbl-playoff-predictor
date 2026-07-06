// Re-export of the canonical simulation engine in docs/js/sim.js.
// The canonical file lives under docs/ because GitHub Pages can only serve
// that folder to the browser Web Worker; this shim keeps the documented repo
// layout (src/sim.js) working for the Node scraper with zero duplication.
// One file, one set of math — server and client can never drift apart.
export * from "../docs/js/sim.js";

// Re-export of the canonical config in docs/js/teams.js.
// The canonical file lives under docs/ because GitHub Pages can only serve
// that folder to the browser; this shim keeps the documented repo layout
// (config/teams.js) working for the Node scraper with zero duplication.
export * from "../docs/js/teams.js";

// Web Worker: runs the exact same simulation engine as the server, off the
// main thread so the dials feel instant.
import { simulate } from "./sim.js?v=7";

self.onmessage = (e) => {
  const { id, payload } = e.data;
  const t0 = performance.now();
  try {
    const out = simulate(payload);
    self.postMessage({ id, out, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

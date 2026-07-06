// Polite HTTP fetcher: identifies itself, never exceeds 1 request/second,
// retries 3 times with exponential backoff.

const USER_AGENT =
  "FCBL-Playoff-Predictor/1.0 (Lowell Spinners fan project; contact: vlahakis.a@husky.neu.edu)";

const MIN_INTERVAL_MS = 1100; // a hair over 1s to stay comfortably polite
let lastRequestAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url, { tries = 3 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 500) throw new Error(`suspiciously short response (${text.length} bytes)`);
      return text;
    } catch (err) {
      console.warn(`  fetch attempt ${attempt}/${tries} failed for ${url}: ${err.message}`);
      if (attempt === tries) throw new Error(`giving up on ${url}: ${err.message}`);
      // 403/405/429 are the site's rate-limiter talking (e.g. two update runs
      // landing close together); give it a real cool-down, not seconds
      const rateLimited = /HTTP (403|405|429)/.test(err.message);
      await sleep(rateLimited ? 45000 * attempt : 2000 * 2 ** (attempt - 1));
    }
  }
}

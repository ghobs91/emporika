// ── Provider harness (development only) ────────────────────────────────
//
// The MV3 service worker cannot use dynamic `import()`, and it cannot
// message itself, which makes the usual "test it from the SW console"
// advice impossible. This page is a normal extension document: static ESM
// imports work, host permissions apply, and CORS is bypassed exactly as it
// is for the worker.
//
// Open it from the toolbar button (`chrome.action` → debug.html).

import * as backmarket from './providers/backmarket.js';

const PROVIDERS = { backmarket };

const output = document.getElementById('output');
const queryInput = document.getElementById('query');

function show(title, payload) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;

  const pre = document.createElement('pre');
  pre.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

  section.append(heading, pre);
  output.prepend(section);
}

function currentQuery() {
  return queryInput.value.trim() || 'iphone 15';
}

async function runSearch(providerId) {
  const provider = PROVIDERS[providerId];
  const query = currentQuery();
  const started = performance.now();

  try {
    const products = await provider.search(query);
    const elapsed = Math.round(performance.now() - started);

    if (!products.length) {
      show(
        `${providerId} · search("${query}") · 0 products in ${elapsed}ms`,
        'Fetch succeeded but nothing was parsed. Run the capture button and paste the result.'
      );
      return;
    }

    show(`${providerId} · search("${query}") · ${products.length} products in ${elapsed}ms`, products);
  } catch (error) {
    show(`${providerId} · search("${query}") failed after ${Math.round(performance.now() - started)}ms`, String(error));
  }
}

async function runCapture(providerId) {
  const provider = PROVIDERS[providerId];
  if (typeof provider.capture !== 'function') {
    show(`${providerId} · capture unavailable`, 'This provider module does not export capture().');
    return;
  }

  try {
    show(`${providerId} · capture("${currentQuery()}")`, await provider.capture(currentQuery()));
  } catch (error) {
    show(`${providerId} · capture failed`, String(error));
  }
}

for (const button of document.querySelectorAll('[data-run]')) {
  button.addEventListener('click', () => runSearch(button.dataset.run));
}

for (const button of document.querySelectorAll('[data-capture]')) {
  button.addEventListener('click', () => runCapture(button.dataset.capture));
}

// Saves the raw response so a sample can be inspected offline — the most
// reliable way to correct a parser, since it is the real markup rather than
// a summary of it.
async function saveRaw(providerId) {
  const provider = PROVIDERS[providerId];
  if (typeof provider.raw !== 'function') {
    show(`${providerId} · save unavailable`, 'This provider module does not export raw().');
    return;
  }

  try {
    const { status, finalUrl, html } = await provider.raw(currentQuery());
    const url = URL.createObjectURL(new Blob([html], { type: 'text/plain' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${providerId}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    show(`${providerId} · saved ${html.length} bytes (HTTP ${status})`, finalUrl);
  } catch (error) {
    show(`${providerId} · save failed`, String(error));
  }
}

for (const button of document.querySelectorAll('[data-save]')) {
  button.addEventListener('click', () => saveRaw(button.dataset.save));
}

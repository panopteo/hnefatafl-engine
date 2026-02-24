#!/usr/bin/env node
/*
  Headless regression runner for hnefatafl-engine.
  - Evaluates the main UI script from index.html in a Node VM context.
  - Stubs DOM/engineManager to avoid browser dependencies.
  - Executes regressionScenarios() and reports failures.

  Usage:
    node tools/run-regressions.js
*/

const fs = require('fs');
const vm = require('vm');

function extractScripts(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
}

function makeDomStubs() {
  const makeClassList = () => ({ add() {}, remove() {}, toggle() {} });
  const makeEl = () => ({
    textContent: '',
    value: '',
    checked: false,
    style: {},
    dataset: {},
    classList: makeClassList(),
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {}
  });

  return {
    document: {
      getElementById() { return makeEl(); },
      querySelector() { return makeEl(); },
      querySelectorAll() { return []; },
      createElement() { return makeEl(); },
      body: makeEl()
    },
    navigator: { clipboard: null },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    alert() {},
    confirm() { return false; },
    prompt() { return null; }
  };
}

function run() {
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = extractScripts(html);
  if (scripts.length < 2) {
    console.error('Expected at least 2 <script> tags (worker + UI). Found:', scripts.length);
    process.exit(2);
  }

  // scripts[0] is worker source (type=javascript/worker); scripts[1] is UI source.
  const uiScript = scripts[1];

  class DummyWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage() {
      // No-op: regressions are pure and do not require engine worker responses.
    }
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Blob: class Blob { constructor() {} },
    URL: { createObjectURL() { return 'blob:dummy'; }, revokeObjectURL() {} },
    crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0; return arr; } },
    Worker: DummyWorker,
    ...makeDomStubs()
  };
  // Browser code expects window.*
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);

  // Evaluate the UI script.
  vm.runInContext(uiScript, ctx, { filename: 'index.html(ui)' });

  // Execute regressionScenarios() inside the VM so we can access lexical bindings.
  const result = vm.runInContext(`(() => {
    if (typeof regressionScenarios !== 'function') {
      return { ok: false, error: 'regressionScenarios not found' };
    }
    const scenarios = regressionScenarios();
    const failures = [];
    for (const t of scenarios) {
      try {
        if (!t.run()) failures.push(t.name);
      } catch (e) {
        failures.push(t.name + ': ' + (e && e.message ? e.message : String(e)));
      }
    }
    return { ok: failures.length === 0, failures, count: scenarios.length };
  })()`, ctx);

  if (!result || result.ok !== true) {
    const list = result?.failures?.length ? result.failures.join('\n- ') : (result?.error || 'unknown');
    console.error('Regression failures:', '\n- ' + list);
    process.exit(1);
  }

  console.log(`OK: ${result.count} regressions passed`);
}

run();

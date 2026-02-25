#!/usr/bin/env node
/*
  Headless regression runner for hnefatafl-engine.
  - Evaluates the main UI script from index.html in a Node VM context.
  - Stubs DOM/Worker/URL/Blob/window to avoid browser dependencies.
  - Executes regressionScenarios() and reports failures.

  Usage:
    node tools/run-regressions.js
    node tools/run-regressions.js --list
    node tools/run-regressions.js --filter "Alex"
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

function parseArgs(argv) {
  const args = { list: false, filter: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--filter') args.filter = argv[++i] ?? '';
    else {
      console.error('Unknown arg:', a);
      process.exit(2);
    }
  }
  return args;
}

function run() {
  const args = parseArgs(process.argv);

  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = extractScripts(html);
  if (scripts.length < 2) {
    console.error('Expected at least 2 <script> tags (worker + UI). Found:', scripts.length);
    process.exit(2);
  }

  // scripts[0] is worker source (type=javascript/worker); scripts[1] is UI source.
  const workerScript = scripts[0];
  const uiScript = scripts[1];

  class DummyWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage() {
      // No-op: headless regressions run pure helpers and do not require engine searches.
    }
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }

  // --- Worker self-tests (rule parity guardrail) ---
  {
    const posted = [];
    const workerSandbox = {
      console,
      setTimeout,
      clearTimeout,
      performance: { now: () => Date.now() },
      crypto: { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0; return arr; } },
      self: {
        postMessage: (msg) => posted.push(msg),
        onmessage: null
      }
    };
    const workerCtx = vm.createContext(workerSandbox);
    vm.runInContext(workerScript, workerCtx, { filename: 'index.html(worker)' });
    if (typeof workerSandbox.self.onmessage !== 'function') {
      console.error('Worker self-test failed: self.onmessage not installed');
      process.exit(1);
    }
    workerSandbox.self.onmessage({ data: { type: 'SELF_TEST', id: 'node-regressions' } });
    const resultMsg = posted.find(m => m && m.type === 'SELF_TEST_RESULT');
    if (!resultMsg) {
      console.error('Worker self-test failed: no SELF_TEST_RESULT posted');
      process.exit(1);
    }
    if (resultMsg.error) {
      console.error('Worker self-test failed:', resultMsg.error);
      process.exit(1);
    }
    if (!resultMsg.payload || resultMsg.payload.ok !== true) {
      const failures = resultMsg.payload?.failures?.length ? resultMsg.payload.failures.join('\n- ') : 'unknown';
      console.error('Worker self-test failures:', '\n- ' + failures);
      process.exit(1);
    }
  }

  // --- UI regressions ---
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

  // Pass args into the VM context.
  sandbox.__RUNREG_LIST = args.list;
  sandbox.__RUNREG_FILTER = args.filter;

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

    // Optional args passed via global.
    const __list = !!globalThis.__RUNREG_LIST;
    const __filter = (typeof globalThis.__RUNREG_FILTER === 'string') ? globalThis.__RUNREG_FILTER : null;

    const selected = __filter
      ? scenarios.filter(t => String(t.name).toLowerCase().includes(__filter.toLowerCase()))
      : scenarios;

    if (__list) {
      return { ok: true, list: scenarios.map(t => t.name), count: scenarios.length };
    }

    if (__filter && selected.length === 0) {
      return { ok: false, error: 'No regressions match filter: ' + __filter };
    }

    for (const t of selected) {
      try {
        if (!t.run()) failures.push(t.name);
      } catch (e) {
        failures.push(t.name + ': ' + (e && e.message ? e.message : String(e)));
      }
    }
    return { ok: failures.length === 0, failures, count: selected.length, total: scenarios.length };
  })()`, ctx);

  if (!result || result.ok !== true) {
    const list = result?.failures?.length ? result.failures.join('\n- ') : (result?.error || 'unknown');
    console.error('Regression failures:', '\n- ' + list);
    process.exit(1);
  }

  if (result.list) {
    result.list.forEach(name => console.log(name));
    return;
  }

  const total = (typeof result.total === 'number') ? `/${result.total}` : '';
  console.log(`OK: ${result.count}${total} regressions passed`);
}

run();

/**
 * Loader for the two CLASSIC scripts (js/reminder-core.js, js/plan-store.js).
 *
 * They are IIFEs that attach to globalThis because the service worker has to
 * importScripts() them, and workers cannot use ES modules. Node's test runner
 * cannot import those directly, so we evaluate them in a sandbox with a fake
 * globalThis instead.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/**
 * Evaluate a classic script and return whatever it attached to globalThis.
 * @param {string} relativePath e.g. 'js/reminder-core.js'
 * @param {object} [extraGlobals] values to expose (e.g. a fake indexedDB)
 */
export function loadClassic(relativePath, extraGlobals = {}) {
  const code = readFileSync(join(root, relativePath), 'utf8');
  const sandbox = Object.create(null);
  Object.assign(sandbox, extraGlobals);
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relativePath });
  return sandbox;
}

/** The reminder rules, as the page and the service worker both see them. */
export function loadReminderCore() {
  return loadClassic('js/reminder-core.js').PlanReminderCore;
}

/** The IndexedDB wrapper. Pass a fake indexedDB via extraGlobals to test it. */
export function loadPlanStore(fakeIndexedDB) {
  return loadClassic('js/plan-store.js', fakeIndexedDB ? { indexedDB: fakeIndexedDB } : {}).PlanStore;
}

export { root };

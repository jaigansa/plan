/**
 * Storage layer tests, run against real localStorage and real IndexedDB.
 *
 * These cover the promise the app makes to the user: clearing site data must
 * not lose the boards, and writes must not disappear silently. The cloud itself
 * is out of scope here; the merge decision is covered in sync-merge.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import 'fake-indexeddb/auto';

/** A localStorage that behaves like the browser one. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * storage.js is a real ES module, so it is imported rather than sandboxed. Its
 * browser globals are read at construction time, which makes injecting them
 * around the import straightforward.
 */
let cacheBuster = 0;
async function loadStorageClass() {
  const mod = await import('../js/storage.js?case=' + (cacheBuster += 1));
  return mod.StorageManager;
}

function installGlobals() {
  const listeners = { window: {}, document: [] };
  const localStorage = new MemoryStorage();

  globalThis.localStorage = localStorage;
  globalThis.self = globalThis;
  globalThis.window = {
    addEventListener(t, f) { listeners.window[t] = f; },
    removeEventListener() {},
    dispatchEvent() { return true; }
  };
  globalThis.document = {
    addEventListener(t, f) { listeners.document.push([t, f]); },
    visibilityState: 'visible'
  };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

  // plan-store.js is a classic script (the service worker importScripts()s it),
  // so it has to be evaluated rather than imported.
  vm.runInThisContext(readFileSync(join(root, 'js/plan-store.js'), 'utf8'), {
    filename: 'js/plan-store.js'
  });

  return { localStorage, listeners };
}

async function wipeDb() {
  await new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase('plan-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

const BOARDS_KEY = 'kanban_boards_v2';
const ACTIVE_KEY = 'kanban_active_board_v2';
const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** A fresh StorageManager over a clean database. */
async function freshStart() {
  await wipeDb();
  const env = installGlobals();
  const StorageManager = await loadStorageClass();
  const manager = new StorageManager();
  await wait(80);
  return { manager, env, StorageManager };
}

/** Throw away localStorage and boot again, as if site data was cleared. */
async function restartCleared() {
  globalThis.localStorage.clear();
  const StorageManager = await loadStorageClass();
  const manager = new StorageManager();
  await wait(80);
  return { manager, env: { localStorage: globalThis.localStorage }, StorageManager };
}

test('a fresh install gets a board and persists it', async () => {
  const { manager, env } = await freshStart();
  assert.ok(manager.getData(), 'a board exists immediately');
  await wait();
  assert.ok(env.localStorage.getItem(BOARDS_KEY), 'the default board gets written');
});

test('the default board has the Plan/Progress/Done/Drop columns and no default cards', async () => {
  const { manager } = await freshStart();
  const titles = Array.from(manager.getData().lists, (l) => l.title);
  assert.deepEqual(titles, ['Plan', 'Progress', 'Done', 'Drop']);
  assert.deepEqual(manager.getData().cards, {}, 'fresh board has zero default cards');
  manager.getData().lists.forEach(l => {
    assert.deepEqual(l.cardIds, [], `column ${l.title} starts with empty cardIds`);
  });
});

test('clearing localStorage restores every board from IndexedDB', async () => {
  const { manager } = await freshStart();
  manager.boards['board-2'] = { id: 'board-2', title: 'Second', lists: [], cards: {} };
  manager.saveAllBoards();
  await manager.flushBackup();
  await wait();

  const { env } = await restartCleared();
  const restored = JSON.parse(env.localStorage.getItem(BOARDS_KEY));
  assert.ok(restored['board-1'], 'board-1 came back');
  assert.ok(restored['board-2'], 'board-2 came back too, not just the active one');
  assert.equal(restored['board-2'].title, 'Second');
});

test('a restore keeps the card contents, not just the board shell', async () => {
  const { manager } = await freshStart();
  manager.data.cards['card-custom-1'] = { id: 'card-custom-1', title: 'Edited before the wipe' };
  manager.data.lists[0].cardIds.push('card-custom-1');
  manager.saveAllBoards();
  await manager.flushBackup();
  await wait();

  const { env } = await restartCleared();
  const restored = JSON.parse(env.localStorage.getItem(BOARDS_KEY));
  assert.equal(restored['board-1'].cards['card-custom-1'].title, 'Edited before the wipe');
});

test('nothing to restore still leaves a usable default board', async () => {
  const StorageManager = await loadStorageClass();
  const env = installGlobals();
  await wipeDb();
  globalThis.localStorage.clear();
  new StorageManager();
  await wait(60);

  const boards = JSON.parse(env.localStorage.getItem(BOARDS_KEY));
  assert.equal(Object.keys(boards).length, 1, 'a clean start yields one default board');
});

test('an existing localStorage store is not overwritten by the backup', async () => {
  const { manager } = await freshStart();
  manager.data.title = 'My real board';
  manager.saveAllBoards();
  await manager.flushBackup();
  await wait();

  // Reload WITHOUT wiping: localStorage is the source of truth.
  const StorageManager = await loadStorageClass();
  const reloaded = new StorageManager();
  await wait(60);
  assert.equal(reloaded.getData().title, 'My real board');
});

test('corrupt localStorage is recovered from the backup', async () => {
  const { manager, env } = await freshStart();
  manager.data.title = 'Recoverable';
  manager.saveAllBoards();
  await manager.flushBackup();
  await wait();

  env.localStorage.setItem(BOARDS_KEY, '{not json');

  const StorageManager = await loadStorageClass();
  new StorageManager();
  await wait(80);

  const restored = JSON.parse(env.localStorage.getItem(BOARDS_KEY));
  assert.equal(restored['board-1'].title, 'Recoverable');
});

test('a quota error is surfaced instead of silently dropping the write', async () => {
  const { manager, env } = await freshStart();
  const statuses = [];
  manager.onSyncStatusChange((s) => statuses.push(s));

  env.localStorage.setItem = () => {
    const err = new Error('full');
    err.name = 'QuotaExceededError';
    throw err;
  };

  manager.data.title = 'will not fit';
  manager.saveAllBoards();

  assert.equal(statuses.length, 1);
  assert.match(statuses[0].message, /Storage full/i);
});

test('switching boards persists the new active id', async () => {
  const { manager, env } = await freshStart();
  manager.boards['board-9'] = { id: 'board-9', title: 'Nine', lists: [], cards: {} };
  manager.saveAllBoards();

  assert.equal(manager.switchBoard('board-9'), true);
  assert.equal(env.localStorage.getItem(ACTIVE_KEY), 'board-9');
  assert.equal(manager.getData().title, 'Nine');
});

test('an unknown active board id falls back to a real one', async () => {
  const { manager, env } = await freshStart();
  env.localStorage.setItem(ACTIVE_KEY, 'board-does-not-exist');
  const StorageManager = await loadStorageClass();
  const m2 = new StorageManager();
  await wait(40);
  assert.ok(m2.getData(), 'a usable board is still selected');
  assert.ok(m2.getActiveBoardId());
});

test('undo and redo round-trip a board edit', async () => {
  const { manager } = await freshStart();
  const before = manager.getData().title;

  manager.recordHistory();
  manager.data.title = 'changed';
  manager.saveAllBoards();

  assert.equal(manager.undo(), true);
  assert.equal(manager.getData().title, before);

  assert.equal(manager.redo(), true);
  assert.equal(manager.getData().title, 'changed');
});

test('undo does nothing when there is no history', async () => {
  const { manager } = await freshStart();
  assert.equal(manager.canUndo(), false);
  assert.equal(manager.undo(), false);
});

test('createBoard creates and switches to the new board', async () => {
  const { manager, env } = await freshStart();
  const newId = manager.createBoard('Sprint 42');
  assert.equal(manager.getActiveBoardId(), newId);
  assert.equal(manager.getData().title, 'Sprint 42');
  assert.equal(env.localStorage.getItem(ACTIVE_KEY), newId);
  const all = manager.getAllBoards();
  assert.ok(all[newId]);
});

test('deleteCurrentBoard removes active board and switches to remaining', async () => {
  const { manager } = await freshStart();
  const id2 = manager.createBoard('Second Board');
  assert.equal(manager.getActiveBoardId(), id2);
  const deleted = manager.deleteCurrentBoard();
  assert.equal(deleted, true);
  assert.notEqual(manager.getActiveBoardId(), id2);
  assert.equal(manager.deleteCurrentBoard(), false, 'cannot delete the only remaining board');
});

test('getSyncSnapshot and setSyncSnapshot round-trip snapshot state', async () => {
  const { manager } = await freshStart();
  assert.equal(manager.getSyncSnapshot('board-1'), null);

  const snapshot = { id: 'board-1', title: 'Snapshot Title', lists: [], cards: {} };
  manager.setSyncSnapshot('board-1', snapshot, '2026-09-26T12:00:00Z');

  const retrieved = manager.getSyncSnapshot('board-1');
  assert.deepEqual(retrieved, snapshot);

  const state = manager.getSyncState('board-1');
  assert.equal(state.lastSyncedAt, '2026-09-26T12:00:00Z');
});

test('Supabase fetchFromSupabase merges remote data without getSyncSnapshot error', async () => {
  const { manager } = await freshStart();
  const statuses = [];
  manager.onSyncStatusChange((s) => statuses.push(s));

  let upsertCalled = false;
  globalThis.window.supabase = {
    createClient: () => ({
      removeChannel: () => {},
      channel: () => ({ on: () => ({ subscribe: () => {} }) }),
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                content: {
                  id: 'board-1',
                  title: 'Cloud Board',
                  lists: [{ id: 'list-1', title: 'Remote List', color: '#fff', cardIds: [] }],
                  cards: {}
                },
                updated_at: new Date().toISOString()
              },
              error: null
            })
          })
        }),
        upsert: async () => {
          upsertCalled = true;
          return { error: null };
        }
      })
    })
  };

  manager.saveSupabaseConfig({ url: 'https://test.supabase.co', key: 'testkey', boardId: 'board-1' });
  await wait(80);

  const failedStatus = statuses.find(s => s.message && s.message.includes('getSyncSnapshot is not a function'));
  assert.equal(failedStatus, undefined, 'must not throw getSyncSnapshot is not a function');
  assert.ok(manager.getData().lists.some(l => l.id === 'list-1'), 'remote list must be merged');
});

test('per-board sync isolation: distinct sync IDs and no cross-board overwrites', async () => {
  const { manager } = await freshStart();
  manager.saveSupabaseConfig({ url: 'https://test.supabase.co', key: 'testkey', boardId: 'legacy-board-1' });

  // board-1 uses legacy config id or its own
  assert.equal(manager.getSyncBoardId('board-1'), 'legacy-board-1');

  // Create a second board
  const b2Id = manager.createBoard('Second Board');
  // Second board must NOT inherit legacy-board-1 or 'default'; it should use its own ID
  assert.equal(manager.getSyncBoardId(b2Id), b2Id);

  // Set explicit custom sync ID
  manager.setBoardSyncId(b2Id, 'custom-b2-sync');
  assert.equal(manager.getSyncBoardId(b2Id), 'custom-b2-sync');

  // Add a unique card to board 2
  const b2Data = manager.getData();
  b2Data.cards['c-b2'] = {
    id: 'c-b2',
    title: 'Board 2 Card',
    listId: b2Data.lists[0].id
  };
  b2Data.lists[0].cardIds.push('c-b2');
  manager.saveLocal(b2Data);
  assert.ok(manager.getData().cards['c-b2'], 'card exists on board 2');

  // Switch back to board 1
  manager.switchBoard('board-1');
  assert.equal(manager.getData().cards['c-b2'], undefined, 'board 1 must not contain board 2 card');

  // Simulate remote sync for board 2 arriving while board 1 is active
  const remoteBoard2Content = {
    id: b2Id,
    title: 'Second Board Remote',
    lists: [{ id: 'remote-list-b2', title: 'Remote List B2', color: '#000', cardIds: ['c-remote-b2'] }],
    cards: {
      'c-remote-b2': { id: 'c-remote-b2', title: 'Remote Card B2', listId: 'remote-list-b2' }
    }
  };

  // Mock supabase client to return board-specific content
  const remoteBoard1Content = {
    id: 'board-1',
    title: 'Board 1 Remote',
    lists: [{ id: 'list-todo-board-1', title: 'Plan', color: '#3b82f6', cardIds: [] }],
    cards: {}
  };

  const rows = {
    'custom-b2-sync': { id: 'custom-b2-sync', content: remoteBoard2Content, updated_at: new Date().toISOString() },
    'legacy-board-1': { id: 'legacy-board-1', content: remoteBoard1Content, updated_at: new Date().toISOString() }
  };

  const upserted = [];
  function makeQueryBuilder(filterVal = null) {
    return {
      eq: (col, val) => makeQueryBuilder(val),
      maybeSingle: async () => ({
        data: filterVal ? (rows[filterVal] || null) : null,
        error: null
      }),
      then: (resolve, reject) => {
        const res = filterVal ? { data: rows[filterVal] || null, error: null } : { data: Object.values(rows), error: null };
        return Promise.resolve(res).then(resolve, reject);
      }
    };
  }

  globalThis.window.supabase = {
    createClient: () => ({
      removeChannel: () => {},
      channel: () => ({ on: () => ({ subscribe: () => {} }) }),
      from: () => ({
        select: () => makeQueryBuilder(),
        upsert: async (row) => {
          upserted.push(row);
          return { error: null };
        }
      })
    })
  };
  manager.initSupabase();

  // Fetch for board 2 while board 1 is active
  await manager.fetchFromSupabase(b2Id);

  // Active board (board-1) must NOT be mutated or overwritten by board 2's sync
  assert.equal(manager.getActiveBoardId(), 'board-1');
  assert.equal(manager.getData().cards['c-remote-b2'], undefined, 'active board-1 does not receive board 2 remote card');
  assert.ok(!manager.getData().lists.some(l => l.id === 'remote-list-b2'), 'active board-1 does not receive board 2 remote list');

  // Board 2 in storage MUST receive the remote merge
  const allBoards = manager.getAllBoards();
  assert.ok(allBoards[b2Id].cards['c-remote-b2'], 'board 2 in storage received remote card');
  assert.ok(allBoards[b2Id].cards['c-b2'], 'board 2 local card is preserved');
  assert.ok(allBoards[b2Id].lists.some(l => l.id === 'remote-list-b2'), 'board 2 in storage received remote list');
});

test('fresh mobile device cleanly adopts cloud board without demo card pollution', async () => {
  const { isDefaultStarterBoard } = await import('../js/storage.js');
  const { manager } = await freshStart();

  // Fresh manager starts with default starter board
  assert.equal(isDefaultStarterBoard(manager.getData()), true, 'fresh board must be recognized as default starter');

  let upsertCalled = false;
  const remoteBoardContent = {
    id: 'board-1',
    title: 'My Work Tasks',
    lists: [{ id: 'list-w1', title: 'Sprint 1', color: '#10b981', cardIds: ['card-custom-99'] }],
    cards: {
      'card-custom-99': { id: 'card-custom-99', title: 'Real Task from Desktop', priority: 'high' }
    }
  };

  globalThis.window.supabase = {
    createClient: () => ({
      removeChannel: () => {},
      channel: () => ({ on: () => ({ subscribe: () => {} }) }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                content: remoteBoardContent,
                updated_at: new Date().toISOString()
              },
              error: null
            })
          })
        }),
        upsert: async () => {
          upsertCalled = true;
          return { error: null };
        }
      })
    })
  };

  manager.saveSupabaseConfig({ url: 'https://test.supabase.co', key: 'testkey', boardId: 'board-1' });
  await wait(80);

  const activeData = manager.getData();
  assert.equal(activeData.title, 'My Work Tasks');
  assert.ok(activeData.cards['card-custom-99'], 'remote task must be adopted');
  assert.equal(activeData.cards['card-truck'], undefined, 'default demo card-truck must NOT be injected into cloud board');
  assert.equal(activeData.cards['card-1'], undefined, 'default demo card-1 must NOT be injected into cloud board');
  assert.equal(upsertCalled, false, 'fresh adoption must not re-upload demo cards to cloud');
});

test('deleteCard permanently removes card, clears from list, and records tombstone', async () => {
  const { manager } = await freshStart();
  manager.data.cards['card-test-1'] = { id: 'card-test-1', title: 'Task 1' };
  manager.data.lists[0].cardIds.push('card-test-1');
  manager.saveAllBoards();

  const data = manager.getData();
  assert.ok(data.cards['card-test-1'], 'card-test-1 exists initially');

  const res = manager.deleteCard('card-test-1');
  assert.equal(res, true);

  const updated = manager.getData();
  assert.equal(updated.cards['card-test-1'], undefined, 'card-test-1 must be removed from cards map');
  const todoList = updated.lists.find(l => l.id === 'list-todo');
  assert.ok(!todoList.cardIds.includes('card-test-1'), 'card-test-1 must be removed from list.cardIds');
  assert.ok(Array.isArray(updated.deletedCardIds), 'deletedCardIds array exists');
  assert.ok(updated.deletedCardIds.includes('card-test-1'), 'card-test-1 is recorded in deletedCardIds tombstone');
});

test('StorageManager: toggle between Local and Cloud mode without losing credentials', async () => {
  const { manager } = await freshStart();

  // Fresh start defaults to local mode
  assert.equal(manager.getStorageMode(), 'local');
  assert.equal(manager.isCloudEnabled(), false);
  assert.equal(manager.supabaseClient, null);

  // Mock global Supabase
  globalThis.window = globalThis.window || {};
  globalThis.window.supabase = {
    createClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null })
          })
        })
      }),
      channel: () => ({
        on: () => ({
          subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return { unsubscribe: () => {} }; }
        })
      }),
      removeChannel: () => {}
    })
  };

  // Configure Supabase in Local mode
  manager.saveSupabaseConfig({
    url: 'https://demo.supabase.co',
    key: 'demo-anon-key',
    boardId: 'my-board',
    storageMode: 'local'
  });

  // Credentials are saved, but cloud sync is inactive
  const loaded = manager.loadSupabaseConfig();
  assert.equal(loaded.url, 'https://demo.supabase.co');
  assert.equal(loaded.key, 'demo-anon-key');
  assert.equal(loaded.storageMode, 'local');
  assert.equal(manager.isCloudEnabled(), false);
  assert.equal(manager.supabaseClient, null);

  // enqueueSync does not queue when in local mode
  manager.enqueueSync('board-1');
  assert.equal(manager.hasPendingSync(), false);

  // Switch to Cloud mode
  manager.saveSupabaseConfig({
    storageMode: 'cloud'
  });
  assert.equal(manager.getStorageMode(), 'cloud');
  assert.equal(manager.isCloudEnabled(), true);
  assert.ok(manager.supabaseClient, 'Supabase client initialized in cloud mode');

  // Switch back to Local mode
  manager.saveSupabaseConfig({
    storageMode: 'local'
  });
  assert.equal(manager.getStorageMode(), 'local');
  assert.equal(manager.isCloudEnabled(), false);
  assert.equal(manager.supabaseClient, null, 'Supabase client disconnected in local mode');
});

test('deleteList permanently removes list, clears cards, and records tombstones', async () => {
  const { manager } = await freshStart();
  const listId = 'list-custom-to-delete';
  manager.data.lists.push({ id: listId, title: 'To Delete', cardIds: ['card-inside-list'] });
  manager.data.cards['card-inside-list'] = { id: 'card-inside-list', title: 'Card inside' };
  manager.saveAllBoards();

  assert.ok(manager.getData().lists.some(l => l.id === listId));
  assert.ok(manager.getData().cards['card-inside-list']);

  const res = manager.deleteList(listId);
  assert.equal(res, true);

  const updated = manager.getData();
  assert.ok(!updated.lists.some(l => l.id === listId), 'list must be removed from lists');
  assert.equal(updated.cards['card-inside-list'], undefined, 'cards inside list must be removed');
  assert.ok(Array.isArray(updated.deletedListIds), 'deletedListIds array exists');
  assert.ok(updated.deletedListIds.includes(listId), 'listId recorded in deletedListIds');
  assert.ok(updated.deletedCardIds.includes('card-inside-list'), 'card recorded in deletedCardIds');
});

test('subscribeRealtime cleans up existing channel before creating new one', async () => {
  const { manager } = await freshStart();
  let removedChannel = null;
  let channelsCreated = [];

  globalThis.window.supabase = {
    createClient: () => ({
      removeChannel: (ch) => { removedChannel = ch; },
      channel: (name) => {
        channelsCreated.push(name);
        return {
          on: () => ({
            subscribe: () => ({ id: name })
          })
        };
      },
      from: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
        }),
        upsert: async () => ({ error: null })
      })
    })
  };

  manager.saveSupabaseConfig({
    url: 'https://demo.supabase.co',
    key: 'demo-key',
    storageMode: 'cloud'
  });

  assert.equal(channelsCreated.length, 1);
  assert.equal(channelsCreated[0], 'board-board-1');

  // Subscribing again (e.g. board switch or wake) removes prior channel
  manager.subscribeRealtime('board-2', 'board-2');
  assert.ok(removedChannel, 'prior channel was removed');
  assert.equal(channelsCreated.length, 2);
  assert.equal(channelsCreated[1], 'board-board-2');
});



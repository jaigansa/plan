/**
 * IndexedDB layer tests (mirror + rolling backups).
 *
 * The store is the only copy of the data that survives a wiped localStorage and
 * the only thing the service worker can read at all, so it is worth testing
 * against a real IndexedDB implementation rather than a hand-rolled stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { loadPlanStore } from './helpers/load-classic.mjs';

// The store is a classic script attached to the worker global, so it has to be
// evaluated in a sandbox. Hand it the fake-indexeddb instance.
const store = loadPlanStore(globalThis.indexedDB);

async function wipe() {
  const { indexedDB } = globalThis;
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('plan-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

test('a mirror round-trips the board the worker needs', async () => {
  await wipe();
  const board = { lists: [{ id: 'L1', cardIds: ['a'] }], cards: { a: { title: 'A' } } };

  await store.putMirror({
    boardId: 'b1',
    data: board,
    settings: { reminderEnabled: true },
    savedAt: 1000
  });

  const mirror = await store.getMirror();
  assert.equal(mirror.boardId, 'b1');
  assert.deepEqual(mirror.data, board);
  assert.equal(mirror.settings.reminderEnabled, true);
  assert.equal(mirror.savedAt, 1000);
});

test('writing the mirror again replaces it rather than accumulating', async () => {
  await wipe();
  await store.putMirror({ boardId: 'b1', data: { cards: {} }, savedAt: 1 });
  await store.putMirror({ boardId: 'b1', data: { cards: { x: {} } }, savedAt: 2 });

  const mirror = await store.getMirror();
  assert.equal(mirror.savedAt, 2);
  assert.ok(mirror.data.cards.x);
});

test('getMirror is null before anything is written', async () => {
  await wipe();
  assert.equal(await store.getMirror(), null);
});

test('backups accumulate and getLatestBackup returns the newest', async () => {
  await wipe();
  await store.putBackup('b1', { v: 1 }, 100);
  await store.putBackup('b1', { v: 2 }, 300);
  await store.putBackup('b1', { v: 3 }, 200);

  const latest = await store.getLatestBackup('b1');
  assert.deepEqual(latest.data, { v: 2 }, 'newest wins regardless of insert order');
  assert.equal(latest.savedAt, 300);
});

test('backups are kept per board', async () => {
  await wipe();
  await store.putBackup('b1', { name: 'one' }, 100);
  await store.putBackup('b2', { name: 'two' }, 500);
  await store.putBackup('b1', { name: 'one-new' }, 400);

  assert.deepEqual((await store.getLatestBackup('b1')).data, { name: 'one-new' });
  assert.deepEqual((await store.getLatestBackup('b2')).data, { name: 'two' });
});

test('an unknown board id falls back to the newest snapshot overall', async () => {
  await wipe();
  await store.putBackup('b1', { name: 'one' }, 100);

  const fallback = await store.getLatestBackup('nope');
  assert.deepEqual(fallback.data, { name: 'one' });
});

test('getLatestBackup is null when there is nothing to restore', async () => {
  await wipe();
  assert.equal(await store.getLatestBackup('b1'), null);
});

test('listBackups reports one entry per board, newest time', async () => {
  await wipe();
  await store.putBackup('b1', {}, 100);
  await store.putBackup('b1', {}, 900);
  await store.putBackup('b2', {}, 400);

  const list = await store.listBackups();
  assert.equal(list.length, 2);
  const b1 = list.find((b) => b.boardId === 'b1');
  const b2 = list.find((b) => b.boardId === 'b2');
  assert.equal(b1.savedAt, 900);
  assert.equal(b2.savedAt, 400);
});

test('the snapshot history is trimmed instead of growing forever', async () => {
  await wipe();
  for (let i = 0; i < 30; i += 1) {
    await store.putBackup('b1', { i }, 1000 + i);
  }
  const list = await store.listBackups();
  assert.equal(list.length, 1, 'one board means one listBackups entry');

  const all = await store.getLatestBackup('b1');
  assert.equal(all.savedAt, 1029, 'the newest snapshot must be the one kept');
});

test('a snapshot of an empty board is still a real snapshot', async () => {
  await wipe();
  await store.putBackup('b1', { lists: [], cards: {} }, 100);
  const latest = await store.getLatestBackup('b1');
  assert.ok(latest, 'an empty board must be restorable, not treated as missing');
  assert.deepEqual(latest.data, { lists: [], cards: {} });
});

test('putBackup defaults savedAt to now when omitted', async () => {
  await wipe();
  const before = Date.now();
  await store.putBackup('b1', { v: 1 });
  const latest = await store.getLatestBackup('b1');
  assert.ok(latest.savedAt >= before);
});

test('hasIndexedDB reflects reality', () => {
  assert.equal(store.hasIndexedDB(), true);
});

test('an all-boards snapshot round-trips the whole workspace', async () => {
  await wipe();
  const boards = {
    'board-1': { lists: [{ id: 'L1', cardIds: [] }], cards: {} },
    'board-2': { lists: [{ id: 'L1', cardIds: ['x'] }], cards: { x: { title: 'X' } } }
  };
  await store.putBoardsBackup(boards, 500);

  const snap = await store.getLatestBoardsBackup();
  assert.deepEqual(snap.boards, boards);
  assert.equal(snap.savedAt, 500);
});

test('getLatestBoardsBackup is null when only per-board snapshots exist', async () => {
  await wipe();
  await store.putBackup('b1', { v: 1 }, 100);
  assert.equal(await store.getLatestBoardsBackup(), null);
});

test('the newest all-boards snapshot wins', async () => {
  await wipe();
  await store.putBoardsBackup({ b1: { v: 1 } }, 100);
  await store.putBoardsBackup({ b1: { v: 2 } }, 900);
  assert.deepEqual((await store.getLatestBoardsBackup()).boards, { b1: { v: 2 } });
});

test('an all-boards snapshot satisfies a per-board lookup', async () => {
  await wipe();
  await store.putBoardsBackup({ b1: { name: 'one' }, b2: { name: 'two' } }, 700);

  assert.deepEqual((await store.getLatestBackup('b2')).data, { name: 'two' });
  assert.deepEqual((await store.getLatestBackup('b1')).data, { name: 'one' });
});

test('an all-boards snapshot is preferred over a stale per-board one', async () => {
  await wipe();
  await store.putBackup('b1', { name: 'per-board' }, 100);
  await store.putBoardsBackup({ b1: { name: 'aggregate' } }, 500);

  assert.deepEqual((await store.getLatestBackup('b1')).data, { name: 'aggregate' });
});

test('a newer per-board snapshot is still used for its own board', async () => {
  await wipe();
  await store.putBoardsBackup({ b1: { name: 'aggregate' } }, 100);
  await store.putBackup('b1', { name: 'newer single' }, 900);

  assert.deepEqual((await store.getLatestBackup('b1')).data, { name: 'newer single' });
});

test('listBackups does not report the aggregate record as a board', async () => {
  await wipe();
  await store.putBackup('b1', {}, 100);
  await store.putBoardsBackup({ b1: {} }, 500);

  const list = await store.listBackups();
  // Array.from re-homes the array: values built inside the vm sandbox do not
  // share this realm's Array.prototype, which strict deepEqual checks.
  assert.deepEqual(Array.from(list, (b) => b.boardId), ['b1']);
});

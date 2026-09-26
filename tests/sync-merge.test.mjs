/**
 * Three-way board merge. This is the logic that replaced "last save wins", so
 * the tests are mostly about what must NOT be lost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBoards } from '../js/sync-merge.js';

const list = (id, cardIds, title) => ({ id, title: title || id, color: '#fff', cardIds });

function cards(entries) {
  const out = {};
  Object.keys(entries).forEach((k) => {
    out[k] = Object.assign({ id: k, title: k, priority: '', completed: false }, entries[k]);
  });
  return out;
}

test('a card changed only locally survives', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A local' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.a.title, 'A local');
  assert.equal(conflicts.length, 0);
});

test('a card changed only remotely is pulled in, not clobbered', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A remote' } }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.a.title, 'A remote');
  assert.equal(conflicts.length, 0);
});

test('a card changed on BOTH sides is kept local AND reported', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'mine' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'theirs' } }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.a.title, 'mine', 'local edit must not vanish');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'field-conflict');
  assert.deepEqual(conflicts[0].fields, ['title']);
  assert.equal(conflicts[0].values.title.local, 'mine');
  assert.equal(conflicts[0].values.title.remote, 'theirs');
});

test('edits to different fields of the same card both survive', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A', description: 'd' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'mine', description: 'd' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A', description: 'theirs' } }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.a.title, 'mine');
  assert.equal(data.cards.a.description, 'theirs');
  assert.equal(conflicts.length, 0, 'different fields are not a conflict');
});

test('a card added locally is kept', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const local = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: {} }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };

  const { data } = mergeBoards(base, local, remote);
  assert.ok(data.cards.b, 'a locally added card must not disappear');
  assert.deepEqual(data.lists[0].cardIds, ['a', 'b']);
});

test('a card added remotely is pulled in', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const remote = { lists: [list('L1', ['a', 'z'])], cards: cards({ a: {}, z: {} }) };

  const { data } = mergeBoards(base, local, remote);
  assert.ok(data.cards.z);
  assert.deepEqual(data.lists[0].cardIds, ['a', 'z']);
});

test('a card deleted locally stays deleted even if remote still has it', () => {
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: {} }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const remote = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: {} }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.b, undefined, 'local delete must be respected');
  assert.ok(!data.lists[0].cardIds.includes('b'));
  assert.equal(conflicts.length, 0, 'an untouched remote copy is not a conflict');
});

test('deleting locally while the card is edited remotely IS a conflict', () => {
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: { title: 'B' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const remote = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: { title: 'B edited' } }) };

  const { data, conflicts } = mergeBoards(base, local, remote);
  assert.equal(data.cards.b, undefined);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'delete-vs-edit');
});

test('a card deleted remotely but still local is kept and marked changed', () => {
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: {} }) };
  const local = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: { title: 'mine' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };

  const { data, changedLocally, conflicts } = mergeBoards(base, local, remote);
  assert.ok(data.cards.b);
  assert.equal(changedLocally, true, 'the card must be pushed back up');
  assert.equal(conflicts.length, 0);
});

test('list order: local order wins, remote-only lists are appended', () => {
  const base = { lists: [list('L1', []), list('L2', [])], cards: {} };
  const local = { lists: [list('L2', []), list('L1', [])], cards: {} };
  const remote = { lists: [list('L1', []), list('L2', []), list('L3', [])], cards: {} };

  const { data } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists.map((l) => l.id), ['L2', 'L1', 'L3']);
});

test('a list deleted locally stays deleted', () => {
  const base = { lists: [list('L1', []), list('L2', [])], cards: {} };
  const local = { lists: [list('L1', [])], cards: {} };
  const remote = { lists: [list('L1', []), list('L2', [])], cards: {} };

  const { data } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists.map((l) => l.id), ['L1']);
});

test('a list renamed remotely is adopted when untouched locally', () => {
  const base = { lists: [list('L1', [], 'Old name')], cards: {} };
  const local = { lists: [list('L1', [], 'Old name')], cards: {} };
  const remote = { lists: [list('L1', [], 'New name')], cards: {} };

  const { data } = mergeBoards(base, local, remote);
  assert.equal(data.lists[0].title, 'New name');
});

test('cardIds order keeps local order and appends remote-only cards', () => {
  // 'c' is absent from base, so it is a remote ADDITION, not a local delete.
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: {}, b: {} }) };
  const local = { lists: [list('L1', ['b', 'a'])], cards: cards({ a: {}, b: {} }) };
  const remote = { lists: [list('L1', ['a', 'b', 'c'])], cards: cards({ a: {}, b: {}, c: {} }) };

  const { data } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists[0].cardIds, ['b', 'a', 'c']);
});

test('a card removed locally is not re-added by a stale remote list', () => {
  // 'c' IS in base but gone locally: a local delete must survive the merge.
  const base = { lists: [list('L1', ['a', 'b', 'c'])], cards: cards({ a: {}, b: {}, c: {} }) };
  const local = { lists: [list('L1', ['b', 'a'])], cards: cards({ a: {}, b: {} }) };
  const remote = { lists: [list('L1', ['a', 'b', 'c'])], cards: cards({ a: {}, b: {}, c: {} }) };

  const { data } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists[0].cardIds, ['b', 'a']);
  assert.equal(data.cards.c, undefined);
});

test('references to cards that no longer exist are dropped', () => {
  const base = { lists: [list('L1', ['a', 'ghost'])], cards: cards({ a: {}, ghost: {} }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: {} }) };
  const remote = { lists: [list('L1', ['a', 'ghost'])], cards: cards({ a: {}, ghost: {} }) };

  const { data } = mergeBoards(base, local, remote);
  assert.ok(!data.lists[0].cardIds.includes('ghost'), 'a dangling id must not survive');
});

test('first sync with no base keeps local data and imports remote additions', () => {
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'mine' } }) };
  const remote = { lists: [list('L1', ['a', 'z'])], cards: cards({ a: { title: 'theirs' }, z: {} }) };

  const { data, conflicts } = mergeBoards(null, local, remote);
  // with no common ancestor, same-card edits are a genuine conflict
  assert.equal(data.cards.a.title, 'mine');
  assert.ok(data.cards.z);
  assert.ok(conflicts.length >= 1);
});

test('an empty remote board does not wipe local data', () => {
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'keep me' } }) };
  const { data } = mergeBoards(null, local, { lists: [], cards: {} });
  assert.equal(data.cards.a.title, 'keep me');
  assert.deepEqual(data.lists[0].cardIds, ['a']);
});

test('an empty local board does not wipe remote data', () => {
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'theirs' } }) };
  const { data } = mergeBoards(null, { lists: [], cards: {} }, remote);
  assert.equal(data.cards.a.title, 'theirs');
});

test('the merge never mutates its inputs', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'A' } }) };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'mine' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { title: 'theirs' } }) };
  const snapshots = [base, local, remote].map((x) => JSON.stringify(x));

  mergeBoards(base, local, remote);
  assert.equal(JSON.stringify(base), snapshots[0]);
  assert.equal(JSON.stringify(local), snapshots[1]);
  assert.equal(JSON.stringify(remote), snapshots[2]);
});

test('merge is idempotent - merging twice changes nothing', () => {
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: { title: 'A' }, b: { title: 'B' } }) };
  const local = { lists: [list('L1', ['b', 'a'])], cards: cards({ a: { title: 'mine' }, b: { title: 'B' } }) };
  const remote = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: { title: 'A' }, b: { title: 'theirs' } }) };

  const first = mergeBoards(base, local, remote);
  const second = mergeBoards(base, first.data, remote);
  assert.equal(JSON.stringify(first.data), JSON.stringify(second.data));
});

test('archivedCards and other board fields are preserved', () => {
  const base = { lists: [list('L1', ['a'])], cards: cards({ a: {} }), archivedCards: [{ id: 'x' }], theme: 'light' };
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: {} }), archivedCards: [{ id: 'x' }], theme: 'light' };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: {} }), archivedCards: [{ id: 'x' }], theme: 'dark' };

  const { data } = mergeBoards(base, local, remote);
  assert.equal(data.theme, 'light');
  assert.equal(data.archivedCards.length, 1);
});

test('a card deleted remotely and untouched locally stays deleted', () => {
  const base = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };
  const local = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { id: 'a' } }) };

  const { data, changedLocally } = mergeBoards(base, local, remote);
  assert.equal(data.cards.b, undefined, 'untouched card deleted remotely must stay deleted');
  assert.deepEqual(data.lists[0].cardIds, ['a']);
  assert.equal(changedLocally, false);
});

test('deletedCardIds tombstone prevents resurrection even without base snapshot', () => {
  const base = null;
  const local = { lists: [list('L1', ['a'])], cards: cards({ a: { id: 'a' } }), deletedCardIds: ['b'] };
  const remote = { lists: [list('L1', ['a', 'b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };

  const { data } = mergeBoards(base, local, remote);
  assert.equal(data.cards.b, undefined, 'deletedCardIds tombstone must prevent remote resurrection');
  assert.deepEqual(data.lists[0].cardIds, ['a']);
  assert.ok(data.deletedCardIds.includes('b'));
});

test('a list deleted remotely and untouched locally is deleted locally on other device', () => {
  const base = { lists: [list('L1', ['a']), list('L2', ['b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };
  // Local (device B) still has L1 and L2
  const local = { lists: [list('L1', ['a']), list('L2', ['b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };
  // Remote (device A) deleted L2 and its card b
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { id: 'a' } }), deletedListIds: ['L2'], deletedCardIds: ['b'] };

  const { data, changedLocally } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists.map(l => l.id), ['L1'], 'L2 must be deleted on local device too');
  assert.equal(data.cards.b, undefined, 'card b in deleted list must be deleted');
  assert.ok(data.deletedListIds.includes('L2'), 'deletedListIds includes L2');
  assert.equal(changedLocally, true);
});

test('deletedListIds tombstone deletes list across devices even without base snapshot', () => {
  const base = null;
  // Local (device B) has L1 and L2
  const local = { lists: [list('L1', ['a']), list('L2', ['b'])], cards: cards({ a: { id: 'a' }, b: { id: 'b' } }) };
  // Remote (device A) deleted L2 and tombstones it
  const remote = { lists: [list('L1', ['a'])], cards: cards({ a: { id: 'a' } }), deletedListIds: ['L2'] };

  const { data } = mergeBoards(base, local, remote);
  assert.deepEqual(data.lists.map(l => l.id), ['L1'], 'L2 must be removed by deletedListIds tombstone');
  assert.ok(data.deletedListIds.includes('L2'));
});


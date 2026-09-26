/**
 * Reminder rules. These are the rules that decide whether a card nags you, and
 * they now run in two places (the page and the service worker), so they are
 * worth pinning down precisely.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReminderCore } from './helpers/load-classic.mjs';

const core = loadReminderCore();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// 2024-01-03 is a Wednesday.
const WED = Date.UTC(2024, 0, 3, 9, 0, 0);

function board(cards, lists) {
  return {
    lists: lists || [{ id: 'L1', title: 'Todo', cardIds: Object.keys(cards) }],
    cards
  };
}

function card(over) {
  return Object.assign({
    id: 'c1', title: 'Task', priority: 'high', completed: false,
    days: ['M', 'T', 'W', 'R', 'F', 'S', 'U'], lastNotifiedAt: 0, checklist: [], comments: []
  }, over);
}

test('day codes map to the right weekday letters', () => {
  assert.equal(core.getTodayCode(WED), 'W');
  // 2024-01-07 is a Sunday -> 'U' (the app uses U for Sunday, not S)
  assert.equal(core.getTodayCode(Date.UTC(2024, 0, 7)), 'U');
  // 2024-01-06 is a Saturday -> 'S'
  assert.equal(core.getTodayCode(Date.UTC(2024, 0, 6)), 'S');
  assert.equal(core.getTodayCode(Date.UTC(2024, 0, 1)), 'M');
});

test('getTodayCode accepts Date, epoch ms, and defaults to now', () => {
  assert.equal(core.getTodayCode(new Date(WED)), 'W');
  assert.equal(core.getTodayCode(WED), 'W');
  assert.ok(core.ALL_DAYS.includes(core.getTodayCode()));
});

test('intervals are the documented 5/15/30/60 minutes', () => {
  assert.equal(core.PRIORITY_INTERVALS.urgent, 5 * MIN);
  assert.equal(core.PRIORITY_INTERVALS.high, 15 * MIN);
  assert.equal(core.PRIORITY_INTERVALS.medium, 30 * MIN);
  assert.equal(core.PRIORITY_INTERVALS.low, 60 * MIN);
  assert.equal(core.PRIORITY_INTERVALS.none, undefined);
});

test('a card is due once its interval has elapsed', () => {
  const data = board({ c1: card({ lastNotifiedAt: 0 }) });
  const due = core.computeDueReminders(data, WED);
  assert.equal(due.length, 1);
  assert.equal(due[0].cardId, 'c1');
  assert.equal(due[0].priority, 'high');
});

test('a card is NOT due just before its interval elapses', () => {
  const justInside = WED - (15 * MIN) + 1000;
  const data = board({ c1: card({ lastNotifiedAt: justInside }) });
  assert.equal(core.computeDueReminders(data, WED).length, 0);
});

test('a card becomes due exactly at the interval boundary', () => {
  const boundary = WED - 15 * MIN;
  const data = board({ c1: card({ lastNotifiedAt: boundary }) });
  assert.equal(core.computeDueReminders(data, WED).length, 1);
});

test('cards with no priority never remind', () => {
  const data = board({ c1: card({ priority: '' }), c2: card({ priority: undefined }) });
  assert.equal(core.computeDueReminders(data, WED).length, 0);
});

test('completed cards are skipped', () => {
  const data = board({ c1: card({ completed: true }) });
  assert.equal(core.computeDueReminders(data, WED).length, 0);
});

test('a card only reminds on its assigned days', () => {
  // Wednesday, but the card is only assigned Monday
  const data = board({ c1: card({ days: ['M'] }) });
  assert.equal(core.computeDueReminders(data, WED).length, 0);

  const wed = board({ c1: card({ days: ['W'] }) });
  assert.equal(core.computeDueReminders(wed, WED).length, 1);
});

test('a card with an empty days array reminds every day', () => {
  const data = board({ c1: card({ days: [] }) });
  assert.equal(core.computeDueReminders(data, WED).length, 1);
});

test('computeDueReminders does not mutate the input board', () => {
  const data = board({ c1: card({ lastNotifiedAt: 0 }) });
  const before = JSON.stringify(data);
  core.computeDueReminders(data, WED);
  assert.equal(JSON.stringify(data), before, 'computing due reminders must be side-effect free');
});

test('markNotified stamps only the cards that fired', () => {
  // c2 is low priority with a 60m window and was already reminded 30m ago,
  // so it is NOT due and must be left alone.
  const data = board({
    c1: card({ lastNotifiedAt: 0 }),
    c2: card({ id: 'c2', priority: 'low', lastNotifiedAt: WED - 30 * MIN })
  });
  const due = core.computeDueReminders(data, WED);
  assert.equal(due.length, 1);
  assert.equal(due[0].cardId, 'c1');

  core.markNotified(data, due, WED);
  assert.equal(data.cards.c1.lastNotifiedAt, WED);
  assert.equal(data.cards.c2.lastNotifiedAt, WED - 30 * MIN, 'a card that did not fire must not be stamped');
  // and now c1 is not due again
  assert.equal(core.computeDueReminders(data, WED).length, 0);
});

test('markNotified ignores unknown ids instead of throwing', () => {
  const data = board({ c1: card() });
  assert.doesNotThrow(() => core.markNotified(data, [{ cardId: 'ghost' }], WED));
});

test('describe builds the notification title and body', () => {
  const data = board({ c1: card({ priority: 'urgent', title: 'Fix leak' }) },
    [{ id: 'L1', title: 'Backlog', cardIds: ['c1'] }]);
  const due = core.computeDueReminders(data, WED);
  const text = core.describe(due[0]);
  assert.equal(text.title, '[URGENT] Fix leak');
  assert.match(text.body, /Backlog/);
  assert.match(text.body, /5m/);
  assert.match(text.body, /W/);
});

test('malformed data does not throw', () => {
  // Arrays built inside the vm sandbox have a different Array prototype, so
  // assert on length rather than deep-equality.
  const count = (data) => core.computeDueReminders(data, WED).length;

  assert.equal(count(null), 0);
  assert.equal(count(undefined), 0);
  assert.equal(count({}), 0);
  assert.equal(count({ lists: [], cards: {} }), 0);

  // a card that is not an object
  const weird = { lists: [{ id: 'L', title: 't', cardIds: ['x'] }], cards: { x: null } };
  assert.doesNotThrow(() => core.computeDueReminders(weird, WED));

  // a list without cardIds
  const noIds = { lists: [{ id: 'L', title: 't' }], cards: { x: card() } };
  assert.equal(count(noIds), 1, 'a missing cardIds list must not break the day lookup');

  // cards keyed differently from card.id
  const mismatched = { lists: [{ id: 'L', title: 't', cardIds: ['key1'] }], cards: { key1: card({ id: 'other' }) } };
  assert.equal(count(mismatched), 1);
});

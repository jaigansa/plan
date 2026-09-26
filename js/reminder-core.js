/**
 * Shared reminder logic for plan.
 *
 * This file is a CLASSIC script (not an ES module) on purpose: the service
 * worker cannot use `import`, but it can use `importScripts`. The page loads it
 * with a plain <script> tag. Both sides therefore run the exact same decision
 * code, so a reminder can never fire in one context with different rules than
 * the other.
 *
 * Everything here is pure: no DOM, no localStorage, no Notification API.
 */
(function (root) {
  'use strict';

  // 0 = Sun (U), 1 = Mon (M) ... matches Date#getDay()
  const DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];

  const DAY_INFO = [
    { code: 'M', name: 'Mon', full: 'Monday' },
    { code: 'T', name: 'Tue', full: 'Tuesday' },
    { code: 'W', name: 'Wed', full: 'Wednesday' },
    { code: 'R', name: 'Thu', full: 'Thursday' },
    { code: 'F', name: 'Fri', full: 'Friday' },
    { code: 'S', name: 'Sat', full: 'Saturday' },
    { code: 'U', name: 'Sun', full: 'Sunday' }
  ];

  // Fixed reminder cadence per priority. "None" is intentionally absent so
  // cards without a priority are skipped.
  const PRIORITY_INTERVALS = {
    urgent: 5 * 60 * 1000,
    high: 15 * 60 * 1000,
    medium: 30 * 60 * 1000,
    low: 60 * 60 * 1000
  };

  const ALL_DAYS = DAY_CODES.slice();

  /**
   * Day letter for a given time. Accepts a Date, epoch ms, or nothing.
   * DAY_CODES is indexed by Date#getDay() (0 = Sunday).
   *
   * The Date check is duck-typed on purpose: `instanceof Date` is false for a
   * Date created in another realm (a worker, an iframe, a test sandbox), which
   * would silently fall through to "now".
   */
  function getTodayCode(now) {
    let d;
    if (now && typeof now.getDay === 'function') d = now;
    else if (typeof now === 'number' && isFinite(now)) d = new Date(now);
    else d = new Date();
    return DAY_CODES[d.getDay()];
  }

  function isValidPriority(priority) {
    return Object.prototype.hasOwnProperty.call(PRIORITY_INTERVALS, priority);
  }

  /**
   * Build a cardId -> list title map from the board data.
   * Tolerates lists without cardIds so a partially synced board cannot throw.
   */
  function buildCardListMap(data) {
    const map = {};
    if (!data || !Array.isArray(data.lists)) return map;
    data.lists.forEach((list) => {
      (list.cardIds || []).forEach((id) => {
        map[id] = list.title || 'Todo';
      });
    });
    return map;
  }

  /**
   * Decide which cards should fire a reminder right now.
   *
   * Returns a NEW array of descriptors; the input data is never mutated, so the
   * caller stays in control of when to persist the updated lastNotifiedAt.
   *
   * @param {object} data  board data ({ lists, cards })
   * @param {number} now   epoch ms, injectable for tests
   * @returns {Array<{cardId, title, priority, listName, intervalMs, todayCode}>}
   */
  function computeDueReminders(data, now) {
    const at = typeof now === 'number' ? now : Date.now();
    if (!data || !data.cards || !data.lists) return [];

    const todayCode = getTodayCode(at);
    const cardListMap = buildCardListMap(data);
    const due = [];

    Object.keys(data.cards).forEach((cardId) => {
      const card = data.cards[cardId];
      if (!card || card.completed) return;

      const intervalMs = PRIORITY_INTERVALS[card.priority];
      if (!intervalMs) return; // no priority => no reminders

      // A card with no explicit days reminds every day.
      const assignedDays = Array.isArray(card.days) && card.days.length ? card.days : ALL_DAYS;
      if (assignedDays.indexOf(todayCode) === -1) return;

      const lastNotified = card.lastNotifiedAt || 0;
      if (at - lastNotified < intervalMs) return;

      due.push({
        cardId: card.id || cardId,
        title: card.title || 'Untitled',
        priority: card.priority,
        listName: cardListMap[cardId] || 'Todo',
        intervalMs: intervalMs,
        todayCode: todayCode
      });
    });

    return due;
  }

  /**
   * Stamp lastNotifiedAt onto the given cards. Mutates `data` in place and
   * returns it, so the caller can hand the same object to its save function.
   */
  function markNotified(data, due, now) {
    const at = typeof now === 'number' ? now : Date.now();
    if (!data || !data.cards) return data;
    (due || []).forEach((d) => {
      if (data.cards[d.cardId]) data.cards[d.cardId].lastNotifiedAt = at;
    });
    return data;
  }

  /** Build the title/body shown in the notification. */
  function describe(due) {
    const label = (due.priority || '').toUpperCase();
    const intervalMins = Math.round(due.intervalMs / 60000);
    return {
      title: '[' + label + '] ' + due.title,
      body: 'List: "' + due.listName + '" · Reminding every ' + intervalMins + 'm on ' + due.todayCode
    };
  }

  root.PlanReminderCore = {
    DAY_CODES: DAY_CODES,
    DAY_INFO: DAY_INFO,
    PRIORITY_INTERVALS: PRIORITY_INTERVALS,
    ALL_DAYS: ALL_DAYS,
    getTodayCode: getTodayCode,
    isValidPriority: isValidPriority,
    buildCardListMap: buildCardListMap,
    computeDueReminders: computeDueReminders,
    markNotified: markNotified,
    describe: describe
  };
})(typeof self !== 'undefined' ? self : this);

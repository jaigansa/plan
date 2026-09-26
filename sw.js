// plan Service Worker
//
// Responsibilities:
//  1. Show notifications and focus the right card when one is clicked.
//  2. Run reminder checks WHILE THE TAB IS CLOSED. The page cannot do this:
//     a closed tab stops its timers, and a worker cannot read localStorage.
//     So the page mirrors the board into IndexedDB (js/plan-store.js) and this
//     worker reads that mirror on a periodicSync wake-up.
//
// Reminder rules come from js/reminder-core.js, the same file the page uses, so
// a card can never be judged differently depending on who is checking.
// The worker lives at the site root, but these modules are served from /js/.
// A worker cannot use import paths relative to the page, only to itself.
importScripts('./js/reminder-core.js', './js/plan-store.js');

const CACHE_NAME = 'plan-v1';
const REMINDER_SYNC_TAG = 'plan-reminders';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cardId = event.notification.data?.cardId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (cardId) {
            client.postMessage({ type: 'FOCUS_CARD', cardId });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./');
      }
    })
  );
});

/**
 * Read the mirrored board, notify everything due, and stamp the mirror so the
 * next run does not repeat them. The page reconciles those stamps into
 * localStorage on its next load, so a reminder shown by the worker is not
 * shown again by the page.
 */
async function runReminderCheck() {
  const core = self.PlanReminderCore;
  const store = self.PlanStore;
  if (!core || !store) return;

  const mirror = await store.getMirror();
  if (!mirror || !mirror.data) return;

  const settings = mirror.settings || {};
  if (settings.enabled === false) return;

  const data = mirror.data;
  if (!data.cards || !data.lists) return;

  const now = Date.now();
  const due = core.computeDueReminders(data, now);
  if (!due.length) return;

  for (const item of due) {
    const text = core.describe(item);
    try {
      await self.registration.showNotification(text.title, {
        body: text.body,
        tag: 'card-alert-' + item.cardId,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2300ff66" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
        data: { cardId: item.cardId }
      });
    } catch (err) {
      // A single failed notification must not abort the rest of the batch.
      console.warn('plan SW notification failed:', err);
    }
  }

  // Record what was sent. These stamps go back to the page via the mirror.
  core.markNotified(data, due, now);
  mirror.savedAt = now;
  await store.putMirror(mirror);
}

// Chromium: fired by the browser on its own schedule, even with no tabs open.
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== REMINDER_SYNC_TAG) return;
  event.waitUntil(runReminderCheck());
});

// Fallback path: some browsers grant a one-off sync instead of periodic, and
// the page can also request an immediate run after a save.
self.addEventListener('sync', (event) => {
  if (event.tag !== REMINDER_SYNC_TAG) return;
  event.waitUntil(runReminderCheck());
});

// The page asks for an immediate check after saving board data.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'RUN_REMINDER_CHECK') {
    event.waitUntil(runReminderCheck());
    return;
  }

  // Hand the worker-side lastNotifiedAt stamps back to the page.
  if (data.type === 'GET_WORKER_NOTIFIED') {
    event.waitUntil(
      self.PlanStore.getMirror()
        .then((m) => {
          const port = event.ports && event.ports[0];
          const payload = (m && m.data && m.data.cards) || {};
          if (port) port.postMessage({ ok: true, cards: payload });
        })
        .catch(() => {
          const port = event.ports && event.ports[0];
          if (port) port.postMessage({ ok: false, cards: {} });
        })
    );
  }
});

/**
 * Notification Manager for plan
 * - Master Enable / Disable toggle
 * - Fixed default priority intervals:
 *     Urgent: 5 min
 *     High: 15 min
 *     Medium: 30 min
 *     Low: 60 min
 *     None: Disabled
 * - Multi-day assignment support: M, T, W, R, F, S, U
 *     (M=Mon, T=Tue, W=Wed, R=Thu, F=Fri, S=Sat, U=Sun)
 * - Decision logic lives in reminder-core.js so the page and the service
 *   worker always agree on what is due.
 */

const Core = (typeof self !== 'undefined' && self.PlanReminderCore) || null;

if (!Core) {
  console.error('plan: reminder-core.js failed to load; reminders are disabled.');
}

export const DAY_CODES = Core ? Core.DAY_CODES.slice() : ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
export const DAY_INFO = Core ? Core.DAY_INFO.slice() : [];
export const PRIORITY_INTERVALS = Core ? { ...Core.PRIORITY_INTERVALS } : {};

const SETTINGS_KEY = 'todoflow_notification_settings_v1';

export class NotificationManager {
  constructor(app) {
    this.app = app;
    this.timerId = null;
    this.swRegistration = null;
    this.initServiceWorker();
  }

  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('./sw.js');
      } catch (err) {
        console.warn('Service worker registration failed:', err);
      }
    }
  }

  isSupported() {
    return 'Notification' in window;
  }

  getPermission() {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  async requestPermission() {
    if (!this.isSupported()) return 'denied';
    const permission = await Notification.requestPermission();
    return permission;
  }

  isEnabled() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return true; // Default to enabled if user grants permission
    try {
      const data = JSON.parse(raw);
      return data.enabled !== false;
    } catch {
      return true;
    }
  }

  setEnabled(enabled) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: Boolean(enabled) }));
    if (enabled) {
      this.startScheduler();
    } else {
      this.stopScheduler();
    }
  }

  getTodayCode() {
    return Core ? Core.getTodayCode() : DAY_CODES[new Date().getDay()];
  }

  async sendNotification(title, options = {}) {
    if (!this.isSupported() || this.getPermission() !== 'granted' || !this.isEnabled()) {
      return false;
    }

    const defaultOptions = {
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2300ff66" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2300ff66"><circle cx="12" cy="12" r="10"/></svg>',
      ...options
    };

    // Mobile haptic vibration if supported
    if (navigator.vibrate) {
      try { navigator.vibrate([150, 80, 150]); } catch {}
    }

    // Try service worker notification first (for background / PWA reliability)
    if (this.swRegistration && this.swRegistration.showNotification) {
      try {
        await this.swRegistration.showNotification(title, defaultOptions);
        return true;
      } catch (err) {
        // Fall back to standard Notification constructor
      }
    }

    try {
      new Notification(title, defaultOptions);
      return true;
    } catch (err) {
      console.warn('Notification failed:', err);
      return false;
    }
  }

  async sendTestNotification() {
    const perm = this.getPermission();
    if (perm !== 'granted') {
      const newPerm = await this.requestPermission();
      if (newPerm !== 'granted') {
        alert('Notification permission is not granted. Please allow notifications in your browser settings.');
        return false;
      }
    }

    return this.sendNotification('plan Test Notification', {
      body: 'Notifications are working! You will receive priority alerts on your assigned days.',
      tag: 'todoflow-test'
    });
  }

  startScheduler() {
    this.stopScheduler();
    if (!this.isEnabled()) return;

    // Check immediately on startup
    this.checkAndNotify();

    // Check periodically every 30 seconds while the tab is open. This is the
    // fallback for browsers without periodicsync; the service worker covers
    // the closed-tab case where it is available.
    this.timerId = setInterval(() => {
      this.checkAndNotify();
    }, 30000);

    // Publish data for the worker and ask for background wake-ups.
    this.syncMirror();

    // A tab left open but idle/backgrounded still runs the interval, so also
    // re-check whenever the user comes back to the tab.
    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.checkAndNotify();
      });
    }
  }

  stopScheduler() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Fire any reminders that are due right now.
   *
   * The decision itself is delegated to reminder-core so the service worker
   * applies identical rules. This method only adds the browser bits: sending
   * the notification, persisting lastNotifiedAt, and refreshing the SW mirror
   * so a background run does not re-fire the same card.
   *
   * @param {object} [opts]
   * @param {object} [opts.data]   board data to evaluate (defaults to active)
   * @param {number} [opts.now]    epoch ms, injectable for tests
   * @param {boolean} [opts.persist] write lastNotifiedAt back (default true)
   * @returns {Promise<Array>} the reminders that fired
   */
  async checkAndNotify(opts) {
    const options = opts || {};
    if (!Core) return [];
    if (!this.isSupported() || this.getPermission() !== 'granted' || !this.isEnabled()) return [];

    const data = options.data || this.app.storage.getData();
    if (!data || !data.cards || !data.lists) return [];

    const now = typeof options.now === 'number' ? options.now : Date.now();
    const due = Core.computeDueReminders(data, now);
    if (!due.length) return [];

    for (let i = 0; i < due.length; i++) {
      const text = Core.describe(due[i]);
      await this.sendNotification(text.title, {
        body: text.body,
        tag: 'card-alert-' + due[i].cardId,
        data: { cardId: due[i].cardId }
      });
    }

    if (options.persist !== false) {
      Core.markNotified(data, due, now);
      this.app.storage.saveLocal(data);
    }

    // Keep the worker's copy in step so it does not repeat these reminders.
    this.syncMirror();

    return due;
  }

  /**
   * Publish the active board + reminder settings where the service worker can
   * read them (IndexedDB, since workers cannot see localStorage), then ask the
   * browser to schedule background checks.
   */
  syncMirror() {
    if (!this.app || !this.app.storage) return Promise.resolve();
    if (typeof self === 'undefined' || !self.PlanStore) return Promise.resolve();

    const payload = {
      boardId: this.app.storage.activeBoardId,
      data: this.app.storage.getData(),
      settings: this.getSettings(),
      savedAt: Date.now()
    };

    return self.PlanStore.putMirror(payload)
      .then(() => this.requestBackgroundSync())
      .catch((err) => { console.warn('Reminder mirror failed:', err); });
  }

  getSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return { enabled: true };
    try { return JSON.parse(raw); } catch { return { enabled: true }; }
  }

  /**
   * Ask the browser to wake the service worker while the tab is closed.
   * Chromium honours periodicsync; elsewhere this is a no-op and the in-page
   * interval remains the fallback.
   */
  async requestBackgroundSync() {
    if (!this.swRegistration) return false;
    try {
      if ('periodicSync' in this.swRegistration) {
        let status;
        try {
          status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        } catch {
          // Unsupported permission name in this browser
          return false;
        }
        if (status && status.state === 'granted') {
          await this.swRegistration.periodicSync.register('plan-reminders', { minInterval: 15 * 60 * 1000 });
          return true;
        }
        return false;
      }
    } catch (err) {
      console.warn('Periodic sync unavailable:', err);
    }
    return false;
  }
}

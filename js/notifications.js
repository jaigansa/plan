/**
 * Notification Manager for plan
 * - Mobile & PWA optimized push / local notifications
 * - Master Enable / Disable toggle
 * - Fixed priority reminder intervals:
 *     Urgent: 5 min
 *     High: 15 min
 *     Medium: 30 min
 *     Low: 60 min
 *     None: Disabled
 * - Day assignment support: M, T, W, R, F, S, U
 * - Service Worker + PeriodicSync + Visibility change fallback
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
        this.swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        // Request background sync once worker is active
        if (this.swRegistration.active) {
          this.requestBackgroundSync();
        } else {
          this.swRegistration.addEventListener('updatefound', () => {
            const installing = this.swRegistration.installing;
            if (installing) {
              installing.addEventListener('statechange', () => {
                if (installing.state === 'activated') {
                  this.requestBackgroundSync();
                }
              });
            }
          });
        }
      } catch (err) {
        console.warn('Service worker registration failed:', err);
      }
    }
  }

  async getRegistration() {
    if (this.swRegistration) return this.swRegistration;
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.ready;
        return this.swRegistration;
      } catch (e) {
        return null;
      }
    }
    return null;
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
    try {
      // Direct user gesture promise
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.syncMirror();
        this.startScheduler();
      }
      return permission;
    } catch (err) {
      // Fallback for older callback-based browsers
      return new Promise((resolve) => {
        Notification.requestPermission((perm) => {
          if (perm === 'granted') {
            this.syncMirror();
            this.startScheduler();
          }
          resolve(perm);
        });
      });
    }
  }

  isEnabled() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return true;
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
      this.syncMirror();
      this.startScheduler();
    } else {
      this.stopScheduler();
      this.syncMirror();
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
      vibrate: [200, 100, 200],
      requireInteraction: false,
      ...options
    };

    // Mobile haptic feedback
    if (navigator.vibrate) {
      try { navigator.vibrate([150, 80, 150]); } catch {}
    }

    // Try service worker notification first (critical for mobile browser/PWA)
    const reg = await this.getRegistration();
    if (reg && reg.showNotification) {
      try {
        await reg.showNotification(title, defaultOptions);
        return true;
      } catch (err) {
        console.warn('Service worker showNotification failed, trying window Notification:', err);
      }
    }

    // Fall back to standard Notification constructor if available
    try {
      new Notification(title, defaultOptions);
      return true;
    } catch (err) {
      console.warn('Window Notification failed:', err);
      return false;
    }
  }

  async sendTestNotification() {
    let perm = this.getPermission();
    if (perm !== 'granted') {
      perm = await this.requestPermission();
      if (perm !== 'granted') {
        alert('Notification permission is not granted. Please allow notifications in your mobile browser settings.');
        return false;
      }
    }

    return this.sendNotification('plan Test Notification', {
      body: 'Notifications are working! You will receive priority alerts on your assigned days.',
      tag: 'plan-test-alert'
    });
  }

  startScheduler() {
    this.stopScheduler();
    if (!this.isEnabled()) return;

    // Check immediately on startup
    this.checkAndNotify();

    // Check periodically every 30 seconds while tab/app is open
    this.timerId = setInterval(() => {
      this.checkAndNotify();
    }, 30000);

    // Keep service worker mirror up to date
    this.syncMirror();

    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.checkAndNotify();
          this.syncMirror();
        }
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
   * Check for due reminders and display notifications
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

    this.syncMirror();
    return due;
  }

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
      .catch((err) => { console.warn('Reminder mirror sync failed:', err); });
  }

  getSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return { enabled: true };
    try { return JSON.parse(raw); } catch { return { enabled: true }; }
  }

  async requestBackgroundSync() {
    const reg = await this.getRegistration();
    if (!reg) return false;
    try {
      if ('periodicSync' in reg) {
        let status;
        try {
          status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        } catch {
          return false;
        }
        if (status && status.state === 'granted') {
          await reg.periodicSync.register('plan-reminders', { minInterval: 15 * 60 * 1000 });
          return true;
        }
      }
    } catch (err) {
      console.warn('Periodic sync registration error:', err);
    }
    return false;
  }
}

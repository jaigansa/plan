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

    // Resolve absolute URLs for icon & badge so Android Chrome service worker and system tray display them reliably
    const baseUri = new URL('./', window.location.href).href;
    const defaultIcon = new URL('icon-192.png', baseUri).href;
    const defaultBadge = new URL('badge-96.png', baseUri).href;

    const notifOptions = {
      body: options.body || '',
      icon: options.icon || defaultIcon,
      badge: options.badge || defaultBadge,
      tag: options.tag || 'plan-alert-' + Date.now(),
      renotify: true,
      vibrate: [200, 100, 200],
      requireInteraction: false,
      silent: false,
      data: options.data || {},
      ...options
    };

    // Mobile haptic feedback if supported
    if (navigator.vibrate) {
      try { navigator.vibrate([150, 80, 150]); } catch {}
    }

    // Try service worker notification first (mandatory for Android Chrome)
    const reg = await this.getRegistration();
    if (reg && reg.showNotification) {
      try {
        await reg.showNotification(title, notifOptions);
        return true;
      } catch (err) {
        console.warn('Service worker showNotification failed, trying window Notification:', err);
      }
    }

    // Fall back to standard Notification constructor if available
    try {
      new Notification(title, notifOptions);
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
      body: 'Notifications are working cleanly!',
      tag: 'plan-test-alert'
    });
  }

  startScheduler() {
    this.stopScheduler();
    this.updateCountdownUI();

    if (!this.isEnabled()) return;

    // Check immediately on startup
    this.checkAndNotify();

    // Check periodically every 15 seconds while tab/app is open
    this.timerId = setInterval(() => {
      this.checkAndNotify();
    }, 15000);

    // Update countdown ticker every 1 second
    this.countdownTimerId = setInterval(() => {
      this.updateCountdownUI();
    }, 1000);

    // Keep service worker mirror up to date
    this.syncMirror();

    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.checkAndNotify();
          this.updateCountdownUI();
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
    if (this.countdownTimerId) {
      clearInterval(this.countdownTimerId);
      this.countdownTimerId = null;
    }
    this.updateCountdownUI();
  }

  updateCountdownUI() {
    const badge = document.getElementById('header-notif-countdown');
    const timerText = document.getElementById('countdown-timer-text');
    if (!badge || !timerText) return;

    if (!this.isEnabled() || !this.isSupported() || this.getPermission() !== 'granted' || !Core) {
      badge.classList.add('hidden');
      return;
    }

    const data = this.app.storage ? this.app.storage.getData() : null;
    if (!data) {
      badge.classList.add('hidden');
      return;
    }

    const now = Date.now();
    const nextItem = Core.getNextDueReminder(data, now);
    if (!nextItem) {
      badge.classList.add('hidden');
      return;
    }

    badge.classList.remove('hidden');

    const msLeft = Math.max(0, nextItem.nextDueAt - now);
    const totalSecs = Math.floor(msLeft / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    let timeFormatted = '';
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      timeFormatted = `${hours}h ${remainMins}m`;
    } else {
      timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    timerText.textContent = timeFormatted;
    badge.title = `Next reminder for "${nextItem.title}" in ${timeFormatted}`;

    if (msLeft <= 60000) {
      badge.classList.add('urgent');
    } else {
      badge.classList.remove('urgent');
    }

    // Update individual card progress bars
    this.updateCardProgressBars(data, now);
  }

  updateCardProgressBars(data, now) {
    if (!Core) return;
    const progressMap = Core.getCardReminderProgressMap(data, now);
    const cardEls = document.querySelectorAll('.todo-card, .kanban-card');

    const prioColors = {
      urgent: '#ef4444',
      high: '#f97316',
      medium: '#eab308',
      low: '#10b981'
    };

    const prioGlows = {
      urgent: 'rgba(239, 68, 68, 0.5)',
      high: 'rgba(249, 115, 22, 0.5)',
      medium: 'rgba(234, 179, 8, 0.5)',
      low: 'rgba(16, 185, 129, 0.5)'
    };

    cardEls.forEach(cardEl => {
      const cardId = cardEl.getAttribute('data-card-id');
      const bar = cardEl.querySelector('.card-timer-progress-bar');
      if (!bar) return;

      const info = progressMap[cardId];
      if (!info) {
        bar.style.width = '0%';
        bar.style.display = 'none';
        return;
      }

      const priority = cardEl.getAttribute('data-priority') || 'low';
      const color = prioColors[priority] || '#00ff66';
      const glow = prioGlows[priority] || 'rgba(0, 255, 102, 0.4)';

      bar.style.display = 'block';
      bar.style.setProperty('--timer-progress', `${info.percentage}%`);
      bar.style.setProperty('--timer-color', color);
      bar.style.setProperty('--timer-glow', glow);
      bar.style.width = `${info.percentage}%`;

      const minsLeft = Math.ceil(info.msLeft / 60000);
      bar.title = info.isDue ? 'Notification due now' : `Next notification in ~${minsLeft}m (${info.percentage}%)`;
    });
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

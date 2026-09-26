/**
 * Theme Manager - Locked to Green TUI mode.
 */

export class ThemeManager {
  constructor(app) {
    this.app = app;
    this.init();
  }

  init() {
    this.applyTheme();
  }

  getTheme() {
    return 'tui';
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', 'tui');
  }
}

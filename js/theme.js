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

  applyTheme() {
    document.documentElement.setAttribute('data-theme', 'tui');
  }
}

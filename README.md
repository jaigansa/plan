# plan - Mobile TUI Todo Manager 📱

A fast, distraction-free **Mobile-Only TUI Todo & Task Manager** built with zero-build **Vanilla HTML5, CSS3, and ES6 JavaScript**.

Optimized specifically for phone screens and mobile web browsers with tap-based controls, zero drag-and-drop complexity, and reliable reminder notifications.

---

## ✨ Features

- **Mobile-First TUI Architecture**:
  - Full-width, vertically stacked list columns optimized for single-thumb mobile usage.
  - Authentic Phosphor Green Terminal aesthetic with Google Sans typography.

- **Full-Screen 3-Dot Action Menu**:
  - Tap `⋮` on any todo to open a dedicated full-screen options view.
  - Priority selector with direct visual pills (`None`, `Low`, `Med`, `High`, `Urgent`).
  - Mobile-sized action buttons for:
    - Moving items up or down within a list.
    - Moving items across different lists (`Move to Another List...`).
    - Quick deletion (`Delete Todo`).

- **Tap-Based Reordering (No Drag & Drop)**:
  - Clean card face containing only checkbox, title, and the 3-dot action button.
  - Reorder entire lists using list header movement arrows (`◀` / `▶`).

- **Quick Add & Inline Controls**:
  - Inline input bar right inside every list for instant todo creation.
  - `+` button opens a priority picker modal (`Urgent`, `High`, `Medium`, `Low`, `None`).
  - Auto-priority inline shorthand parser: e.g. `!urgent`, `!high`, `!med`, `!low`.
  - Single-tap completion checkbox with strike-through styling.
  - Priority border colors on cards reflecting priority levels at a glance.

- **Robust Mobile & PWA Notifications**:
  - Push/Service Worker notification integration supporting background wake-ups.
  - Fixed reminder cadences based on priority:
    - **Urgent**: Every 5 min
    - **High**: Every 15 min
    - **Medium**: Every 30 min
    - **Low**: Every 60 min
  - Multi-day assignment support (`M, T, W, R, F, S, U`) on list level and task level.
  - Master toggle with permission status badge, explicit request button, and test alert trigger.

- **Offline Storage & Multi-Board Management**:
  - 100% offline local storage in `localStorage` with `IndexedDB` mirror backups.
  - Create, rename, switch, and delete multiple boards.
  - Export and import JSON backups.

---

## 🚀 Getting Started

No build tools, bundlers, or `npm install` steps are required!

### Option 1: Direct Browser
Open `index.html` directly in your mobile browser or mobile emulator.

### Option 2: Local HTTP Server (Recommended)
Using Python:
```bash
python3 -m http.server 8080
```
Then navigate to `http://<your-device-ip>:8080` or `http://localhost:8080` in your mobile browser.

---

## 📂 Project Structure

```
├── index.html       # Mobile-optimized HTML layout and modals
├── style.css        # Mobile-first CSS design system & TUI themes
├── manifest.json    # PWA manifest for standalone home-screen install
├── sw.js            # Service worker for background reminders & notifications
├── js/
│   ├── app.js       # Main mobile coordinator (rendering, tap actions, reordering)
│   ├── notifications.js # Robust mobile notification manager & PWA sync
│   ├── reminder-core.js # Shared deterministic priority & reminder calculations
│   ├── plan-store.js    # IndexedDB mirror store for service worker access
│   ├── storage.js       # LocalStorage & IndexedDB backup persistence
│   ├── theme.js         # Theme coordinator
│   └── utils.js         # HTML escaping & modal helpers
└── README.md        # Documentation
```

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

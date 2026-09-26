# plan - Visual Task Manager 📋

A modern, fast, responsive Kanban task management application built with zero-build **Vanilla HTML5, CSS3, and ES6 JavaScript**. 

Designed for personal productivity, sprint tracking, and visual project workflows with both offline-first browser storage and real-time cloud synchronization.

---

## ✨ Features

- **Intuitive Kanban Board & Drag-and-Drop**:
  - Drag & drop cards effortlessly across columns or reorder within columns.
  - Reorder whole lists horizontally.
  - On mobile, reordering is done on the list pill bar instead of dragging whole cards: hold a pill and slide it left/right, and the stacked columns (with all their cards) follow. A quick swipe still just scrolls the pill bar.
  - Minimalist color indicators: modern circular dot badges for both columns and card priorities.

- **Two Ways to Add a Card**:
  - Fast path: type in a column's quick-add bar and press `Enter` to save with no priority.
  - Priority path: type a title, tap the column's `+` button, and a small priority picker appears - tap a priority (or `None`) and the card saves immediately, using that column's active reminder days. Tapping `+` on an empty bar just focuses the input.

- **Dedicated Search & Filter Window**:
  - Clean header icon opening a dedicated, focused search modal (`Ctrl/Cmd + K` or search icon).
  - Real-time search by title, description, and tags with hit counts.
  - Filter by priority (Urgent, High, Medium, Low), due date status (Overdue, Due Soon, No Date), and labels.
  - One-click jump directly to any card from search results.

- **Card Templates System**:
  - Pre-packaged starter templates (Bug Report, Feature Request, Meeting Action Items).
  - Create custom templates with default checklists, labels, descriptions, and priority levels.
  - Save any existing card directly into the template library.
  - Instant insertion into any chosen column.

- **Activity Timeline & Audit Trail**:
  - Card-level chronological audit log tracking moves between columns, priority adjustments, checklist item completions, and edits.
  - User comments system interleaved with audit entries.
  - Filter timeline tabs by: **All**, **Comments**, or **History**.

- **Modern Visual UI & Polish**:
  - Custom rounded SVG-style checkboxes with animated strike-through styling.
  - Gradient pill progress bar tracking checklist completion percentage.
  - Custom 12-color popover palette for lists and tags.
  - Sleek, cross-browser minimalist pill scrollbars for vertical lists and horizontal board tracks.
  - Seamless Theme Switcher: **Dark (Slate)**, **Light (Clean)**, **TUI Matrix (Phosphor Green)**, and **TUI Amber (Retro CRT Terminal)** with persistence.
  - Authentic TUI experience: sharp ASCII/Unicode geometry, JetBrains Mono typography, tmux/lazygit-style bottom status bar with real-time stats & clock, and toggleable vintage CRT scanlines (`c`).

- **Persistence & Cloud Sync**:
  - **100% Offline by default**: Automatically saves board state, active cards, templates, and theme settings in browser `localStorage`.
  - **Optional Supabase Cloud Sync**: Connect your Supabase project in `⚙️ Settings` to sync boards in real-time across multiple devices and browsers.
  - **JSON Export & Import**: Backup boards to `.json` files or restore backups anytime.
  - **Archive System**: Archive completed or inactive cards and restore or purge them from the Archive modal.

---

## 🚀 Getting Started

No build tools, bundlers, or `npm install` steps are required!

### Option 1: Direct Browser
Open `index.html` directly in any modern web browser (Chrome, Firefox, Safari, Edge).

### Option 2: Local HTTP Server (Recommended)
Using Python:
```bash
python3 -m http.server 8080
```
Then navigate to `http://localhost:8080` in your browser.

Using Node `serve` or `npx`:
```bash
npx serve .
```

---

## ☁️ Supabase Cloud Sync Setup (Optional)

To synchronize your boards across different devices or teams in real time:

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard and run:

```sql
-- 1. Create the boards table for full board state persistence
create table if not exists boards (
  id text primary key,
  content jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Enable Row Level Security (RLS)
alter table boards enable row level security;

-- 3. Allow anonymous read/write access (using the anon key)
create policy "Allow anon full access" 
  on boards 
  for all 
  using (true) 
  with check (true);

-- 4. Enable Realtime replication for instant cross-device updates
alter publication supabase_realtime add table boards;
```

3. In plan, click **⚙️ Settings** in the top navigation bar.
4. Paste your **Supabase Project URL**, **Public Anon Key**, and optional **Board Sync ID**, then click **Save Cloud Settings**.

### Sync Architecture & Notes

- **Entire Board Sync**: Each board syncs its complete state (columns, cards, checklists, order, and metadata) as an isolated row in the `boards` table identified by its unique board ID.
- **Board Isolation**: Switching or updating boards will not overwrite other boards or active boards on other devices.
- **Realtime Updates**: The `supabase_realtime` publication ensures edits on one device broadcast immediately to other open sessions.
- **Legacy `shared_cards` Table**: The app operates in full board sync mode; the `shared_cards` table is no longer required and can be safely dropped or omitted.

> ⚠️ **Access Control Note:** The policy above grants full read/write access to
> anyone with the project URL and anon key. For restricted team or enterprise environments,
> configure Supabase Auth alongside custom user-scoped RLS policies.


---

## 📂 Project Structure

```
├── index.html       # Semantic HTML layout, modals (Card Detail, Search, Templates, Settings, Archive, Priority Picker)
├── style.css        # Modern design system, CSS variables, Dark/Light modes, custom scrollbars
├── js/
│   ├── app.js       # Main application lifecycle, column & card DOM rendering, search modal, templates
│   ├── modal.js     # Card detail modal, checklist logic, audit timeline, labels & attachments
│   ├── dnd.js       # Drag & drop system for desktop HTML5 DnD + mobile/touch adapter
│   ├── storage.js   # LocalStorage persistence layer + Supabase REST sync API
│   └── theme.js     # Light/Dark theme toggling and preference persistence
└── README.md        # Documentation and guide
```

---

## 🛠️ Tech Stack

- **HTML5**: Semantic tags, accessible modal dialogs, and native drag events.
- **CSS3**: CSS Custom Properties (variables), Flexbox, CSS Grid, custom scrollbar styling, keyframe animations.
- **Vanilla JavaScript (ES6 Modules)**: Native browser APIs, zero external runtime bundlers.
- **Lucide Icons**: Feather-light icon set via CDN.
- **Supabase JS Client**: Optional real-time cloud persistence via CDN.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

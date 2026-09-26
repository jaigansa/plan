/**
 * Storage manager with:
 * - Multi-board support (multiple boards list, active board ID)
 * - Undo / Redo history stack (snapshots on user action)
 * - Supabase realtime sync
 * - IndexedDB auto-backup (survives localStorage being cleared)
 * - Offline write queue (retries on reconnect)
 *
 * Cloud sync merges instead of overwriting; see sync-merge.js.
 */
import { mergeBoards } from './sync-merge.js';

const BOARDS_STORE_KEY = 'kanban_boards_v2';
const ACTIVE_BOARD_KEY = 'kanban_active_board_v2';
const SUPABASE_CONFIG_KEY = 'kanban_supabase_config_v1';
const SYNC_STATE_KEY = 'kanban_sync_state_v1';
const PENDING_QUEUE_KEY = 'kanban_pending_sync_v1';

function parseBoardContent(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatSyncErrorMessage(err, prefix = 'Cloud sync failed') {
  const msg = (err && (err.message || err.error_description || (typeof err === 'string' ? err : ''))) || 'Unknown error';
  if (/type uuid/i.test(msg)) {
    return "Supabase 'id' column must be type 'text' (not 'uuid'). See SQL in README.";
  }
  if (/relation.*boards.*does not exist/i.test(msg)) {
    return "Table 'boards' does not exist in Supabase. Run SQL in README.";
  }
  if (/row-level security/i.test(msg) || /violates row-level security/i.test(msg)) {
    return "RLS policy error in Supabase. Add anon full access policy from README.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Network error: check Supabase URL, Key, or internet connection.";
  }
  return `${prefix}: ${msg}`;
}

export function isDefaultStarterBoard(board) {
  if (!board) return false;
  if (board.isDefault === true) return true;
  const cards = board.cards || {};
  const keys = Object.keys(cards);
  if (keys.length === 5 &&
      cards['card-1'] &&
      cards['card-2'] &&
      cards['card-3'] &&
      cards['card-4'] &&
      cards['card-truck'] &&
      (!board.archivedCards || board.archivedCards.length === 0)) {
    return true;
  }
  return false;
}

export const createDefaultBoard = (id = 'board-1', title = 'My Project Board') => ({
  id,
  title,
  theme: 'dark',
  isDefault: true,
  lists: [
    {
      id: 'list-todo',
      title: 'Plan',
      color: '#3b82f6', // Column color badge
      cardIds: ['card-1', 'card-2', 'card-truck']
    },
    {
      id: 'list-in-progress',
      title: 'Progress',
      color: '#eab308',
      cardIds: ['card-3']
    },
    {
      id: 'list-done',
      title: 'Done',
      color: '#10b981',
      cardIds: ['card-4']
    },
    {
      id: 'list-drop',
      title: 'Drop',
      color: '#64748b',
      cardIds: []
    }
  ],
  cards: {
    'card-1': {
      id: 'card-1',
      title: 'Welcome to your Kanban board',
      description: 'You can drag and drop cards between lists, reorder them, or click on them to view details.',
      priority: 'low',
      labels: [{ id: 'l1', name: 'Welcome', color: '#10b981' }],
      dueDate: '',
      checklist: [
        { id: 'c1', text: 'Drag this card to "Progress"', done: false },
        { id: 'c2', text: 'Click to open details modal', done: false }
      ],
      comments: [
        { id: 'cm-1', text: 'Welcome! You can add notes or team discussions here.', createdAt: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    },
    'card-2': {
      id: 'card-2',
      title: 'Try Dark / Light Mode & Shortcuts',
      description: 'Press [?] to view keyboard shortcuts, [n] to create a card, or [/] to search.',
      priority: 'medium',
      labels: [{ id: 'l2', name: 'Feature', color: '#3b82f6' }],
      dueDate: new Date().toISOString().split('T')[0],
      checklist: [],
      comments: [],
      createdAt: new Date().toISOString()
    },
    'card-3': {
      id: 'card-3',
      title: 'Customize cards, priorities & checklists',
      description: 'Set priority levels, column colors, and checklists with instant on-card checking.',
      priority: 'urgent',
      labels: [{ id: 'l3', name: 'High Priority', color: '#ef4444' }],
      dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      checklist: [
        { id: 'c3', text: 'Add your own task item', done: true },
        { id: 'c4', text: 'Set a target completion date', done: false }
      ],
      comments: [
        { id: 'cm-2', text: 'Checklist subtasks can be checked directly on the board.', createdAt: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    },
    'card-4': {
      id: 'card-4',
      title: 'Set up Supabase Cloud Sync (Optional)',
      description: 'Configure your Supabase project in Settings to sync your board, cards, and theme in real-time across devices.',
      priority: 'high',
      labels: [{ id: 'l4', name: 'Cloud', color: '#8b5cf6' }],
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
      checklist: [],
      comments: [],
      createdAt: new Date().toISOString()
    },
    'card-truck': {
      id: 'card-truck',
      title: 'Truck body work',
      description: 'Fabricating the truck body: measure the chassis, cut and weld the frame, fit the panels, then prime and paint.',
      priority: 'high',
      labels: [{ id: 'l5', name: 'Fabrication', color: '#f97316' }],
      dueDate: '',
      checklist: [
        { id: 'c5', text: 'Measure chassis and mark out the body frame', done: false },
        { id: 'c6', text: 'Cut and weld the sub-frame and cross members', done: false },
        { id: 'c7', text: 'Fit and align the side and rear panels', done: false },
        { id: 'c8', text: 'Prime, rust-proof and paint', done: false }
      ],
      comments: [],
      createdAt: new Date().toISOString()
    }
  },
  archivedCards: [] // List of archived card objects
});

export class StorageManager {
  constructor() {
    this.boards = this.loadAllBoards();
    this.activeBoardId = localStorage.getItem(ACTIVE_BOARD_KEY) || 'board-1';
    
    // Validate active board exists
    if (!this.boards[this.activeBoardId]) {
      this.activeBoardId = Object.keys(this.boards)[0] || 'board-1';
    }

    this.data = this.boards[this.activeBoardId];

    // Undo / Redo History Stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 30;

    this.supabaseClient = null;
    this.supabaseConfig = this.loadSupabaseConfig();
    this.syncStatusListeners = [];
    this.realtimeChannel = null;
    this.initSupabase();

    // Retry queued cloud writes when the network or tab comes back.
    this.startQueueListeners();

    // If localStorage was cleared but IndexedDB still has snapshots, put them
    // back. If there is nothing to restore, this is also where the in-memory
    // default board gets written for the first time.
    this.reconcileFromBackup().then((restored) => {
      if (restored) {
        this.boards = this.loadAllBoards();
        if (!this.boards[this.activeBoardId]) {
          this.activeBoardId = Object.keys(this.boards)[0];
        }
        this.data = this.boards[this.activeBoardId];
        try { window.dispatchEvent(new CustomEvent('board:updated')); } catch (e) { /* no-op */ }
      } else if (!localStorage.getItem(BOARDS_STORE_KEY)) {
        this.saveAllBoards();
      }
      this.backupNow();
    });

    // Best-effort final snapshot when the tab goes away.
    window.addEventListener('pagehide', () => { this.flushBackup(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushBackup();
    });
  }

  onSyncStatusChange(cb) {
    this.syncStatusListeners.push(cb);
  }

  notifyStatus(status) {
    this._lastStatus = status;
    this.syncStatusListeners.forEach(fn => {
      try { fn(status); } catch (e) { /* no-op */ }
    });
  }

  loadAllBoards() {
    try {
      const raw = localStorage.getItem(BOARDS_STORE_KEY) || localStorage.getItem('trello_clone_boards_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          Object.keys(parsed).forEach(k => {
            if (!parsed[k].archivedCards) parsed[k].archivedCards = [];
            if (parsed[k].cards) {
              Object.keys(parsed[k].cards).forEach(cId => {
                delete parsed[k].cards[cId].cover;
              });
            }
          });
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error reading boards store:', e);
    }
    // Nothing stored. Hand back a default IN MEMORY ONLY: writing it here would
    // make localStorage look non-empty, and reconcileFromBackup() - which has to
    // wait for IndexedDB - would then decide there was nothing to restore. The
    // constructor persists this default later, once the restore check has run.
    return { 'board-1': createDefaultBoard('board-1', 'My Project Board') };
  }

  /**
   * Async safety net: if localStorage is empty but IndexedDB still has snapshots,
   * write them back. Safe to call repeatedly.
   */
  async reconcileFromBackup() {
    const store = typeof self !== 'undefined' ? self.PlanStore : null;
    if (!store || !store.hasIndexedDB()) return false;
    try {
      const raw = localStorage.getItem(BOARDS_STORE_KEY);
      if (raw) {
        // A malformed or empty-but-present value still counts as "we have
        // something"; only a genuinely absent key is worth recovering.
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Object.keys(parsed).length) return false;
        } catch (e) { /* fall through and recover */ }
      }

      // Prefer a snapshot of the whole workspace, so no board is lost.
      let boards = null;
      const combined = await store.getLatestBoardsBackup();
      if (combined && combined.boards) {
        boards = combined.boards;
      } else {
        const list = await store.listBackups();
        if (!list.length) return false;
        const newest = list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
        const snap = await store.getLatestBackup(newest.boardId);
        if (!snap || !snap.data) return false;
        boards = { [snap.boardId]: snap.data };
      }

      const ids = Object.keys(boards);
      if (!ids.length) return false;

      ids.forEach(id => {
        if (!boards[id].archivedCards) boards[id].archivedCards = [];
      });

      localStorage.setItem(BOARDS_STORE_KEY, JSON.stringify(boards));
      const wanted = localStorage.getItem(ACTIVE_BOARD_KEY);
      if (!wanted || !boards[wanted]) localStorage.setItem(ACTIVE_BOARD_KEY, ids[0]);

      this.notifyStatus({ online: false, syncing: false, message: 'Restored from local backup' });
      return true;
    } catch (e) {
      console.warn('Backup reconcile failed:', e);
      return false;
    }
  }

  /**
   * Snapshot every board to IndexedDB. Never throws: a missed backup must not
   * be able to break a save.
   */
  backupNow() {
    const store = typeof self !== 'undefined' ? self.PlanStore : null;
    if (!store || !store.hasIndexedDB()) return Promise.resolve(false);
    return store.putBoardsBackup(this.boards, Date.now())
      .then(() => true)
      .catch((e) => { console.warn('Backup write failed:', e); return false; });
  }

  saveAllBoards() {
    this.boards[this.activeBoardId] = this.data;
    try {
      localStorage.setItem(BOARDS_STORE_KEY, JSON.stringify(this.boards));
      localStorage.setItem(ACTIVE_BOARD_KEY, this.activeBoardId);
    } catch (e) {
      console.error('Error saving boards store:', e);
      // Most likely QuotaExceededError. Surface it instead of losing writes.
      this.notifyStatus({ online: false, syncing: false, message: 'Storage full - changes may not save' });
      return;
    }
    this.scheduleBackup();
  }

  /**
   * Throttled IndexedDB snapshot: at most one write every 10s, plus a trailing
   * write so the final state is always captured.
   */
  scheduleBackup() {
    if (this._backupTimer) return;
    this._backupPending = true;
    this._backupTimer = setTimeout(() => {
      this._backupTimer = null;
      if (this._backupPending) {
        this._backupPending = false;
        this.backupNow();
      }
    }, 10000);
    if (this._backupTimer && typeof this._backupTimer.unref === 'function') {
      this._backupTimer.unref();
    }
  }

  /** Force an immediate snapshot (used on pagehide/unload). */
  flushBackup() {
    if (this._backupTimer) {
      clearTimeout(this._backupTimer);
      this._backupTimer = null;
    }
    this._backupPending = false;
    return this.backupNow();
  }

  // --- Undo / Redo ---
  recordHistory() {
    // Push deep copy of current board state before mutating
    this.undoStack.push(JSON.stringify(this.data));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    // Any new action clears the redo stack
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    this.redoStack.push(JSON.stringify(this.data));
    const previous = JSON.parse(this.undoStack.pop());
    this.data = previous;
    this.saveAllBoards();
    this.syncToSupabase();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.undoStack.push(JSON.stringify(this.data));
    const next = JSON.parse(this.redoStack.pop());
    this.data = next;
    this.saveAllBoards();
    this.syncToSupabase();
    return true;
  }

  saveLocal(data, record = true) {
    if (record) {
      this.recordHistory();
      if (data && data.isDefault) {
        delete data.isDefault;
      }
    }
    this.data = data;
    this.saveAllBoards();
    this.syncToSupabase();
  }

  deleteCard(cardId, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    if (!board) return false;

    if (board.cards) {
      delete board.cards[cardId];
    }
    if (Array.isArray(board.lists)) {
      board.lists.forEach(l => {
        if (Array.isArray(l.cardIds)) {
          l.cardIds = l.cardIds.filter(id => id !== cardId);
        }
      });
    }

    if (!Array.isArray(board.deletedCardIds)) {
      board.deletedCardIds = [];
    }
    if (!board.deletedCardIds.includes(cardId)) {
      board.deletedCardIds.push(cardId);
      if (board.deletedCardIds.length > 200) {
        board.deletedCardIds.shift();
      }
    }

    this.saveLocal(board);
    return true;
  }

  getData() {
    return this.data;
  }

  getAllBoards() {
    return this.boards;
  }

  getActiveBoardId() {
    return this.activeBoardId;
  }

  switchBoard(boardId) {
    if (this.boards[boardId]) {
      this.activeBoardId = boardId;
      this.data = this.boards[boardId];
      this.undoStack = [];
      this.redoStack = [];
      this.saveAllBoards();
      this.initSupabase();
      return true;
    }
    return false;
  }

  createBoard(title) {
    const id = 'board-' + Date.now();
    const newBoard = createDefaultBoard(id, title || 'New Board');
    newBoard.lists = [
      { id: 'list-todo-' + id, title: 'Plan', color: '#3b82f6', cardIds: [] },
      { id: 'list-prog-' + id, title: 'Progress', color: '#eab308', cardIds: [] },
      { id: 'list-done-' + id, title: 'Done', color: '#10b981', cardIds: [] },
      { id: 'list-drop-' + id, title: 'Drop', color: '#64748b', cardIds: [] }
    ];
    newBoard.cards = {};
    this.boards[id] = newBoard;
    this.switchBoard(id);
    return id;
  }

  deleteCurrentBoard() {
    const keys = Object.keys(this.boards);
    if (keys.length <= 1) {
      if (typeof alert === 'function') alert('Cannot delete the only remaining board.');
      return false;
    }
    const toDeleteId = this.activeBoardId;
    const toDeleteSyncId = this.getSyncBoardId(toDeleteId);
    delete this.boards[toDeleteId];
    this.activeBoardId = Object.keys(this.boards)[0];
    this.data = this.boards[this.activeBoardId];
    this.undoStack = [];
    this.redoStack = [];
    this.saveAllBoards();
    this.initSupabase();
    if (this.supabaseClient) {
      try {
        this.supabaseClient.from('boards').delete().eq('id', toDeleteSyncId).then(() => {}).catch(() => {});
      } catch (e) { /* no-op */ }
    }
    return true;
  }

  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && parsed.lists && parsed.cards) {
        if (!parsed.theme) parsed.theme = 'dark';
        this.saveLocal(parsed);
        return true;
      }
    } catch (e) {
      console.error('Invalid JSON import:', e);
    }
    return false;
  }

  resetToDefault() {
    this.saveLocal(createDefaultBoard(this.activeBoardId, this.data.title || 'My Project Board'));
  }

  // --- Supabase Integration ---
  loadSupabaseConfig() {
    try {
      const raw = localStorage.getItem(SUPABASE_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          url: parsed.url || '',
          key: parsed.key || '',
          boardId: parsed.boardId || '',
          mode: parsed.mode === 'cards' ? 'cards' : 'board',
        };
      }
    } catch {
      /* fall through to defaults */
    }
    return { url: '', key: '', boardId: '', mode: 'board' };
  }

  saveSupabaseConfig(config) {
    // Preserve the existing mode when a caller does not specify one.
    this.supabaseConfig = {
      url: (config.url || '').trim(),
      key: (config.key || '').trim(),
      boardId: (config.boardId || '').trim(),
      mode: config.mode === 'cards' ? 'cards' : 'board',
    };
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(this.supabaseConfig));
    this.initSupabase();
  }

  // 'board' = whole board as one jsonb blob (legacy, default)
  // 'cards' = one row per card, only cards flagged shared:true
  getSyncMode() {
    return this.supabaseConfig && this.supabaseConfig.mode === 'cards' ? 'cards' : 'board';
  }

  isCardsMode() {
    return this.getSyncMode() === 'cards';
  }

  isConnected() {
    return !!(this.supabaseClient && this.supabaseConfig.url && this.supabaseConfig.key);
  }

  getSyncBoardId(targetBoardId = this.activeBoardId) {
    const targetId = targetBoardId || this.activeBoardId || 'board-1';
    const board = (this.boards && this.boards[targetId]) || (targetId === this.activeBoardId ? this.data : null);
    if (board && board.syncId) {
      return board.syncId;
    }
    // Only the primary 'board-1' inherits legacy global boardId if set
    if (targetId === 'board-1' && this.supabaseConfig && this.supabaseConfig.boardId) {
      return this.supabaseConfig.boardId;
    }
    return targetId;
  }

  setBoardSyncId(boardId, syncId) {
    const targetId = boardId || this.activeBoardId;
    const board = (this.boards && this.boards[targetId]) || (targetId === this.activeBoardId ? this.data : null);
    if (board) {
      const clean = (syncId || '').trim();
      if (clean) {
        board.syncId = clean;
      } else {
        delete board.syncId;
      }
      this.saveAllBoards();
    }
  }

  /**
   * Cards eligible for upload: everything in a list flagged shared, plus any
   * card individually flagged (set before list-level sharing existed).
   */
  sharedCardIds(targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    const cards = (board && board.cards) || {};
    const lists = (board && board.lists) || [];
    const ids = new Set();

    for (const list of lists) {
      if (!list || !list.shared) continue;
      for (const id of (list.cardIds || [])) {
        if (cards[id]) ids.add(id);
      }
    }
    for (const id of Object.keys(cards)) {
      if (cards[id] && cards[id].shared) ids.add(id);
    }

    return [...ids];
  }

  isListShared(listId, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    const list = ((board && board.lists) || []).find(l => l.id === listId);
    return !!(list && list.shared);
  }

  /**
   * Flag a whole list for cloud sync. The list flag is authoritative for its
   * cards, so cards added to the list later are picked up automatically.
   */
  setListShared(listId, shared, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    if (!board || !Array.isArray(board.lists)) return false;
    const list = board.lists.find(l => l.id === listId);
    if (!list) return false;

    list.shared = !!shared;
    const cards = board.cards || {};
    for (const id of (list.cardIds || [])) {
      if (cards[id]) cards[id] = { ...cards[id], shared: !!shared };
    }
    return true;
  }

  initSupabase() {
    const { url, key } = this.supabaseConfig;
    const activeBoardId = this.activeBoardId;
    const boardSyncId = this.getSyncBoardId(activeBoardId);

    if (this.realtimeChannel && this.supabaseClient) {
      try {
        this.supabaseClient.removeChannel(this.realtimeChannel);
      } catch (e) {
        console.warn('Channel cleanup:', e);
      }
      this.realtimeChannel = null;
    }

    if (url && key && window.supabase) {
      try {
        this.supabaseClient = window.supabase.createClient(url, key);
        this.notifyStatus({ online: true, syncing: false, message: 'Supabase Connected' });
        if (this.isCardsMode()) {
          this.fetchSharedCards(activeBoardId);
        } else {
          this.fetchFromSupabase(activeBoardId);
          this.syncAllBoardsFromSupabase();
        }
        this.subscribeRealtime(boardSyncId, activeBoardId);
      } catch (err) {
        console.error('Supabase init error:', err);
        this.notifyStatus({ online: false, syncing: false, message: 'Supabase Config Error' });
      }
    } else {
      this.supabaseClient = null;
      this.notifyStatus({ online: false, syncing: false, message: 'Local Storage' });
    }
  }

  subscribeRealtime(boardSyncId, targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;

    // Shared-cards mode listens on the per-card table and merges single cards.
    if (this.isCardsMode()) {
      try {
        this.realtimeChannel = this.supabaseClient
          .channel(`shared-cards-${boardSyncId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'shared_cards', filter: `board_id=eq.${boardSyncId}` },
            (payload) => {
              if (payload.eventType === 'DELETE') {
                this.removeSharedCardLocally(payload.old ? payload.old.card_id : null, targetBoardId);
                return;
              }
              if (payload.new && payload.new.content) {
                this.mergeSharedCards([payload.new.content], targetBoardId);
              }
              this.notifyStatus({ online: true, syncing: false, message: 'Synced in Real-time' });
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('Realtime subscription failed:', e);
      }
      return;
    }

    try {
      this.realtimeChannel = this.supabaseClient
        .channel(`board-${boardSyncId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'boards', filter: `id=eq.${boardSyncId}` },
          (payload) => {
            const remoteContent = payload.new ? parseBoardContent(payload.new.content) : null;
            if (remoteContent) {
              const currentTarget = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
              if (!currentTarget) return;

              const base = this.getSyncSnapshot(boardSyncId);
              const { data: merged, conflicts, changedLocally } =
                mergeBoards(base, currentTarget, remoteContent);

              merged.id = targetBoardId;
              this.boards[targetBoardId] = merged;
              this.setSyncSnapshot(boardSyncId, merged, payload.new.updated_at);

              if (targetBoardId === this.activeBoardId) {
                if (conflicts.length) this.reportConflicts(conflicts);
                this.data = merged;
                this.saveAllBoards();
                window.dispatchEvent(new CustomEvent('board:updated'));
              } else {
                this.saveAllBoards();
              }

              if (changedLocally) {
                this.enqueueSync(targetBoardId);
                this.flushQueue();
              }
              this.notifyStatus({ online: true, syncing: false, message: 'Synced in Real-time' });
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.notifyStatus({ online: true, syncing: false, message: 'Supabase Connected' });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.notifyStatus({ online: false, syncing: false, message: 'Realtime disconnected - retrying' });
          }
        });
    } catch (e) {
      console.warn('Realtime subscription failed:', e);
    }
  }

  /**
   * Pull the cloud board and MERGE it with local edits.
   * Target board is explicitly scoped to avoid cross-board contamination.
   */
  async fetchFromSupabase(targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;
    try {
      this.notifyStatus({ online: true, syncing: true, message: 'Syncing with Supabase...' });
      const boardSyncId = this.getSyncBoardId(targetBoardId);
      const targetBoard = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
      if (!targetBoard) return;

      const { data, error } = await this.supabaseClient
        .from('boards')
        .select('content, updated_at')
        .eq('id', boardSyncId)
        .maybeSingle();

      if (error) throw error;

      const remoteContent = data ? parseBoardContent(data.content) : null;
      if (remoteContent) {
        let merged;
        let conflicts = [];
        let changedLocally = false;

        if (isDefaultStarterBoard(targetBoard)) {
          // Untouched default starter board on a new device (e.g. mobile).
          // Cleanly adopt the remote board from cloud without injecting sample demo cards.
          merged = JSON.parse(JSON.stringify(remoteContent));
          merged.id = targetBoardId;
          delete merged.isDefault;
        } else {
          const base = this.getSyncSnapshot(boardSyncId);
          const res = mergeBoards(base, targetBoard, remoteContent);
          merged = res.data;
          conflicts = res.conflicts || [];
          changedLocally = res.changedLocally;
          merged.id = targetBoardId;
        }

        if (conflicts.length && targetBoardId === this.activeBoardId) {
          this.reportConflicts(conflicts);
        }

        const differs = JSON.stringify(merged) !== JSON.stringify(remoteContent);
        this.boards[targetBoardId] = merged;
        this.setSyncSnapshot(boardSyncId, merged, data.updated_at);

        if (targetBoardId === this.activeBoardId) {
          this.data = merged;
          this.saveAllBoards();
          window.dispatchEvent(new CustomEvent('board:updated'));
        } else {
          this.saveAllBoards();
        }

        // Anything we changed locally still needs to go back up.
        if (changedLocally && differs) {
          this.enqueueSync(targetBoardId);
          this.flushQueue();
        }

        this.notifyStatus({
          online: true,
          syncing: false,
          message: conflicts.length
            ? `Synced with ${conflicts.length} conflict(s) merged`
            : 'Synced with Cloud'
        });
      } else {
        this.enqueueSync(targetBoardId);
        this.flushQueue();
      }
    } catch (err) {
      console.warn('Supabase fetch error, keeping local data:', err.message);
      this.enqueueSync(targetBoardId);
      this.notifyStatus({ online: false, syncing: false, message: formatSyncErrorMessage(err, 'Cloud sync failed') });
    }
  }

  async syncAllBoardsFromSupabase() {
    if (!this.supabaseClient || this.isCardsMode()) return;
    try {
      const { data, error } = await this.supabaseClient
        .from('boards')
        .select('id, content, updated_at');
      if (error || !Array.isArray(data)) return;

      let changed = false;
      for (const row of data) {
        if (!row || !row.id || !row.content) continue;
        const remoteContent = parseBoardContent(row.content);
        if (!remoteContent) continue;

        let localId = null;
        for (const [id] of Object.entries(this.boards)) {
          if (this.getSyncBoardId(id) === row.id) {
            localId = id;
            break;
          }
        }

        if (!localId) {
          localId = remoteContent.id || row.id;
          if (!this.boards[localId]) {
            this.boards[localId] = remoteContent;
            this.setSyncSnapshot(row.id, remoteContent, row.updated_at);
            changed = true;
          }
        } else if (localId !== this.activeBoardId) {
          const base = this.getSyncSnapshot(row.id);
          const { data: merged } = mergeBoards(base, this.boards[localId], remoteContent);
          merged.id = localId;
          this.boards[localId] = merged;
          this.setSyncSnapshot(row.id, merged, row.updated_at);
          changed = true;
        }
      }

      // If active board is an untouched starter board, and remote has real boards,
      // switch to the first real remote board so a mobile user sees their cloud content.
      if (isDefaultStarterBoard(this.data) && data.length > 0) {
        const matchingCurrent = data.some(r => r.id === this.getSyncBoardId(this.activeBoardId));
        if (!matchingCurrent) {
          const firstRemoteRow = data[0];
          const firstContent = parseBoardContent(firstRemoteRow.content);
          const targetKey = (firstContent && firstContent.id) || firstRemoteRow.id;
          if (this.boards[targetKey]) {
            delete this.boards[this.activeBoardId];
            this.activeBoardId = targetKey;
            this.data = this.boards[targetKey];
            changed = true;
          }
        }
      }

      if (changed) {
        this.saveAllBoards();
        window.dispatchEvent(new CustomEvent('board:updated'));
      }
    } catch (e) {
      console.warn('Could not sync all boards from cloud:', e);
    }
  }

  // --- Shared Cards Mode (one row per card) ---
  async fetchSharedCards(targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;
    try {
      this.notifyStatus({ online: true, syncing: true, message: 'Fetching shared cards...' });
      const boardSyncId = this.getSyncBoardId(targetBoardId);
      const { data, error } = await this.supabaseClient
        .from('shared_cards')
        .select('content')
        .eq('board_id', boardSyncId);

      if (error) throw error;

      const remote = (data || []).map(r => r.content).filter(c => c && c.id);
      this.mergeSharedCards(remote, targetBoardId);
      this.notifyStatus({ online: true, syncing: false, message: `${remote.length} shared card(s)` });
    } catch (err) {
      console.warn('Shared cards fetch error:', err.message);
      this.notifyStatus({ online: false, syncing: false, message: 'Cloud sync failed: ' + err.message });
    }
  }

  /**
   * Merge remote shared cards into the local board.
   * Scoped to target board so other boards are not touched.
   */
  mergeSharedCards(remoteCards, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    if (!board) return false;
    if (!board.cards) board.cards = {};

    let changed = false;
    for (const remote of remoteCards) {
      if (!remote || !remote.id) continue;
      const local = board.cards[remote.id];
      // Remote wins for the card body, but keep local-only fields and force shared.
      board.cards[remote.id] = { ...(local || {}), ...remote, shared: true };
      if (this.attachCardToList(remote.id, targetBoardId)) changed = true;
      changed = true;
    }

    if (changed) {
      if (targetBoardId === this.activeBoardId) {
        this.data = board;
      }
      this.boards[targetBoardId] = board;
      this.saveAllBoards();
      window.dispatchEvent(new CustomEvent('board:updated'));
    }
    return changed;
  }

  removeSharedCardLocally(cardId, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    if (!cardId || !board || !board.cards || !board.cards[cardId]) return;
    board.cards[cardId] = { ...board.cards[cardId], shared: false };
    if (targetBoardId === this.activeBoardId) {
      this.data = board;
    }
    this.boards[targetBoardId] = board;
    this.saveAllBoards();
    window.dispatchEvent(new CustomEvent('board:updated'));
  }

  /**
   * Ensure a card is referenced by some list so it renders.
   */
  attachCardToList(cardId, targetBoardId = this.activeBoardId) {
    const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
    if (!board || !Array.isArray(board.lists)) return false;
    const already = board.lists.some(l => (l.cardIds || []).includes(cardId));
    if (already) return false;

    if (board.lists.length === 0) {
      board.lists.push({ id: 'list-shared-' + targetBoardId, title: 'Shared', color: '#8b5cf6', cardIds: [cardId] });
      return true;
    }
    board.lists[0].cardIds.push(cardId);
    return true;
  }

  async syncSharedCards(targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;
    try {
      const boardSyncId = this.getSyncBoardId(targetBoardId);
      const board = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
      if (!board) return;
      const cards = board.cards || {};
      const sharedIds = this.sharedCardIds(targetBoardId);

      // Prune rows for cards that are no longer shared (or were deleted).
      const { data: existing, error: exErr } = await this.supabaseClient
        .from('shared_cards')
        .select('card_id')
        .eq('board_id', boardSyncId);

      if (exErr) throw exErr;

      const desired = new Set(sharedIds);
      const stale = (existing || [])
        .map(r => r.card_id)
        .filter(cid => !desired.has(cid));

      if (stale.length) {
        const { error: delErr } = await this.supabaseClient
          .from('shared_cards')
          .delete()
          .eq('board_id', boardSyncId)
          .in('card_id', stale);
        if (delErr) throw delErr;
      }

      if (sharedIds.length) {
        const now = new Date().toISOString();
        const rows = sharedIds.map(id => ({
          board_id: boardSyncId,
          card_id: id,
          content: { ...cards[id], shared: true },
          updated_at: now,
        }));
        const { error } = await this.supabaseClient.from('shared_cards').upsert(rows);
        if (error) throw error;
      }

      this.clearQueue(targetBoardId);
      this.notifyStatus({
        online: true,
        syncing: false,
        message: `Synced ${sharedIds.length} shared card(s)`,
      });
    } catch (err) {
      console.error('Shared cards upload error:', err);
      this.enqueueSync(targetBoardId);
      this.notifyStatus({ online: false, syncing: false, message: 'Cloud save failed: ' + err.message });
    }
  }

  syncToSupabase(targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;
    if (this.isCardsMode()) return this.syncSharedCards(targetBoardId);
    return this.syncBoardBlob(targetBoardId);
  }

  /**
   * Push the board up, but only after checking whether the cloud copy moved
   * since our last sync. If it did, merge both sides rather than clobbering.
   */
  async syncBoardBlob(targetBoardId = this.activeBoardId) {
    if (!this.supabaseClient) return;
    try {
      this.notifyStatus({ online: true, syncing: true, message: 'Saving to Supabase...' });
      const boardSyncId = this.getSyncBoardId(targetBoardId);
      const state = this.getSyncState(boardSyncId);
      const localBoard = (this.boards && this.boards[targetBoardId]) || (targetBoardId === this.activeBoardId ? this.data : null);
      if (!localBoard) return;

      const { data: remoteRow, error: readErr } = await this.supabaseClient
        .from('boards')
        .select('content, updated_at')
        .eq('id', boardSyncId)
        .maybeSingle();
      if (readErr) throw readErr;

      let payload = localBoard;
      let conflicts = [];

      const remoteContent = remoteRow ? parseBoardContent(remoteRow.content) : null;
      const remoteChanged = remoteContent &&
        remoteRow.updated_at &&
        (!state.lastSyncedAt || String(remoteRow.updated_at) > String(state.lastSyncedAt));

      if (remoteChanged) {
        const { data: merged, conflicts: found } =
          mergeBoards(state.snapshot, localBoard, remoteContent);
        merged.id = targetBoardId;
        payload = merged;
        conflicts = found || [];
        this.boards[targetBoardId] = merged;
        if (targetBoardId === this.activeBoardId) {
          if (conflicts.length) this.reportConflicts(conflicts);
          this.data = merged;
          this.saveAllBoards();
          window.dispatchEvent(new CustomEvent('board:updated'));
        } else {
          this.saveAllBoards();
        }
      }

      const now = new Date().toISOString();
      const { error } = await this.supabaseClient
        .from('boards')
        .upsert({
          id: boardSyncId,
          content: payload,
          updated_at: now
        });

      if (error) throw error;

      this.setSyncSnapshot(boardSyncId, payload, now);
      this.clearQueue(targetBoardId);
      this.notifyStatus({
        online: true,
        syncing: false,
        message: conflicts.length
          ? `Saved to Cloud (${conflicts.length} conflict merged)`
          : 'Saved to Cloud'
      });
    } catch (err) {
      console.error('Supabase upload error:', err);
      this.enqueueSync(targetBoardId);
      this.notifyStatus({ online: false, syncing: false, message: formatSyncErrorMessage(err, 'Cloud save failed') });
    }
  }

  // --- Sync bookkeeping: last-synced snapshot, offline queue, conflicts ---

  getSyncState(boardId) {
    try {
      const raw = localStorage.getItem(SYNC_STATE_KEY);
      if (!raw) return {};
      const all = JSON.parse(raw) || {};
      const id = boardId || this.getSyncBoardId();
      return all[id] || {};
    } catch (e) {
      return {};
    }
  }

  getSyncSnapshot(boardId) {
    return this.getSyncState(boardId).snapshot || null;
  }

  setSyncSnapshot(boardId, snapshot, updatedAt) {
    try {
      const raw = localStorage.getItem(SYNC_STATE_KEY);
      const all = raw ? (JSON.parse(raw) || {}) : {};
      const id = boardId || this.getSyncBoardId();
      all[id] = {
        lastSyncedAt: updatedAt || new Date().toISOString(),
        snapshot: JSON.parse(JSON.stringify(snapshot))
      };
      localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('Could not record sync snapshot:', e);
    }
  }

  /**
   * Tell the user their edit and someone else's edit collided. Silently
   * picking a winner is how work disappeared before.
   */
  reportConflicts(conflicts) {
    const list = conflicts || [];
    if (!list.length) return;
    const titles = list.slice(0, 3).map((c) => '"' + (c.title || c.cardId) + '"').join(', ');
    const more = list.length > 3 ? ' and ' + (list.length - 3) + ' more' : '';
    this.notifyStatus({
      online: true,
      syncing: false,
      message: 'Merge conflict on ' + titles + more + ' - kept your version'
    });
    try {
      window.dispatchEvent(new CustomEvent('sync:conflicts', { detail: { conflicts: list } }));
    } catch (e) { /* no-op */ }
  }

  /** Remember that there is an unsent change for a specific board. */
  enqueueSync(targetBoardId = this.activeBoardId) {
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      let queue = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.boardId && !parsed[parsed.boardId]) {
              queue[targetBoardId] = parsed;
            } else {
              queue = parsed;
            }
          }
        } catch {}
      }
      queue[targetBoardId] = {
        boardId: this.getSyncBoardId(targetBoardId),
        at: Date.now()
      };
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { /* no-op */ }
  }

  hasPendingSync(targetBoardId) {
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      if (!raw) return false;
      const queue = JSON.parse(raw);
      if (!queue || typeof queue !== 'object') return false;
      if (targetBoardId) return Boolean(queue[targetBoardId]);
      return Object.keys(queue).length > 0;
    } catch (e) {
      return false;
    }
  }

  clearQueue(targetBoardId) {
    try {
      if (!targetBoardId) {
        localStorage.removeItem(PENDING_QUEUE_KEY);
        return;
      }
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw);
      if (queue && typeof queue === 'object') {
        delete queue[targetBoardId];
        if (Object.keys(queue).length === 0) {
          localStorage.removeItem(PENDING_QUEUE_KEY);
        } else {
          localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
        }
      }
    } catch (e) { /* no-op */ }
  }

  /**
   * Retry any queued writes across all boards.
   */
  flushQueue() {
    if (!this.supabaseClient || !this.hasPendingSync()) return;
    if (this._flushing) return;
    this._flushing = true;
    Promise.resolve()
      .then(async () => {
        const raw = localStorage.getItem(PENDING_QUEUE_KEY);
        if (!raw) return;
        const queue = JSON.parse(raw) || {};
        const keys = Object.keys(queue);
        for (const targetId of keys) {
          if (this.isCardsMode()) {
            await this.syncSharedCards(targetId);
          } else {
            await this.syncBoardBlob(targetId);
          }
        }
      })
      .catch((e) => console.warn('Queued sync retry failed:', e))
      .finally(() => { this._flushing = false; });
  }

  startQueueListeners() {
    if (this._queueListenersBound) return;
    this._queueListenersBound = true;

    const onWakeOrReconnect = () => {
      if (this.isConnected() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        this.notifyStatus({ online: true, syncing: true, message: 'Syncing with Supabase...' });
        const activeBoardId = this.activeBoardId;
        const boardSyncId = this.getSyncBoardId(activeBoardId);
        this.subscribeRealtime(boardSyncId, activeBoardId);
        if (this.isCardsMode()) {
          this.fetchSharedCards(activeBoardId);
        } else {
          this.fetchFromSupabase(activeBoardId);
          this.syncAllBoardsFromSupabase();
        }
      }
      this.flushQueue();
    };

    window.addEventListener('online', () => {
      this.notifyStatus({ online: true, syncing: false, message: 'Back online - syncing' });
      onWakeOrReconnect();
    });
    window.addEventListener('offline', () => {
      this.notifyStatus({ online: false, syncing: false, message: 'Offline - changes saved locally' });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        onWakeOrReconnect();
      }
    });
    window.addEventListener('focus', () => {
      onWakeOrReconnect();
    });
    this._queueTimer = setInterval(() => this.flushQueue(), 60000);
    if (this._queueTimer && typeof this._queueTimer.unref === 'function') {
      this._queueTimer.unref();
    }
  }
}

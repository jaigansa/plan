/**
 * Storage manager with:
 * - Multi-board support (multiple boards list, active board ID)
 * - Undo / Redo history stack (snapshots on user action)
 * - IndexedDB auto-backup (survives localStorage being cleared)
 */

const BOARDS_STORE_KEY = 'kanban_boards_v2';
const ACTIVE_BOARD_KEY = 'kanban_active_board_v2';

export function isDefaultStarterBoard(board) {
  if (!board) return false;
  if (board.isDefault === true) return true;
  const cards = board.cards || {};
  const keys = Object.keys(cards);
  if (keys.length === 0 && (!board.archivedCards || board.archivedCards.length === 0)) {
    return true;
  }
  if (keys.length === 1 && cards['card-1'] && (!board.archivedCards || board.archivedCards.length === 0)) {
    return true;
  }
  if (cards['card-1'] && cards['card-truck']) {
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
      color: '#3b82f6',
      cardIds: []
    },
    {
      id: 'list-in-progress',
      title: 'Progress',
      color: '#eab308',
      cardIds: []
    },
    {
      id: 'list-done',
      title: 'Done',
      color: '#10b981',
      cardIds: []
    },
    {
      id: 'list-drop',
      title: 'Drop',
      color: '#64748b',
      cardIds: []
    }
  ],
  cards: {},
  archivedCards: [],
  deletedCardIds: [],
  deletedListIds: []
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

    this.syncStatusListeners = [];

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
          const legacyDemoIds = new Set(['card-truck', 'card-2', 'card-3', 'card-4', 'card-1']);
          Object.keys(parsed).forEach(k => {
            const b = parsed[k];
            if (!b.archivedCards) b.archivedCards = [];
            if (!Array.isArray(b.deletedCardIds)) b.deletedCardIds = [];
            if (!Array.isArray(b.deletedListIds)) b.deletedListIds = [];
            b.deletedCardIds = b.deletedCardIds.filter(id => !legacyDemoIds.has(id));
            if (b.cards && typeof b.cards === 'object') {
              legacyDemoIds.forEach(demoId => {
                if (b.cards[demoId] && (demoId !== 'card-1' || b.cards['card-1'].title === 'Welcome to your plan')) {
                  delete b.cards[demoId];
                  if (Array.isArray(b.lists)) {
                    b.lists.forEach(l => {
                      if (Array.isArray(l.cardIds)) {
                        l.cardIds = l.cardIds.filter(cid => cid !== demoId);
                      }
                    });
                  }
                }
              });
              Object.keys(b.cards).forEach(cId => {
                delete b.cards[cId].cover;
                if ('description' in b.cards[cId] && (!b.cards[cId].description || !b.cards[cId].description.trim())) {
                  delete b.cards[cId].description;
                }
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
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this.undoStack.push(JSON.stringify(this.data));
    const next = JSON.parse(this.redoStack.pop());
    this.data = next;
    this.saveAllBoards();
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

  deleteList(listId, targetBoardId = this.activeBoardId) {
    const targetId = targetBoardId || this.activeBoardId;
    const board = (this.boards && this.boards[targetId]) || (targetId === this.activeBoardId ? this.data : null);
    if (!board || !Array.isArray(board.lists)) return false;

    const listIndex = board.lists.findIndex(l => l.id === listId);
    if (listIndex === -1) return false;

    const [removedList] = board.lists.splice(listIndex, 1);

    if (!Array.isArray(board.deletedListIds)) {
      board.deletedListIds = [];
    }
    if (!board.deletedListIds.includes(listId)) {
      board.deletedListIds.push(listId);
      if (board.deletedListIds.length > 50) {
        board.deletedListIds.shift();
      }
    }

    if (!Array.isArray(board.deletedCardIds)) {
      board.deletedCardIds = [];
    }
    (removedList.cardIds || []).forEach(cId => {
      if (board.cards) delete board.cards[cId];
      if (!board.deletedCardIds.includes(cId)) {
        board.deletedCardIds.push(cId);
      }
    });
    if (board.deletedCardIds.length > 200) {
      board.deletedCardIds = board.deletedCardIds.slice(-200);
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
    newBoard.deletedCardIds = [];
    newBoard.deletedListIds = [];
    delete newBoard.isDefault;
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
    delete this.boards[toDeleteId];
    this.activeBoardId = Object.keys(this.boards)[0];
    this.data = this.boards[this.activeBoardId];
    this.undoStack = [];
    this.redoStack = [];
    this.saveAllBoards();
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

}

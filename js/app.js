/**
 * Main application coordinator for Phosphor Green TUI plan
 * - Clean terminal interface
 * - Todo lists with inline quick-add & auto-colored priorities (!urgent, !high, !med, !low)
 * - Drag and drop card & list reordering
 * - Instant completion checkbox & inline priority cycling
 * - Backup / Export (JSON, CSV) & Board Reset
 */
import { StorageManager } from './storage.js';
import { DndController } from './dnd.js';
import { ThemeManager } from './theme.js';
import { escapeHtml, PRIORITIES, ModalHelper } from './utils.js';
import { NotificationManager, DAY_INFO } from './notifications.js';
import { generateQRCodeSVG } from './qrcode.js';

class KanbanApp {
  constructor() {
    this.storage = new StorageManager();
    this.theme = new ThemeManager(this);
    this.dnd = new DndController(this);
    this.notifications = new NotificationManager(this);

    this.boardEl = document.getElementById('board');

    this.init();
  }

  init() {
    this.checkSyncHash();
    this.setupBoardSwitcher();
    this.renderBoard();
    this.setupGlobalEvents();
    this.setupKeyboardShortcuts();
    this.setupSettingsModal();
    this.setupAddCardModal();
    this.notifications.startScheduler();

    // Listen for storage updates
    window.addEventListener('board:updated', () => {
      this.theme.applyTheme();
      this.renderBoard();
      this.renderBoardSwitcher();
    });

    // Cloud status indicator
    this.storage.onSyncStatusChange((status) => {
      this.updateCloudStatusBadge(status);
    });
  }

  checkSyncHash() {
    try {
      const hash = window.location.hash || '';
      if (hash.startsWith('#sync=')) {
        const raw = decodeURIComponent(hash.slice(6));
        let jsonStr;
        try {
          jsonStr = decodeURIComponent(escape(atob(raw)));
        } catch {
          jsonStr = atob(raw);
        }
        const decoded = JSON.parse(jsonStr);
        if (decoded && decoded.url && decoded.key) {
          if (decoded.boardId) {
            this.storage.setBoardSyncId(this.storage.getActiveBoardId(), decoded.boardId);
          }
          this.storage.saveSupabaseConfig({
            ...decoded,
            storageMode: 'cloud'
          });
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse #sync hash from URL:', e);
    }
  }

  updateCloudStatusBadge(status) {
    const badge = document.getElementById('cloud-status-badge');
    const headerPill = document.getElementById('header-sync-status');

    let stateClass = 'offline';
    let iconName = 'hard-drive';
    let pillText = 'Local';

    if (status.syncing) {
      stateClass = 'syncing';
      iconName = 'refresh-cw';
      pillText = 'Syncing...';
    } else if (status.online) {
      stateClass = 'online';
      iconName = 'cloud';
      pillText = 'Synced';
    } else if (status.message && (status.message.includes('failed') || status.message.includes('Error') || status.message.includes('offline'))) {
      stateClass = 'error';
      iconName = 'alert-circle';
      pillText = 'Sync Error';
    }

    if (badge) {
      badge.className = 'status-badge ' + (status.online ? 'online' : 'offline');
      const textEl = badge.querySelector('.badge-text');
      if (textEl) textEl.textContent = status.message;

      const existing = badge.querySelector('svg.lucide, i[data-lucide]');
      if (existing) {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', status.online ? 'cloud' : 'hard-drive');
        existing.replaceWith(icon);
      }
    }

    if (headerPill) {
      headerPill.className = `header-sync-pill ${stateClass}`;
      headerPill.title = `Storage: ${status.message || 'Local Storage'} (click to configure)`;
      const pillTextEl = headerPill.querySelector('.sync-pill-text');
      if (pillTextEl) pillTextEl.textContent = pillText;

      const existingIcon = headerPill.querySelector('svg.lucide, i[data-lucide]');
      if (existingIcon) {
        const newIcon = document.createElement('i');
        newIcon.setAttribute('data-lucide', iconName);
        if (status.syncing) newIcon.classList.add('spin-icon');
        existingIcon.replaceWith(newIcon);
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // --- Multi-Board Switcher ---
  setupBoardSwitcher() {
    const boardSelect = document.getElementById('board-select');
    const newBoardBtn = document.getElementById('btn-new-board');
    const renameBoardBtn = document.getElementById('btn-rename-board');
    const delBoardBtn = document.getElementById('btn-del-board');

    if (boardSelect) {
      boardSelect.addEventListener('change', () => {
        const selectedId = boardSelect.value;
        if (selectedId && selectedId !== this.storage.getActiveBoardId()) {
          this.storage.switchBoard(selectedId);
          this.renderBoard();
        }
      });
    }

    if (newBoardBtn) {
      newBoardBtn.addEventListener('click', () => {
        const title = prompt('Enter new board name:', 'New Board');
        if (title !== null) {
          const cleanTitle = title.trim() || 'New Board';
          this.storage.createBoard(cleanTitle);
          this.renderBoard();
        }
      });
    }

    if (renameBoardBtn) {
      renameBoardBtn.addEventListener('click', () => {
        const currentData = this.storage.getData();
        const currentTitle = currentData?.title || 'My Project Board';
        const newTitle = prompt('Rename board:', currentTitle);
        if (newTitle !== null && newTitle.trim() && newTitle.trim() !== currentTitle) {
          currentData.title = newTitle.trim();
          this.storage.saveAllBoards();
          this.storage.syncToSupabase();
          this.renderBoardSwitcher();
        }
      });
    }

    if (delBoardBtn) {
      delBoardBtn.addEventListener('click', () => {
        const boards = this.storage.getAllBoards();
        const activeId = this.storage.getActiveBoardId();
        if (Object.keys(boards).length <= 1) {
          alert('Cannot delete the only remaining board.');
          return;
        }
        const title = boards[activeId]?.title || 'this board';
        if (confirm(`Delete board "${title}" permanently?`)) {
          this.storage.deleteCurrentBoard();
          this.renderBoard();
        }
      });
    }

    this.renderBoardSwitcher();
  }

  renderBoardSwitcher() {
    const boardSelect = document.getElementById('board-select');
    const delBoardBtn = document.getElementById('btn-del-board');
    if (!boardSelect) return;

    const boards = this.storage.getAllBoards();
    const activeId = this.storage.getActiveBoardId();
    const boardIds = Object.keys(boards);

    boardSelect.innerHTML = '';
    boardIds.forEach((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = boards[id]?.title || id;
      if (id === activeId) opt.selected = true;
      boardSelect.appendChild(opt);
    });

    if (delBoardBtn) {
      delBoardBtn.disabled = boardIds.length <= 1;
      delBoardBtn.title = boardIds.length <= 1 ? 'Cannot delete the only board' : 'Delete Current Board';
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // --- Keyboard Shortcuts ---
  setupKeyboardShortcuts() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    ModalHelper.bind(shortcutsModal, 'btn-shortcuts-help', 'shortcuts-close-btn');

    document.addEventListener('keydown', (e) => {
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

      if (e.key === 'Escape') {
        if (ModalHelper.closeTopModal()) return;
        if (document.activeElement?.blur) document.activeElement.blur();
        return;
      }

      if (isInputActive) return;

      // 'n' -> Focus quick-add input in first list
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        const firstInput = this.boardEl.querySelector('.quick-add-input');
        if (firstInput) {
          firstInput.focus();
        }
      }

      // '?' -> Open Shortcuts guide
      if (e.key === '?') {
        e.preventDefault();
        if (shortcutsModal.classList.contains('hidden')) {
          ModalHelper.open(shortcutsModal);
        } else {
          ModalHelper.close(shortcutsModal);
        }
      }
    });
  }

  setupGlobalEvents() {
    // Add list form
    const addListForm = document.getElementById('add-list-form');
    const newListInput = document.getElementById('new-list-title');
    if (addListForm) {
      addListForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = newListInput.value.trim();
        if (title) {
          this.addList(title);
          newListInput.value = '';
          newListInput.focus();
        }
      });
    }

    // Board container drag over (for lists reordering)
    this.boardEl.addEventListener('dragover', (e) => {
      this.dnd.handleBoardDragOver(e, this.boardEl);
    });
    this.boardEl.addEventListener('drop', (e) => {
      this.dnd.handleBoardDrop(e, this.boardEl);
    });

    // Global mouseup cleanup for unstarted drags
    window.addEventListener('mouseup', () => {
      if (!this.dnd.isDragging) {
        document.querySelectorAll('.kanban-card[draggable="true"]').forEach(el => el.removeAttribute('draggable'));
      }
      if (!this.dnd.draggedListId) {
        document.querySelectorAll('.kanban-list[draggable="true"]').forEach(el => el.removeAttribute('draggable'));
      }
    });
  }

  setupSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    const exportBtn = document.getElementById('btn-export-json');
    const exportCsvBtn = document.getElementById('btn-export-csv');
    const importFileInput = document.getElementById('import-file-input');
    const resetBtn = document.getElementById('btn-reset-board');

    // Storage & Supabase cloud sync controls
    const btnToggleLocal = document.getElementById('btn-toggle-local');
    const btnToggleCloud = document.getElementById('btn-toggle-cloud');
    const storageModeDesc = document.getElementById('storage-mode-desc');
    const storageModeDescText = document.getElementById('storage-mode-desc-text');
    const supabaseConfigFields = document.getElementById('supabase-config-fields');
    const sbUrlInput = document.getElementById('sb-url');
    const sbKeyInput = document.getElementById('sb-key');
    const sbBoardIdInput = document.getElementById('sb-board-id');
    const saveCloudBtn = document.getElementById('btn-save-settings');
    const showQrBtn = document.getElementById('btn-show-qr');
    const copySyncLinkBtn = document.getElementById('btn-copy-sync-link');

    let currentSelectedMode = 'local';

    const setStorageModeUI = (mode) => {
      currentSelectedMode = mode === 'cloud' ? 'cloud' : 'local';
      if (currentSelectedMode === 'cloud') {
        btnToggleLocal?.classList.remove('active');
        btnToggleCloud?.classList.add('active');
        if (storageModeDesc) storageModeDesc.className = 'storage-mode-note cloud-mode';
        if (storageModeDescText) storageModeDescText.textContent = 'Cloud Mode: Syncs with Supabase in real-time across your devices.';
        supabaseConfigFields?.classList.remove('hidden');
        if (showQrBtn) showQrBtn.style.display = '';
        if (copySyncLinkBtn) copySyncLinkBtn.style.display = '';
      } else {
        btnToggleLocal?.classList.add('active');
        btnToggleCloud?.classList.remove('active');
        if (storageModeDesc) storageModeDesc.className = 'storage-mode-note';
        if (storageModeDescText) storageModeDescText.textContent = 'Local Mode: All tasks and boards are stored strictly on this device. Cloud sync and network calls are disabled.';
        supabaseConfigFields?.classList.add('hidden');
        if (showQrBtn) showQrBtn.style.display = 'none';
        if (copySyncLinkBtn) copySyncLinkBtn.style.display = 'none';
        const syncQrBox = document.getElementById('sync-qr-box');
        if (syncQrBox) syncQrBox.classList.add('hidden');
      }
      if (window.lucide) window.lucide.createIcons();
    };

    if (btnToggleLocal) {
      btnToggleLocal.addEventListener('click', () => setStorageModeUI('local'));
    }
    if (btnToggleCloud) {
      btnToggleCloud.addEventListener('click', () => setStorageModeUI('cloud'));
    }

    const populateSettings = () => {
      const config = this.storage.loadSupabaseConfig();
      const currentBoard = this.storage.getData();
      setStorageModeUI(config.storageMode || 'local');
      if (sbUrlInput) sbUrlInput.value = config.url || '';
      if (sbKeyInput) sbKeyInput.value = config.key || '';
      if (sbBoardIdInput) {
        sbBoardIdInput.value = currentBoard?.syncId || '';
        sbBoardIdInput.placeholder = this.storage.getSyncBoardId(this.storage.getActiveBoardId());
      }
      const syncCopiedMsg = document.getElementById('sync-link-copied-msg');
      if (syncCopiedMsg) syncCopiedMsg.classList.add('hidden');
      const syncQrBox = document.getElementById('sync-qr-box');
      if (syncQrBox) syncQrBox.classList.add('hidden');
      if (window.lucide) window.lucide.createIcons();
    };

    ModalHelper.bind(settingsModal, 'btn-open-settings', 'settings-close-btn', populateSettings);
    ModalHelper.bind(settingsModal, 'header-sync-status', null, populateSettings);

    const hideQrBtn = document.getElementById('btn-hide-qr');
    const syncQrBox = document.getElementById('sync-qr-box');
    const syncQrFrame = document.getElementById('sync-qr-frame');
    const syncQrLocalhostAlert = document.getElementById('sync-qr-localhost-alert');

    const getPairingConfig = () => {
      const saved = this.storage.loadSupabaseConfig() || {};
      const url = ((sbUrlInput ? sbUrlInput.value : '') || saved.url || '').trim();
      const key = ((sbKeyInput ? sbKeyInput.value : '') || saved.key || '').trim();
      const currentSyncBoardId = this.storage.getSyncBoardId(this.storage.getActiveBoardId());
      const boardId = ((sbBoardIdInput ? sbBoardIdInput.value : '') || saved.boardId || currentSyncBoardId || '').trim();
      if (sbUrlInput && !sbUrlInput.value && url) sbUrlInput.value = url;
      if (sbKeyInput && !sbKeyInput.value && key) sbKeyInput.value = key;
      if (sbBoardIdInput && !sbBoardIdInput.value && boardId) sbBoardIdInput.value = boardId;
      return { url, key, boardId, mode: 'board', storageMode: 'cloud' };
    };

    const buildPairingLink = () => {
      const config = getPairingConfig();
      if (!config.url || !config.key) return null;
      const payload = JSON.stringify(config);
      let encoded;
      try {
        encoded = btoa(unescape(encodeURIComponent(payload)));
      } catch {
        encoded = btoa(payload);
      }
      return `${window.location.origin}${window.location.pathname}#sync=${encodeURIComponent(encoded)}`;
    };

    if (showQrBtn) {
      showQrBtn.addEventListener('click', () => {
        const link = buildPairingLink();
        if (!link) {
          if (sbUrlInput && !sbUrlInput.value) sbUrlInput.focus();
          else if (sbKeyInput && !sbKeyInput.value) sbKeyInput.focus();
          alert('Please enter your Supabase Project URL and Anon Key first.');
          return;
        }

        try {
          const svgMarkup = generateQRCodeSVG(link, { scalable: true });
          if (syncQrFrame) {
            syncQrFrame.innerHTML = svgMarkup;
          }
          if (syncQrLocalhostAlert) {
            const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
            syncQrLocalhostAlert.classList.toggle('hidden', !isLocal);
          }
          if (syncQrBox) {
            syncQrBox.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
            syncQrBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        } catch (err) {
          console.error('Failed to generate QR Code:', err);
          alert('Could not generate QR code: ' + (err.message || 'Unknown error'));
        }
      });
    }

    if (hideQrBtn) {
      hideQrBtn.addEventListener('click', () => {
        if (syncQrBox) syncQrBox.classList.add('hidden');
      });
    }

    const toggleQrContrastBtn = document.getElementById('btn-toggle-qr-contrast');
    const toggleQrContrastLabel = document.getElementById('btn-toggle-qr-contrast-label');
    if (toggleQrContrastBtn && syncQrFrame) {
      toggleQrContrastBtn.addEventListener('click', () => {
        syncQrFrame.classList.toggle('qr-contrast-high');
        const isHigh = syncQrFrame.classList.contains('qr-contrast-high');
        if (toggleQrContrastLabel) {
          toggleQrContrastLabel.textContent = isHigh ? 'Terminal Mode' : 'Invert Colors';
        }
      });
    }

    const syncCopiedMsg = document.getElementById('sync-link-copied-msg');
    if (copySyncLinkBtn) {
      copySyncLinkBtn.addEventListener('click', async () => {
        const link = buildPairingLink();
        if (!link) {
          if (sbUrlInput && !sbUrlInput.value) sbUrlInput.focus();
          else if (sbKeyInput && !sbKeyInput.value) sbKeyInput.focus();
          alert('Please enter your Supabase Project URL and Anon Key first.');
          return;
        }

        let copied = false;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(link);
            copied = true;
          } catch (e) {
            copied = false;
          }
        }
        if (!copied) {
          const ta = document.createElement('textarea');
          ta.value = link;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            copied = true;
          } catch (e) {
            copied = false;
          }
          document.body.removeChild(ta);
        }

        if (syncCopiedMsg) {
          syncCopiedMsg.classList.remove('hidden');
          if (window.lucide) window.lucide.createIcons();
          setTimeout(() => {
            syncCopiedMsg.classList.add('hidden');
          }, 6000);
        }
      });
    }

    if (saveCloudBtn) {
      saveCloudBtn.addEventListener('click', () => {
        const boardSyncId = sbBoardIdInput ? sbBoardIdInput.value.trim() : '';
        this.storage.setBoardSyncId(this.storage.getActiveBoardId(), boardSyncId);
        this.storage.saveSupabaseConfig({
          url: sbUrlInput ? sbUrlInput.value : '',
          key: sbKeyInput ? sbKeyInput.value : '',
          boardId: boardSyncId,
          mode: 'board',
          storageMode: currentSelectedMode,
        });
        this.renderBoard();
        ModalHelper.close(settingsModal);
      });
    }

    // Notifications configuration controls
    const notifToggle = document.getElementById('notif-toggle-master');
    const notifBadge = document.getElementById('notif-perm-badge');
    const notifReqBtn = document.getElementById('btn-notif-req-perm');
    const notifTestBtn = document.getElementById('btn-notif-test');

    const updateNotifUI = () => {
      const isEnabled = this.notifications.isEnabled();
      const perm = this.notifications.getPermission();

      if (notifToggle) notifToggle.checked = isEnabled;

      if (notifBadge) {
        if (!this.notifications.isSupported()) {
          notifBadge.textContent = 'Not Supported';
          notifBadge.className = 'notif-perm-badge denied';
        } else if (perm === 'granted') {
          notifBadge.textContent = 'Granted';
          notifBadge.className = 'notif-perm-badge granted';
        } else if (perm === 'denied') {
          notifBadge.textContent = 'Denied';
          notifBadge.className = 'notif-perm-badge denied';
        } else {
          notifBadge.textContent = 'Prompt Needed';
          notifBadge.className = 'notif-perm-badge default';
        }
      }

      if (notifReqBtn) {
        notifReqBtn.style.display = (perm !== 'granted' && this.notifications.isSupported()) ? 'inline-flex' : 'none';
      }
    };

    updateNotifUI();

    if (notifToggle) {
      notifToggle.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        if (checked && this.notifications.getPermission() !== 'granted') {
          const perm = await this.notifications.requestPermission();
          if (perm !== 'granted') {
            alert('Notification permission was not granted. Please allow notifications in your browser settings.');
          }
        }
        this.notifications.setEnabled(checked);
        updateNotifUI();
      });
    }

    if (notifReqBtn) {
      notifReqBtn.addEventListener('click', async () => {
        await this.notifications.requestPermission();
        updateNotifUI();
      });
    }

    if (notifTestBtn) {
      notifTestBtn.addEventListener('click', async () => {
        await this.notifications.sendTestNotification();
        updateNotifUI();
      });
    }

    // Close settings when a child tool opens
    const shortcutsBtn = document.getElementById('btn-shortcuts-help');
    if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => ModalHelper.close(settingsModal));

    // Export JSON
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const json = this.storage.exportJSON();
        this.downloadFile(`todo-${this.storage.getActiveBoardId()}-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
      });
    }

    // Export CSV
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        const csv = this.generateCSV();
        this.downloadFile(`todo-${this.storage.getActiveBoardId()}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
      });
    }

    // Import JSON
    if (importFileInput) {
      importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          const success = this.storage.importJSON(event.target.result);
          if (success) {
            this.renderBoard();
            ModalHelper.close(settingsModal);
            alert('Board imported successfully!');
          } else {
            alert('Invalid board JSON file.');
          }
        };
        reader.readAsText(file);
      });
    }

    // Reset Board
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset this board to default state?')) {
          this.storage.resetToDefault();
          this.renderBoard();
          ModalHelper.close(settingsModal);
        }
      });
    }
  }

  // --- Priority Picker (opened by a list's + button once a title is typed) ---
  setupAddCardModal() {
    this.addCardModal = document.getElementById('add-card-modal');
    if (!this.addCardModal) return;

    this.addCardTitlePreview = document.getElementById('add-card-title-preview');
    this.addCardPrioEl = document.getElementById('add-card-priority-list');

    ModalHelper.bind(this.addCardModal, null, 'add-card-close-btn');

    if (this.addCardPrioEl) {
      const options = [{ key: '', name: 'None', color: null }, ...Object.values(PRIORITIES)];
      this.addCardPrioEl.innerHTML = options.map(p => `
        <button type="button" class="priority-btn" data-priority="${p.key}">
          ${p.color ? `<span class="prio-dot" style="background:${p.color}"></span>` : ''}${p.name}
        </button>
      `).join('');

      // Picking an option saves the card straight away - no confirm button.
      this.addCardPrioEl.querySelectorAll('.priority-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const priority = btn.dataset.priority;
          const listId = this.addCardListId;
          const title = this.pendingAddTitle;
          ModalHelper.close(this.addCardModal);
          this.addCardListId = null;
          this.pendingAddTitle = null;
          if (!listId || !title) return;

          // Grab the column's active reminder days, then clear the quick-add
          // bar before addCard() re-renders the board.
          const listEl = this.boardEl.querySelector(`.kanban-list[data-list-id="${listId}"]`);
          const quickInput = listEl ? listEl.querySelector('.quick-add-input') : null;
          const days = listEl
            ? [...listEl.querySelectorAll('.day-chip.active')].map(c => c.dataset.day)
            : null;
          if (quickInput) quickInput.value = '';

          this.addCard(listId, title, priority, days);
        });
      });
    }
  }

  openAddCardModal(listId) {
    if (!this.addCardModal) return;
    const list = this.storage.getData().lists.find(l => l.id === listId);
    if (!list) return;

    // The picker only opens when the inline input has text; otherwise the tap
    // falls through to focusing the input.
    const listEl = this.boardEl.querySelector(`.kanban-list[data-list-id="${listId}"]`);
    const quickInput = listEl ? listEl.querySelector('.quick-add-input') : null;
    const title = quickInput ? quickInput.value.trim() : '';
    if (!title) {
      if (quickInput) quickInput.focus();
      return;
    }

    this.addCardListId = listId;
    this.pendingAddTitle = title;

    const nameEl = document.getElementById('add-card-list-name');
    if (nameEl) nameEl.textContent = list.title;
    const preview = this.addCardTitlePreview;
    if (preview) preview.textContent = title;

    ModalHelper.open(this.addCardModal);
  }

  // --- Board Data & UI Rendering ---
  renderBoard() {
    this.dnd.clearDragState();
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());

    const data = this.storage.getData() || {};
    const lists = Array.isArray(data.lists) ? data.lists : [];
    const cards = (data.cards && typeof data.cards === 'object') ? data.cards : {};

    // Clear lists but keep .add-list-wrapper
    const addListWrapper = document.getElementById('add-list-wrapper');
    const existingLists = this.boardEl.querySelectorAll('.kanban-list');
    existingLists.forEach(l => l.remove());

    lists.forEach(list => {
      const listEl = this.createListElement(list, cards);
      this.boardEl.insertBefore(listEl, addListWrapper);
    });

    this.renderMobileNav(lists, cards);
    this.renderBoardSwitcher();

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // --- Mobile Column Navigation Bar ---
  renderMobileNav(lists, cardsMap) {
    const navEl = document.getElementById('mobile-list-nav');
    if (!navEl) return;
    navEl.innerHTML = '';

    if (!lists || lists.length === 0) return;

    // A reorder re-renders the whole nav, so remember the focused list instead of
    // letting the highlight snap back to the first pill.
    const activeListId = this.activeListId && lists.some(l => l.id === this.activeListId)
      ? this.activeListId
      : lists[0].id;

    lists.forEach((list) => {
      const cards = (list.cardIds || []).map(id => cardsMap[id]).filter(Boolean);
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `mobile-nav-pill ${list.id === activeListId ? 'active' : ''}`;
      pill.setAttribute('data-list-id', list.id);
      pill.setAttribute('title', 'Tap to jump - hold to reorder');
      pill.innerHTML = `
        <span class="mobile-nav-title">${this.escapeHtml(list.title)}</span>
        <span class="mobile-nav-count">${cards.length}</span>
      `;

      pill.addEventListener('click', () => {
        if (this.dnd.consumePillClickSuppress()) return;
        const targetList = this.boardEl.querySelector(`[data-list-id="${list.id}"]`);
        if (targetList) {
          const isMobile = window.innerWidth <= 768;
          targetList.scrollIntoView({
            behavior: 'smooth',
            block: isMobile ? 'start' : 'nearest',
            inline: isMobile ? 'nearest' : 'start'
          });
          this.activeListId = list.id;
          navEl.querySelectorAll('.mobile-nav-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        }
      });

      this.dnd.attachPillTouchEvents(pill, list.id);
      navEl.appendChild(pill);
    });

    this.setupMobileObserver();
  }

  setupMobileObserver() {
    if (this.mobileObserver) {
      this.mobileObserver.disconnect();
    }
    const navEl = document.getElementById('mobile-list-nav');
    if (!navEl || !window.IntersectionObserver) return;

    this.mobileObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
          const listId = entry.target.getAttribute('data-list-id');
          this.activeListId = listId;
          const pills = navEl.querySelectorAll('.mobile-nav-pill');
          pills.forEach(p => {
            const isActive = p.getAttribute('data-list-id') === listId;
            p.classList.toggle('active', isActive);
            if (isActive) {
              p.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
            }
          });
        }
      });
    }, {
      root: this.boardEl,
      threshold: [0.25, 0.5]
    });

    this.boardEl.querySelectorAll('.kanban-list').forEach(el => this.mobileObserver.observe(el));
  }

  createListElement(list, cardsMap) {
    const listEl = document.createElement('div');
    listEl.className = 'kanban-list';
    listEl.setAttribute('data-list-id', list.id);

    const cards = (list.cardIds || []).map(id => cardsMap[id]).filter(Boolean);

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'list-header';
    const listShared = this.storage.isListShared(list.id);
    const shareBtnHtml = this.storage.isCardsMode()
      ? `<button type="button" class="list-share-btn ${listShared ? 'shared' : ''}"
           title="${listShared ? 'Syncing this list to cloud - click to stop' : 'Sync this list to cloud'}">
           <i data-lucide="cloud"></i>
         </button>`
      : '';
    headerEl.innerHTML = `
      <div class="list-header-left">
        <input type="text" class="list-title-input" value="${this.escapeHtml(list.title)}" title="Click to rename list" />
      </div>
      <div class="list-actions">
        <span class="card-count">${cards.length}</span>
        ${shareBtnHtml}
        <button type="button" class="list-delete-btn" title="Delete list"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    // Title input rename
    const titleInput = headerEl.querySelector('.list-title-input');
    titleInput.addEventListener('change', () => {
      this.renameList(list.id, titleInput.value.trim() || 'Untitled List');
    });

    // Delete list button
    headerEl.querySelector('.list-delete-btn').addEventListener('click', () => {
      if (confirm(`Delete list "${list.title}" and its ${list.cardIds.length} todos?`)) {
        this.deleteList(list.id);
      }
    });

    // Cloud sync toggle for the whole list
    const listShareBtn = headerEl.querySelector('.list-share-btn');
    if (listShareBtn) {
      listShareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleListShared(list.id);
      });
    }

    // List dragging is strictly armed from list header (never inputs, buttons, cards, or list body)
    headerEl.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !e.target.closest('input, button, textarea, select, .column-color-indicator-btn')) {
        listEl.setAttribute('draggable', 'true');
      }
    });
    headerEl.addEventListener('mouseup', () => {
      if (!this.dnd.draggedListId) {
        listEl.removeAttribute('draggable');
      }
    });
    listEl.addEventListener('dragstart', (e) => {
      if (listEl.getAttribute('draggable') !== 'true') {
        e.preventDefault();
        return;
      }
      this.dnd.handleListDragStart(e, list.id);
    });
    listEl.addEventListener('dragend', (e) => {
      listEl.removeAttribute('draggable');
      this.dnd.handleListDragEnd(e);
    });

    // Touch events on header for list reordering
    this.dnd.attachListTouchEvents(listEl, list.id);

    // Quick Add Bar right inside the list (at top below header)!
    const quickAddEl = document.createElement('div');
    quickAddEl.className = 'list-quick-add';
    quickAddEl.innerHTML = `
      <form class="quick-add-form">
        <input type="text" class="quick-add-input" placeholder="+ Add a todo... (press Enter)" autocomplete="off" />
        <button type="button" class="btn-quick-add" title="Add todo with priority, days &amp; reminders"><i data-lucide="plus"></i></button>
      </form>
    `;

    const quickForm = quickAddEl.querySelector('.quick-add-form');
    const quickInput = quickAddEl.querySelector('.quick-add-input');
    const quickAddBtn = quickAddEl.querySelector('.btn-quick-add');

    // Cards container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';
    cardsContainer.setAttribute('data-list-id', list.id);

    // DND events: allow dropping cards anywhere over list column or container
    listEl.addEventListener('dragover', (e) => {
      if (this.dnd.draggedCardId) {
        this.dnd.handleCardContainerDragOver(e, cardsContainer);
      }
    });
    listEl.addEventListener('drop', (e) => {
      if (this.dnd.draggedCardId) {
        this.dnd.handleCardDrop(e, list.id);
      }
    });

    cardsContainer.addEventListener('dragover', (e) => this.dnd.handleCardContainerDragOver(e, cardsContainer));
    cardsContainer.addEventListener('drop', (e) => this.dnd.handleCardDrop(e, list.id));

    // Render cards
    cards.forEach(card => {
      const cardEl = this.createCardElement(card, list.id);
      cardsContainer.appendChild(cardEl);
    });

    // Kanban List Footer: Days Group Only
    const listFooterEl = document.createElement('div');
    listFooterEl.className = 'kanban-list-footer';

    const listDays = (Array.isArray(list.days) && list.days.length) ? list.days : ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
    const daysChipsHtml = DAY_INFO.map(d => {
      const active = listDays.includes(d.code);
      return `<button type="button" class="day-chip ${active ? 'active' : ''}" data-day="${d.code}" title="${d.full}: Default reminder ${active ? 'ON' : 'OFF'} (click to toggle)">${d.code}</button>`;
    }).join('');

    listFooterEl.innerHTML = `
      <div class="quick-add-days-group" title="Default Reminder Days for this list (M, T, W, R, F, S, U - Multi-select)">
        <span class="days-footer-label"><i data-lucide="bell"></i> Days:</span>
        <div class="days-chips-wrapper">
          ${daysChipsHtml}
        </div>
      </div>
    `;

    // Day chips toggle in footer
    listFooterEl.querySelectorAll('.day-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dayCode = chip.getAttribute('data-day');
        this.toggleListDay(list.id, dayCode);
      });
    });

    quickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = quickInput.value.trim();
      const currentDays = (Array.isArray(list.days) && list.days.length) ? list.days : ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
      if (val) {
        this.addCard(list.id, val, '', currentDays);
        quickInput.value = '';
        quickInput.focus();
      }
    });

    // The + button opens the priority picker once a title is typed.
    quickAddBtn.addEventListener('click', () => this.openAddCardModal(list.id));

    listEl.appendChild(headerEl);
    listEl.appendChild(quickAddEl);
    listEl.appendChild(cardsContainer);
    listEl.appendChild(listFooterEl);

    return listEl;
  }

  createCardElement(card, listId) {
    const cardEl = document.createElement('div');
    const priorityClass = card.priority ? `priority-${card.priority}` : 'priority-none';
    cardEl.className = `kanban-card ${priorityClass}` + (card.completed ? ' is-completed' : '');

    cardEl.setAttribute('data-card-id', card.id);
    cardEl.setAttribute('data-priority', card.priority || '');

    const pInfo = PRIORITIES[card.priority];
    const priorityHint = pInfo
      ? `Priority: ${pInfo.name} (Click todo to cycle priority)`
      : 'Click todo to set priority';
    cardEl.setAttribute('title', `${priorityHint} · Drag grip handle to reorder`);

    cardEl.innerHTML = `
      <div class="card-main-row">
        <div class="card-drag-grip" title="Drag to reorder"><i data-lucide="grip-vertical"></i></div>
        <label class="card-complete-toggle" title="${card.completed ? 'Mark incomplete' : 'Mark completed'}">
          <input type="checkbox" class="card-done-chk" ${card.completed ? 'checked' : ''} />
          <span class="card-chk-custom"></span>
        </label>
        <span class="card-title ${card.completed ? 'completed-text' : ''}">${this.escapeHtml(card.title)}</span>
        <button type="button" class="card-delete-quick-btn" title="Delete todo"><i data-lucide="x"></i></button>
      </div>
    `;

    // Drag listeners: strictly arm draggable only when pressing the drag grip handle.
    // The card body itself is never draggable.
    const grip = cardEl.querySelector('.card-drag-grip');
    if (grip) {
      grip.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
          cardEl.setAttribute('draggable', 'true');
        }
      });
      grip.addEventListener('mouseup', () => {
        if (!this.dnd.isDragging) {
          cardEl.removeAttribute('draggable');
        }
      });
    }

    cardEl.addEventListener('dragstart', (e) => {
      // Abort immediately if card is not armed for drag
      if (cardEl.getAttribute('draggable') !== 'true') {
        e.preventDefault();
        return;
      }
      this.dnd.handleCardDragStart(e, card.id, listId);
    });

    cardEl.addEventListener('dragend', (e) => {
      cardEl.removeAttribute('draggable');
      this.dnd.handleCardDragEnd(e);
    });

    // Touch events on grip for mobile / touch devices
    this.dnd.attachCardTouchEvents(cardEl, card.id, listId);

    // Completion checkbox toggle
    const chk = cardEl.querySelector('.card-done-chk');
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      this.toggleCardCompleted(card.id);
    });

    // Quick delete button
    const deleteBtn = cardEl.querySelector('.card-delete-quick-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCard(card.id);
      });
    }

    // Click todo item to cycle priority (exclude grip, checkbox, delete button)
    cardEl.addEventListener('click', (e) => {
      if (this.dnd.isDragging || this.dnd.isTouchDragging) return;
      if (e.target.closest('.card-complete-toggle, .card-delete-quick-btn, .card-drag-grip, input, button')) {
        return;
      }
      this.cycleCardPriority(card.id);
    });

    return cardEl;
  }

  // --- Data Operations ---
  getCard(cardId) {
    const data = this.storage.getData();
    return data.cards[cardId];
  }

  addList(title) {
    const data = this.storage.getData();
    const id = 'list-' + Date.now();
    if (Array.isArray(data.deletedListIds)) {
      data.deletedListIds = data.deletedListIds.filter(lid => lid !== id);
    }
    const defaultColors = ['#00ff66', '#3b82f6', '#10b981', '#f97316', '#8b5cf6'];
    const randomColor = defaultColors[data.lists.length % defaultColors.length];
    data.lists.push({ id, title, color: randomColor, cardIds: [] });
    this.storage.saveLocal(data);
    this.renderBoard();
  }

  renameList(listId, title) {
    const data = this.storage.getData();
    const list = data.lists.find(l => l.id === listId);
    if (list) {
      list.title = title;
      this.storage.saveLocal(data);
    }
  }

  deleteList(listId) {
    const data = this.storage.getData();
    const listIndex = data.lists.findIndex(l => l.id === listId);
    if (listIndex > -1) {
      const [removedList] = data.lists.splice(listIndex, 1);
      if (!Array.isArray(data.deletedListIds)) {
        data.deletedListIds = [];
      }
      if (!data.deletedListIds.includes(listId)) {
        data.deletedListIds.push(listId);
      }
      if (data.deletedListIds.length > 50) {
        data.deletedListIds = data.deletedListIds.slice(-50);
      }

      if (!Array.isArray(data.deletedCardIds)) {
        data.deletedCardIds = [];
      }
      removedList.cardIds.forEach(cId => {
        delete data.cards[cId];
        if (!data.deletedCardIds.includes(cId)) {
          data.deletedCardIds.push(cId);
        }
      });
      if (data.deletedCardIds.length > 200) {
        data.deletedCardIds = data.deletedCardIds.slice(-200);
      }
      this.storage.saveLocal(data);
      this.renderBoard();
    }
  }

  reorderList(listId, targetIndex) {
    const data = this.storage.getData();
    const currentIndex = data.lists.findIndex(l => l.id === listId);
    if (currentIndex === -1) return;

    const [movedList] = data.lists.splice(currentIndex, 1);
    let finalIndex = targetIndex;
    if (targetIndex === -1 || targetIndex >= data.lists.length) {
      data.lists.push(movedList);
    } else {
      data.lists.splice(finalIndex, 0, movedList);
    }
    this.storage.saveLocal(data);
    this.renderBoard();
  }

  addCard(listId, rawTitle, explicitPriority = '', explicitDays = null) {
    const data = this.storage.getData();
    const list = data.lists.find(l => l.id === listId);
    if (!list) return;

    let title = (rawTitle || '').trim();
    let priority = (explicitPriority || '').toLowerCase();

    // Auto-detect priority shorthand tag in title if not explicitly set
    // e.g., "Fix critical bug !urgent" or "Call vendor !high" or "!med buy groceries"
    if (!priority) {
      const prioRegex = /(?:^|\s)!(urgent|high|medium|med|low|u|h|m|l)(?:\s|$)/i;
      const match = title.match(prioRegex);
      if (match) {
        const tag = match[1].toLowerCase();
        if (tag === 'urgent' || tag === 'u') priority = 'urgent';
        else if (tag === 'high' || tag === 'h') priority = 'high';
        else if (tag === 'medium' || tag === 'med' || tag === 'm') priority = 'medium';
        else if (tag === 'low' || tag === 'l') priority = 'low';
        title = title.replace(prioRegex, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    if (!title) return;

    const id = 'card-' + Date.now();
    const now = new Date().toISOString();
    if (Array.isArray(data.deletedCardIds)) {
      data.deletedCardIds = data.deletedCardIds.filter(cid => cid !== id);
    }
    data.cards[id] = {
      id,
      title,
      priority: priority || '',
      completed: false,
      days: (explicitDays && Array.isArray(explicitDays)) ? explicitDays : ['M', 'T', 'W', 'R', 'F', 'S', 'U'],
      lastNotifiedAt: 0,
      createdAt: now
    };
    list.cardIds.push(id);
    this.storage.saveLocal(data);
    this.renderBoard();
  }

  toggleCardCompleted(cardId) {
    const data = this.storage.getData();
    const card = data.cards[cardId];
    if (!card) return;

    card.completed = !card.completed;
    this.storage.saveLocal(data);
    this.renderBoard();
  }


  toggleListDay(listId, dayCode) {
    const data = this.storage.getData();
    const list = (data.lists || []).find(l => l.id === listId);
    if (!list) return;

    const ALL_DAYS = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
    if (!Array.isArray(list.days) || list.days.length === 0) {
      list.days = [...ALL_DAYS];
    }

    if (list.days.includes(dayCode)) {
      list.days = list.days.filter(d => d !== dayCode);
    } else {
      list.days.push(dayCode);
      list.days.sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
    }

    this.storage.saveLocal(data);
    this.renderBoard();
  }

  cycleCardPriority(cardId) {
    const data = this.storage.getData();
    const card = data.cards[cardId];
    if (!card) return;

    // Cycle: '' -> 'low' -> 'medium' -> 'high' -> 'urgent' -> ''
    const cycleOrder = ['', 'low', 'medium', 'high', 'urgent'];
    const currentIdx = cycleOrder.indexOf(card.priority || '');
    const nextIdx = (currentIdx + 1) % cycleOrder.length;
    card.priority = cycleOrder[nextIdx];

    this.storage.saveLocal(data);
    this.renderBoard();
  }

  updateCard(cardId, updates) {
    const data = this.storage.getData();
    const card = data.cards[cardId];
    if (card) {
      Object.assign(card, updates);
      this.storage.saveLocal(data);
      this.renderBoard();
    }
  }

  deleteCard(cardId) {
    this.storage.deleteCard(cardId);
    this.renderBoard();
  }

  toggleListShared(listId) {
    const data = this.storage.getData();
    const list = (data.lists || []).find(l => l.id === listId);
    if (!list) return;

    if (!this.storage.isConnected()) {
      this.storage.notifyStatus({
        online: false,
        syncing: false,
        message: 'Set Supabase URL + key in Settings first',
      });
      return;
    }

    this.storage.setListShared(listId, !list.shared);
    // record=false: flipping the share flag is not a board edit worth undoing.
    this.storage.saveLocal(data, false);
    this.renderBoard();
  }

  moveCard(cardId, sourceListId, targetListId, targetIndex) {
    const data = this.storage.getData();
    const srcList = data.lists.find(l => l.id === sourceListId);
    const tgtList = data.lists.find(l => l.id === targetListId);
    if (!srcList || !tgtList) return;

    // Remove from source
    srcList.cardIds = srcList.cardIds.filter(id => id !== cardId);

    // Add to target
    if (targetIndex === -1 || targetIndex >= tgtList.cardIds.length) {
      tgtList.cardIds.push(cardId);
    } else {
      tgtList.cardIds.splice(targetIndex, 0, cardId);
    }

    this.storage.saveLocal(data);
    this.renderBoard();
  }

  // --- Export Helpers ---
  downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  generateCSV() {
    const data = this.storage.getData();
    const rows = [
      ['List', 'Todo Title', 'Priority', 'Completed']
    ];

    data.lists.forEach(list => {
      list.cardIds.forEach(cId => {
        const card = data.cards[cId];
        if (card) {
          rows.push([
            `"${(list.title || '').replace(/"/g, '""')}"`,
            `"${(card.title || '').replace(/"/g, '""')}"`,
            `"${(card.priority || 'None')}"`,
            card.completed ? 'Yes' : 'No'
          ]);
        }
      });
    });

    return rows.map(r => r.join(',')).join('\n');
  }

  escapeHtml(str) {
    return escapeHtml(str);
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new KanbanApp();
});

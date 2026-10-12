/**
 * Main application coordinator for plan (Mobile-Only TUI Todo Manager)
 * - Exclusively mobile layout & tap controls
 * - No drag-and-drop
 * - Quick reordering (Move up / down) and list transfer
 * - Instant completion checkbox & priority cycling
 * - Backup / Export (JSON, CSV) & Multi-board switcher
 * - Robust notification setup
 */
import { StorageManager } from './storage.js';
import { ThemeManager } from './theme.js';
import { escapeHtml, PRIORITIES, ModalHelper } from './utils.js';
import { NotificationManager } from './notifications.js';

class KanbanApp {
  constructor() {
    this.storage = new StorageManager();
    this.theme = new ThemeManager(this);
    this.notifications = new NotificationManager(this);

    this.boardEl = document.getElementById('todo-board') || document.getElementById('board');
    this.activeListId = null;

    this.init();
  }

  init() {
    this.setupBoardSwitcher();
    this.renderBoard();
    this.setupGlobalEvents();
    this.setupSettingsModal();
    this.setupAddCardModal();
    this.notifications.startScheduler();

    // Listen for storage updates
    window.addEventListener('board:updated', () => {
      this.theme.applyTheme();
      this.renderBoard();
      this.renderBoardSwitcher();
      this.notifications.updateCountdownUI();
    });
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
          newListInput.blur();
        }
      });
    }

    // Dismiss any open card action menu when tapping outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.card-action-menu-wrapper')) {
        this.closeAllCardMenus();
      }
    });
  }

  closeAllCardMenus() {
    const openMenus = document.querySelectorAll('.card-action-dropdown.is-open');
    if (openMenus.length > 0) {
      openMenus.forEach(menu => {
        menu.classList.remove('is-open');
      });
      // Check if any other modal overlays are open before removing modal-open
      const otherModalOpen = Array.from(document.querySelectorAll('.modal-overlay:not(.hidden)')).length > 0;
      if (!otherModalOpen) {
        document.body.classList.remove('modal-open');
      }
    }
  }

  setupSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    const exportBtn = document.getElementById('btn-export-json');
    const importFileInput = document.getElementById('import-file-input');
    const resetBtn = document.getElementById('btn-reset-board');

    ModalHelper.bind(settingsModal, 'btn-open-settings', 'settings-close-btn');

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
          notifBadge.textContent = 'Active (Granted)';
          notifBadge.className = 'notif-perm-badge granted';
        } else if (perm === 'denied') {
          notifBadge.textContent = 'Blocked (Denied)';
          notifBadge.className = 'notif-perm-badge denied';
        } else {
          notifBadge.textContent = 'Permission Needed';
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
            alert('Notification permission was not granted. Please enable notifications in your browser/device settings.');
          }
        }
        this.notifications.setEnabled(checked);
        updateNotifUI();
      });
    }

    if (notifReqBtn) {
      notifReqBtn.addEventListener('click', async () => {
        const perm = await this.notifications.requestPermission();
        if (perm === 'granted') {
          this.notifications.setEnabled(true);
        } else if (perm === 'denied') {
          alert('Notifications are blocked by your browser. Please tap the lock/site settings icon in your address bar to allow notifications.');
        }
        updateNotifUI();
      });
    }

    if (notifTestBtn) {
      notifTestBtn.addEventListener('click', async () => {
        await this.notifications.sendTestNotification();
        updateNotifUI();
      });
    }

    // Export JSON
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const json = this.storage.exportJSON();
        this.downloadFile(`todo-${this.storage.getActiveBoardId()}-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
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

  // --- Priority Picker Modal ---
  setupAddCardModal() {
    this.addCardModal = document.getElementById('add-todo-modal') || document.getElementById('add-card-modal');
    if (!this.addCardModal) return;

    this.addCardTitlePreview = document.getElementById('add-todo-title-preview') || document.getElementById('add-card-title-preview');
    this.addCardPrioEl = document.getElementById('add-todo-priority-list') || document.getElementById('add-card-priority-list');

    ModalHelper.bind(this.addCardModal, null, 'add-todo-close-btn');

    const moveModal = document.getElementById('move-todo-modal') || document.getElementById('move-card-modal');
    if (moveModal) {
      ModalHelper.bind(moveModal, null, 'move-todo-close-btn');
    }

    if (this.addCardPrioEl) {
      const options = [{ key: '', name: 'None', color: null }, ...Object.values(PRIORITIES)];
      this.addCardPrioEl.innerHTML = options.map(p => `
        <button type="button" class="priority-btn" data-priority="${p.key}">
          ${p.color ? `<span class="prio-dot" style="background:${p.color}"></span>` : ''}${p.name}
        </button>
      `).join('');

      this.addCardPrioEl.querySelectorAll('.priority-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const priority = btn.dataset.priority;
          const listId = this.addCardListId;
          const title = this.pendingAddTitle;
          ModalHelper.close(this.addCardModal);
          this.addCardListId = null;
          this.pendingAddTitle = null;
          if (!listId || !title) return;

          const listEl = this.boardEl.querySelector(`.todo-list[data-list-id="${listId}"]`) || this.boardEl.querySelector(`.kanban-list[data-list-id="${listId}"]`);
          const quickInput = listEl ? listEl.querySelector('.quick-add-input') : null;
          if (quickInput) quickInput.value = '';

          this.addCard(listId, title, priority);
        });
      });
    }
  }

  openAddCardModal(listId) {
    if (!this.addCardModal) return;
    const list = this.storage.getData().lists.find(l => l.id === listId);
    if (!list) return;

    const listEl = this.boardEl.querySelector(`.todo-list[data-list-id="${listId}"]`) || this.boardEl.querySelector(`.kanban-list[data-list-id="${listId}"]`);
    const quickInput = listEl ? listEl.querySelector('.quick-add-input') : null;
    const title = quickInput ? quickInput.value.trim() : '';
    if (!title) {
      if (quickInput) quickInput.focus();
      return;
    }

    this.addCardListId = listId;
    this.pendingAddTitle = title;

    const nameEl = document.getElementById('add-todo-list-name') || document.getElementById('add-card-list-name');
    if (nameEl) nameEl.textContent = list.title;
    const preview = this.addCardTitlePreview;
    if (preview) preview.textContent = title;

    ModalHelper.open(this.addCardModal);
  }

  // --- Board Data & UI Rendering ---
  renderBoard() {
    const data = this.storage.getData() || {};
    const lists = Array.isArray(data.lists) ? data.lists : [];
    const cards = (data.cards && typeof data.cards === 'object') ? data.cards : {};

    const addListWrapper = document.getElementById('add-list-wrapper');
    const existingLists = this.boardEl.querySelectorAll('.todo-list, .kanban-list');
    existingLists.forEach(l => l.remove());

    lists.forEach((list, index) => {
      const listEl = this.createListElement(list, cards, index, lists.length);
      this.boardEl.insertBefore(listEl, addListWrapper);
    });

    this.renderBoardSwitcher();
    if (this.notifications) {
      this.notifications.updateCountdownUI();
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  createListElement(list, cardsMap, listIndex, totalLists) {
    const listEl = document.createElement('div');
    listEl.className = 'todo-list';
    listEl.setAttribute('data-list-id', list.id);

    const cards = (list.cardIds || []).map(id => cardsMap[id]).filter(Boolean);

    // List Header
    const headerEl = document.createElement('div');
    headerEl.className = 'list-header';
    headerEl.innerHTML = `
      <div class="list-header-left">
        <input type="text" class="list-title-input" value="${this.escapeHtml(list.title)}" aria-label="Rename list" />
      </div>
      <div class="list-actions">
        <button type="button" class="btn-list-move list-move-up" title="Move list up" ${listIndex === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
        <button type="button" class="btn-list-move list-move-down" title="Move list down" ${listIndex === totalLists - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
        <span class="card-count">${cards.length}</span>
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

    // List reorder buttons (Move Up / Move Down)
    const moveUpBtn = headerEl.querySelector('.list-move-up');
    const moveDownBtn = headerEl.querySelector('.list-move-down');
    if (moveUpBtn && listIndex > 0) {
      moveUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reorderList(list.id, listIndex - 1);
      });
    }
    if (moveDownBtn && listIndex < totalLists - 1) {
      moveDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reorderList(list.id, listIndex + 1);
      });
    }

    // Quick Add Bar right inside the list
    const quickAddEl = document.createElement('div');
    quickAddEl.className = 'list-quick-add';
    quickAddEl.innerHTML = `
      <form class="quick-add-form">
        <input type="text" class="quick-add-input" placeholder="+ Add a todo... (Tap Enter)" autocomplete="off" />
        <button type="button" class="btn-quick-add" title="Add todo with priority &amp; reminders"><i data-lucide="plus"></i></button>
      </form>
    `;

    const quickForm = quickAddEl.querySelector('.quick-add-form');
    const quickInput = quickAddEl.querySelector('.quick-add-input');
    const quickAddBtn = quickAddEl.querySelector('.btn-quick-add');

    // Cards container
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';
    cardsContainer.setAttribute('data-list-id', list.id);

    // Render cards
    cards.forEach((card, cardIdx) => {
      const cardEl = this.createCardElement(card, list.id, cardIdx, cards.length);
      cardsContainer.appendChild(cardEl);
    });

    quickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = quickInput.value.trim();
      if (val) {
        this.addCard(list.id, val, '');
        quickInput.value = '';
        quickInput.blur();
      }
    });

    quickAddBtn.addEventListener('click', () => this.openAddCardModal(list.id));

    listEl.appendChild(headerEl);
    listEl.appendChild(quickAddEl);
    listEl.appendChild(cardsContainer);

    return listEl;
  }

  createCardElement(card, listId, cardIdx, totalCardsInList) {
    const cardEl = document.createElement('div');
    const priorityKey = (card.priority || '').toLowerCase();
    const priorityClass = priorityKey ? `priority-${priorityKey}` : 'priority-none';
    cardEl.className = `todo-card ${priorityClass}` + (card.completed ? ' is-completed' : '');
    cardEl.setAttribute('data-card-id', card.id);
    cardEl.setAttribute('data-priority', priorityKey);

    const pInfo = PRIORITIES[priorityKey];
    const priorityName = pInfo ? pInfo.name : 'None';

    cardEl.innerHTML = `
      <div class="card-main-row">
        <label class="card-complete-toggle" title="${card.completed ? 'Mark incomplete' : 'Mark completed'}">
          <input type="checkbox" class="card-done-chk" ${card.completed ? 'checked' : ''} />
          <span class="card-chk-custom"></span>
        </label>

        <span class="todo-title ${card.completed ? 'completed-text' : ''}">${this.escapeHtml(card.title)}</span>

        <div class="card-action-menu-wrapper">
          <button type="button" class="card-menu-btn" title="Todo actions" aria-label="Todo actions">
            <i data-lucide="more-vertical"></i>
          </button>

          <div class="card-action-dropdown">
            <div class="card-dropdown-topbar">
              <div class="card-dropdown-header-info">
                <span class="dropdown-header-title">Todo Options</span>
                <span class="dropdown-card-title-preview">${this.escapeHtml(card.title)}</span>
              </div>
              <button type="button" class="card-dropdown-close-btn" aria-label="Close menu">&times;</button>
            </div>

            <div class="card-dropdown-section">
              <div class="card-dropdown-section-title">
                <span>Priority</span>
                <span class="dropdown-header-badge ${priorityKey ? `prio-${priorityKey}` : ''}">${priorityName}</span>
              </div>
              <div class="card-prio-selector">
                <button type="button" class="card-prio-opt ${priorityKey === '' ? 'is-selected' : ''}" data-prio="">None</button>
                <button type="button" class="card-prio-opt prio-low ${priorityKey === 'low' ? 'is-selected' : ''}" data-prio="low">Low</button>
                <button type="button" class="card-prio-opt prio-medium ${priorityKey === 'medium' ? 'is-selected' : ''}" data-prio="medium">Med</button>
                <button type="button" class="card-prio-opt prio-high ${priorityKey === 'high' ? 'is-selected' : ''}" data-prio="high">High</button>
                <button type="button" class="card-prio-opt prio-urgent ${priorityKey === 'urgent' ? 'is-selected' : ''}" data-prio="urgent">Urgent</button>
              </div>
            </div>

            <div class="dropdown-divider"></div>

            <div class="card-dropdown-section card-dropdown-actions">
              <div class="card-dropdown-section-title">Actions</div>

              <button type="button" class="card-menu-item card-item-up" ${cardIdx === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-up"></i> <span>Move Up in List</span>
              </button>

              <button type="button" class="card-menu-item card-item-down" ${cardIdx === totalCardsInList - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-down"></i> <span>Move Down in List</span>
              </button>

              <button type="button" class="card-menu-item card-item-transfer">
                <i data-lucide="arrow-right-left"></i> <span>Move to Another List...</span>
              </button>

              <div class="dropdown-divider"></div>

              <button type="button" class="card-menu-item card-item-delete">
                <i data-lucide="trash-2"></i> <span>Delete Todo</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="card-timer-progress-bar" title="Reminder countdown timer"></div>
    `;

    // Completion checkbox toggle
    const chk = cardEl.querySelector('.card-done-chk');
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      this.toggleCardCompleted(card.id);
    });

    // 3-dot Menu Toggle
    const menuWrapper = cardEl.querySelector('.card-action-menu-wrapper');
    const menuBtn = cardEl.querySelector('.card-menu-btn');
    const dropdown = cardEl.querySelector('.card-action-dropdown');

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('is-open');
      this.closeAllCardMenus();
      if (!isOpen) {
        dropdown.classList.add('is-open');
        document.body.classList.add('modal-open');
      }
    });

    // Close button inside full screen dropdown
    const closeBtn = dropdown.querySelector('.card-dropdown-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllCardMenus();
      });
    }

    // Dismiss when tapping directly on backdrop area of full screen dropdown
    dropdown.addEventListener('click', (e) => {
      if (e.target === dropdown) {
        this.closeAllCardMenus();
      }
    });

    // Priority buttons in menu
    dropdown.querySelectorAll('.card-prio-opt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const prio = btn.getAttribute('data-prio');
        this.setCardPriority(card.id, prio);
      });
    });

    // Move Up
    const moveUpBtn = dropdown.querySelector('.card-item-up');
    if (moveUpBtn && cardIdx > 0) {
      moveUpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllCardMenus();
        this.reorderCard(card.id, listId, cardIdx - 1);
      });
    }

    // Move Down
    const moveDownBtn = dropdown.querySelector('.card-item-down');
    if (moveDownBtn && cardIdx < totalCardsInList - 1) {
      moveDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllCardMenus();
        this.reorderCard(card.id, listId, cardIdx + 1);
      });
    }

    // Move to another list
    const transferBtn = dropdown.querySelector('.card-item-transfer');
    if (transferBtn) {
      transferBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllCardMenus();
        this.promptMoveCardToList(card.id, listId);
      });
    }

    // Delete todo
    const deleteBtn = dropdown.querySelector('.card-item-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeAllCardMenus();
        if (confirm(`Delete todo "${card.title}"?`)) {
          this.deleteCard(card.id);
        }
      });
    }

    return cardEl;
  }

  setCardPriority(cardId, priority) {
    const data = this.storage.getData();
    const card = data.cards[cardId];
    if (!card) return;

    card.priority = priority || '';
    this.storage.saveLocal(data);
    this.renderBoard();
  }

  // --- Data Operations ---
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
    this.storage.deleteList(listId);
    this.renderBoard();
  }

  reorderList(listId, targetIndex) {
    const data = this.storage.getData();
    const currentIndex = data.lists.findIndex(l => l.id === listId);
    if (currentIndex === -1) return;

    const [movedList] = data.lists.splice(currentIndex, 1);
    const finalIndex = Math.max(0, Math.min(targetIndex, data.lists.length));
    data.lists.splice(finalIndex, 0, movedList);
    this.storage.saveLocal(data);
    this.renderBoard();
  }

  addCard(listId, rawTitle, explicitPriority = '') {
    const data = this.storage.getData();
    const list = data.lists.find(l => l.id === listId);
    if (!list) return;

    let title = (rawTitle || '').trim();
    let priority = (explicitPriority || '').toLowerCase();

    // Auto-detect priority shorthand tag in title
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

  deleteCard(cardId) {
    this.storage.deleteCard(cardId);
    this.renderBoard();
  }

  reorderCard(cardId, listId, targetIndex) {
    const data = this.storage.getData();
    const list = data.lists.find(l => l.id === listId);
    if (!list) return;

    const currentIdx = list.cardIds.indexOf(cardId);
    if (currentIdx === -1) return;

    list.cardIds.splice(currentIdx, 1);
    const finalIdx = Math.max(0, Math.min(targetIndex, list.cardIds.length));
    list.cardIds.splice(finalIdx, 0, cardId);

    this.storage.saveLocal(data);
    this.renderBoard();
  }

  promptMoveCardToList(cardId, currentListId) {
    const data = this.storage.getData();
    const otherLists = (data.lists || []).filter(l => l.id !== currentListId);
    if (!otherLists.length) {
      alert('No other lists available to move this todo.');
      return;
    }

    const card = (data.cards || {})[cardId];
    const modalEl = document.getElementById('move-todo-modal') || document.getElementById('move-card-modal');
    const titlePreview = document.getElementById('move-todo-title-preview') || document.getElementById('move-card-title-preview');
    const optionsContainer = document.getElementById('move-todo-list-options') || document.getElementById('move-card-list-options');

    if (!modalEl || !optionsContainer) return;

    if (titlePreview) {
      titlePreview.textContent = card ? card.title : 'Todo';
    }

    optionsContainer.innerHTML = otherLists.map(targetList => `
      <button type="button" class="btn btn-secondary move-list-target-btn" data-target-list-id="${targetList.id}" style="width: 100%; text-align: left; display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; font-size: 0.9rem; cursor: pointer;">
        <span style="font-weight: 600;">${this.escapeHtml(targetList.title)}</span>
        <i data-lucide="arrow-right" style="width: 16px; height: 16px;"></i>
      </button>
    `).join('');

    optionsContainer.querySelectorAll('.move-list-target-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetListId = btn.dataset.targetListId;
        ModalHelper.close(modalEl);
        if (targetListId) {
          this.moveCard(cardId, currentListId, targetListId, -1);
        }
      });
    });

    ModalHelper.open(modalEl);
  }

  moveCard(cardId, sourceListId, targetListId, targetIndex) {
    const data = this.storage.getData();
    const srcList = data.lists.find(l => l.id === sourceListId);
    const tgtList = data.lists.find(l => l.id === targetListId);
    if (!srcList || !tgtList) return;

    srcList.cardIds = srcList.cardIds.filter(id => id !== cardId);

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

  escapeHtml(str) {
    return escapeHtml(str);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new KanbanApp();
});

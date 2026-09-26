/**
 * Drag and Drop controller tests for Desktop and Mobile.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Helper mock DOM node
class MockElement {
  constructor(tagName = 'div', className = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.contains(c)) { this.remove(c); return false; }
          else { this.add(c); return true; }
        } else if (force) {
          this.add(c); return true;
        } else {
          this.remove(c); return false;
        }
      }
    };
    this.className = className;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.isConnected = true;
    this._rect = { left: 0, top: 0, width: 100, height: 40 };
  }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }
  set className(val) {
    this.classList._classes.clear();
    (val ? String(val).split(/\s+/).filter(Boolean) : []).forEach(c => this.classList._classes.add(c));
  }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, val) { this.attributes.set(name, String(val)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }

  getBoundingClientRect() { return this._rect; }
  setBoundingClientRect(rect) { this._rect = { ...this._rect, ...rect }; }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  removeEventListener(event, fn) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== fn);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    const fns = this.listeners[event.type] || [];
    fns.forEach(fn => fn(event));
    if (!event._propagationStopped && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, before) {
    if (!before) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = this.children.indexOf(before);
    if (idx === -1) return this.appendChild(child);
    this.children.splice(idx, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const parts = selector.split(',').map(s => s.trim());
    const matchesSelector = (el, sel) => {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        if (cls.includes(':not(')) {
          const [baseCls, notPart] = cls.split(':not(');
          const notCls = notPart.replace(')', '').replace('.', '');
          return el.classList.contains(baseCls) && !el.classList.contains(notCls);
        } else {
          return el.classList.contains(cls);
        }
      } else if (sel.startsWith('#')) {
        return el.id === sel.slice(1);
      } else if (sel.startsWith('[data-list-id="')) {
        const id = sel.match(/\[data-list-id="([^"]+)"\]/)[1];
        return el.getAttribute('data-list-id') === id;
      }
      return false;
    };
    const check = (el) => {
      if (parts.some(p => matchesSelector(el, p))) {
        results.push(el);
      }
      el.children.forEach(c => check(c));
    };
    this.children.forEach(c => check(c));
    return results;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      let match = false;
      if (selector.startsWith('.')) {
        match = cur.classList && cur.classList.contains(selector.slice(1));
      } else if (selector.startsWith('#')) {
        match = cur.id === selector.slice(1);
      }
      if (match) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  cloneNode(deep = true) {
    const copy = new MockElement(this.tagName.toLowerCase(), Array.from(this.classList._classes).join(' '));
    this.attributes.forEach((v, k) => copy.setAttribute(k, v));
    copy._rect = { ...this._rect };
    if (deep) {
      this.children.forEach(c => copy.appendChild(c.cloneNode(true)));
    }
    return copy;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return this.parentNode.children[idx + 1] || null;
  }
}

class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.cancelable = options.cancelable !== false;
    this.defaultPrevented = false;
    this._propagationStopped = false;
    this.target = options.target || null;
    this.currentTarget = options.currentTarget || null;
    this.clientX = options.clientX || 0;
    this.clientY = options.clientY || 0;
    this.touches = options.touches || [];
    this.dataTransfer = options.dataTransfer || {
      _data: {},
      effectAllowed: 'none',
      dropEffect: 'none',
      setData(k, v) { this._data[k] = String(v); },
      getData(k) { return this._data[k] || ''; }
    };
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._propagationStopped = true; }
}

function setupMockEnv() {
  const root = new MockElement('body');
  globalThis.document = {
    createElement(tag) { return new MockElement(tag); },
    body: root,
    querySelectorAll(sel) { return root.querySelectorAll(sel); },
    querySelector(sel) { return root.querySelector(sel); },
    getElementById(id) {
      const all = root.querySelectorAll('#' + id);
      return all[0] || (root.id === id ? root : null);
    },
    elementFromPoint(x, y) {
      return root._hitElement || null;
    }
  };
  globalThis.window = {
    addEventListener(evt, fn) {
      if (!this._listeners) this._listeners = {};
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(fn);
    },
    matchMedia(q) {
      return { matches: false };
    }
  };
  globalThis.getComputedStyle = (el) => ({
    flexDirection: el._flexDirection || 'row'
  });
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate() {} },
      configurable: true,
      writable: true
    });
  } catch {}
  return root;
}

test('DndController: initializes with clean state', async () => {
  setupMockEnv();
  const { DndController } = await import('../js/dnd.js');
  const dnd = new DndController({});
  assert.equal(dnd.isDragging, false);
  assert.equal(dnd.isTouchDragging, false);
  assert.equal(dnd.draggedCardId, null);
  assert.equal(dnd.draggedListId, null);
});

test('DndController: findCardListId finds the owning list', async () => {
  setupMockEnv();
  const { DndController } = await import('../js/dnd.js');
  const mockApp = {
    storage: {
      getData: () => ({
        lists: [
          { id: 'list-1', cardIds: ['c1', 'c2'] },
          { id: 'list-2', cardIds: ['c3', 'c4'] }
        ]
      })
    }
  };
  const dnd = new DndController(mockApp);
  assert.equal(dnd.findCardListId('c1'), 'list-1');
  assert.equal(dnd.findCardListId('c4'), 'list-2');
  assert.equal(dnd.findCardListId('unknown'), null);
});

test('DndController: getDragAfterElement finds vertical element', async () => {
  setupMockEnv();
  const { DndController } = await import('../js/dnd.js');
  const dnd = new DndController({});
  const container = new MockElement('div');
  const c1 = new MockElement('div', 'kanban-card');
  c1.setBoundingClientRect({ top: 100, height: 50 }); // center 125
  const c2 = new MockElement('div', 'kanban-card');
  c2.setBoundingClientRect({ top: 160, height: 50 }); // center 185
  container.appendChild(c1);
  container.appendChild(c2);

  // Dropping at Y=110 (above c1 center 125) -> should insert before c1
  const after1 = dnd.getDragAfterElement(container, '.kanban-card', 110, false);
  assert.equal(after1, c1);

  // Dropping at Y=140 (below c1 center 125, above c2 center 185) -> before c2
  const after2 = dnd.getDragAfterElement(container, '.kanban-card', 140, false);
  assert.equal(after2, c2);

  // Dropping at Y=200 (below all centers) -> undefined (append to end)
  const after3 = dnd.getDragAfterElement(container, '.kanban-card', 200, false);
  assert.ok(!after3);
});

test('DndController: Desktop card dragStart, dragOver and drop across lists', async () => {
  const root = setupMockEnv();
  const { DndController } = await import('../js/dnd.js');

  let movedCardArgs = null;
  const mockApp = {
    moveCard: (cardId, src, tgt, idx) => {
      movedCardArgs = { cardId, src, tgt, idx };
    },
    storage: {
      getData: () => ({
        lists: [
          { id: 'list-1', cardIds: ['c1'] },
          { id: 'list-2', cardIds: ['c2', 'c3'] }
        ]
      })
    }
  };

  const dnd = new DndController(mockApp);

  const cardEl = new MockElement('div', 'kanban-card');
  const gripEl = new MockElement('div', 'card-drag-grip');
  cardEl.appendChild(gripEl);
  root.appendChild(cardEl);

  const startEvt = new MockEvent('dragstart', { target: cardEl, currentTarget: cardEl });
  dnd.handleCardDragStart(startEvt, 'c1', 'list-1');

  assert.equal(dnd.isDragging, true);
  assert.equal(dnd.draggedCardId, 'c1');
  assert.equal(dnd.sourceListId, 'list-1');
  assert.equal(startEvt.dataTransfer.getData('text/plain'), 'c1');

  // Drag over target container
  const targetContainer = new MockElement('div', 'cards-container');
  targetContainer.setAttribute('data-list-id', 'list-2');
  const targetC2 = new MockElement('div', 'kanban-card');
  targetC2.setBoundingClientRect({ top: 100, height: 50 });
  targetContainer.appendChild(targetC2);

  const overEvt = new MockEvent('dragover', { currentTarget: targetContainer, clientY: 110 });
  dnd.handleCardContainerDragOver(overEvt);

  const placeholder = targetContainer.querySelector('.card-placeholder');
  assert.notEqual(placeholder, null);
  assert.equal(targetContainer.children[0], placeholder);

  // Drop card into list-2
  const dropEvt = new MockEvent('drop', { currentTarget: targetContainer });
  dnd.handleCardDrop(dropEvt, 'list-2');

  assert.deepEqual(movedCardArgs, {
    cardId: 'c1',
    src: 'list-1',
    tgt: 'list-2',
    idx: 0
  });
});

test('DndController: Desktop list column dragStart, dragOver and drop', async () => {
  const root = setupMockEnv();
  const { DndController } = await import('../js/dnd.js');

  let reorderListArgs = null;
  const mockApp = {
    reorderList: (listId, targetIndex) => {
      reorderListArgs = { listId, targetIndex };
    }
  };

  const dnd = new DndController(mockApp);

  const boardEl = new MockElement('main', 'board-container');
  boardEl.id = 'board';
  const list1 = new MockElement('div', 'kanban-list');
  list1.setAttribute('data-list-id', 'l1');
  list1.setBoundingClientRect({ left: 0, width: 200 });

  const list2 = new MockElement('div', 'kanban-list');
  list2.setAttribute('data-list-id', 'l2');
  list2.setBoundingClientRect({ left: 220, width: 200 });

  boardEl.appendChild(list1);
  boardEl.appendChild(list2);
  root.appendChild(boardEl);

  const startEvt = new MockEvent('dragstart', { target: list1, currentTarget: list1 });
  dnd.handleListDragStart(startEvt, 'l1');

  assert.equal(dnd.draggedListId, 'l1');
  assert.equal(startEvt.dataTransfer.getData('text/plain'), 'l1');

  // Drag over board at clientX = 300 (past list2 center 320 -> should drop after list2)
  const overEvt = new MockEvent('dragover', { clientX: 350 });
  dnd.handleBoardDragOver(overEvt, boardEl);

  const placeholder = boardEl.querySelector('.list-placeholder');
  assert.notEqual(placeholder, null);

  const dropEvt = new MockEvent('drop', {});
  dnd.handleBoardDrop(dropEvt, boardEl);

  assert.notEqual(reorderListArgs, null);
  assert.equal(reorderListArgs.listId, 'l1');
});

test('DndController: Mobile touch card dragging moves card', async () => {
  const root = setupMockEnv();
  const { DndController } = await import('../js/dnd.js');

  let moveCardArgs = null;
  const mockApp = {
    moveCard: (cardId, src, tgt, idx) => {
      moveCardArgs = { cardId, src, tgt, idx };
    },
    storage: {
      getData: () => ({
        lists: [
          { id: 'list-1', cardIds: ['card-1'] },
          { id: 'list-2', cardIds: ['card-2'] }
        ]
      })
    }
  };

  const dnd = new DndController(mockApp);

  const list1 = new MockElement('div', 'kanban-list');
  list1.setAttribute('data-list-id', 'list-1');
  const container1 = new MockElement('div', 'cards-container');
  container1.setAttribute('data-list-id', 'list-1');
  const card1 = new MockElement('div', 'kanban-card');
  const grip1 = new MockElement('div', 'card-drag-grip');
  card1.appendChild(grip1);
  container1.appendChild(card1);
  list1.appendChild(container1);

  const list2 = new MockElement('div', 'kanban-list');
  list2.setAttribute('data-list-id', 'list-2');
  const container2 = new MockElement('div', 'cards-container');
  container2.setAttribute('data-list-id', 'list-2');
  const card2 = new MockElement('div', 'kanban-card');
  card2.setBoundingClientRect({ top: 200, height: 60 });
  container2.appendChild(card2);
  list2.appendChild(container2);

  root.appendChild(list1);
  root.appendChild(list2);

  // Attach touch events to card grip
  dnd.attachCardTouchEvents(card1, 'card-1', 'list-1');

  // Trigger touchstart
  const touchStartEvt = new MockEvent('touchstart', {
    target: grip1,
    touches: [{ clientX: 50, clientY: 50 }]
  });
  grip1.dispatchEvent(touchStartEvt);

  // Move finger past 5px to initiate touch drag immediately
  root._hitElement = container2;
  const touchMoveEvt = new MockEvent('touchmove', {
    touches: [{ clientX: 60, clientY: 210 }]
  });
  dnd.handleGlobalTouchMove(touchMoveEvt);

  assert.equal(dnd.isTouchDragging, true);
  assert.equal(dnd.currentTouchTargetListId, 'list-2');

  // Release finger
  dnd.handleGlobalTouchEnd();

  assert.notEqual(moveCardArgs, null);
  assert.equal(moveCardArgs.cardId, 'card-1');
  assert.equal(moveCardArgs.src, 'list-1');
  assert.equal(moveCardArgs.tgt, 'list-2');
});

test('DndController: Mobile nav pill drag reordering', async () => {
  const root = setupMockEnv();
  const { DndController } = await import('../js/dnd.js');

  let reorderListArgs = null;
  const mockApp = {
    reorderList: (listId, idx) => {
      reorderListArgs = { listId, idx };
    }
  };

  const dnd = new DndController(mockApp);
  dnd.isMobileViewport = () => true;

  const nav = new MockElement('nav', 'mobile-list-nav');
  nav.id = 'mobile-list-nav';

  const pill1 = new MockElement('button', 'mobile-nav-pill');
  pill1.setAttribute('data-list-id', 'list-1');
  pill1.setBoundingClientRect({ left: 10, width: 80 });

  const pill2 = new MockElement('button', 'mobile-nav-pill');
  pill2.setAttribute('data-list-id', 'list-2');
  pill2.setBoundingClientRect({ left: 100, width: 80 });

  nav.appendChild(pill1);
  nav.appendChild(pill2);
  root.appendChild(nav);

  dnd.attachPillTouchEvents(pill1, 'list-1');

  // Touchstart
  pill1.dispatchEvent(new MockEvent('touchstart', {
    touches: [{ clientX: 20 }]
  }));

  // Force start drag
  dnd.startPillDrag();
  assert.equal(dnd.isPillDragging, true);

  // Move pill past pill2
  dnd.moveDraggedPill(160);

  // Commit drop
  dnd.commitPillDrop();
  assert.notEqual(reorderListArgs, null);
  assert.equal(reorderListArgs.listId, 'list-1');
  assert.equal(reorderListArgs.idx, 1);
});

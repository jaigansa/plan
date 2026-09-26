/**
 * HTML5 Drag and Drop & Touch handler for Kanban cards and lists.
 */

export class DndController {
  constructor(app) {
    this.app = app;
    this.draggedCardId = null;
    this.sourceListId = null;
    this.draggedListId = null;

    // Touch DnD State
    this.touchCardEl = null;
    this.touchCloneEl = null;
    this.touchCardId = null;
    this.touchSourceListId = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchOffsetX = 0;
    this.touchOffsetY = 0;
    this.isTouchDragging = false;
    this.touchHoldTimer = null;
    this.currentTouchTargetListId = null;
    this.isDragging = false;
    this.cardPlaceholderEl = null;

    // Touch List Reorder State
    this.touchListEl = null;
    this.touchListId = null;
    this.touchListCloneEl = null;
    this.touchListOffsetX = 0;
    this.touchListOffsetY = 0;
    this.isTouchListDragging = false;
    this.touchListHoldTimer = null;

    // Mobile Nav Pill Reorder State
    this.isPillDragging = false;
    this.pillDragEl = null;
    this.pillDragListId = null;
    this.pillHoldTimer = null;
    this.pillStartX = 0;
    this.pillDropAt = 0;

    this.bindTouchGlobalEvents();
  }

  // Pill dragging replaces card/list dragging on mobile, so the whole-card
  // touch drag is only wired up on pointer-precise viewports.
  isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  clearDragState() {
    document.querySelectorAll('.is-dragging, .list-dragging, .pill-dragging').forEach(el => el.classList.remove('is-dragging', 'list-dragging', 'pill-dragging'));
    document.querySelectorAll('.card-placeholder, .list-placeholder').forEach(el => el.remove());
    this.cardPlaceholderEl = null;
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());
    if (this.touchCloneEl) {
      try { this.touchCloneEl.remove(); } catch {}
      this.touchCloneEl = null;
    }
    if (this.touchListCloneEl) {
      try { this.touchListCloneEl.remove(); } catch {}
      this.touchListCloneEl = null;
    }
  }

  getDragAfterElement(container, selector, coord, isHorizontal = false) {
    const draggableElements = [...container.querySelectorAll(selector)];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = isHorizontal
        ? coord - box.left - box.width / 2
        : coord - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  findCardListId(cardId) {
    const data = this.app.storage.getData();
    for (const list of data.lists) {
      if (list.cardIds.includes(cardId)) return list.id;
    }
    return null;
  }

  // One placeholder node for the whole drag. Re-inserting the same element moves
  // it between columns, so a drop can never find a stale placeholder left behind
  // in a column the card has already left.
  ensureCardPlaceholder() {
    if (!this.cardPlaceholderEl) {
      this.cardPlaceholderEl = document.createElement('div');
      this.cardPlaceholderEl.className = 'card-placeholder';
      this.cardPlaceholderEl.textContent = 'Drop here';
    }
    return this.cardPlaceholderEl;
  }

  // --- Card Drag & Drop ---
  handleCardDragStart(e, cardId, listId) {
    if (e.target.closest('input, button, textarea, select, .card-delete-quick-btn')) {
      e.preventDefault();
      return;
    }
    this.isDragging = true;
    this.draggedCardId = cardId;
    this.sourceListId = listId;
    this.draggedListId = null;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId);

    setTimeout(() => {
      if (e.target && e.target.classList) {
        e.target.classList.add('is-dragging');
      }
    }, 0);

    e.stopPropagation();
  }

  handleCardDragEnd(e) {
    if (e.currentTarget) e.currentTarget.classList.remove('is-dragging');
    this.clearDragState();
    this.draggedCardId = null;
    this.sourceListId = null;
    setTimeout(() => {
      this.isDragging = false;
    }, 50);
  }

  handleCardContainerDragOver(e) {
    if (!this.draggedCardId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const container = e.currentTarget;
    const afterElement = this.getDragAfterElement(container, '.kanban-card:not(.is-dragging)', e.clientY);

    const placeholder = this.ensureCardPlaceholder();

    if (afterElement == null) {
      container.appendChild(placeholder);
    } else if (placeholder !== afterElement) {
      container.insertBefore(placeholder, afterElement);
    }
  }

  handleCardDrop(e, targetListId) {
    e.preventDefault();
    e.stopPropagation();

    const cardId = this.draggedCardId || e.dataTransfer.getData('text/plain');
    if (!cardId) return;

    const sourceListId = this.sourceListId || this.findCardListId(cardId);
    if (!sourceListId) return;

    const container = e.currentTarget;
    const placeholder = container.querySelector('.card-placeholder');
    let targetIndex = -1;

    if (placeholder) {
      const cardsInDom = [...container.querySelectorAll('.kanban-card:not(.is-dragging), .card-placeholder')];
      targetIndex = cardsInDom.indexOf(placeholder);
      placeholder.remove();
    }

    this.app.moveCard(cardId, sourceListId, targetListId, targetIndex);
    this.draggedCardId = null;
    this.sourceListId = null;
    this.clearDragState();
    setTimeout(() => {
      this.isDragging = false;
    }, 50);
  }

  // --- List Drag & Drop ---
  handleListDragStart(e, listId) {
    if (e.target.closest('.kanban-card, button, input, textarea, select, .list-quick-add, .cards-container')) return;
    this.draggedListId = listId;
    this.draggedCardId = null;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('list-dragging');
  }

  handleListDragEnd(e) {
    if (e.currentTarget) e.currentTarget.classList.remove('list-dragging');
    this.clearDragState();
    this.draggedListId = null;
  }

  handleBoardDragOver(e, boardElement) {
    if (!this.draggedListId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const afterElement = this.getDragAfterElement(boardElement, '.kanban-list:not(.list-dragging)', e.clientX, true);
    let placeholder = boardElement.querySelector('.list-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'list-placeholder';
    }

    const addListBtn = boardElement.querySelector('.add-list-wrapper');
    if (afterElement == null) {
      boardElement.insertBefore(placeholder, addListBtn);
    } else {
      boardElement.insertBefore(placeholder, afterElement);
    }
  }

  handleBoardDrop(e, boardElement) {
    if (!this.draggedListId) return;
    e.preventDefault();

    const placeholder = boardElement.querySelector('.list-placeholder');
    let targetIndex = -1;
    if (placeholder) {
      const lists = [...boardElement.querySelectorAll('.kanban-list:not(.list-dragging), .list-placeholder')];
      targetIndex = lists.indexOf(placeholder);
      placeholder.remove();
    }

    this.app.reorderList(this.draggedListId, targetIndex);
    this.draggedListId = null;
    this.clearDragState();
  }

  // --- Touch Support for Mobile / Tablet ---
  bindTouchGlobalEvents() {
    window.addEventListener('touchmove', (e) => this.handleGlobalTouchMove(e), { passive: false });
    window.addEventListener('touchend', (e) => this.handleGlobalTouchEnd(e));
    window.addEventListener('touchcancel', (e) => this.handleGlobalTouchEnd(e));
  }

  // --- Mobile Nav Pill Reordering (replaces whole-card drag on mobile) ---
  attachPillTouchEvents(pillEl, listId) {
    pillEl.addEventListener('touchstart', (e) => {
      if (!this.isMobileViewport()) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      this.pillDragEl = pillEl;
      this.pillDragListId = listId;
      this.pillStartX = touch.clientX;

      clearTimeout(this.pillHoldTimer);
      // Hold to arm: a quick swipe must still scroll the pill bar.
      this.pillHoldTimer = setTimeout(() => this.startPillDrag(), 180);
    }, { passive: true });
  }

  startPillDrag() {
    if (!this.pillDragEl || !this.pillDragEl.isConnected) return;
    this.isPillDragging = true;
    this.pillDragEl.classList.add('pill-dragging');

    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }
  }

  moveDraggedPill(clientX) {
    const navEl = document.getElementById('mobile-list-nav');
    const dragEl = this.pillDragEl;
    if (!navEl || !dragEl || !dragEl.isConnected) return;

    const afterPill = [...navEl.querySelectorAll('.mobile-nav-pill')]
      .reduce((closest, pill) => {
        if (pill === dragEl) return closest;
        const box = pill.getBoundingClientRect();
        const offset = clientX - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset, pill };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).pill;

    // The nav holds nothing but pills, so re-inserting here keeps DOM order and
    // therefore pill order as the single source of truth for the drag preview.
    if (afterPill) navEl.insertBefore(dragEl, afterPill);
    else navEl.appendChild(dragEl);
  }

  autoScrollPillNav(clientX) {
    const navEl = document.getElementById('mobile-list-nav');
    if (!navEl) return;
    const rect = navEl.getBoundingClientRect();
    const EDGE = 44;
    const STEP = 10;

    if (clientX < rect.left + EDGE) navEl.scrollLeft -= STEP;
    else if (clientX > rect.right - EDGE) navEl.scrollLeft += STEP;
  }

  commitPillDrop() {
    const navEl = document.getElementById('mobile-list-nav');
    const dragEl = this.pillDragEl;
    if (!navEl || !dragEl || !this.pillDragListId) return;

    // reorderList() splices the list out before inserting, so the target index
    // is the number of pills sitting before the dragged one.
    const domOrder = [...navEl.querySelectorAll('.mobile-nav-pill')]
      .map(p => p.getAttribute('data-list-id'));
    const targetIndex = domOrder.indexOf(this.pillDragListId);

    // The browser still fires a click after touchend; swallow it so the drop
    // does not immediately scroll the board back to the dragged list.
    this.pillDropAt = Date.now();
    dragEl.classList.remove('pill-dragging');

    if (targetIndex > -1) {
      this.app.reorderList(this.pillDragListId, targetIndex);
    }
  }

  // Time-bounded so a dropped pill can never swallow a later deliberate tap.
  consumePillClickSuppress() {
    if (!this.pillDropAt) return false;
    if (Date.now() - this.pillDropAt > 500) {
      this.pillDropAt = 0;
      return false;
    }
    this.pillDropAt = 0;
    return true;
  }

  attachCardTouchEvents(cardEl, cardId, listId) {
    if (this.isMobileViewport()) return;
    const grip = cardEl.querySelector('.card-drag-grip') || cardEl;

    grip.addEventListener('touchstart', (e) => {
      // Only initiate touch drag from the dedicated card grip handle
      if (!e.target.closest('.card-drag-grip')) return;
      if (e.target.closest('input, button, textarea, select, .day-chip, .card-complete-toggle, .card-delete-quick-btn')) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      this.touchCardEl = cardEl;
      this.touchCardId = cardId;
      this.touchSourceListId = listId;
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;

      const rect = cardEl.getBoundingClientRect();
      this.touchOffsetX = touch.clientX - rect.left;
      this.touchOffsetY = touch.clientY - rect.top;

      clearTimeout(this.touchHoldTimer);
      this.touchHoldTimer = setTimeout(() => {
        this.startTouchDrag(rect);
      }, 150);
    }, { passive: true });
  }

  startTouchDrag(rect) {
    if (!this.touchCardEl) return;
    this.isTouchDragging = true;

    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }

    // Clean up any stale clones before creating a new one
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());

    const clone = this.touchCardEl.cloneNode(true);
    clone.classList.add('touch-drag-clone');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.position = 'fixed';
    clone.style.left = `${this.touchStartX - this.touchOffsetX}px`;
    clone.style.top = `${this.touchStartY - this.touchOffsetY}px`;
    clone.style.zIndex = '99999';
    clone.style.pointerEvents = 'none';
    clone.style.boxShadow = '0 15px 30px rgba(0,0,0,0.3), 0 5px 15px rgba(0,0,0,0.2)';
    clone.style.transform = 'rotate(2.5deg) scale(1.03)';
    clone.style.opacity = '0.92';
    clone.style.transition = 'none';

    document.body.appendChild(clone);
    this.touchCloneEl = clone;
    this.touchCardEl.classList.add('is-dragging');
  }

  handleGlobalTouchMove(e) {
    const touch = e.touches[0];
    if (!touch) return;

    // Pill reordering takes priority: only one drag can be armed per touch.
    if (this.isPillDragging) {
      e.preventDefault();
      this.moveDraggedPill(touch.clientX);
      this.autoScrollPillNav(touch.clientX);
      return;
    }

    // List reordering takes priority: only one drag can be armed per touch.
    if (this.isTouchListDragging) {
      e.preventDefault();
      this.moveTouchListClone(touch);
      this.autoScrollBoard(touch);
      this.updateListPlaceholder(touch);
      return;
    }

    // A pill hold that has not armed yet turns back into a plain pill-bar scroll.
    if (this.pillDragEl && !this.isPillDragging) {
      if (Math.abs(touch.clientX - this.pillStartX) > 10) {
        clearTimeout(this.pillHoldTimer);
        this.pillDragEl = null;
        this.pillDragListId = null;
      }
      return;
    }

    if (!this.touchCardEl) return;

    const moveDist = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);

    if (!this.isTouchDragging && moveDist > 10) {
      clearTimeout(this.touchHoldTimer);
      return;
    }

    if (!this.isTouchDragging) return;
    e.preventDefault();

    if (this.touchCloneEl) {
      this.touchCloneEl.style.left = `${touch.clientX - this.touchOffsetX}px`;
      this.touchCloneEl.style.top = `${touch.clientY - this.touchOffsetY}px`;
    }

    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elemBelow) return;

    const cardsContainer = elemBelow.closest('.cards-container');
    if (cardsContainer) {
      this.currentTouchTargetListId = cardsContainer.getAttribute('data-list-id');
      const afterElement = this.getDragAfterElement(cardsContainer, '.kanban-card:not(.is-dragging)', touch.clientY);

      const placeholder = this.ensureCardPlaceholder();

      if (afterElement == null) {
        cardsContainer.appendChild(placeholder);
      } else if (placeholder !== afterElement) {
        cardsContainer.insertBefore(placeholder, afterElement);
      }
    }
  }

  handleGlobalTouchEnd() {
    clearTimeout(this.touchHoldTimer);
    clearTimeout(this.touchListHoldTimer);
    clearTimeout(this.pillHoldTimer);

    if (this.isPillDragging) {
      this.commitPillDrop();
      this.clearDragState();
      this.resetTouchState();
      return;
    }

    if (this.isTouchListDragging) {
      this.commitTouchListDrop();
      this.clearDragState();
      this.resetTouchState();
      return;
    }

    if (this.touchCloneEl) {
      try { this.touchCloneEl.remove(); } catch {}
      this.touchCloneEl = null;
    }
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());

    if (this.touchCardEl) {
      this.touchCardEl.classList.remove('is-dragging');
    }

    // Use the tracked placeholder, not a document-wide lookup: a lookup can
    // return the placeholder parked in the source column and compute the drop
    // index against the wrong container.
    const placeholder = this.cardPlaceholderEl;
    if (this.isTouchDragging && placeholder && this.currentTouchTargetListId && this.touchCardId) {
      const container = placeholder.closest('.cards-container');
      if (container) {
        const cardsInDom = [...container.querySelectorAll('.kanban-card:not(.is-dragging), .card-placeholder')];
        const targetIndex = cardsInDom.indexOf(placeholder);
        placeholder.remove();
        this.cardPlaceholderEl = null;

        const sourceListId = this.touchSourceListId || this.findCardListId(this.touchCardId);
        // Trust the container the placeholder actually sits in, so the list and
        // the index can never disagree.
        const targetListId = container.getAttribute('data-list-id') || this.currentTouchTargetListId;
        this.app.moveCard(this.touchCardId, sourceListId, targetListId, targetIndex);
      }
    }

    this.clearDragState();
    this.resetTouchState();
  }

  resetTouchState() {
    clearTimeout(this.touchHoldTimer);
    clearTimeout(this.touchListHoldTimer);
    clearTimeout(this.pillHoldTimer);
    this.isTouchDragging = false;
    this.touchCardEl = null;
    this.touchCloneEl = null;
    this.touchCardId = null;
    this.touchSourceListId = null;
    this.currentTouchTargetListId = null;
    this.isTouchListDragging = false;
    this.touchListEl = null;
    this.touchListId = null;
    this.touchListCloneEl = null;
    this.isPillDragging = false;
    this.pillDragEl = null;
    this.pillDragListId = null;
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());
  }

  // --- Touch List Reordering (Tablet / non-touch-pointer viewports) ---
  attachListTouchEvents(listEl, listId) {
    if (this.isMobileViewport()) return;
    const header = listEl.querySelector('.list-header');
    if (!header) return;

    header.addEventListener('touchstart', (e) => {
      // Drag must originate from the list header, and never from an
      // interactive control (the title input is used for renaming).
      if (e.target.closest('button, input, textarea, select, .kanban-card, .cards-container, .list-quick-add')) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      this.touchListEl = listEl;
      this.touchListId = listId;
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;

      const rect = listEl.getBoundingClientRect();
      this.touchListOffsetX = touch.clientX - rect.left;
      this.touchListOffsetY = touch.clientY - rect.top;

      clearTimeout(this.touchListHoldTimer);
      this.touchListHoldTimer = setTimeout(() => this.startTouchListDrag(rect), 150);
    }, { passive: true });
  }

  startTouchListDrag(rect) {
    if (!this.touchListEl) return;
    this.isTouchListDragging = true;
    this.isTouchDragging = false;

    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }

    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());

    const clone = this.touchListEl.cloneNode(true);
    clone.classList.add('touch-drag-clone');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.position = 'fixed';
    clone.style.left = `${this.touchStartX - this.touchListOffsetX}px`;
    clone.style.top = `${this.touchStartY - this.touchListOffsetY}px`;
    clone.style.zIndex = '99999';
    clone.style.pointerEvents = 'none';
    clone.style.boxShadow = '0 15px 30px rgba(0,0,0,0.3), 0 5px 15px rgba(0,0,0,0.2)';
    clone.style.transform = 'rotate(1.5deg) scale(1.02)';
    clone.style.opacity = '0.92';
    clone.style.transition = 'none';

    document.body.appendChild(clone);
    this.touchListCloneEl = clone;
    // Added after cloning so the floating clone does not inherit .list-dragging
    this.touchListEl.classList.add('list-dragging');
  }

  moveTouchListClone(touch) {
    if (!this.touchListCloneEl) return;
    this.touchListCloneEl.style.left = `${touch.clientX - this.touchListOffsetX}px`;
    this.touchListCloneEl.style.top = `${touch.clientY - this.touchListOffsetY}px`;
  }

  updateListPlaceholder(touch) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elemBelow) return;
    // The clone is pointer-events:none, so this hits the real list underneath.
    if (!elemBelow.closest('#board')) return;

    // The board is a horizontal scroller on desktop but stacks into a vertical
    // scroller on mobile, so the drop axis has to follow the flex direction.
    const isVertical = getComputedStyle(boardEl).flexDirection === 'column';
    const afterElement = isVertical
      ? this.getDragAfterElement(boardEl, '.kanban-list:not(.list-dragging)', touch.clientY)
      : this.getDragAfterElement(boardEl, '.kanban-list:not(.list-dragging)', touch.clientX, true);
    const addListBtn = boardEl.querySelector('.add-list-wrapper');

    let placeholder = boardEl.querySelector('.list-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'list-placeholder';
    }

    if (afterElement == null) {
      boardEl.insertBefore(placeholder, addListBtn);
    } else {
      boardEl.insertBefore(placeholder, afterElement);
    }
  }

  autoScrollBoard(touch) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    const isVertical = getComputedStyle(boardEl).flexDirection === 'column';
    const rect = boardEl.getBoundingClientRect();
    const EDGE = 56;
    const STEP = 14;

    if (isVertical) {
      if (touch.clientY < rect.top + EDGE) boardEl.scrollTop -= STEP;
      else if (touch.clientY > rect.bottom - EDGE) boardEl.scrollTop += STEP;
    } else {
      if (touch.clientX < rect.left + EDGE) boardEl.scrollLeft -= STEP;
      else if (touch.clientX > rect.right - EDGE) boardEl.scrollLeft += STEP;
    }
  }

  commitTouchListDrop() {
    // The floating clone is a child of <body>, not the board, so removing it
    // here cannot shift the index we are about to compute.
    document.querySelectorAll('.touch-drag-clone').forEach(el => el.remove());
    this.touchListCloneEl = null;

    const boardEl = document.getElementById('board');
    const placeholder = boardEl ? boardEl.querySelector('.list-placeholder') : null;
    if (!placeholder || !this.touchListId) return;

    // Same convention as handleBoardDrop: the dragged list is excluded from the
    // index because reorderList() already removes it from the array first.
    const lists = [...boardEl.querySelectorAll('.kanban-list:not(.list-dragging), .list-placeholder')];
    const targetIndex = lists.indexOf(placeholder);
    placeholder.remove();

    if (targetIndex !== -1) {
      this.app.reorderList(this.touchListId, targetIndex);
    }
  }
}

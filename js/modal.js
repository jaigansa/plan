/**
 * Streamlined Todo Details Modal controller
 * Handles: Title, Auto-colored Priority, Due Date, Notes, Subtasks Checklist, Archive & Delete
 */
import { escapeHtml, getDueStatus, ModalHelper } from './utils.js';

export class ModalController {
  constructor(app) {
    this.app = app;
    this.activeCardId = null;
    this.modalEl = document.getElementById('card-modal');
    this.setupEvents();
  }

  updateAndRefresh(updates) {
    if (!this.activeCardId) return null;
    this.app.updateCard(this.activeCardId, updates);
    return this.app.getCard(this.activeCardId);
  }

  setupEvents() {
    ModalHelper.bind(this.modalEl, null, 'modal-close-btn');

    // Title edit
    const titleInput = document.getElementById('modal-card-title');
    titleInput.addEventListener('change', () => {
      const newTitle = titleInput.value.trim() || 'Untitled Todo';
      this.updateAndRefresh({ title: newTitle });
    });

    // Description / Notes edit
    const descTextarea = document.getElementById('modal-card-desc');
    descTextarea.addEventListener('change', () => {
      this.updateAndRefresh({ description: descTextarea.value });
    });

    // Priority buttons with auto-coloring
    const priorityBtns = document.querySelectorAll('.priority-btn');
    priorityBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.activeCardId) return;
        const priority = btn.getAttribute('data-priority') || '';
        this.updateAndRefresh({ priority });
        this.renderPriority(priority);
      });
    });

    // Due Date edit
    const dueDateInput = document.getElementById('modal-card-due');
    dueDateInput.addEventListener('change', () => {
      const dateVal = dueDateInput.value;
      this.updateAndRefresh({ dueDate: dateVal });
      this.renderDueStatus(dateVal);
    });

    const clearDueBtn = document.getElementById('btn-clear-due');
    if (clearDueBtn) {
      clearDueBtn.addEventListener('click', () => {
        dueDateInput.value = '';
        this.updateAndRefresh({ dueDate: '' });
        this.renderDueStatus('');
      });
    }

    // Add Subtask Checklist Item
    const addChecklistBtn = document.getElementById('btn-add-checklist-item');
    const checklistInput = document.getElementById('new-checklist-text');
    const handleAddChecklist = () => {
      const text = checklistInput.value.trim();
      if (text && this.activeCardId) {
        const card = this.app.getCard(this.activeCardId);
        const checklist = card.checklist || [];
        checklist.push({ id: 'chk-' + Date.now(), text, done: false });
        this.updateAndRefresh({ checklist });
        checklistInput.value = '';
        this.renderChecklist(checklist);
      }
    };
    if (addChecklistBtn) {
      addChecklistBtn.addEventListener('click', handleAddChecklist);
      checklistInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleAddChecklist();
        }
      });
    }

    // Delete Todo
    const deleteCardBtn = document.getElementById('btn-delete-card');
    if (deleteCardBtn) {
      deleteCardBtn.addEventListener('click', () => {
        if (confirm('Delete this todo permanently?')) {
          this.app.deleteCard(this.activeCardId);
          this.close();
        }
      });
    }
  }

  open(cardId) {
    this.activeCardId = cardId;
    const card = this.app.getCard(cardId);
    if (!card) return;

    document.getElementById('modal-card-title').value = card.title || '';
    document.getElementById('modal-card-desc').value = card.description || '';
    document.getElementById('modal-card-due').value = card.dueDate || '';

    this.renderPriority(card.priority || '');
    this.renderDueStatus(card.dueDate || '');
    this.renderChecklist(card.checklist || []);

    ModalHelper.open(this.modalEl);
  }

  close() {
    ModalHelper.close(this.modalEl);
    this.activeCardId = null;
  }

  renderPriority(currentPriority) {
    const priorityBtns = document.querySelectorAll('.priority-btn');
    const cleanPriority = currentPriority || '';
    priorityBtns.forEach(btn => {
      const p = btn.getAttribute('data-priority') || '';
      btn.classList.toggle('active', p === cleanPriority);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  renderDueStatus(dueDateStr) {
    const badge = document.getElementById('modal-due-status');
    if (!badge) return;
    const status = getDueStatus(dueDateStr);
    if (!status) {
      badge.textContent = '';
      badge.className = 'due-status-badge';
      return;
    }
    badge.innerHTML = `<i data-lucide="${status.icon}"></i> ${status.modalText}`;
    badge.className = `due-status-badge ${status.cls}`;
    if (window.lucide) window.lucide.createIcons();
  }

  renderChecklist(checklist) {
    const listContainer = document.getElementById('modal-checklist-items');
    const progressBar = document.getElementById('checklist-progress-bar');
    const progressText = document.getElementById('checklist-progress-text');

    listContainer.innerHTML = '';

    const total = checklist.length;
    const completed = checklist.filter(item => item.done).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}% (${completed}/${total})`;

    checklist.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `checklist-item ${item.done ? 'is-completed' : ''}`;
      // item.id reaches an id/for attribute pair, so it must be escaped: ids
      // can arrive from an imported JSON file or a shared cloud card.
      const safeId = escapeHtml(String(item.id));
      row.innerHTML = `
        <input type="checkbox" id="chk-${safeId}" ${item.done ? 'checked' : ''} />
        <label for="chk-${safeId}">${escapeHtml(item.text)}</label>
        <button type="button" class="checklist-del-btn" title="Delete subtask"><i data-lucide="trash"></i></button>
      `;

      row.querySelector('input').addEventListener('change', (e) => {
        item.done = e.target.checked;
        this.updateAndRefresh({ checklist });
        this.renderChecklist(checklist);
      });

      row.querySelector('.checklist-del-btn').addEventListener('click', () => {
        checklist.splice(index, 1);
        this.updateAndRefresh({ checklist });
        this.renderChecklist(checklist);
      });

      listContainer.appendChild(row);
    });
    if (window.lucide) window.lucide.createIcons();
  }
}

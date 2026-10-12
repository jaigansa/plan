/**
 * Shared utilities, constants, and helpers for plan
 */

export function escapeHtml(str) {
  // Only null/undefined become ''. Using !str here would silently turn 0 and
  // false into an empty string.
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

export const PRIORITIES = {
  urgent: { key: 'urgent', name: 'Urgent', color: '#ef4444', rank: 4 },
  high:   { key: 'high',   name: 'High',   color: '#f97316', rank: 3 },
  medium: { key: 'medium', name: 'Medium', color: '#eab308', rank: 2 },
  low:    { key: 'low',    name: 'Low',    color: '#10b981', rank: 1 }
};

export class ModalHelper {
  static open(modalEl, onOpen) {
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    modalEl.style.display = 'flex';
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    if (onOpen) onOpen();
    if (window.lucide) window.lucide.createIcons();
  }

  static close(modalEl, onClose) {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
    const openModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    if (openModals.length === 0) {
      document.body.classList.remove('modal-open');
    }
    if (onClose) onClose();
  }

  static bind(modalEl, openTrigger, closeTrigger, onOpen) {
    if (!modalEl) return;

    if (openTrigger) {
      const btn = typeof openTrigger === 'string' ? document.getElementById(openTrigger) : openTrigger;
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          ModalHelper.open(modalEl, onOpen);
        });
      }
    }

    if (closeTrigger) {
      const btn = typeof closeTrigger === 'string' ? document.getElementById(closeTrigger) : closeTrigger;
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          ModalHelper.close(modalEl);
        });
      }
    }

    // Bind any elements inside modal with .modal-close or [data-modal-close]
    modalEl.querySelectorAll('.modal-close, [data-modal-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        ModalHelper.close(modalEl);
      });
    });

    // Backdrop click to close
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) {
        ModalHelper.close(modalEl);
      }
    });

    // Backdrop touch to close on mobile devices
    modalEl.addEventListener('touchend', (e) => {
      if (e.target === modalEl) {
        e.preventDefault();
        ModalHelper.close(modalEl);
      }
    });

    // Prevent clicks inside the modal card from bubbling to overlay
    const card = modalEl.querySelector('.modal-card');
    if (card) {
      card.addEventListener('click', (e) => e.stopPropagation());
    }
  }
}

/**
 * Three-way merge for plan board sync.
 *
 * The old behaviour was a blind overwrite: whoever saved last replaced the
 * other device's work. This module instead takes three versions of a board:
 *
 *   base   - the last state both sides agreed on (what we last synced)
 *   local  - this device's current state
 *   remote - the other device's state
 *
 * and produces a merged board plus a list of conflicts, so a card edited on
 * both sides is reported instead of silently lost.
 *
 * Pure functions only: no storage, no network, no DOM. That is deliberate - it
 * is the part most worth unit testing, because losing a card is unrecoverable.
 */

const CARD_FIELDS_TO_MERGE = [
  'title', 'description', 'priority', 'completed',
  'labels', 'checklist', 'comments', 'dueDate', 'days', 'archived'
];

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

export function sameDays(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return same(a, b);
  if (a.length !== b.length) return false;
  const sA = [...a].sort().join(',');
  const sB = [...b].sort().join(',');
  return sA === sB;
}

function asCards(data) {
  return (data && data.cards && typeof data.cards === 'object') ? data.cards : {};
}

function asLists(data) {
  return (data && Array.isArray(data.lists)) ? data.lists : [];
}

function cardIdsOf(list) {
  return (list && Array.isArray(list.cardIds)) ? list.cardIds : [];
}

/**
 * Merge one card.
 * @returns {{card: object|null, changedLocally: boolean, conflict: object|null}}
 *   card === null means "deleted locally, keep it deleted".
 */
function mergeCard(id, base, local, remote) {
  const b = base || null;
  const l = local === undefined ? null : local;
  const r = remote === undefined ? null : remote;

  // Added on one side only -> take the addition.
  if (!b) {
    if (l && !r) return { card: clone(l), changedLocally: !!l, conflict: null };
    if (r && !l) return { card: clone(r), changedLocally: false, conflict: null };
    if (l && r) {
      if (same(l, r)) return { card: clone(l), changedLocally: true, conflict: null };
      const m = mergeFields(id, l, r, b);
      return { card: m.card, changedLocally: true, conflict: m.conflict };
    }
    return { card: null, changedLocally: false, conflict: null };
  }

  // Deleted locally, still exists remotely -> respect the local delete.
  if (l === null) {
    if (r === null) return { card: null, changedLocally: true, conflict: null };
    if (same(r, b)) return { card: null, changedLocally: true, conflict: null };
    return {
      card: null,
      changedLocally: true,
      conflict: { type: 'delete-vs-edit', cardId: id, title: (r && r.title) || id }
    };
  }

  // Deleted remotely, still here locally
  if (r === null) {
    if (same(l, b)) {
      // Local did not modify it; remote deleted it -> respect the remote delete.
      return { card: null, changedLocally: false, conflict: null };
    }
    // Local modified it while remote deleted it -> keep local edit.
    return { card: clone(l), changedLocally: !same(l, b), conflict: null };
  }

  return mergeFields(id, l, r, b);
}

function mergeFields(id, l, r, b) {
  const out = clone(l);
  let conflict = null;
  let changedLocally = false;
  const fields = {};

  CARD_FIELDS_TO_MERGE.forEach((key) => {
    const lv = l[key];
    const rv = r[key];
    const bv = b ? b[key] : undefined;

    const areEqual = key === 'days' ? sameDays(lv, rv) : same(lv, rv);
    if (areEqual) return;              // both agree

    const remoteChangedOnly = key === 'days' ? sameDays(lv, bv) : same(lv, bv);
    if (remoteChangedOnly) {           // only remote changed
      if (rv !== undefined) out[key] = clone(rv);
      return;
    }

    const localChangedOnly = key === 'days' ? sameDays(rv, bv) : same(rv, bv);
    if (localChangedOnly) {            // only local changed -> keep local
      changedLocally = true;
      return;
    }

    // When there is no base snapshot (first sync / clean device):
    if (!b) {
      if (key === 'days') {
        const allDaysStr = 'F,M,R,S,T,U,W';
        const lStr = Array.isArray(lv) ? [...lv].sort().join(',') : '';
        const rStr = Array.isArray(rv) ? [...rv].sort().join(',') : '';
        // If local has default all-days and remote has custom days, adopt remote
        if (lStr === allDaysStr && rStr !== allDaysStr && rv !== undefined) {
          out[key] = clone(rv);
          return;
        }
        if (rStr === allDaysStr && lStr !== allDaysStr) {
          changedLocally = true;
          return;
        }
      }
      // If remote has a defined value and local is empty/falsy, take remote
      if ((lv === undefined || lv === null || lv === '') && rv !== undefined) {
        out[key] = clone(rv);
        return;
      }
    }

    // Both changed the same field differently. Keep local (the user is looking
    // at it) but record it so the UI can tell them.
    changedLocally = true;
    fields[key] = { local: clone(lv), remote: clone(rv) };
    if (!conflict) {
      conflict = {
        type: 'field-conflict',
        cardId: id,
        title: l.title || r.title || id,
        fields: Object.keys(fields)
      };
      conflict.values = fields;
    }
  });

  return { card: out, changedLocally, conflict };
}

/**
 * Merge a list's cardIds as an ordered set.
 * Local order wins; remote-only cards are appended in remote order.
 */
function mergeCardIds(id, base, local, remote) {
  const b = cardIdsOf(base);
  const l = cardIdsOf(local);
  const r = cardIdsOf(remote);

  const baseSet = new Set(b);
  const remoteSet = new Set(r);
  const localSet = new Set(l);

  const merged = [];
  const seen = new Set();
  l.forEach((cid) => { if (!seen.has(cid)) { seen.add(cid); merged.push(cid); } });

  r.forEach((cid) => {
    if (seen.has(cid)) return;
    // A card deleted locally stays deleted.
    if (baseSet.has(cid) && !localSet.has(cid)) return;
    seen.add(cid);
    merged.push(cid);
  });

  // Cards added locally that the remote list does not know about are kept
  // (already in `merged` from the local pass).
  void id;
  return merged;
}

function mergeList(list, base, remote) {
  const out = clone(list);
  if (base && typeof base.title === 'string' && remote && typeof remote.title === 'string') {
    if (base.title === list.title) out.title = remote.title;      // renamed remotely
    else if (base.title !== remote.title) {
      // renamed on both sides differently - keep local, conflict reported by caller
    }
  }
  if (remote && Array.isArray(remote.days)) {
    if (!base || sameDays(list.days, base.days)) {
      out.days = clone(remote.days);
    }
  }
  out.cardIds = mergeCardIds(list.id, base, list, remote);
  return out;
}

/**
 * Merge three board versions.
 *
 * @param {object} base   last agreed state (may be null on first sync)
 * @param {object} local  this device's board
 * @param {object} remote the other device's board
 * @returns {{data: object, conflicts: Array, changedLocally: boolean}}
 */
export function mergeBoards(base, local, remote) {
  const L = local || {};
  const R = remote || {};
  const B = base || null;

  let changedLocally = false;
  const conflicts = [];

  const baseListsById = {};
  asLists(B).forEach((l) => { baseListsById[l.id] = l; });
  const remoteListsById = {};
  asLists(R).forEach((l) => { remoteListsById[l.id] = l; });
  const localListsById = {};
  asLists(L).forEach((l) => { localListsById[l.id] = l; });

  const localDeletedLists = new Set(Array.isArray(L.deletedListIds) ? L.deletedListIds : []);
  const remoteDeletedLists = new Set(Array.isArray(R.deletedListIds) ? R.deletedListIds : []);
  const allDeletedLists = new Set([...localDeletedLists, ...remoteDeletedLists]);

  // Lists: keep local order, then append remote-only lists.
  const mergedLists = [];
  const usedListIds = new Set();
  asLists(L).forEach((list) => {
    // 1. Drop list if tombstoned on either side
    if (allDeletedLists.has(list.id)) {
      changedLocally = true;
      return;
    }
    // 2. Drop list if present in base, untouched locally, but deleted remotely
    if (baseListsById[list.id] && !remoteListsById[list.id]) {
      const baseList = baseListsById[list.id];
      if (baseList.title === list.title) {
        allDeletedLists.add(list.id);
        changedLocally = true;
        return;
      }
    }
    usedListIds.add(list.id);
    mergedLists.push(mergeList(list, baseListsById[list.id], remoteListsById[list.id]));
  });
  asLists(R).forEach((list) => {
    if (usedListIds.has(list.id)) return;
    if (allDeletedLists.has(list.id)) return;
    // Remote-only list: if it was deleted locally, keep it deleted.
    if (baseListsById[list.id] && !localListsById[list.id]) return;
    mergedLists.push(clone(list));
  });

  // Cards.
  const baseCards = asCards(B);
  const localCards = asCards(L);
  const remoteCards = asCards(R);
  const mergedCards = {};

  const allIds = new Set([
    ...Object.keys(baseCards),
    ...Object.keys(localCards),
    ...Object.keys(remoteCards)
  ]);

  const legacyDemoIds = new Set(['card-truck', 'card-2', 'card-3', 'card-4', 'card-1']);
  const localDeleted = (Array.isArray(L.deletedCardIds) ? L.deletedCardIds : []).filter(id => !legacyDemoIds.has(id));
  const remoteDeleted = (Array.isArray(R.deletedCardIds) ? R.deletedCardIds : []).filter(id => !legacyDemoIds.has(id));
  const allDeleted = new Set([...localDeleted, ...remoteDeleted]);

  allIds.forEach((id) => {
    if (allDeleted.has(id)) {
      // Explicitly deleted card tombstone - must not be resurrected
      return;
    }
    const hasLocal = Object.prototype.hasOwnProperty.call(localCards, id);
    const res = mergeCard(
      id,
      baseCards[id],
      hasLocal ? localCards[id] : undefined,
      remoteCards[id]
    );
    if (res.conflict) conflicts.push(res.conflict);
    if (res.card) mergedCards[id] = res.card;
    if (res.changedLocally) changedLocally = true;
  });

  // Drop references to cards that no longer exist anywhere.
  const cleanedLists = mergedLists.map((list) => ({
    ...list,
    cardIds: (list.cardIds || []).filter((cid) => mergedCards[cid] && !allDeleted.has(cid))
  }));

  const out = { ...clone(L), lists: cleanedLists, cards: mergedCards };
  if (Array.isArray(L.archivedCards)) out.archivedCards = clone(L.archivedCards);
  if (allDeleted.size > 0) out.deletedCardIds = [...allDeleted].slice(-200);
  if (allDeletedLists.size > 0) out.deletedListIds = [...allDeletedLists].slice(-100);

  return { data: out, conflicts, changedLocally };
}

export default mergeBoards;

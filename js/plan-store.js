/**
 * IndexedDB store for plan.
 *
 * Two jobs, one file, because both the page and the service worker need it and
 * the service worker cannot use ES modules:
 *
 *  1. MIRROR  - a copy of the active board that the service worker can read.
 *               localStorage is unreadable from a worker, so without this the
 *               worker cannot know which cards are due.
 *  2. BACKUP - rolling snapshots of every board, so wiping localStorage does
 *               not mean losing the data.
 *
 * Classic script: loaded via <script> in the page and importScripts() in the SW.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'plan-store';
  const DB_VERSION = 1;
  const MIRROR_STORE = 'mirror';
  const BACKUP_STORE = 'backups';
  const SNAPSHOT_LIMIT = 20;
  const ALL_BOARDS_ID = '*';

  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!hasIndexedDB()) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MIRROR_STORE)) db.createObjectStore(MIRROR_STORE);
        if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  /**
   * Run fn in one transaction and resolve with what it produced.
   *
   * fn may return an IDBRequest, in which case its result is used. The request
   * has to be tracked by hand: resolving on oncomplete alone cannot tell "the
   * request failed to find anything" (result === undefined) from "fn returned
   * no request at all", and guessing that way leaks IDBRequest objects to
   * callers whenever a lookup legitimately misses.
   */
  function tx(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(storeName, mode);
      } catch (err) {
        reject(err);
        return;
      }
      const store = t.objectStore(storeName);

      let value;
      let tracked = false;
      const track = (v) => {
        // Duck-typed rather than `instanceof IDBRequest`: this file also runs in
        // a test sandbox, where the IDBRequest global may not exist.
        if (v && typeof v === 'object' && 'result' in v && 'onsuccess' in v) {
          tracked = true;
          v.onsuccess = () => { value = v.result; };
          v.onerror = () => reject(v.error || new Error('IndexedDB request failed'));
        }
        return v;
      };

      try {
        track(fn(store));
      } catch (err) {
        reject(err);
        return;
      }

      t.oncomplete = () => resolve(tracked ? value : undefined);
      t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }

  /**
   * Store the active board for the service worker to read.
   * @param {object} payload { boardId, data, settings, savedAt }
   */
  async function putMirror(payload) {
    const db = await openDb();
    try {
      await tx(db, MIRROR_STORE, 'readwrite', (s) => s.put(payload, 'active'));
    } finally {
      db.close();
    }
  }

  async function getMirror() {
    const db = await openDb();
    try {
      const value = await tx(db, MIRROR_STORE, 'readonly', (s) => s.get('active'));
      return value === undefined ? null : value;
    } finally {
      db.close();
    }
  }

  /**
   * Save a timestamped snapshot, trimming to SNAPSHOT_LIMIT.
   * Failures are swallowed by the caller: a missed backup must never break a save.
   */
  async function putBackup(boardId, data, savedAt) {
    const db = await openDb();
    try {
      await putSnapshot(db, { boardId, data, savedAt });
    } finally {
      db.close();
    }
  }

  /**
   * Snapshot EVERY board in one record.
   *
   * A per-board snapshot only protects whichever board happened to be active, so
   * clearing localStorage would still lose the others. One record covering all
   * boards restores the whole workspace, and it is a single write, so a snapshot
   * can never be a half-finished mixture of old and new.
   */
  async function putBoardsBackup(boards, savedAt) {
    const db = await openDb();
    try {
      await putSnapshot(db, { boardId: ALL_BOARDS_ID, boards, savedAt });
    } finally {
      db.close();
    }
  }

  async function putSnapshot(db, record) {
    const at = typeof record.savedAt === 'number' ? record.savedAt : Date.now();
    const key = at + ':' + record.boardId;
    const entry = { boardId: record.boardId, savedAt: at };
    if (record.boards !== undefined) entry.boards = record.boards;
    else entry.data = record.data;

    await tx(db, BACKUP_STORE, 'readwrite', (s) => s.put(entry, key));

    const keys = await tx(db, BACKUP_STORE, 'readonly', (s) => s.getAllKeys());
    if (Array.isArray(keys) && keys.length > SNAPSHOT_LIMIT) {
      const sorted = keys.slice().sort();
      const excess = sorted.slice(0, sorted.length - SNAPSHOT_LIMIT);
      await tx(db, BACKUP_STORE, 'readwrite', (s) => { excess.forEach((k) => s.delete(k)); });
    }
  }

  /** Newest snapshot holding a full boards map, or null. */
  async function getLatestBoardsBackup() {
    const db = await openDb();
    try {
      const all = await tx(db, BACKUP_STORE, 'readonly', (s) => s.getAll());
      if (!Array.isArray(all)) return null;
      const pool = all.filter((b) => b && b.boards && typeof b.boards === 'object');
      if (!pool.length) return null;
      pool.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return pool[0] || null;
    } finally {
      db.close();
    }
  }

  /** Newest single-board snapshot for a board, or null. */
  async function getLatestBackup(boardId) {
    const db = await openDb();
    try {
      const all = await tx(db, BACKUP_STORE, 'readonly', (s) => s.getAll());
      if (!Array.isArray(all) || !all.length) return null;

      const newest = (list) => {
        const copy = list.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        return copy[0] || null;
      };

      // An all-boards snapshot contains this board, and a per-board snapshot is
      // allowed to be newer than the aggregate, so compare the two by time
      // rather than always trusting the aggregate.
      const candidates = [];

      all.forEach((b) => {
        if (!b) return;
        if (b.boardId === boardId && b.data) {
          candidates.push({ boardId, data: b.data, savedAt: b.savedAt });
        } else if (b.boards && typeof b.boards === 'object' && b.boards[boardId]) {
          candidates.push({ boardId, data: b.boards[boardId], savedAt: b.savedAt });
        }
      });

      if (candidates.length) return newest(candidates);
      // Nothing for this board: fall back to the newest snapshot we hold at all.
      return newest(all.filter((b) => b && b.data));
    } finally {
      db.close();
    }
  }

  /**
   * Every board id we hold a per-board snapshot for, with its newest time.
   * The aggregate ALL_BOARDS record is not a board, so it is not listed.
   */
  async function listBackups() {
    const db = await openDb();
    try {
      const all = await tx(db, BACKUP_STORE, 'readonly', (s) => s.getAll());
      if (!Array.isArray(all)) return [];
      const byBoard = {};
      all.forEach((b) => {
        if (!b || b.boardId === ALL_BOARDS_ID) return;
        const prev = byBoard[b.boardId];
        if (!prev || (b.savedAt || 0) > (prev.savedAt || 0)) byBoard[b.boardId] = b;
      });
      return Object.keys(byBoard).map((id) => ({ boardId: id, savedAt: byBoard[id].savedAt }));
    } finally {
      db.close();
    }
  }

  root.PlanStore = {
    hasIndexedDB: hasIndexedDB,
    putMirror: putMirror,
    getMirror: getMirror,
    putBackup: putBackup,
    putBoardsBackup: putBoardsBackup,
    getLatestBackup: getLatestBackup,
    getLatestBoardsBackup: getLatestBoardsBackup,
    listBackups: listBackups
  };
})(typeof self !== 'undefined' ? self : this);

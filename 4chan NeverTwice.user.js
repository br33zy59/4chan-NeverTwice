// ==UserScript==
// @name         4chan NeverTwice
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  Hides threads based on similarity to ones that have been posted before
// @author       Foo
// @match        https://boards.4chan.org/*
// @match        https://boards.4channel.org/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const DB_NAME = '4chanNeverTwice';
    const STORE_NAME = 'seenThreads';
    const DB_VERSION = 3;
    const HAMMING_THRESHOLD = 4; // How similar posts have to be to match. Lower = must be more similar.
    const PRUNE_DAYS = 90;
    const DEBUG = true; // Set to false when done testing
    const MODE = 'mark'; // Options: 'hide' or 'mark'
    const CROSS_BOARD_CHECK = 1; // 1 = compare against all boards, 0 = same board only

    let processTimeout = null;
    let db;

    // Per-board cache when CROSS_BOARD_CHECK = 0; full-DB cache when = 1
    const boardCache = new Map();
    let allCache = null;

    // ====================== Debug Logging ======================
    function log(...args) {
        if (DEBUG) console.log('[NeverTwice]', ...args);
    }

    // ====================== Board / Page Detection ======================
    function getCurrentBoard() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[0] || '';
    }

    function isCatalogPage() {
        const path = window.location.pathname;
        const hash = window.location.hash;
        return (
            path.endsWith('/catalog') ||
            hash === '#catalog' ||
            (path.split('/').filter(Boolean).length === 1)
        );
    }

    // ====================== General Detection ======================
    const GENERAL_SLASH_RE = /^\s*\/\w+\/\s*/;
    const GENERAL_HASH_RE = /#\d+/;
    const GENERAL_WORD_RE = /general/i;
    const GENERAL_QUOTE_RE = />>\d+/;

    // Skip dupe checks if we think the thread is a general
    function isGeneralThread(title, teaser) {
        if (!title || !teaser) return false;
        if (GENERAL_SLASH_RE.test(title) || GENERAL_HASH_RE.test(title) || GENERAL_WORD_RE.test(title)) return true;
        if (GENERAL_QUOTE_RE.test(teaser)) return true;
        return false;
    }

    // ====================== Mark Duplicate Threads ======================
    function markDuplicate(thread) {
        thread.style.border = '3px solid #ff4444';
        thread.style.backgroundColor = 'rgba(255, 68, 68, 0.08)';
        thread.classList.add('duplicate-marked');

        const img = thread.querySelector('img');
        if (img) {
            img.style.border = '2px solid #ff0000';
        }
    }

    const TITLE_SELECTORS = '.post-title, .thread-title, .subject, .title';
    const TEASER_SELECTORS = '.postMessage, .post-message, .comment, .teaser, .post-text, .summary, .body, .message';
    const TEASER_FALLBACK_SELECTORS = 'blockquote.postMessage, blockquote, .postMessage, .comment, .post-message';

    function extractThreadText(threadEl) {
        let title = threadEl.querySelector(TITLE_SELECTORS)?.textContent.trim() || '';
        let teaser = threadEl.querySelector(TEASER_SELECTORS)?.textContent.trim() || '';

        if (!teaser) {
            const container = threadEl.querySelector('.post, .catalog-post, article') || threadEl;
            if (!title) {
                title = container.querySelector(TITLE_SELECTORS)?.textContent.trim() || '';
            }
            teaser = Array.from(container.querySelectorAll(TEASER_FALLBACK_SELECTORS))
                .map(el => el.textContent.trim())
                .filter(Boolean)
                .join(' ')
                .substring(0, 300);
        }

        return { title, teaser };
    }

    // ====================== SimHash (64-bit as hi/lo uint32 pair) ======================
    function hashString64(str) {
        let lo = 2166136261;
        let hi = 16777619;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            lo ^= c;
            lo = Math.imul(lo, 16777619);
            hi ^= c + i;
            hi = Math.imul(hi, 2246822519);
        }
        return { hi: hi >>> 0, lo: lo >>> 0 };
    }

    function simpleSimHash(text) {
        const normalized = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\bgeneral\b|\bg\b|\/[\w]+\/|thread/gi, ' ');

        const words = normalized.split(' ').filter(w => w.length >= 3);
        const loVector = new Array(32).fill(0);
        const hiVector = new Array(32).fill(0);

        words.forEach(word => {
            const { hi, lo } = hashString64(word);
            for (let i = 0; i < 32; i++) {
                loVector[i] += ((lo >>> i) & 1) ? 1 : -1;
                hiVector[i] += ((hi >>> i) & 1) ? 1 : -1;
            }
        });

        let simhashLo = 0;
        let simhashHi = 0;
        for (let i = 0; i < 32; i++) {
            if (loVector[i] > 0) simhashLo |= (1 << i);
            if (hiVector[i] > 0) simhashHi |= (1 << i);
        }
        return { hi: simhashHi >>> 0, lo: simhashLo >>> 0 };
    }

    function popcount32(x) {
        x >>>= 0;
        let count = 0;
        while (x) {
            count += x & 1;
            x >>>= 1;
        }
        return count;
    }

    function hammingDistance(a, b) {
        return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
    }

    function simhashBucket(simhash) {
        return simhash.hi >>> 24;
    }

    function simhashToHex(simhash) {
        const hi = simhash.hi.toString(16).padStart(8, '0');
        const lo = simhash.lo.toString(16).padStart(8, '0');
        return hi + lo;
    }

    function isDegenerateHash(simhash) {
        return simhash.hi === 0 && simhash.lo === 0;
    }

    function threadKey(board, threadNo) {
        return `${board}/${threadNo}`;
    }

    // ====================== IndexedDB ======================
    function createObjectStore(db) {
        const store = db.createObjectStore(STORE_NAME, {
            keyPath: ['board', 'threadNo']
        });
        store.createIndex('board', 'board', { unique: false });
        store.createIndex('ts', 'ts', { unique: false });
        store.createIndex('bucket', 'bucket', { unique: false });
        return store;
    }

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                db = event.target.result;

                if (event.oldVersion < DB_VERSION) {
                    if (db.objectStoreNames.contains(STORE_NAME)) {
                        db.deleteObjectStore(STORE_NAME);
                    }
                    createObjectStore(db);
                }
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                pruneDegenerateEntries();
                pruneOldEntries();
                resolve();
            };
            request.onerror = (event) => reject(event);
        });
    }

    function pruneDegenerateEntries() {
        if (!db) return;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const { board, simhashHi, simhashLo } = cursor.value;
                if (isDegenerateHash({ hi: simhashHi, lo: simhashLo })) {
                    cursor.delete();
                    boardCache.delete(board);
                    allCache = null;
                }
                cursor.continue();
            }
        };
    }

    function pruneOldEntries() {
        if (!db) return;
        const cutoff = Date.now() - (PRUNE_DAYS * 86400000);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const index = tx.objectStore(STORE_NAME).index('ts');
        index.openCursor(IDBKeyRange.upperBound(cutoff)).onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const board = cursor.value.board;
                cursor.delete();
                boardCache.delete(board);
                allCache = null;
                cursor.continue();
            }
        };
    }

    function entryFromRecord(record) {
        return {
            board: record.board,
            threadNo: record.threadNo,
            simhash: { hi: record.simhashHi, lo: record.simhashLo },
            ts: record.ts
        };
    }

    function filterRecords(records) {
        return records
            .filter(r => !isDegenerateHash({ hi: r.simhashHi, lo: r.simhashLo }))
            .map(entryFromRecord);
    }

    async function loadAllCache() {
        if (allCache) return allCache;

        allCache = await new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            tx.objectStore(STORE_NAME).getAll().onsuccess = (e) => {
                resolve(filterRecords(e.target.result));
            };
        });

        return allCache;
    }

    async function loadBoardCache(board) {
        if (boardCache.has(board)) {
            return boardCache.get(board);
        }

        const entries = await new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const index = tx.objectStore(STORE_NAME).index('board');
            index.getAll(board).onsuccess = (e) => {
                resolve(filterRecords(e.target.result));
            };
        });

        boardCache.set(board, entries);
        return entries;
    }

    async function loadCompareCache(board) {
        return CROSS_BOARD_CHECK ? loadAllCache() : loadBoardCache(board);
    }

    function appendToCache(board, entry) {
        if (CROSS_BOARD_CHECK) {
            if (allCache) allCache.push(entry);
            return;
        }
        if (boardCache.has(board)) {
            boardCache.get(board).push(entry);
        }
    }

    function addSeenThread(board, threadNo, simhash) {
        if (isDegenerateHash(simhash)) return;

        const record = {
            board,
            threadNo,
            simhashHi: simhash.hi,
            simhashLo: simhash.lo,
            bucket: simhashBucket(simhash),
            ts: Date.now()
        };

        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);

        appendToCache(board, entryFromRecord(record));
        log(`Added to DB → /${board}/${threadNo} | Hash: ${simhashToHex(simhash)}`);
    }

    function isRepeat(board, simhash, currentThreadNo, candidates) {
        if (isDegenerateHash(simhash)) return { isDuplicate: false };

        let bestMatch = null;
        let matchCount = 0;
        let newestTimestamp = 0;

        for (const entry of candidates) {
            if (entry.board === board && entry.threadNo === currentThreadNo) continue;
            if (isDegenerateHash(entry.simhash)) continue;

            const dist = hammingDistance(entry.simhash, simhash);
            if (dist <= HAMMING_THRESHOLD) {
                matchCount++;
                if (entry.ts > newestTimestamp) {
                    newestTimestamp = entry.ts;
                    bestMatch = entry;
                }
            }
        }

        if (matchCount > 0 && bestMatch) {
            const distance = hammingDistance(bestMatch.simhash, simhash);
            const lastSeenDate = new Date(newestTimestamp).toLocaleString();

            log(`MATCH FOUND! Distance: ${distance} | ` +
                `Current: /${board}/${currentThreadNo} | ` +
                `Old: /${bestMatch.board}/${bestMatch.threadNo} | ` +
                `Seen ${matchCount} time(s) before | Last Seen: ${lastSeenDate}`);

            return {
                isDuplicate: true,
                matchCount,
                lastSeen: newestTimestamp
            };
        }

        return { isDuplicate: false };
    }

    // ====================== Debug Helpers (Global) ======================
    window.dumpNeverTwiceDB = async () => {
        if (!db) return console.warn('DB not initialized');

        const tx = db.transaction(STORE_NAME, 'readonly');
        const entries = await new Promise((resolve) => {
            tx.objectStore(STORE_NAME).getAll().onsuccess = (e) => resolve(e.target.result);
        });

        console.groupCollapsed(`NeverTwice DB - ${entries.length} entries`);
        entries.forEach((e, i) => {
            const hash = simhashToHex({ hi: e.simhashHi, lo: e.simhashLo });
            console.log(`#${i + 1} | /${e.board}/${e.threadNo} | Hash:${hash} | ts:${e.ts}`);
        });
        console.groupEnd();
    };

    window.clearNeverTwiceDB = async () => {
        if (!db) return console.warn('DB not initialized');
        boardCache.clear();
        allCache = null;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        await new Promise((resolve, reject) => {
            const request = tx.objectStore(STORE_NAME).clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        console.log('[NeverTwice] Database cleared.');
    };

    // ====================== Catalog Processing ======================
    const processedThreads = new Set();

    async function processCatalog() {
        if (!db || !isCatalogPage()) return;

        if (processTimeout) clearTimeout(processTimeout);

        processTimeout = setTimeout(async () => {
            const board = getCurrentBoard();
            if (!board) return;

            await loadCompareCache(board);

            const candidates = (CROSS_BOARD_CHECK ? allCache : boardCache.get(board)) || [];
            const indexedKeys = new Set(candidates.map(e => threadKey(e.board, e.threadNo)));

            const threads = document.querySelectorAll('.thread, .catalog-thread, article.thread, div.thread');

            for (const thread of threads) {
                const threadNo = thread.dataset.id || thread.id?.replace(/[^0-9]/g, '') || '';
                if (!threadNo || thread.style.display === 'none') continue;

                const key = threadKey(board, threadNo);
                if (processedThreads.has(key)) continue;

                const { title, teaser } = extractThreadText(thread);

                if ( isGeneralThread(title, teaser) ) {
                    processedThreads.add(key);
                    continue;
                }

                if (!title && !teaser) {
                    processedThreads.add(key);
                    continue;
                }

                processedThreads.add(key);
                const combined = (title || '') + ' || ' + (teaser || '');
                const simhash = simpleSimHash(combined);

                if (isDegenerateHash(simhash)) {
                    log(`Skipped (insufficient text): /${board}/${threadNo} | "${combined.substring(0, 80)}"`);
                    continue;
                }

                if (indexedKeys.has(key)) {
                    continue;
                }

                const result = isRepeat(board, simhash, threadNo, candidates);

                if (result.isDuplicate) {
                    if (MODE === 'hide') {
                        thread.style.display = 'none';
                        thread.classList.add('hidden-duplicate');
                        log(`HIDING duplicate thread /${board}/${threadNo}`);
                    } else {
                        markDuplicate(thread);
                        log(`MARKED duplicate thread /${board}/${threadNo}`);
                    }
                } else {
                    addSeenThread(board, threadNo, simhash);
                    indexedKeys.add(key);
                    log(`Added new thread /${board}/${threadNo}`);
                }
            }
        }, 450);
    }

    // ====================== Main ======================
    async function main() {
        if (!isCatalogPage()) return;

        await initDB();

        console.log('%c[NeverTwice] Debug mode active. Use dumpNeverTwiceDB() and clearNeverTwiceDB() in console.', 'color: #0a0');

        setTimeout(processCatalog, 800);

        const observer = new MutationObserver(() => setTimeout(processCatalog, 500));
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('4chanX', () => setTimeout(processCatalog, 300));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();
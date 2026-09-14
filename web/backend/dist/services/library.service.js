"use strict";
// ---------------------------------------------------------------------------
//  Library service -- SQLite-backed with in-memory Map for O(1) lookups
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryUploadUnavailableError = exports.DuplicateContentError = void 0;
exports.sanitizeFilename = sanitizeFilename;
exports.contentDisposition = contentDisposition;
exports.getAll = getAll;
exports.incrementDownloadCount = incrementDownloadCount;
exports.toggleStar = toggleStar;
exports.getById = getById;
exports.getFilePath = getFilePath;
exports.fileExists = fileExists;
exports.addItem = addItem;
exports.deleteItem = deleteItem;
exports.batchDelete = batchDelete;
exports.reload = reload;
const db_1 = __importDefault(require("../db"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const logger_1 = __importDefault(require("../logger"));
const LIBRARY_FILES = path_1.default.join(config_1.LIBRARY_DIR, 'files');
fs_1.default.mkdirSync(LIBRARY_FILES, { recursive: true });
// Prepared statements
const stmtAll = db_1.default.prepare('SELECT * FROM library ORDER BY uploadedAt DESC');
const stmtInsert = db_1.default.prepare('INSERT INTO library (id, filename, uploader, uploaderId, uploadedAt, size, frameCount, downloadCount, contentHash) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)');
const stmtGetByContentHash = db_1.default.prepare('SELECT id FROM library WHERE contentHash = ? LIMIT 1');
const stmtUpdateContentHash = db_1.default.prepare('UPDATE library SET contentHash = ? WHERE id = ?');
const stmtDelete = db_1.default.prepare('DELETE FROM library WHERE id = ?');
const stmtDeleteStars = db_1.default.prepare('DELETE FROM library_stars WHERE libraryId = ?');
const stmtGetById = db_1.default.prepare('SELECT * FROM library WHERE id = ?');
const stmtIncrementDownload = db_1.default.prepare('UPDATE library SET downloadCount = COALESCE(downloadCount, 0) + 1 WHERE id = ?');
const stmtStarCounts = db_1.default.prepare('SELECT libraryId, COUNT(*) as cnt FROM library_stars GROUP BY libraryId');
const stmtStarGet = db_1.default.prepare('SELECT 1 FROM library_stars WHERE userId = ? AND libraryId = ?');
const stmtStarInsertOrIgnore = db_1.default.prepare('INSERT OR IGNORE INTO library_stars (userId, libraryId) VALUES (?, ?)');
const stmtStarRemove = db_1.default.prepare('DELETE FROM library_stars WHERE userId = ? AND libraryId = ?');
// ---------------------------------------------------------------------------
//  In-memory cache (Map<id, LibraryItem>) and backfill queue
// ---------------------------------------------------------------------------
const cache = new Map();
const backfillQueue = [];
/** True only after UNIQUE index on contentHash exists; uploads are rejected with 503 until then to avoid race duplicates. */
let uniqueIndexReady = false;
/** Last time we ran DDL for UNIQUE index; used to cooldown retries from upload path. */
let lastUniqueIndexRetryAt = 0;
const UNIQUE_INDEX_RETRY_COOLDOWN_MS = 60_000; // 60s between DDL attempts from upload path
function loadCache() {
    cache.clear();
    backfillQueue.length = 0;
    const rows = stmtAll.all();
    for (const row of rows) {
        const item = {
            id: row.id,
            filename: row.filename,
            uploader: row.uploader,
            uploaderId: row.uploaderId,
            uploadedAt: row.uploadedAt,
            size: row.size ?? 0,
            frameCount: row.frameCount ?? 0,
            downloadCount: row.downloadCount ?? 0,
            contentHash: row.contentHash,
        };
        cache.set(item.id, item);
        if (!item.contentHash)
            backfillQueue.push(item);
    }
    logger_1.default.info({ count: cache.size, backfill: backfillQueue.length }, 'Library cache loaded');
}
const BACKFILL_CHUNK = 50;
const BACKFILL_DELAY_MS = 10;
function runBackfillChunk() {
    if (backfillQueue.length === 0) {
        dedupeLibraryDuplicates();
        ensureUniqueContentHashConstraint();
        return;
    }
    const chunk = backfillQueue.splice(0, BACKFILL_CHUNK);
    for (const item of chunk) {
        const filePath = path_1.default.join(LIBRARY_FILES, `${item.id}.qgif`);
        if (!fs_1.default.existsSync(filePath))
            continue;
        try {
            const buf = fs_1.default.readFileSync(filePath);
            const contentHash = crypto_1.default.createHash('sha256').update(buf).digest('hex');
            stmtUpdateContentHash.run(contentHash, item.id);
            item.contentHash = contentHash;
        }
        catch (err) {
            logger_1.default.warn({ id: item.id, err }, 'Failed to backfill contentHash');
        }
    }
    setTimeout(runBackfillChunk, BACKFILL_DELAY_MS);
}
function dedupeLibraryDuplicates() {
    const byHash = new Map();
    for (const item of cache.values()) {
        if (!item.contentHash)
            continue;
        const list = byHash.get(item.contentHash) ?? [];
        list.push(item);
        byHash.set(item.contentHash, list);
    }
    let removed = 0;
    for (const list of byHash.values()) {
        if (list.length <= 1)
            continue;
        list.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
        for (let i = 1; i < list.length; i++) {
            if (deleteItem(list[i].id))
                removed++;
        }
    }
    if (removed > 0)
        logger_1.default.info({ removed }, 'Library dedupe: removed duplicate contentHash rows');
}
/** Single index on contentHash: UNIQUE only (legacy non-unique idx_library_contentHash dropped here to avoid dual index). */
function tryCreateUniqueContentHashIndex() {
    try {
        db_1.default.exec('DROP INDEX IF EXISTS idx_library_contentHash');
        db_1.default.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_library_contentHash_unique ON library(contentHash)");
        uniqueIndexReady = true;
        logger_1.default.info('Library: UNIQUE index on contentHash ready');
        return true;
    }
    catch (err) {
        logger_1.default.warn({ err }, 'Library: UNIQUE index on contentHash not created (e.g. duplicate contentHash in DB)');
        uniqueIndexReady = false;
        return false;
    }
}
function ensureUniqueContentHashConstraint() {
    tryCreateUniqueContentHashIndex();
    if (uniqueIndexReady)
        return;
    // Background retry so we don't run DDL on every upload; interval cleared when index is ready
    const retryMs = 60_000;
    const t = setInterval(() => {
        if (uniqueIndexReady) {
            clearInterval(t);
            return;
        }
        if (tryCreateUniqueContentHashIndex())
            clearInterval(t);
    }, retryMs);
    t.unref?.();
}
/** Call from addItem only; respects cooldown to avoid DDL/log flood. */
function tryCreateUniqueContentHashIndexIfCooldown() {
    if (uniqueIndexReady)
        return true;
    const now = Date.now();
    if (now - lastUniqueIndexRetryAt < UNIQUE_INDEX_RETRY_COOLDOWN_MS)
        return false;
    lastUniqueIndexRetryAt = now;
    return tryCreateUniqueContentHashIndex();
}
loadCache();
setImmediate(runBackfillChunk);
// ---------------------------------------------------------------------------
//  Filename sanitisation for Content-Disposition headers
// ---------------------------------------------------------------------------
/**
 * Sanitise a filename for use in Content-Disposition.
 * Strips control characters and problematic ASCII, then produces an
 * RFC-5987-encoded filename* for full Unicode support.
 */
function sanitizeFilename(raw) {
    // Remove control chars, quotes, backslashes, path separators
    const safe = raw.replace(/[\x00-\x1f"\\/:*?<>|]/g, '_');
    // ASCII-only fallback (replace non-ASCII with _)
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
    // RFC 5987 percent-encode
    const encoded = encodeURIComponent(safe).replace(/'/g, '%27');
    return { ascii, encoded };
}
/**
 * Build a full Content-Disposition header value for file download.
 */
function contentDisposition(filename) {
    const { ascii, encoded } = sanitizeFilename(filename);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
function getAll(sort = 'stars', userId) {
    const starRows = stmtStarCounts.all();
    const starCountMap = new Map(starRows.map((r) => [r.libraryId, r.cnt]));
    const starredSet = new Set();
    if (userId) {
        const all = [...cache.values()];
        for (const item of all) {
            if (stmtStarGet.get(userId, item.id) != null)
                starredSet.add(item.id);
        }
    }
    const items = [...cache.values()].map((item) => {
        const { contentHash: _h, ...rest } = item;
        return {
            ...rest,
            starCount: starCountMap.get(item.id) ?? 0,
            starredByMe: userId ? starredSet.has(item.id) : undefined,
        };
    });
    if (sort === 'newest') {
        items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
    else if (sort === 'stars') {
        items.sort((a, b) => (b.starCount ?? 0) - (a.starCount ?? 0) || new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
    else {
        items.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0) || new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    }
    return items;
}
function incrementDownloadCount(id) {
    const item = cache.get(id);
    if (!item)
        return;
    stmtIncrementDownload.run(id);
    item.downloadCount = (item.downloadCount ?? 0) + 1;
}
function toggleStar(userId, libraryId) {
    const item = cache.get(libraryId);
    if (!item)
        return false;
    const result = stmtStarInsertOrIgnore.run(userId, libraryId);
    if (result.changes === 1)
        return true;
    stmtStarRemove.run(userId, libraryId);
    return false;
}
function getById(id) {
    const item = cache.get(id);
    if (!item)
        return null;
    const { contentHash: _h, ...rest } = item;
    return rest;
}
function getFilePath(id) {
    return path_1.default.join(LIBRARY_FILES, `${id}.qgif`);
}
function fileExists(id) {
    return fs_1.default.existsSync(getFilePath(id));
}
/** Thrown when upload content is identical to an existing library file (any user). */
class DuplicateContentError extends Error {
    constructor() {
        super('Duplicate file content');
        this.name = 'DuplicateContentError';
    }
}
exports.DuplicateContentError = DuplicateContentError;
/** Thrown when UNIQUE index on contentHash is not available; uploads disabled to avoid duplicate race. */
class LibraryUploadUnavailableError extends Error {
    constructor() {
        super('Library upload temporarily unavailable');
        this.name = 'LibraryUploadUnavailableError';
    }
}
exports.LibraryUploadUnavailableError = LibraryUploadUnavailableError;
function getByContentHash(contentHash) {
    const row = stmtGetByContentHash.get(contentHash);
    if (!row)
        return null;
    return cache.get(row.id) ?? null;
}
function addItem(buf, originalFilename, uploader, uploaderId, frameCount) {
    if (!uniqueIndexReady) {
        if (!tryCreateUniqueContentHashIndexIfCooldown()) {
            throw new LibraryUploadUnavailableError();
        }
    }
    const contentHash = crypto_1.default.createHash('sha256').update(buf).digest('hex');
    if (getByContentHash(contentHash)) {
        throw new DuplicateContentError();
    }
    const id = crypto_1.default.randomBytes(8).toString('hex');
    fs_1.default.writeFileSync(getFilePath(id), buf);
    const item = {
        id,
        filename: originalFilename,
        uploader,
        uploaderId,
        uploadedAt: new Date().toISOString(),
        size: buf.length,
        frameCount,
        downloadCount: 0,
        contentHash,
    };
    try {
        stmtInsert.run(item.id, item.filename, item.uploader, item.uploaderId, item.uploadedAt, item.size, item.frameCount, contentHash);
    }
    catch (err) {
        const code = err?.code;
        try {
            fs_1.default.unlinkSync(getFilePath(id));
        }
        catch {
            // ignore
        }
        if (code === 'SQLITE_CONSTRAINT') {
            throw new DuplicateContentError();
        }
        throw err;
    }
    cache.set(id, item);
    logger_1.default.info({ id, filename: item.filename, uploader: item.uploader }, 'Library item added');
    const { contentHash: _h, ...rest } = item;
    return rest;
}
function deleteItem(id) {
    const item = cache.get(id);
    if (!item)
        return false;
    try {
        fs_1.default.unlinkSync(getFilePath(id));
    }
    catch {
        // file already gone, continue
    }
    stmtDeleteStars.run(id);
    stmtDelete.run(id);
    cache.delete(id);
    return true;
}
function batchDelete(ids, userId) {
    let deleted = 0;
    let failed = 0;
    const tx = db_1.default.transaction(() => {
        for (const id of ids) {
            const item = cache.get(id);
            if (!item || item.uploaderId !== userId) {
                failed++;
                continue;
            }
            try {
                fs_1.default.unlinkSync(getFilePath(id));
            }
            catch {
                // ignore
            }
            stmtDeleteStars.run(id);
            stmtDelete.run(id);
            cache.delete(id);
            deleted++;
        }
    });
    tx();
    return { deleted, failed };
}
/**
 * Reloads from DB -- useful if needed after external changes.
 * Not typically called at runtime.
 */
function reload() {
    loadCache();
}
//# sourceMappingURL=library.service.js.map
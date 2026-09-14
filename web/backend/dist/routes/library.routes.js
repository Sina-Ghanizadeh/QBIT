"use strict";
// ---------------------------------------------------------------------------
//  Library routes -- /api/library/*
// ---------------------------------------------------------------------------
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = __importDefault(require("archiver"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validate_1 = require("../middleware/validate");
const requireNotBanned_1 = require("../middleware/requireNotBanned");
const schemas_1 = require("../schemas");
const config_1 = require("../config");
const libraryService = __importStar(require("../services/library.service"));
const publicUserId_service_1 = require("../services/publicUserId.service");
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
// Rate limit specifically for library endpoints
const libraryLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.LIBRARY_RATE_LIMIT.windowMs,
    max: config_1.LIBRARY_RATE_LIMIT.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
router.use(libraryLimiter);
// Multer: store in memory for validation before writing to disk
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: config_1.MAX_QGIF_SIZE },
    fileFilter: (_req, file, cb) => {
        if (file.originalname.endsWith('.qgif')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only .qgif files are accepted'));
        }
    },
});
// GET /api/library -- list all items (query: sort=newest|stars|downloads, default stars); whitelist DTO only
router.get('/', (req, res) => {
    const sort = req.query.sort || 'stars';
    const validSort = ['newest', 'stars', 'downloads'].includes(sort) ? sort : 'stars';
    const userId = req.isAuthenticated() ? req.user.id : undefined;
    const items = libraryService.getAll(validSort, userId);
    const payload = items.map((item) => ({
        id: item.id,
        filename: item.filename,
        uploader: item.uploader,
        uploadedAt: item.uploadedAt,
        size: item.size,
        frameCount: item.frameCount,
        downloadCount: item.downloadCount,
        starCount: item.starCount,
        starredByMe: item.starredByMe,
        uploaderPublicId: (0, publicUserId_service_1.ensurePublicUserId)(item.uploaderId),
    }));
    res.json(payload);
});
// POST /api/library/upload -- upload a .qgif file
router.post('/upload', requireNotBanned_1.requireNotBanned, (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required to upload' });
    }
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }
        const buf = req.file.buffer;
        // Validate .qgif header (5 bytes minimum)
        if (buf.length < 5) {
            return res.status(400).json({ error: 'File too small' });
        }
        const frameCount = buf[0];
        const width = buf[1] | (buf[2] << 8);
        const height = buf[3] | (buf[4] << 8);
        if (frameCount === 0 || width !== 128 || height !== 64) {
            return res.status(400).json({ error: 'Invalid .qgif format' });
        }
        // Verify expected file size: header(5) + delays(fc*2) + frames(fc*1024)
        const expectedSize = 5 + frameCount * 2 + frameCount * 1024;
        if (buf.length < expectedSize) {
            return res.status(400).json({ error: 'File is truncated' });
        }
        const user = req.user;
        try {
            const item = libraryService.addItem(buf, req.file.originalname, user.displayName || 'Unknown', user.id, frameCount);
            const payload = {
                id: item.id,
                filename: item.filename,
                uploader: item.uploader,
                uploadedAt: item.uploadedAt,
                size: item.size,
                frameCount: item.frameCount,
                downloadCount: item.downloadCount,
                uploaderPublicId: (0, publicUserId_service_1.ensurePublicUserId)(item.uploaderId),
            };
            res.json(payload);
        }
        catch (err) {
            if (err instanceof libraryService.DuplicateContentError) {
                return res.status(409).json({
                    error: 'This file is already in the library (same content)',
                    code: 'DUPLICATE_CONTENT',
                });
            }
            if (err instanceof libraryService.LibraryUploadUnavailableError) {
                return res.status(503).json({
                    error: 'Library upload temporarily unavailable',
                    code: 'SERVICE_UNAVAILABLE',
                });
            }
            logger_1.default.error({ err }, 'Library upload failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    });
});
// DELETE /api/library/batch -- batch delete (must be before /:id to avoid matching "batch")
router.delete('/batch', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.libraryBatchSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const { ids } = req.body;
    const result = libraryService.batchDelete(ids, user.id);
    res.json({ ok: true, ...result });
});
// POST /api/library/batch-download -- zip download
router.post('/batch-download', (0, validate_1.validate)(schemas_1.libraryBatchSchema), (req, res) => {
    const { ids } = req.body;
    const filesToZip = [];
    for (const id of ids) {
        const item = libraryService.getById(id);
        if (!item)
            continue;
        const filePath = libraryService.getFilePath(id);
        if (fs_1.default.existsSync(filePath)) {
            filesToZip.push({ filename: item.filename, filepath: filePath });
            libraryService.incrementDownloadCount(id);
        }
    }
    if (filesToZip.length === 0) {
        return res.status(404).json({ error: 'No files found' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="qgif-library.zip"');
    const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    for (const f of filesToZip) {
        // Sanitize filename: only keep basename to prevent zip-slip
        const safeName = path_1.default.basename(f.filename);
        archive.file(f.filepath, { name: safeName });
    }
    archive.finalize();
});
// GET /api/library/:id/download -- download with Content-Disposition
router.get('/:id/download', (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const item = libraryService.getById(id);
    if (!item)
        return res.status(404).json({ error: 'Not found' });
    const filePath = libraryService.getFilePath(item.id);
    if (!fs_1.default.existsSync(filePath))
        return res.status(404).json({ error: 'File missing' });
    libraryService.incrementDownloadCount(item.id);
    res.setHeader('Content-Disposition', libraryService.contentDisposition(item.filename));
    res.setHeader('Content-Type', 'application/octet-stream');
    fs_1.default.createReadStream(filePath).pipe(res);
});
// GET /api/library/:id/raw -- raw bytes for canvas renderer
router.get('/:id/raw', (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const item = libraryService.getById(id);
    if (!item)
        return res.status(404).json({ error: 'Not found' });
    const filePath = libraryService.getFilePath(item.id);
    if (!fs_1.default.existsSync(filePath))
        return res.status(404).json({ error: 'File missing' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs_1.default.createReadStream(filePath).pipe(res);
});
// POST /api/library/:id/star -- toggle star (auth required)
router.post('/:id/star', requireNotBanned_1.requireNotBanned, (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required to star' });
    }
    const user = req.user;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const item = libraryService.getById(id);
    if (!item)
        return res.status(404).json({ error: 'Not found' });
    const starred = libraryService.toggleStar(user.id, id);
    res.json({ starred });
});
// DELETE /api/library/:id -- delete a single item (own uploads only)
router.delete('/:id', requireNotBanned_1.requireNotBanned, (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required' });
    }
    const user = req.user;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const item = libraryService.getById(id);
    if (!item)
        return res.status(404).json({ error: 'Not found' });
    if (item.uploaderId !== user.id) {
        return res.status(403).json({ error: 'You can only delete your own uploads' });
    }
    libraryService.deleteItem(id);
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=library.routes.js.map
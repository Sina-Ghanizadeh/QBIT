"use strict";
// ---------------------------------------------------------------------------
//  Report routes -- POST /api/report (user reports for admin)
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
const validate_1 = require("../middleware/validate");
const requireNotBanned_1 = require("../middleware/requireNotBanned");
const schemas_1 = require("../schemas");
const reportService = __importStar(require("../services/report.service"));
const userService = __importStar(require("../services/user.service"));
const publicUserId_service_1 = require("../services/publicUserId.service");
const logger_1 = __importDefault(require("../logger"));
const router = (0, express_1.Router)();
// POST /api/report -- submit a report (logged-in user reports another user by publicUserId)
router.post('/report', requireNotBanned_1.requireNotBanned, (0, validate_1.validate)(schemas_1.reportSchema), (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Login required to report' });
    }
    const reporter = req.user;
    const { reportedPublicUserId, description } = req.body;
    const reportedUserId = (0, publicUserId_service_1.getUserIdFromPublicId)(reportedPublicUserId);
    if (!reportedUserId) {
        return res.status(400).json({ error: 'Reported user not found' });
    }
    if (reporter.id === reportedUserId) {
        return res.status(400).json({ error: 'Cannot report yourself' });
    }
    const reported = userService.getUserById(reportedUserId);
    if (!reported) {
        return res.status(400).json({ error: 'Reported user not found' });
    }
    const report = reportService.addReport(reporter.id, reporter.displayName ?? null, reportedUserId, reported.displayName ?? null, description);
    logger_1.default.info({ reporterUserId: reporter.id, reportedUserId, reportId: report.id }, 'User report submitted');
    res.status(201).json({ ok: true, id: report.id });
});
exports.default = router;
//# sourceMappingURL=report.routes.js.map
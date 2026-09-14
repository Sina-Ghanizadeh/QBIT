"use strict";
// ---------------------------------------------------------------------------
//  Report service -- user reports for admin review
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addReport = addReport;
exports.getAllReports = getAllReports;
exports.deleteReport = deleteReport;
const db_1 = __importDefault(require("../db"));
const stmtInsert = db_1.default.prepare('INSERT INTO reports (reporterUserId, reporterName, reportedUserId, reportedUserName, description, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
const stmtAll = db_1.default.prepare('SELECT * FROM reports ORDER BY createdAt DESC');
const stmtGetById = db_1.default.prepare('SELECT * FROM reports WHERE id = ?');
const stmtDelete = db_1.default.prepare('DELETE FROM reports WHERE id = ?');
function addReport(reporterUserId, reporterName, reportedUserId, reportedUserName, description) {
    const createdAt = new Date().toISOString();
    const result = stmtInsert.run(reporterUserId, reporterName ?? null, reportedUserId, reportedUserName ?? null, description, createdAt);
    const row = stmtGetById.get(result.lastInsertRowid);
    return row;
}
function getAllReports() {
    return stmtAll.all();
}
function deleteReport(id) {
    const result = stmtDelete.run(id);
    return result.changes > 0;
}
//# sourceMappingURL=report.service.js.map
"use strict";
// ---------------------------------------------------------------------------
//  Zod validation middleware factory
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
exports.validateParams = validateParams;
const zod_1 = require("zod");
/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema.  On failure, responds with 400 and structured error details.
 */
function validate(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        }
        catch (err) {
            if (err instanceof zod_1.ZodError) {
                res.status(400).json({
                    error: 'Validation failed',
                    details: err.errors.map((e) => ({
                        path: e.path.join('.'),
                        message: e.message,
                    })),
                });
                return;
            }
            next(err);
        }
    };
}
/**
 * Returns Express middleware that validates `req.params` against the given
 * Zod schema (e.g. { userId: z.string()... }). On failure, responds with 400.
 */
function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.params = schema.parse(req.params);
            next();
        }
        catch (err) {
            if (err instanceof zod_1.ZodError) {
                res.status(400).json({
                    error: 'Invalid path parameter',
                    details: err.errors.map((e) => ({
                        path: e.path.join('.'),
                        message: e.message,
                    })),
                });
                return;
            }
            next(err);
        }
    };
}
//# sourceMappingURL=validate.js.map
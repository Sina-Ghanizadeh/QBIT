"use strict";
// ---------------------------------------------------------------------------
//  Telegram bot -- link accounts + poke / groups / devices commands
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
exports.startTelegramBot = startTelegramBot;
exports.stopTelegramBot = stopTelegramBot;
const config_1 = require("../config");
const botService = __importStar(require("./bot.service"));
const networkService = __importStar(require("./network.service"));
const groupService = __importStar(require("./group.service"));
const socialService = __importStar(require("./social.service"));
const friendService = __importStar(require("./friend.service"));
const claimService = __importStar(require("./claim.service"));
const deviceService = __importStar(require("./device.service"));
const userService = __importStar(require("./user.service"));
const socketService = __importStar(require("./socket.service"));
const publicUserId_service_1 = require("./publicUserId.service");
const logger_1 = __importDefault(require("../logger"));
let pollOffset = 0;
let pollTimer = null;
async function api(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${config_1.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json());
    if (!data.ok) {
        throw new Error(data.description || 'Telegram API error');
    }
    return data.result;
}
async function send(chatId, text) {
    await api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}
function helpText() {
    const uname = config_1.TELEGRAM_BOT_USERNAME ? `@${config_1.TELEGRAM_BOT_USERNAME}` : 'the bot';
    return [
        '<b>QBIT Telegram</b>',
        '',
        'Link: open the web dashboard → generate a code → /start CODE',
        '',
        '/status — my devices',
        '/groups — my groups',
        '/join CODE — request join (private invite)',
        '/poke USER_PUBLIC_ID text — poke an online user',
        '/global on|off — set global network visibility',
        '/unlink — disconnect Telegram',
        '/help',
        '',
        `Bot: ${uname}`,
    ].join('\n');
}
async function handleMessage(chatId, text, username) {
    const parts = text.trim().split(/\s+/);
    const cmdRaw = (parts[0] || '').split('@')[0].toLowerCase();
    const args = parts.slice(1);
    if (cmdRaw === '/start') {
        const code = args[0];
        if (!code) {
            await send(chatId, helpText());
            return;
        }
        const result = botService.completeLink('telegram', code, String(chatId), username);
        if ('error' in result) {
            await send(chatId, `Link failed: ${result.error}`);
            return;
        }
        const u = userService.getUserById(result.userId);
        await send(chatId, `Linked to <b>${u?.displayName || 'your account'}</b>. Try /status`);
        return;
    }
    const link = botService.getLinkByChatId('telegram', String(chatId));
    if (!link || !link.platformChatId || !link.linkedAt) {
        if (cmdRaw === '/help') {
            await send(chatId, helpText());
            return;
        }
        await send(chatId, 'Account not linked. Generate a code in the web dashboard and send /start CODE');
        return;
    }
    const userId = link.userId;
    switch (cmdRaw) {
        case '/help':
            await send(chatId, helpText());
            break;
        case '/status': {
            const devices = networkService.getMyDevices(userId);
            if (devices.length === 0) {
                await send(chatId, 'No claimed devices.');
                break;
            }
            const lines = devices.map((d) => `• ${d.name} — ${d.online ? 'online' : 'offline'}${d.showInGlobal ? ' (global)' : ''}`);
            await send(chatId, `<b>Your devices</b>\n${lines.join('\n')}`);
            break;
        }
        case '/groups': {
            const groups = groupService.listMyGroups(userId);
            if (groups.length === 0) {
                await send(chatId, 'You are not in any groups.');
                break;
            }
            const lines = groups.map((g) => `• ${g.name} [${g.visibility}] — ${g.memberStatus} (${g.memberRole})`);
            await send(chatId, `<b>Your groups</b>\n${lines.join('\n')}`);
            break;
        }
        case '/join': {
            const code = args[0];
            if (!code) {
                await send(chatId, 'Usage: /join INVITE_CODE');
                break;
            }
            const result = groupService.requestJoinByCode(code, userId);
            if ('error' in result) {
                await send(chatId, result.error);
                break;
            }
            await send(chatId, 'Join request submitted (pending approval).');
            break;
        }
        case '/global': {
            const v = (args[0] || '').toLowerCase();
            if (v !== 'on' && v !== 'off') {
                await send(chatId, 'Usage: /global on|off');
                break;
            }
            socialService.setIsGlobal(userId, v === 'on');
            await send(chatId, `Global network: <b>${v}</b>`);
            break;
        }
        case '/poke': {
            const targetPublic = args[0];
            const msg = args.slice(1).join(' ').slice(0, 25);
            if (!targetPublic || !msg) {
                await send(chatId, 'Usage: /poke USER_PUBLIC_ID message');
                break;
            }
            const targetUserId = (0, publicUserId_service_1.getUserIdFromPublicId)(targetPublic);
            if (!targetUserId) {
                await send(chatId, 'User not found');
                break;
            }
            const reason = socialService.canPokeReason(userId, targetUserId);
            if (reason) {
                await send(chatId, reason);
                break;
            }
            const onlineUsersMap = socketService.getOnlineUsersMap();
            const targetSocketIds = [];
            for (const u of onlineUsersMap.values()) {
                if (u.userId === targetUserId)
                    targetSocketIds.push(u.socketId);
            }
            if (targetSocketIds.length === 0) {
                // Try poke first online claimed device of target
                const claims = claimService.getAllClaims();
                let poked = false;
                for (const [deviceId, claim] of Object.entries(claims)) {
                    if (claim.userId !== targetUserId)
                        continue;
                    if (friendService.getOnlyFriendsCanPoke(claim.userId) && !friendService.areFriends(claim.userId, userId)) {
                        continue;
                    }
                    const device = deviceService.getDevice(deviceId);
                    if (!device)
                        continue;
                    const sender = userService.getUserById(userId);
                    device.ws.send(JSON.stringify({
                        type: 'poke',
                        sender: sender?.displayName || 'Telegram',
                        text: msg,
                    }));
                    poked = true;
                    break;
                }
                if (!poked) {
                    await send(chatId, 'User offline and no online device to poke');
                    break;
                }
                await send(chatId, 'Poke sent to their device');
                break;
            }
            const io = socketService.getIo();
            const sender = userService.getUserById(userId);
            const payload = {
                from: sender?.displayName || 'Telegram',
                fromPublicUserId: (0, publicUserId_service_1.ensurePublicUserId)(userId),
                text: msg,
            };
            for (const sid of targetSocketIds) {
                const s = io.sockets.sockets.get(sid);
                if (s)
                    s.emit('poke', payload);
            }
            io.emit('poke:highlight', { publicUserId: targetPublic });
            await send(chatId, 'Poke sent');
            break;
        }
        case '/unlink': {
            botService.unlink(userId, 'telegram');
            await send(chatId, 'Telegram unlinked from your QBIT account.');
            break;
        }
        default:
            await send(chatId, 'Unknown command. /help');
    }
}
function startTelegramBot() {
    if (!config_1.TELEGRAM_BOT_TOKEN) {
        logger_1.default.info('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
        return;
    }
    logger_1.default.info({ username: config_1.TELEGRAM_BOT_USERNAME || '(unknown)' }, 'Starting Telegram bot long-poll');
    const tick = async () => {
        try {
            const updates = (await api('getUpdates', {
                offset: pollOffset,
                timeout: 25,
                allowed_updates: ['message'],
            }));
            for (const u of updates) {
                pollOffset = u.update_id + 1;
                const msg = u.message;
                if (!msg?.text || msg.chat.type !== 'private')
                    continue;
                try {
                    await handleMessage(msg.chat.id, msg.text, msg.from?.username || msg.chat.username);
                }
                catch (err) {
                    logger_1.default.error({ err, chatId: msg.chat.id }, 'Telegram message handler error');
                    try {
                        await send(msg.chat.id, 'Sorry, something went wrong.');
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
        catch (err) {
            logger_1.default.error({ err }, 'Telegram getUpdates failed');
        }
    };
    // Run loop without overlapping: schedule next after each tick
    const loop = async () => {
        await tick();
        if (pollTimer !== null || config_1.TELEGRAM_BOT_TOKEN) {
            setTimeout(loop, 500);
        }
    };
    void loop();
}
function stopTelegramBot() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
//# sourceMappingURL=telegram.bot.js.map
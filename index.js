const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const GEMINI_FALLBACK_MODELS = [...new Set([
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite"
])];
const CREATOR_PHONE = "243977332867";
const SELF_URL = "https://gim-sney.onrender.com";
const MEMORY_DB_DIR = process.env.MEMORY_DIR || path.join(__dirname, 'gim_memory_db');

const botSentIds = new Set();

process.on('uncaughtException', (err) => console.error('[ERREUR]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE]:', err.message));

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GIM SNEY IA PRO est 100% active et en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT, () => console.log(`[HTTP] Serveur actif sur le port ${PORT}`));

setInterval(() => { fetch(SELF_URL).catch(() => {}); }, 10 * 60 * 1000);

// ==========================================
// MEMOIRE PERSISTANTE PAR UTILISATEUR
// ==========================================
function formatTimeAgo(isoDate) {
    if (!isoDate) return "premier echange";
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return "a l'instant";
    const min = Math.floor(diffMs / 60000);
    if (min < 2) return "a l'instant";
    if (min < 60) return `il y a ${min} minutes`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} heure${h > 1 ? 's' : ''}`;
    const d = Math.floor(h / 24);
    return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}

class PersistentMemoryDB {
    constructor(dbDir = MEMORY_DB_DIR, windowSize = 12, maxFacts = 15) {
        this.dbDir = dbDir;
        this.windowSize = windowSize;
        this.maxFacts = maxFacts;
        this.cache = new Map();
        if (!fs.existsSync(this.dbDir)) fs.mkdirSync(this.dbDir, { recursive: true });
    }
    getFilePath(userId) {
        return path.join(this.dbDir, `user_${String(userId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    }
    loadUser(userId, defaultName = "Membre") {
        if (this.cache.has(userId)) return this.cache.get(userId);
        const filePath = this.getFilePath(userId);
        let record = null;
        if (fs.existsSync(filePath)) {
            try { record = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
        }
        if (!record || typeof record !== 'object') {
            record = {
                userId,
                phone: /^\d+$/.test(userId) ? userId : null,
                name: defaultName,
                createdAt: new Date().toISOString(),
                lastSeenAt: null,
                longTermFacts: [],
                recentMessages: []
            };
        }
        if (!Array.isArray(record.longTermFacts)) record.longTermFacts = [];
        if (!Array.isArray(record.recentMessages)) record.recentMessages = [];
        this.cache.set(userId, record);
        return record;
    }
    saveUser(record) {
        if (!fs.existsSync(this.dbDir)) fs.mkdirSync(this.dbDir, { recursive: true });
        const filePath = this.getFilePath(record.userId);
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
        this.cache.set(record.userId, record);
    }
    getGeminiHistory(userId, defaultName) {
        const record = this.loadUser(userId, defaultName);
        const validPairs = [];
        for (let i = 0; i + 1 < record.recentMessages.length; i++) {
            const u = record.recentMessages[i];
            const m = record.recentMessages[i + 1];
            if (u?.role === 'user' && m?.role === 'model' && u.text && m.text) {
                validPairs.push({ role: 'user', parts: [{ text: u.text }] }, { role: 'model', parts: [{ text: m.text }] });
                i++;
            }
        }
        return { record, geminiHistory: validPairs.slice(-this.windowSize), timeSinceLastSeen: formatTimeAgo(record.lastSeenAt) };
    }
    appendExchange(userIdentity, userText, botReply, meta = {}) {
        const record = this.loadUser(userIdentity.userId, userIdentity.displayName);
        const nowIso = new Date().toISOString();
        if (userIdentity.displayName) record.name = userIdentity.displayName;
        if (userIdentity.phone) record.phone = userIdentity.phone;
        record.lastSeenAt = nowIso;
        record.recentMessages.push(
            { role: 'user', text: userText, timestamp: nowIso, groupJid: meta.groupJid || null },
            { role: 'model', text: botReply, timestamp: nowIso, groupJid: meta.groupJid || null }
        );
        while (record.recentMessages.length > this.windowSize) {
            const oldU = record.recentMessages.shift();
            const oldM = record.recentMessages[0]?.role === 'model' ? record.recentMessages.shift() : null;
            if (oldU?.text) {
                record.longTermFacts.push(`[${(oldU.timestamp || nowIso).slice(0, 10)}] "${oldU.text.replace(/\s+/g, ' ').slice(0, 100)}" -> "${(oldM?.text || '').replace(/\s+/g, ' ').slice(0, 100)}"`);
            }
        }
        if (record.longTermFacts.length > this.maxFacts) record.longTermFacts = record.longTermFacts.slice(-this.maxFacts);
        this.saveUser(record);
    }
    clearUserMemory(userId) {
        this.cache.delete(userId);
        const fp = this.getFilePath(userId);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
}

const memoryDB = new PersistentMemoryDB();

// ==========================================
// UTILITAIRES WHATSAPP & IDENTITE
// ==========================================
function extractPhoneFromJid(jid = "") {
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid')) return "";
    return (jid.split('@')[0] || "").split(':')[0].replace(/\D/g, '');
}

async function resolveUserIdentity(msg, sock) {
    const participant = msg?.key?.participant || "";
    const participantAlt = msg?.key?.participantAlt || "";
    const isFromMe = Boolean(msg?.key?.fromMe);
    let phone = extractPhoneFromJid(participantAlt) || extractPhoneFromJid(participant);

    if (!phone && participant.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
        try { phone = extractPhoneFromJid(await sock.signalRepository.lidMapping.getPNForLID(participant)); } catch (_) {}
    }
    if (!phone && isFromMe) phone = CREATOR_PHONE;

    const isCreator = isFromMe || phone === CREATOR_PHONE || participant.includes(CREATOR_PHONE) || participantAlt.includes(CREATOR_PHONE);
    if (isCreator && !phone) phone = CREATOR_PHONE;

    const rawLid = participant.endsWith('@lid') ? participant.split('@')[0].split(':')[0].replace(/\W/g, '') : '';
    return {
        userId: phone || (rawLid ? `lid_${rawLid}` : 'unknown'),
        phone: phone || null,
        isCreator,
        displayName: msg?.pushName || (isCreator ? "Boss Dieudonne" : "Frerot")
    };
}

function unwrapMessage(m) {
    if (!m) return null;
    if (m.ephemeralMessage?.message) return unwrapMessage(m.ephemeralMessage.message);
    if (m.viewOnceMessage?.message) return unwrapMessage(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return unwrapMessage(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension?.message) return unwrapMessage(m.viewOnceMessageV2Extension.message);
    return m;
}

function formatForWhatsApp(text = "") {
    return text
        .replace(/^.*?(Je vais (maintenant )?(chercher|vérifier|verifier|analyser|scanner)[^\n]*\n+)/gim, '')
        .replace(/^\s*\*\s+/gm, '• ')
        .replace(/^#{1,6}\s*(.+)$/gm, (_, t) => `*${t.replace(/\*/g, '').trim()}*`)
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/^\s*---+\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function getMediaBuffer(mediaMsg, type = 'image') {
    try {
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (e) {
        console.error(`Erreur ${type}:`, e.message);
        return null;
    }
}

async function sendTracked(sock, jid, content, options = {}) {
    const sent = await sock.sendMessage(jid, content, options);
    if (sent?.key?.id) {
        botSentIds.add(sent.key.id);
        if (botSentIds.size > 500) botSentIds.delete(botSentIds.values().next().value);
    }
    return sent;
}

// ==========================================
// MOTEUR FOOTBALL & GEMINI
// ==========================================
function classifySportsIntent(question = "", media = null) {
    if (media?.kind === 'image') return 'TICKET_AUDIT';
    if (media?.kind === 'audio') return 'AUDIO_MIXED';
    const q = question.toLowerCase();
    const keys = ['prono', 'pronostic', 'analyse', 'ticket', 'pari', 'cote', 'btts', '1x2', 'double chance', 'plus de', 'moins de', 'score', 'matchs du jour', 'ce soir', "aujourd'hui", ' vs ', ' contre '];
    return keys.some(k => q.includes(k)) || !q.trim() ? 'MATCH_ANALYSIS' : 'SIMPLE_QUERY';
}

function getSystemPrompt(userIdentity, memoryContext, intent) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });
    const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lubumbashi' });

    const { isCreator, displayName, userId } = userIdentity;
    const { record, geminiHistory, timeSinceLastSeen } = memoryContext;
    const isImmediateFollowUp = geminiHistory.length > 0 && (timeSinceLastSeen === "a l'instant" || timeSinceLastSeen.includes('minutes'));

    const greeting = isImmediateFollowUp
        ? `Ne salue PAS a nouveau, reponds directement.`
        : isCreator
        ? `Interlocuteur : Ton Createur ILUNGA MONGA DIEUDONNE. Salue en une courte phrase max (ex: "Bonjour Créateur ! 🫡 Voici...") puis reponds.`
        : `Interlocuteur : ${displayName}. Salue en quelques mots max puis reponds.`;

    const memBlock = record.longTermFacts.length > 0
        ? `\nMEMOIRE PERSISTANTE (${userId}, dernier passage : ${timeSinceLastSeen}) :\n- ${record.longTermFacts.join('\n- ')}`
        : (record.lastSeenAt ? `\nDernier echange avec ${userId} : ${timeSinceLastSeen}.` : '');

    const sportRules = intent === 'SIMPLE_QUERY'
        ? `Reponds en 1 a 3 phrases courtes (3 a 6 si explication). Utilise Google Search si besoin.`
        : `MOTEUR FOOT :
- Utilise Google Search pour verifier l'existence du match (${date}, apres ${heure} a Lubumbashi), forme (5 derniers matchs), classement, buts, absents et H2H.
- Si un match n'a pas lieu aujourd'hui, signale-le immediatement. N'invente JAMAIS de stats.
- Pour chaque match, donne : *Victoire 1X2* • *Double Chance* • *Plus/Moins de buts* • *BTTS* • *Score probable* • *Option à risque réduit* avec justification factuelle.
- Distingue *probabilités statistiques* et *estimations*. Si les donnees 2026 manquent, max *Confiance : 5/10 — Fiabilité : INSUFFISANTE* (jamais 10/10).`;

    return `Tu es GIM SNEY, analyste sportif du groupe "Pronostic du sport". Createur : ILUNGA MONGA DIEUDONNE.
Date : ${date}, ${heure} (Lubumbashi). ${greeting}${memBlock}
STYLE STRICT : Direct, concis facon ChatGPT, sans remplissage ni phrases du type "Je vais maintenant chercher...".
FORMAT WHATSAPP : Jamais de ### ni ** ni ---. Utilise *un seul asterisque* pour le gras et • pour les listes.
${sportRules}`;
}

async function askGemini(groupJid, userIdentity, question, media = null, modelIndex = 0, retries = 1) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    if (!modelName) throw new Error("Quota journalier atteint sur tous les modeles.");

    const memoryContext = memoryDB.getGeminiHistory(userIdentity.userId, userIdentity.displayName);
    const intent = classifySportsIntent(question, media);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [];
    if (media?.data) parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
    const promptText = question || (media?.kind === 'audio' ? "Ecoute ce vocal et reponds." : "Analyse ce ticket Betpawa via Google Search.");
    parts.push({ text: `[${userIdentity.isCreator ? 'Boss Dieudonne' : userIdentity.displayName}] : ${promptText}` });

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: getSystemPrompt(userIdentity, memoryContext, intent) }] },
                contents: [...memoryContext.geminiHistory, { role: "user", parts }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            const e = new Error(data.error?.message || `HTTP ${res.status}`);
            e.status = res.status;
            throw e;
        }
        const raw = data.candidates?.[0]?.content?.parts?.filter(p => typeof p.text === 'string')?.map(p => p.text)?.join("")?.trim();
        if (!raw) throw new Error("Reponse vide.");

        const answer = formatForWhatsApp(raw);
        const label = media?.kind === 'image' ? `[Ticket] ${promptText}` : media?.kind === 'audio' ? `[Vocal]` : promptText;
        memoryDB.appendExchange(userIdentity, label, answer, { groupJid });
        return answer;
    } catch (err) {
        const m = err.message || "";
        const switchModel = err.status === 429 || err.status === 404 || m.includes('quota') || m.includes('Quota') || m.includes('not found');
        if (switchModel && modelIndex + 1 < GEMINI_FALLBACK_MODELS.length) {
            return askGemini(groupJid, userIdentity, question, media, modelIndex + 1, retries);
        }
        if (!m.includes('API key') && !m.includes('leaked') && !switchModel && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(groupJid, userIdentity, question, media, modelIndex, retries - 1);
        }
        throw err;
    }
}

// ==========================================
// BOT WHATSAPP
// ==========================================
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        const sock = makeWASocket({ logger: pino({ level: 'silent' }), auth: state, browser: ['Ubuntu', 'Chrome', '20.0.04'] });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(CREATOR_PHONE);
                    console.log("\n👉 CODE WHATSAPP : " + code + "\n");
                } catch (e) { console.error("Erreur code:", e.message); }
            }, 6000);
        }

        sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
            if (connection === 'open') console.log('🎉 GIM SNEY PRO ACTIF (GROUPES + MEMOIRE PERSISTANTE) !');
            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 3000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (!msg?.message || (msg.key?.id && botSentIds.has(msg.key.id))) continue;
                const sender = msg.key.remoteJid;
                if (!sender || !sender.endsWith('@g.us')) continue; // GROUPES UNIQUEMENT

                const content = unwrapMessage(msg.message);
                if (!content) continue;

                const ctx = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo || content.audioMessage?.contextInfo;
                const quoted = unwrapMessage(ctx?.quotedMessage);
                const isReplyToBot = Boolean(ctx?.stanzaId && botSentIds.has(ctx.stanzaId));
                const img = content.imageMessage || quoted?.imageMessage;
                const audioMsg = content.audioMessage || quoted?.audioMessage;
                const text = (content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || "").trim();
                const lower = text.toLowerCase();

                const isCmd = lower.startsWith('!gim') || lower.startsWith('!prono') || lower.startsWith('pronostic') || lower.startsWith('/predict') || lower.includes('gimsney') || lower === 'football' || lower === '!reset' || lower === 'gimsney reset';
                if (!isCmd && !isReplyToBot) continue;

                const userIdentity = await resolveUserIdentity(msg, sock);
                if (lower === '!reset' || lower === 'gimsney reset') {
                    memoryDB.clearUserMemory(userIdentity.userId);
                    await sendTracked(sock, sender, { text: `🧹 Memoire personnelle reinitialisee, ${userIdentity.displayName} ! ⚽` }, { quoted: msg });
                    continue;
                }

                let media = null;
                if (img) {
                    const buf = await getMediaBuffer(img, 'image');
                    if (buf) media = { kind: 'image', mimeType: (img.mimetype || 'image/jpeg').split(';')[0].trim(), data: buf.toString('base64') };
                } else if (audioMsg) {
                    const buf = await getMediaBuffer(audioMsg, 'audio');
                    if (buf) media = { kind: 'audio', mimeType: (audioMsg.mimetype || 'audio/ogg').split(';')[0].trim(), data: buf.toString('base64') };
                }

                const question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim() || (media ? "" : "Cherche les vrais matchs d'aujourd'hui et propose une analyse complete avec pronostics.");

                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const reply = await askGemini(sender, userIdentity, question, media);
                    await sendTracked(sock, sender, { text: reply }, { quoted: msg });
                } catch (err) {
                    console.error("Erreur groupe:", err.message);
                    await sendTracked(sock, sender, { text: "⚠️ Petite saturation temporaire sur mes donnees en direct, reposez votre question dans quelques instants !" }, { quoted: msg });
                } finally {
                    await sock.sendPresenceUpdate('paused', sender);
                }
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

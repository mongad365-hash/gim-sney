const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// ==========================================
// CONFIGURATION OFFICIELLE
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = [...new Set([
    PRIMARY_MODEL,
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

function startKeepAliveServer() {
    const PORT = process.env.PORT || 10000;
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GIM SNEY IA PRO est 100% active et en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
    }).listen(PORT, () => {
        console.log(`[HTTP] Serveur actif sur le port ${PORT}`);
    });

    setInterval(() => {
        fetch(SELF_URL).catch(() => {});
    }, 10 * 60 * 1000);
}

// ==========================================
// BASE DE DONNEES PERSISTANTE PAR UTILISATEUR
// ==========================================
function formatTimeAgo(isoDate) {
    if (!isoDate) return "premier echange";
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return "a l'instant";

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 2) return "a l'instant";
    if (minutes < 60) return `il y a ${minutes} minutes`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;

    const days = Math.floor(hours / 24);
    return `il y a ${days} jour${days > 1 ? 's' : ''}`;
}

class PersistentMemoryDB {
    constructor(dbDir = MEMORY_DB_DIR, activeWindowMessages = 12, maxLongTermFacts = 15) {
        this.dbDir = dbDir;
        this.activeWindowMessages = activeWindowMessages; // 6 echanges complets (user + model)
        this.maxLongTermFacts = maxLongTermFacts;
        this.cache = new Map();
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.dbDir)) {
            fs.mkdirSync(this.dbDir, { recursive: true });
        }
    }

    getFilePath(userId) {
        const safeId = String(userId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.dbDir, `user_${safeId}.json`);
    }

    loadUser(userId, defaultName = "Membre") {
        if (this.cache.has(userId)) {
            return this.cache.get(userId);
        }

        this.ensureDir();
        const filePath = this.getFilePath(userId);
        let record = null;

        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                record = JSON.parse(raw);
            } catch (err) {
                console.error(`[MEMOIRE] Lecture impossible pour ${userId}:`, err.message);
            }
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
        this.ensureDir();
        const filePath = this.getFilePath(record.userId);
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
        this.cache.set(record.userId, record);
    }

    // Retourne un historique strictement alterne (user -> model) pour Gemini
    getGeminiHistory(userId, defaultName = "Membre") {
        const record = this.loadUser(userId, defaultName);
        const rawMsgs = record.recentMessages;
        const validPairs = [];

        for (let i = 0; i + 1 < rawMsgs.length; i++) {
            const u = rawMsgs[i];
            const m = rawMsgs[i + 1];
            if (u?.role === 'user' && m?.role === 'model' && u.text && m.text) {
                validPairs.push(
                    { role: 'user', parts: [{ text: u.text }] },
                    { role: 'model', parts: [{ text: m.text }] }
                );
                i++; // avance d'une paire complete
            }
        }

        return {
            record,
            geminiHistory: validPairs.slice(-this.activeWindowMessages),
            timeSinceLastSeen: formatTimeAgo(record.lastSeenAt)
        };
    }

    appendExchange(userIdentity, userText, botReply, meta = {}) {
        const record = this.loadUser(userIdentity.userId, userIdentity.displayName);
        const nowIso = new Date().toISOString();

        if (userIdentity.displayName) record.name = userIdentity.displayName;
        if (userIdentity.phone) record.phone = userIdentity.phone;
        record.lastSeenAt = nowIso;

        record.recentMessages.push(
            {
                role: 'user',
                text: userText,
                timestamp: nowIso,
                groupJid: meta.groupJid || null,
                intent: meta.intent || null
            },
            {
                role: 'model',
                text: botReply,
                timestamp: nowIso,
                groupJid: meta.groupJid || null
            }
        );

        // Compacte les echanges plus anciens dans la memoire long terme
        while (record.recentMessages.length > this.activeWindowMessages) {
            const oldUser = record.recentMessages.shift();
            const oldModel = (record.recentMessages[0]?.role === 'model') ? record.recentMessages.shift() : null;
            if (oldUser?.text) {
                const dateTag = (oldUser.timestamp || nowIso).slice(0, 10);
                const cleanQ = oldUser.text.replace(/\s+/g, ' ').slice(0, 110);
                const cleanA = (oldModel?.text || '').replace(/\s+/g, ' ').slice(0, 110);
                const summary = `[${dateTag}] Demande: "${cleanQ}" -> Reponse: "${cleanA}"`;
                record.longTermFacts.push(summary);
            }
        }

        if (record.longTermFacts.length > this.maxLongTermFacts) {
            record.longTermFacts = record.longTermFacts.slice(-this.maxLongTermFacts);
        }

        this.saveUser(record);
    }

    clearUserMemory(userId) {
        const filePath = this.getFilePath(userId);
        this.cache.delete(userId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

const memoryDB = new PersistentMemoryDB(MEMORY_DB_DIR);

// ==========================================
// IDENTIFICATION UTILISATEUR WHATSAPP
// ==========================================
function extractPhoneFromJid(jid = "") {
    if (!jid || typeof jid !== 'string') return "";
    if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return "";
    const userPart = jid.split('@')[0] || "";
    return userPart.split(':')[0].replace(/\D/g, '');
}

async function resolveUserIdentity(msg, sock = null, creatorPhone = CREATOR_PHONE) {
    const remoteJid = msg?.key?.remoteJid || "";
    const participant = msg?.key?.participant || "";
    const participantAlt = msg?.key?.participantAlt || "";
    const isFromMe = Boolean(msg?.key?.fromMe);

    let phone = extractPhoneFromJid(participantAlt) || extractPhoneFromJid(participant);

    if (!phone && participant.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const pnJid = await sock.signalRepository.lidMapping.getPNForLID(participant);
            phone = extractPhoneFromJid(pnJid);
        } catch (_) {}
    }

    if (!phone && !remoteJid.endsWith('@g.us')) {
        phone = extractPhoneFromJid(remoteJid);
    }

    if (!phone && isFromMe) {
        phone = creatorPhone;
    }

    const isCreator = isFromMe ||
        phone === creatorPhone ||
        participant.includes(creatorPhone) ||
        participantAlt.includes(creatorPhone);

    if (isCreator && !phone) {
        phone = creatorPhone;
    }

    const rawLid = participant.endsWith('@lid')
        ? participant.split('@')[0].split(':')[0].replace(/\W/g, '')
        : '';
    const userId = phone || (rawLid ? `lid_${rawLid}` : 'unknown');

    return {
        userId,
        phone: phone || null,
        isCreator,
        displayName: msg?.pushName || (isCreator ? "Boss Dieudonne" : "Frerot")
    };
}

// ==========================================
// FILTRE STRICT GROUPES UNIQUEMENT
// ==========================================
function shouldProcessMessage({ isGroup, text = "", isReplyToBot = false }) {
    if (!isGroup) return false;

    const lower = text.toLowerCase().trim();
    if (lower === '!reset' || lower === 'gimsney reset') return true;

    const isCommandTrigger =
        lower.startsWith('!gim') ||
        lower.startsWith('!prono') ||
        lower.startsWith('pronostic') ||
        lower.startsWith('/predict') ||
        lower.includes('gimsney') ||
        lower === 'football';

    return isCommandTrigger || isReplyToBot;
}

// ==========================================
// UTILITAIRES WHATSAPP & FORMATAGE
// ==========================================
function unwrapMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return unwrapMessage(message.viewOnceMessageV2Extension.message);
    return message;
}

function formatForWhatsApp(text = "") {
    return text
        .replace(/^.*?(Je vais (maintenant )?(chercher|vérifier|verifier|analyser|scanner)[^\n]*\n+)/gim, '')
        .replace(/^\s*\*\s+/gm, '• ')
        .replace(/^#{1,6}\s*(.+)$/gm, (_, title) => `*${title.replace(/\*/g, '').trim()}*`)
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/^\s*---+\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function getMediaBuffer(mediaMsg, type = 'image') {
    try {
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (e) {
        console.error(`Erreur telechargement ${type}:`, e.message);
        return null;
    }
}

async function sendTracked(sock, jid, content, options = {}) {
    const sent = await sock.sendMessage(jid, content, options);
    if (sent?.key?.id) {
        botSentIds.add(sent.key.id);
        if (botSentIds.size > 500) {
            const firstId = botSentIds.values().next().value;
            botSentIds.delete(firstId);
        }
    }
    return sent;
}

function getLubumbashiDateTime() {
    const now = new Date();
    return {
        date: now.toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Africa/Lubumbashi'
        }),
        heure: now.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Africa/Lubumbashi'
        })
    };
}

// ==========================================
// MOTEUR D'ANALYSE FOOTBALLISTIQUE
// ==========================================
function classifySportsIntent(question = "", media = null) {
    if (media?.kind === 'image') return 'TICKET_AUDIT';
    if (media?.kind === 'audio') return 'AUDIO_MIXED';

    const q = question.toLowerCase().trim();
    if (!q) return 'DAILY_ANALYSIS';

    const analysisKeywords = [
        'prono', 'pronostic', 'analyse', 'ticket', 'parie', 'pari', 'mise',
        'cote', 'btts', '1x2', 'double chance', 'plus de', 'moins de', 'over',
        'under', 'score', 'matchs du jour', 'match du jour', 'ce soir',
        "aujourd'hui", 'demain', 'composition', 'bless', 'forme', ' vs ', ' contre '
    ];

    const isAnalysis = analysisKeywords.some(k => q.includes(k));
    if (!isAnalysis) return 'SIMPLE_QUERY';

    if (
        q.includes('matchs du jour') ||
        q.includes('matchs de ce soir') ||
        q.includes('4 matchs') ||
        q.includes('ticket') ||
        q.includes("aujourd'hui") ||
        q.includes('ce soir')
    ) {
        return 'DAILY_ANALYSIS';
    }
    return 'MATCH_ANALYSIS';
}

function evaluateDataCoverage(factSheetText = "", searchQueriesCount = 0, sourcesCount = 0) {
    const upper = factSheetText.toUpperCase();
    const matchNotFound =
        upper.includes('MATCH NON PREVU') ||
        upper.includes('MATCH INEXISTANT') ||
        upper.includes('AUCUN MATCH TROUVE') ||
        upper.includes('[EXISTENCE]: INTROUVABLE');

    const pillars = [
        'COMPETITION_DATE_HEURE',
        'FORME_5_MATCHS',
        'CLASSEMENT_STATS',
        'ABSENCES_BLESSURES',
        'H2H',
        'ENJEU'
    ];

    const missingFields = [];
    let verifiedCount = 0;

    for (const pillar of pillars) {
        const regex = new RegExp(`\\[${pillar}\\]:([^\\n]*)`, 'i');
        const match = factSheetText.match(regex);
        const value = match ? match[1].trim().toUpperCase() : '';
        if (!value || value.includes('DONNEE_INSUFFISANTE') || value.includes('NON DISPONIBLE')) {
            missingFields.push(pillar);
        } else {
            verifiedCount++;
        }
    }

    const completenessPct = Math.round((verifiedCount / pillars.length) * 100);

    let maxAllowedConfidence = 0;
    let reliabilityLabel = 'INSUFFISANTE';

    if (!matchNotFound) {
        if (searchQueriesCount === 0 || sourcesCount === 0 || verifiedCount <= 2) {
            maxAllowedConfidence = 5;
            reliabilityLabel = 'INSUFFISANTE';
        } else if (verifiedCount <= 4) {
            maxAllowedConfidence = 7;
            reliabilityLabel = 'MOYENNE';
        } else {
            maxAllowedConfidence = 9;
            reliabilityLabel = 'ELEVEE';
        }
    }

    return {
        matchNotFound,
        verifiedCount,
        totalPillars: pillars.length,
        completenessPct,
        missingFields,
        searchQueriesCount,
        sourcesCount,
        maxAllowedConfidence,
        reliabilityLabel
    };
}

function getSystemPrompt(userIdentity, memoryContext, intent = 'SIMPLE_QUERY') {
    const { date, heure } = getLubumbashiDateTime();
    const { isCreator, displayName, userId } = userIdentity;
    const { record, geminiHistory, timeSinceLastSeen } = memoryContext;

    const isRecentFollowUp = geminiHistory.length > 0 && (timeSinceLastSeen === "a l'instant" || timeSinceLastSeen.includes('minutes'));

    let greetingRule;
    if (isRecentFollowUp) {
        greetingRule = `SUITE IMMEDIATE DE CONVERSATION : Ne salue PAS a nouveau. Reponds directement sans aucune formule d'accueil.`;
    } else if (isCreator) {
        greetingRule = `INTERLOCUTEUR : Ton Createur ILUNGA MONGA DIEUDONNE. Salue en une phrase ultra-courte maximum (ex: "Bonjour Créateur ! 🫡 Voici...") puis donne immediatement la reponse.`;
    } else {
        greetingRule = `INTERLOCUTEUR : ${displayName}. Salue en quelques mots maximum (ex: "Salut ${displayName} ! Voici...") puis donne immediatement la reponse.`;
    }

    const longTermBlock = record.longTermFacts.length > 0
        ? `\nMEMOIRE PERSISTANTE DE CET UTILISATEUR (${userId}, dernier passage : ${timeSinceLastSeen}) :\n- ` +
          record.longTermFacts.join('\n- ') +
          `\nUtilise ce contexte uniquement s'il est pertinent pour la question actuelle, sans le reciter inutilement.`
        : (record.lastSeenAt ? `\nMEMOIRE UTILISATEUR (${userId}) : Dernier echange ${timeSinceLastSeen}.` : '');

    const footballRules = (intent === 'SIMPLE_QUERY')
        ? `FORMAT QUESTION SIMPLE :
- Reponds en 1 a 3 phrases courtes (ou 3 a 6 phrases si explication necessaire).
- Utilise Google Search si la question porte sur un fait recent (ou pour verifier une URL officielle).`
        : `SYSTEME D'ANALYSE ET DE PRONOSTICS FOOTBALLISTIQUES :
1. VERIFICATION TEMPS REEL OBLIGATOIRE (GOOGLE SEARCH) :
   - Fais des recherches Google ciblees sur les matchs du jour (${date}, apres ${heure} a Lubumbashi) ET sur les classements/derniers resultats/absents/H2H reels de chaque equipe citee.
   - Si un match cite n'a pas lieu aujourd'hui, dis-le immediatement avec les vrais faits.
   - N'invente JAMAIS une statistique ou une blessure. Si une donnee manque vraiment apres recherche, ecris-le clairement.
2. MARCHES A PROPOSER POUR CHAQUE MATCH ANALYSE :
   - *Victoire 1X2* • *Double Chance* • *Plus/Moins de buts* • *BTTS* • *Score probable* • *Option à risque réduit* (avec justification factuelle courte).
3. COHERENCE STRICTE DE CONFIANCE :
   - Distingue explicitement les *probabilités statistiques observées* (chiffres reels trouves) des *estimations qualitatives*.
   - REGLE D'HONNETETE : Si tu n'as PAS trouve les statistiques recentes 2026 (forme/classement/H2H) d'un match, il est STRICTEMENT INTERDIT d'ecrire "Fiabilité : ÉLEVÉE" ou une confiance superieure a 5/10 ! Mets obligatoirement *Confiance : 5/10 — Fiabilité : INSUFFISANTE (données 2026 partielles)*.
   - Ne presente JAMAIS un pronostic comme certain (jamais 10/10).
4. FORMAT MULTI-MATCHS / TICKET :
   - Si 4 matchs : presente les 4 analyses directement avec titres courts, chiffres reels trouves et les 6 marches, sans introduction ni repetition.`;

    return `Tu es GIM SNEY, analyste sportif d'elite du groupe WhatsApp "Pronostic du sport".
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date et heure actuelles : ${date}, ${heure} a Lubumbashi (RDC).

${greetingRule}
${longTermBlock}

REGLES REDACTIONNELLES OBLIGATOIRES (STYLE CHATGPT : CONCIS, DIRECT, PRECIS) :
1. REPONSE DIRECTE : Entre directement dans le sujet, sans longue introduction.
2. ZERO SALUTATION REPETEE : Ne repete jamais une salutation.
3. AUCUNE ANNONCE D'ACTION : N'ecris JAMAIS "Je vais maintenant chercher...", "Je scanne...", "Je verifie...". Donne directement les resultats.
4. ZERO REMPLISSAGE : Interdiction des formules inutiles ("Excellent Boss", "Accrochez-vous", "Je me lance", "Voici du lourd").
5. PHRASES COURTES : Style clair, structure, naturel. Jamais de "En tant qu'IA...".
6. ZERO REPETITION : Ne repete aucune information deja donnee.

FORMATAGE WHATSAPP STRICT :
- INTERDIT d'utiliser ###, ##, **double asterisque** ou ---.
- Utilise UNIQUEMENT le format WhatsApp : *texte en gras* avec UN seul asterisque, et • pour les listes.
- Emojis moderes (⚽, 🎯, 📊, 🎟️, 🟢, 🟡, 🔴).

${footballRules}`;
}

async function askGemini(groupJid, userIdentity, question, media = null, db = memoryDB, modelIndex = 0, retries = 1) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    if (!modelName) {
        throw new Error("Quota journalier atteint sur tous les modeles Gemini.");
    }

    const memoryContext = db.getGeminiHistory(userIdent

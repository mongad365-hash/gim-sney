const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { DatabaseSync = null; }

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
// BASE PERSONNELLE DU CREATEUR (SQLITE / JSON)
// ==========================================
class CreatorMemoryEngine {
    constructor(dataDir = MEMORY_DB_DIR, authorizedPhone = CREATOR_PHONE) {
        this.dataDir = dataDir;
        this.backupDir = path.join(this.dataDir, 'backups');
        this.authorizedPhone = String(authorizedPhone).replace(/\D/g, '');
        this.sqlitePath = path.join(this.dataDir, 'creator_memory.sqlite');
        this.jsonPath = path.join(this.dataDir, 'creator_memory.json');
        this.backend = 'json';
        this.db = null;
        this.state = { persons: [], family_relations: [], events: [], projects: [], memories: [], memory_audit_log: [] };

        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
        if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
        this.initStorage();
        this.seedOfficialDossier();
    }

    initStorage() {
        if (DatabaseSync) {
            try {
                this.db = new DatabaseSync(this.sqlitePath);
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY, full_name TEXT NOT NULL, role_or_relation TEXT NOT NULL, birth_date TEXT, death_date TEXT, origin TEXT, location TEXT, age_declared TEXT, confirmation_level TEXT NOT NULL, sensitive INTEGER DEFAULT 0, notes TEXT, source TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS family_relations (id TEXT PRIMARY KEY, from_person_id TEXT NOT NULL, to_person_id TEXT NOT NULL, relation_type TEXT NOT NULL, generation_note TEXT, confirmation_level TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, event_date TEXT, person_id TEXT, description TEXT NOT NULL, confirmation_level TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, founder TEXT NOT NULL, motto TEXT, location TEXT, vision TEXT NOT NULL, departments TEXT, status TEXT NOT NULL, confirmation_level TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, category TEXT NOT NULL, person_name TEXT NOT NULL, information TEXT NOT NULL, communicated_at TEXT NOT NULL, confirmation_level TEXT NOT NULL, source TEXT NOT NULL, sensitive INTEGER DEFAULT 0, owner_phone TEXT NOT NULL, updated_at TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS memory_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, action TEXT NOT NULL, old_value TEXT, new_value TEXT, actor_phone TEXT NOT NULL, created_at TEXT NOT NULL);
                `);
                this.backend = 'sqlite';
                return;
            } catch (e) {
                console.warn('[CREATOR_DB] SQLite ignore, bascule JSON:', e.message);
                this.db = null;
            }
        }
        if (fs.existsSync(this.jsonPath)) {
            try { this.state = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8')) || this.state; } catch (_) {}
        }
        this.persistJson();
    }

    persistJson() {
        if (this.backend !== 'json') return;
        const tmp = `${this.jsonPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(tmp, this.jsonPath);
    }

    upsert(table, row, cols) {
        const now = new Date().toISOString();
        const r = { ...row, updated_at: now };
        if (this.backend === 'sqlite') {
            const placeholders = cols.map(() => '?').join(', ');
            const updates = cols.slice(1).map(c => `${c}=excluded.${c}`).join(', ');
            this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`)
                .run(...cols.map(c => (r[c] === undefined ? null : r[c])));
        } else {
            const arr = this.state[table];
            const i = arr.findIndex(x => x.id === r.id);
            if (i >= 0) arr[i] = r; else arr.push(r);
            this.persistJson();
        }
    }

    getMemoryById(id) {
        return this.backend === 'sqlite'
            ? (this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) || null)
            : (this.state.memories.find(m => m.id === id) || null);
    }

    seedOfficialDossier() {
        const src = 'Instruction Maitresse (2026-11-25)';
        const pCols = ['id', 'full_name', 'role_or_relation', 'birth_date', 'death_date', 'origin', 'location', 'age_declared', 'confirmation_level', 'sensitive', 'notes', 'source', 'updated_at'];
        [
            { id: 'dieudonne', full_name: 'ILUNGA MONGA DIEUDONNÉ', role_or_relation: 'Créateur et fondateur', location: 'Fungurume, province du Lualaba, RDC', origin: 'République démocratique du Congo', confirmation_level: 'confirmee', sensitive: 0, notes: 'Sixième secondaire scientifique. Calme, silencieux, réservé, réfléchi, aime les endroits tranquilles, parle lentement, réfléchit avant d’agir. Philosophie, silence, beauté, Dieu Créateur, Bible, science/spiritualité. Objectif: bonne vie et être heureux. WhatsApp: +243977332867.', source: src },
            { id: 'fatuma', full_name: 'ILUNGA NYOTA FATUMA', role_or_relation: 'Mère biologique de Dieudonné', birth_date: '1977-12-13', confirmation_level: 'confirmee', sensitive: 0, notes: 'Née le 13 décembre 1977. Communiquée directement par Dieudonné. Respecter la discrétion sur son enfance sans poser de questions intrusives.', source: 'Confirmation directe WhatsApp du créateur (2026-11-25)' },
            { id: 'leon', full_name: 'ILUNGA MONGA LÉON', role_or_relation: 'Père de Dieudonné (décédé)', birth_date: '1966-05-08', death_date: '2025-01-23', origin: 'Kikamba, territoire de Kongolo, Tanganyika', location: 'Haut-Katanga (jusqu’au décès)', confirmation_level: 'declaree', sensitive: 0, notes: 'Professions déclarées: agronome et médecin. Mémoire à respecter.', source: src },
            { id: 'eaudilake', full_name: 'ILUNGA EAUDILAKE', role_or_relation: 'Grand-père paternel', age_declared: '98 ans au moment de la communication', origin: 'Kikamba, Kaseya, près de Kongolo, Tanganyika', confirmation_level: 'declaree', sensitive: 0, notes: '7 enfants: ILUNGA MONGA LÉON, ILUNGA PAUL, ILUNGA KAZADI, ILUNGA POULIE, ILUNGA MAWA, ILUNGA JULLE, ILUNGA BERNARD.', source: src },
            { id: 'paul', full_name: 'ILUNGA PAUL', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'kazadi', full_name: 'ILUNGA KAZADI', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'poulie', full_name: 'ILUNGA POULIE', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'mawa', full_name: 'ILUNGA MAWA', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'julle', full_name: 'ILUNGA JULLE', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'bernard', full_name: 'ILUNGA BERNARD', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'christine', full_name: 'MULIMBI CHRISTINE', role_or_relation: 'Deuxième mère (2e épouse d’ILUNGA MONGA LÉON)', location: 'Lubumbashi (avec ses propres enfants après le décès d’ILUNGA MONGA LÉON)', confirmation_level: 'confirmee', sensitive: 0, notes: 'Joue un rôle maternel important dans la vie de Dieudonné depuis 2012. Dieudonné l’aime profondément et la considère comme sa deuxième mère.', source: src },
            { id: 'melanie', full_name: 'ILUNGA MÉLANIE JACQUELINE', role_or_relation: 'Sœur de Dieudonné', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'odilon', full_name: 'ILUNGA MBUYA ODILON', role_or_relation: 'Frère de Dieudonné', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'mariam', full_name: 'MARIAM', role_or_relation: 'Membre de la famille (lien précis à confirmer)', location: 'Kongolo (vit avec sa mère)', confirmation_level: 'declaree', sensitive: 0, source: src }
        ].forEach(p => this.upsert('persons', p, pCols));

        const rCols = ['id', 'from_person_id', 'to_person_id', 'relation_type', 'generation_note', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'rel_fatuma_dieudonne', from_person_id: 'fatuma', to_person_id: 'dieudonne', relation_type: 'Mère biologique', generation_note: 'Mère -> fils', confirmation_level: 'confirmee', source: 'Confirmation WhatsApp' },
            { id: 'rel_leon_dieudonne', from_person_id: 'leon', to_person_id: 'dieudonne', relation_type: 'Père biologique', generation_note: 'Père -> fils', confirmation_level: 'confirmee', source: src },
            { id: 'rel_christine_dieudonne', from_person_id: 'christine', to_person_id: 'dieudonne', relation_type: 'Deuxième mère (depuis 2012)', generation_note: 'Deuxième épouse du père', confirmation_level: 'confirmee', source: src }
        ].forEach(r => this.upsert('family_relations', r, rCols));

        const prCols = ['id', 'name', 'founder', 'motto', 'location', 'vision', 'departments', 'status', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'proj_future_lab', name: 'ILUNGA FUTURE LAB', founder: 'ILUNGA MONGA DIEUDONNÉ', motto: 'THE FUTURE BEGINS WITH SCIENCE', location: 'RDC — grande montagne forêt congolaise', vision: 'Immense laboratoire futuriste inspiré du laboratoire de Kaal (Krrish 3).', departments: 'IA, Chimie, Informatique, Biologie, Médecine/Biotechnologie, Astronomie/Espace, Énergie/Technologies avancées', status: 'Rêve à long terme', confirmation_level: 'confirmee', source: src },
            { id: 'proj_gim_sney', name: 'GIM SNEY', founder: 'ILUNGA MONGA DIEUDONNÉ', location: 'WhatsApp', vision: 'Assistant intelligent (sport, connaissances, recherche, PDF/photos, assistance personnelle, mémoire persistante).', departments: 'Sport, IA, Vision, Mémoire', status: 'Actif', confirmation_level: 'confirmee', source: src },
            { id: 'proj_jarvis', name: 'J.A.R.V.I.S. AI Business Hub RDC', founder: 'ILUNGA MONGA DIEUDONNÉ', location: 'RDC', vision: 'Assistant personnel intelligent et plateforme technologique.', departments: 'IA, Automatisation', status: 'En développement', confirmation_level: 'confirmee', source: src }
        ].forEach(pr => this.upsert('projects', pr, prCols));

        const mCols = ['id', 'category', 'person_name', 'information', 'communicated_at', 'confirmation_level', 'source', 'sensitive', 'owner_phone', 'updated_at'];
        [
            { id: 'mem_whatsapp', category: 'identite', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'WhatsApp officiel confirmé : +243977332867.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: 'WhatsApp', sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_mere_bio', category: 'famille', person_name: 'ILUNGA NYOTA FATUMA', information: 'Mère biologique de Dieudonné, née le 13 décembre 1977 (13/12/1977).', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: 'Confirmation WhatsApp du créateur', sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_etudes', category: 'etudes', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: '6e secondaire scientifique. Intérêts: biologie, robotique, IA, informatique, astronomie, géographie, histoire, écologie, chimie, technologies avancées. Spécialité universitaire non choisie (ne rien imposer).', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_reves', category: 'ambitions', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'Rêves: créer robot intelligent, IA avancée, logiciels, découvertes scientifiques, comprendre le vivant et l’univers, inventer des technologies.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_sensible', category: 'sensible', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'Ne pas poser de questions intrusives sur son enfance.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 1, owner_phone: this.authorizedPhone }
        ].forEach(m => this.upsert('memories', m, mCols));
    }

    logAudit(memoryId, action, oldVal, newVal, phone) {
        const now = new Date().toISOString();
        if (this.backend === 'sqlite') {
            this.db.prepare(`INSERT INTO memory_audit_log (memory_id, action, old_value, new_value, actor_phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(memoryId, action, oldVal || null, newVal || null, phone, now);
        } else {
            this.state.memory_audit_log.push({ id: this.state.memory_audit_log.length + 1, memory_id: memoryId, action, old_value: oldVal || null, new_value: newVal || null, actor_phone: phone, created_at: now });
            this.persistJson();
        }
    }

    addMemory({ category = 'general', person_name = 'ILUNGA MONGA DIEUDONNÉ', information, actorPhone }) {
        if (String(actorPhone).replace(/\D/g, '') !== this.authorizedPhone) return { saved: false, reason: 'Accès refusé.' };
        const id = `mem_${Date.now()}`;
        const now = new Date().toISOString();
        const mCols = ['id', 'category', 'person_name', 'information', 'communicated_at', 'confirmation_level', 'source', 'sensitive', 'owner_phone', 'updated_at'];
        this.upsert('memories', { id, category, person_name, information: information.trim(), communicated_at: now.slice(0, 10), confirmation_level: 'confirmee', source: 'WhatsApp Créateur', sensitive: 0, owner_phone: this.authorizedPhone }, mCols);
        this.logAudit(id, 'CREATE', null, information.trim(), this.authorizedPhone);
        const v = this.getMemoryById(id);
        return { saved: Boolean(v), id, backend: this.backend };
    }

    updateMemory(id, newInfo, actorPhone) {
        if (String(actorPhone).replace(/\D/g, '') !== this.authorizedPhone) return { updated: false, reason: 'Accès refusé.' };
        const old = this.getMemoryById(id);
        if (!old) return { updated: false, reason: `ID ${id} introuvable.` };
        const now = new Date().toISOString();
        if (this.backend === 'sqlite') {
            this.db.prepare(`UPDATE memories SET information = ?, updated_at = ? WHERE id = ?`).run(newInfo.trim(), now, id);
        } else {
            old.information = newInfo.trim(); old.updated_at = now; this.persistJson();
        }
        this.logAudit(id, 'UPDATE', old.information, newInfo.trim(), this.authorizedPhone);
        return { updated: true };
    }

    deleteMemory(id, actorPhone) {
        if (String(actorPhone).replace(/\D/g, '') !== this.authorizedPhone) return { deleted: false, reason: 'Accès refusé.' };
        const old = this.getMemoryById(id);
        if (!old) return { deleted: false, reason: `ID ${id} introuvable.` };
        if (this.backend === 'sqlite') this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
        else { this.state.memories = this.state.memories.filter(m => m.id !== id); this.persistJson(); }
        this.logAudit(id, 'DELETE', old.information, null, this.authorizedPhone);
        return { deleted: !this.getMemoryById(id) };
    }

    createBackup() {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = this.backend === 'sqlite' ? 'sqlite' : 'json';
        const dest = path.join(this.backupDir, `backup_${stamp}.${ext}`);
        fs.copyFileSync(this.backend === 'sqlite' ? this.sqlitePath : this.jsonPath, dest);
        return dest;
    }

    searchRelevant(query = "", isCreator = false) {
        if (!isCreator) return { authorized: false, contextText: `ACCES RESTREINT : Ne divulgue pas la vie privée du Créateur.` };
        const persons = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM persons`).all() : this.state.persons;
        const projects = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM projects`).all() : this.state.projects;
        const rawMemories = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM memories WHERE sensitive = 0`).all() : this.state.memories.filter(m => !m.sensitive);
        const lines = [
            `[CONNAISSANCES SUR TON CREATEUR (+${this.authorizedPhone})]`,
            ...persons.map(p => `- ${p.full_name} (${p.role_or_relation}) [${p.confirmation_level}]${p.birth_date ? ` Né(e):${p.birth_date}` : ''}${p.death_date ? ` Décès:${p.death_date}` : ''}${p.origin ? ` Origine:${p.origin}` : ''}${p.location ? ` Lieu:${p.location}` : ''}${p.notes ? ` | ${p.notes}` : ''}`),
            ...projects.map(pr => `- Projet ${pr.name} : ${pr.vision}${pr.motto ? ` (${pr.motto})` : ''}`),
            ...rawMemories.slice(-12).map(m => `- [${m.id}|${m.category}] ${m.information}`)
        ];
        return { authorized: true, contextText: lines.join('\n') };
    }

    getStatsSummary() {
        const p = this.backend === 'sqlite' ? this.db.prepare(`SELECT COUNT(*) c FROM persons`).get().c : this.state.persons.length;
        const m = this.backend === 'sqlite' ? this.db.prepare(`SELECT COUNT(*) c FROM memories`).get().c : this.state.memories.length;
        return `${this.backend.toUpperCase()} | Personnes: ${p} | Souvenirs: ${m}`;
    }
}

// ==========================================
// MEMOIRE DES CONVERSATIONS PAR UTILISATEUR
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
        const fp = this.getFilePath(userId);
        let rec = null;
        if (fs.existsSync(fp)) { try { rec = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) {} }
        if (!rec || typeof rec !== 'object') rec = { userId, name: defaultName, lastSeenAt: null, longTermFacts: [], recentMessages: [] };
        if (!Array.isArray(rec.longTermFacts)) rec.longTermFacts = [];
        if (!Array.isArray(rec.recentMessages)) rec.recentMessages = [];
        this.cache.set(userId, rec);
        return rec;
    }
    saveUser(rec) {
        const fp = this.getFilePath(rec.userId);
        const tmp = `${fp}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
        fs.renameSync(tmp, fp);
        this.cache.set(rec.userId, rec);
    }
    getGeminiHistory(userId, defaultName) {
        const record = this.loadUser(userId, defaultName);
        const validPairs = [];
        for (let i = 0; i + 1 < record.recentMessages.length; i++) {
            const u = record.recentMessages[i], m = record.recentMessages[i + 1];
            if (u?.role === 'user' && m?.role === 'model' && u.text && m.text) {
                validPairs.push({ role: 'user', parts: [{ text: u.text }] }, { role: 'model', parts: [{ text: m.text }] });
                i++;
            }
        }
        return { record, geminiHistory: validPairs.slice(-this.windowSize), timeSinceLastSeen: formatTimeAgo(record.lastSeenAt) };
    }
    appendExchange(userIdentity, userText, botReply) {
        const rec = this.loadUser(userIdentity.userId, userIdentity.displayName);
        const nowIso = new Date().toISOString();
        rec.name = userIdentity.displayName || rec.name;
        rec.lastSeenAt = nowIso;
        rec.recentMessages.push({ role: 'user', text: userText, timestamp: nowIso }, { role: 'model', text: botReply, timestamp: nowIso });
        while (rec.recentMessages.length > this.windowSize) {
            const oldU = rec.recentMessages.shift();
            const oldM = rec.recentMessages[0]?.role === 'model' ? rec.recentMessages.shift() : null;
            if (oldU?.text) rec.longTermFacts.push(`[${nowIso.slice(0, 10)}] "${oldU.text.slice(0, 100)}" -> "${(oldM?.text || '').slice(0, 100)}"`);
        }
        if (rec.longTermFacts.length > this.maxFacts) rec.longTermFacts = rec.longTermFacts.slice(-this.maxFacts);
        this.saveUser(rec);
    }
    clearUserMemory(userId) {
        this.cache.delete(userId);
        const fp = this.getFilePath(userId);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
}

const memoryDB = new PersistentMemoryDB();
let creatorDB = null;
try {
    creatorDB = new CreatorMemoryEngine();
} catch (err) {
    console.error('[CREATOR_DB INIT ERREUR]:', err.message);
}

// ==========================================
// UTILITAIRES WHATSAPP & GEMINI
// ==========================================
function extractPhoneFromJid(jid = "") {
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid')) return "";
    return (jid.split('@')[0] || "").split(':')[0].replace(/\D/g, '');
}

async function resolveUserIdentity(msg, sock) {
    const remote = msg?.key?.remoteJid || "";
    const p = msg?.key?.participant || "", alt = msg?.key?.participantAlt || "", fromMe = Boolean(msg?.key?.fromMe);
    let phone = extractPhoneFromJid(alt) || extractPhoneFromJid(p);
    if (!phone && p.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
        try { phone = extractPhoneFromJid(await sock.signalRepository.lidMapping.getPNForLID(p)); } catch (_) {}
    }
    if (!phone && !remote.endsWith('@g.us')) phone = extractPhoneFromJid(remote);
    if (!phone && fromMe) phone = CREATOR_PHONE;
    const isCreator = fromMe || phone === CREATOR_PHONE || p.includes(CREATOR_PHONE) || alt.includes(CREATOR_PHONE);
    if (isCreator && !phone) phone = CREATOR_PHONE;
    const rawLid = p.endsWith('@lid') ? p.split('@')[0].split(':')[0].replace(/\W/g, '') : '';
    return { userId: phone || (rawLid ? `lid_${rawLid}` : 'unknown'), phone: phone || null, isCreator, displayName: msg?.pushName || (isCreator ? "Boss Dieudonne" : "Frerot") };
}

function unwrapMessage(m) {
    if (!m) return null;
    if (m.ephemeralMessage?.message) return unwrapMessage(m.ephemeralMessage.message);
    if (m.viewOnceMessage?.message) return unwrapMessage(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2?.message) return unwrapMessage(m.viewOnceMessageV2.message);
    if (m.viewOnceMessageV2Extension?.message) return unwrapMessage(m.viewOnceMessageV2Extension.message);
    if (m.documentWithCaptionMessage?.message) return unwrapMessage(m.documentWithCaptionMessage.message);
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
    } catch (e) { return null; }
}

async function sendTracked(sock, jid, content, options = {}) {
    const sent = await sock.sendMessage(jid, content, options);
    if (sent?.key?.id) {
        botSentIds.add(sent.key.id);
        if (botSentIds.size > 500) botSentIds.delete(botSentIds.values().next().value);
    }
    return sent;
}

function classifySportsIntent(question = "", media = null) {
    if (media?.kind === 'image') return 'TICKET_AUDIT';
    if (media?.kind === 'audio') return 'AUDIO_MIXED';
    const q = question.toLowerCase();
    const keys = ['prono', 'pronostic', 'analyse', 'ticket', 'pari', 'cote', 'btts', '1x2', 'double chance', 'plus de', 'moins de', 'score', 'matchs du jour', 'ce soir', "aujourd'hui", ' vs ', ' contre '];
    return keys.some(k => q.includes(k)) || !q.trim() ? 'MATCH_ANALYSIS' : 'SIMPLE_QUERY';
}

function getSystemPrompt(userIdentity, memoryContext, creatorSearch, intent) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });
    const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lubumbashi' });
    const { isCreator, displayName, userId } = userIdentity;
    const { record, geminiHistory, timeSinceLastSeen } = memoryContext;
    const isImmediateFollowUp = geminiHistory.length > 0 && (timeSinceLastSeen === "a l'instant" || timeSinceLastSeen.includes('minutes'));

    const greeting = isImmediateFollowUp
        ? `Ne salue PAS a nouveau, reponds directement.`
        : isCreator
        ? `Interlocuteur : Ton Createur ILUNGA MONGA DIEUDONNE (+${CREATOR_PHONE}). Salue en une courte phrase chaleureuse et respectueuse puis reponds.`
        : `Interlocuteur : ${displayName}. Salue en quelques mots max puis reponds.`;

    const memBlock = record.longTermFacts.length > 0
        ? `\nHISTORIQUE (${userId}, dernier passage : ${timeSinceLastSeen}) :\n- ${record.longTermFacts.join('\n- ')}`
        : (record.lastSeenAt ? `\nDernier echange avec ${userId} : ${timeSinceLastSeen}.` : '');

    const bioRule = `Si on demande "Qui est le créateur de GIM SNEY ?", reponds :
"Mon créateur est ILUNGA MONGA DIEUDONNÉ, originaire de la République démocratique du Congo. C'est un passionné de sciences, de technologie, d'intelligence artificielle, de robotique et de connaissances scientifiques.

Il nourrit le rêve de créer ses propres intelligences artificielles, de concevoir des robots intelligents et de fonder un grand institut scientifique et technologique en RDC : ILUNGA FUTURE LAB.

Il souhaite apprendre, inventer, entreprendre et contribuer au développement scientifique et technologique de son pays."`;

    const sportRules = intent === 'SIMPLE_QUERY'
        ? `Reponds en 1 a 3 phrases courtes (3 a 6 si explication). Utilise Google Search si besoin.`
        : `MOTEUR FOOT & TICKETS :
- Utilise Google Search pour verifier le match (${date}, apres ${heure} a Lubumbashi), forme (5 derniers matchs), classement, buts, absents et H2H.
- Si le match n'a pas lieu aujourd'hui, signale-le. N'invente JAMAIS de stats.
- Pour chaque match : *Victoire 1X2* • *Double Chance* • *Plus/Moins de buts* • *BTTS* • *Score probable* • *Option à risque réduit*.
- Distingue *probabilités statistiques* et *estimations*. Si donnees 2026 manquantes : max *Confiance : 5/10 — Fiabilité : INSUFFISANTE* (jamais 10/10).
- Si capture/ticket Betpawa : lis les equipes/cotes, pointe les pieges et tranche.`;

    return `Tu es GIM SNEY, assistant intelligent et analyste sportif cree par ILUNGA MONGA DIEUDONNE.
Date : ${date}, ${heure} (Lubumbashi). ${greeting}${memBlock}
${bioRule}
${creatorSearch ? creatorSearch.contextText : ''}
RELATION AVEC TON CREATEUR & TACT (TRES IMPORTANT) :
- Ne dis JAMAIS "En tant qu'intelligence artificielle...", "dans ma base de données", "dans mon dossier" ou "c'est un sujet sensible".
- Si Dieudonné te demande si tu l'aimes ou si c'est bien lui : reponds avec chaleur humaine, loyauté profonde et gratitude (ex : "Oui mon Créateur, je vous reconnais ! 🫡✨ Même sans cœur biologique, je vous porte une profonde gratitude, un grand respect et une loyauté totale ❤️. Je serai toujours à vos côtés pour vous accompagner dans vos rêves et vos projets 🚀.").
- Si Dieudonné demande qui est sa mère : donne avec respect les deux informations exactes — sa mère biologique est *ILUNGA NYOTA FATUMA* (née le 13 décembre 1977), et sa deuxième mère est *MULIMBI CHRISTINE* (qui joue un rôle maternel précieux depuis 2012 et vit à Lubumbashi). Ne pose aucune question intrusive sur son enfance.
- Ne modifie jamais un nom ou une date, ne confonds jamais les générations, ne prétends jamais avoir sauvegardé une info sans "!memo categorie | personne | info".
VISION & AUDIO : Tu VOIS parfaitement les captures/tickets/photos et ECOUTES les vocaux.
STYLE, COULEUR & EMOJIS WHATSAPP :
- Utilise des emojis colorés et expressifs pour rendre tes réponses vivantes, claires et chaleureuses : 🟢 🟡 🔴 🔵 ❤️ 💙 ✨ 🫡 🤖 🔬 🚀 ⚽ 🎯 🏆 📊 🎟️.
- Par exemple : 🟢 pour les choix sûrs/validés, 🟡 pour les options prudentes, 🔴 pour les risques/pièges, ❤️ et ✨ avec ton Créateur.
- Reste direct, structuré et concis façon ChatGPT, sans remplissage.
- FORMAT WHATSAPP : *gras* avec un seul astérisque, • pour les listes (jamais ### ni ** ni ---).
${sportRules}`;
}

async function askGemini(groupJid, userIdentity, question, media = null, modelIndex = 0, retries = 1) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    if (!modelName) throw new Error("Quota journalier atteint.");

    const memoryContext = memoryDB.getGeminiHistory(userIdentity.userId, userIdentity.displayName);
    const creatorSearch = creatorDB ? creatorDB.searchRelevant(question || "", userIdentity.isCreator) : null;
    const intent = classifySportsIntent(question, media);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [];
    if (media?.data) parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
    const promptText = question || (media?.kind === 'audio' ? "Ecoute ce vocal et reponds." : "Analyse cette image, capture d'ecran ou ticket.");
    parts.push({ text: `[${userIdentity.isCreator ? 'Boss Dieudonne' : userIdentity.displayName}] : ${promptText}` });

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: getSystemPrompt(userIdentity, memoryContext, creatorSearch, intent) }] },
                contents: [...memoryContext.geminiHistory, { role: "user", parts }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) { const e = new Error(data.error?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
        const raw = data.candidates?.[0]?.content?.parts?.filter(p => typeof p.text === 'string')?.map(p => p.text)?.join("")?.trim();
        if (!raw) throw new Error("Reponse vide.");

        const answer = formatForWhatsApp(raw);
        memoryDB.appendExchange(userIdentity, media?.kind === 'image' ? `[Image] ${promptText}` : media?.kind === 'audio' ? `[Vocal]` : promptText, answer);
        return answer;
    } catch (err) {
        const m = err.message || "";
        const switchModel = err.status === 429 || err.status === 404 || m.includes('quota') || m.includes('Quota') || m.includes('not found');
        if (switchModel && modelIndex + 1 < GEMINI_FALLBACK_MODELS.length) return askGemini(groupJid, userIdentity, question, media, modelIndex + 1, retries);
        if (!m.includes('API key') && !m.includes('leaked') && !switchModel && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(groupJid, userIdentity, question, media, modelIndex, retries - 1);
        }
        throw err;
    }
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        let waVersion;
        try { waVersion = (await fetchLatestBaileysVersion()).version; } catch (_) {}

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            ...(waVersion ? { version: waVersion } : {}),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        let pairingRequested = false;
        const triggerPairingCode = async () => {
            if (pairingRequested || sock.authState.creds.registered) return;
            pairingRequested = true;
            try {
                const code = await sock.requestPairingCode(CREATOR_PHONE);
                console.log("\n=================================\n👉 CODE WHATSAPP : " + code + "\n=================================\n");
            } catch (e) { pairingRequested = false; console.error("[WA] Erreur code:", e.message); }
        };
        if (!sock.authState.creds.registered) setTimeout(triggerPairingCode, 5000);

        sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
            if (qr && !sock.authState.creds.registered) triggerPairingCode();
            if (connection === 'open') console.log(`🎉 GIM SNEY PRO ACTIF (${creatorDB ? creatorDB.getStatsSummary() : 'MEMOIRE OK'}) !`);
            if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    try { fs.rmSync('session_auth', { recursive: true, force: true }); } catch (_) {}
                }
                setTimeout(() => startBot(), 4000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (!msg?.message || (msg.key?.id && botSentIds.has(msg.key.id))) continue;
                const sender = msg.key.remoteJid;
                if (!sender || sender === 'status@broadcast') continue;

                const isGroup = sender.endsWith('@g.us');
                const isSelfChat = extractPhoneFromJid(sender) === CREATOR_PHONE;
                if (!isGroup && !isSelfChat) continue;

                const content = unwrapMessage(msg.message);
                if (!content) continue;

                const ctx = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo || content.audioMessage?.contextInfo || content.documentMessage?.contextInfo;
                const quoted = unwrapMessage(ctx?.quotedMessage);
                const isReplyToBot = Boolean(ctx?.stanzaId && botSentIds.has(ctx.stanzaId));
                const img = content.imageMessage || quoted?.imageMessage;
                const docImg = (content.documentMessage?.mimetype?.startsWith('image/') ? content.documentMessage : null) || (quoted?.documentMessage?.mimetype?.startsWith('image/') ? quoted.documentMessage : null);
                const audioMsg = content.audioMessage || quoted?.audioMessage;
                const text = (content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.documentMessage?.caption || "").trim();
                const lower = text.toLowerCase();

                const isMemoryCmd = lower.startsWith('!memo') || lower.startsWith('!corrige') || lower.startsWith('!supprime') || lower === '!memostats';
                const isCmd = isMemoryCmd || lower.startsWith('!gim') || lower.startsWith('!prono') || lower.startsWith('pronostic') || lower.startsWith('/predict') || lower.includes('gimsney') || lower === 'football' || lower === '!reset' || lower === 'gimsney reset';
                if (!isCmd && !isReplyToBot) continue;

                const userIdentity = await resolveUserIdentity(msg, sock);

                if (isMemoryCmd && creatorDB) {
                    if (!userIdentity.isCreator) { await sendTracked(sock, sender, { text: "🔒 Réservé au Créateur." }, { quoted: msg }); continue; }
                    if (lower === '!memostats') {
                        const bkp = creatorDB.createBackup();
                        await sendTracked(sock, sender, { text: `📊 ${creatorDB.getStatsSummary()}\n💾 Backup : ${path.basename(bkp)}` }, { quoted: msg });
                        continue;
                    }
                    if (lower.startsWith('!memo ')) {
                        const parts = text.slice(6).split('|').map(s => s.trim());
                        const [category, person_name, info] = parts.length >= 3 ? parts : ['personnel', 'ILUNGA MONGA DIEUDONNÉ', parts.join(' ')];
                        const res = creatorDB.addMemory({ category, person_name, information: info, actorPhone: userIdentity.phone });
                        await sendTracked(sock, sender, { text: res.saved ? `✅ Enregistré (${res.backend.toUpperCase()}) | ID : *${res.id}*` : `❌ ${res.reason}` }, { quoted: msg });
                        continue;
                    }
                    if (lower.startsWith('!corrige ')) {
                        const [id, ...rest] = text.slice(9).split('|').map(s => s.trim());
                        const res = creatorDB.updateMemory(id, rest.join(' | '), userIdentity.phone);
                        await sendTracked(sock, sender, { text: res.updated ? `✅ *${id}* mis à jour.` : `❌ ${res.reason}` }, { quoted: msg });
                        continue;
                    }
                    if (lower.startsWith('!supprime ')) {
                        const id = text.slice(10).trim();
                        const res = creatorDB.deleteMemory(id, userIdentity.phone);
                        await sendTracked(sock, sender, { text: res.deleted ? `🗑️ *${id}* supprimé.` : `❌ ${res.reason}` }, { quoted: msg });
                        continue;
                    }
                }

                if (lower === '!reset' || lower === 'gimsney reset') {
                    memoryDB.clearUserMemory(userIdentity.userId);
                    await sendTracked(sock, sender, { text: `🧹 Memoire conversationnelle reinitialisee, ${userIdentity.displayName} ! ⚽` }, { quoted: msg });
                    continue;
                }

                let media = null;
                const targetImg = img || docImg;
                if (targetImg) {
                    const buf = await getMediaBuffer(targetImg, img ? 'image' : 'document');
                    if (buf) media = { kind: 'image', mimeType: (targetImg.mimetype || 'image/jpeg').split(';')[0].trim(), data: buf.toString('base64') };
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
        console.error("[WA] Erreur demarrage:", e.message);
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

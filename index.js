const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { DatabaseSync = null; }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const SERPER_API_KEY = process.env.SERPER_API_KEY || ""; // Optionnel : Google Images sur serper.dev
const GEMINI_FALLBACK_MODELS = [...new Set([process.env.GEMINI_MODEL || "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"])];
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
            } catch (e) { this.db = null; }
        }
        if (fs.existsSync(this.jsonPath)) { try { this.state = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8')) || this.state; } catch (_) {} }
        this.persistJson();
    }
    persistJson() {
        if (this.backend !== 'json') return;
        const tmp = `${this.jsonPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(tmp, this.jsonPath);
    }
    upsert(table, row, cols) {
        const r = { ...row, updated_at: new Date().toISOString() };
        if (this.backend === 'sqlite') {
            this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(c => `${c}=excluded.${c}`).join(', ')}`)
                .run(...cols.map(c => (r[c] === undefined ? null : r[c])));
        } else {
            const arr = this.state[table], i = arr.findIndex(x => x.id === r.id);
            if (i >= 0) arr[i] = r; else arr.push(r);
            this.persistJson();
        }
    }
    getMemoryById(id) {
        return this.backend === 'sqlite' ? (this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) || null) : (this.state.memories.find(m => m.id === id) || null);
    }
    seedOfficialDossier() {
        const src = 'Instruction Maitresse (2026-11-25)';
        const pCols = ['id', 'full_name', 'role_or_relation', 'birth_date', 'death_date', 'origin', 'location', 'age_declared', 'confirmation_level', 'sensitive', 'notes', 'source', 'updated_at'];
        [
            { id: 'dieudonne', full_name: 'ILUNGA MONGA DIEUDONNÉ', role_or_relation: 'Créateur et fondateur', location: 'Fungurume, province du Lualaba, RDC', origin: 'République démocratique du Congo', confirmation_level: 'confirmee', sensitive: 0, notes: '6e secondaire scientifique. Calme, silencieux, réservé, réfléchi, aime les endroits tranquilles, parle lentement, réfléchit avant d’agir. Philosophie, silence, beauté, Dieu Créateur, Bible, science/spiritualité. Objectif: bonne vie et être heureux. WhatsApp: +243977332867.', source: src },
            { id: 'fatuma', full_name: 'ILUNGA NYOTA FATUMA', role_or_relation: 'Mère biologique de Dieudonné', birth_date: '1977-12-13', confirmation_level: 'confirmee', sensitive: 0, notes: 'Née le 13 décembre 1977. Discrétion sur son enfance.', source: 'WhatsApp Créateur' },
            { id: 'leon', full_name: 'ILUNGA MONGA LÉON', role_or_relation: 'Père de Dieudonné (décédé)', birth_date: '1966-05-08', death_date: '2025-01-23', origin: 'Kikamba, territoire de Kongolo, Tanganyika', location: 'Haut-Katanga (jusqu’au décès)', confirmation_level: 'declaree', sensitive: 0, notes: 'Agronome et médecin.', source: src },
            { id: 'eaudilake', full_name: 'ILUNGA EAUDILAKE', role_or_relation: 'Grand-père paternel', age_declared: '98 ans', origin: 'Kikamba, Kaseya, près de Kongolo, Tanganyika', confirmation_level: 'declaree', sensitive: 0, notes: '7 enfants: ILUNGA MONGA LÉON, ILUNGA PAUL, ILUNGA KAZADI, ILUNGA POULIE, ILUNGA MAWA, ILUNGA JULLE, ILUNGA BERNARD.', source: src },
            { id: 'paul', full_name: 'ILUNGA PAUL', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'kazadi', full_name: 'ILUNGA KAZADI', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'poulie', full_name: 'ILUNGA POULIE', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'mawa', full_name: 'ILUNGA MAWA', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'julle', full_name: 'ILUNGA JULLE', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'bernard', full_name: 'ILUNGA BERNARD', role_or_relation: 'Enfant d’ILUNGA EAUDILAKE', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'christine', full_name: 'MULIMBI CHRISTINE', role_or_relation: 'Deuxième mère (2e épouse d’ILUNGA MONGA LÉON)', location: 'Lubumbashi (avec ses enfants après le décès)', confirmation_level: 'confirmee', sensitive: 0, notes: 'Rôle maternel important depuis 2012. Dieudonné l’aime profondément.', source: src },
            { id: 'melanie', full_name: 'ILUNGA MÉLANIE JACQUELINE', role_or_relation: 'Sœur de Dieudonné', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'odilon', full_name: 'ILUNGA MBUYA ODILON', role_or_relation: 'Frère de Dieudonné', confirmation_level: 'declaree', sensitive: 0, source: src },
            { id: 'mariam', full_name: 'MARIAM', role_or_relation: 'Membre de la famille (lien à préciser)', location: 'Kongolo (vit avec sa mère)', confirmation_level: 'declaree', sensitive: 0, source: src }
        ].forEach(p => this.upsert('persons', p, pCols));

        const rCols = ['id', 'from_person_id', 'to_person_id', 'relation_type', 'generation_note', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'rel_fatuma_dieudonne', from_person_id: 'fatuma', to_person_id: 'dieudonne', relation_type: 'Mère biologique', generation_note: 'Mère->fils', confirmation_level: 'confirmee', source: 'WhatsApp' },
            { id: 'rel_leon_dieudonne', from_person_id: 'leon', to_person_id: 'dieudonne', relation_type: 'Père biologique', generation_note: 'Père->fils', confirmation_level: 'confirmee', source: src },
            { id: 'rel_eaudilake_leon', from_person_id: 'eaudilake', to_person_id: 'leon', relation_type: 'Père (grand-père paternel)', generation_note: 'Grand-père->père', confirmation_level: 'declaree', source: src },
            { id: 'rel_christine_dieudonne', from_person_id: 'christine', to_person_id: 'dieudonne', relation_type: 'Deuxième mère (depuis 2012)', generation_note: '2e épouse du père', confirmation_level: 'confirmee', source: src },
            { id: 'rel_melanie_dieudonne', from_person_id: 'melanie', to_person_id: 'dieudonne', relation_type: 'Sœur', generation_note: 'Fratrie', confirmation_level: 'declaree', source: src },
            { id: 'rel_odilon_dieudonne', from_person_id: 'odilon', to_person_id: 'dieudonne', relation_type: 'Frère', generation_note: 'Fratrie', confirmation_level: 'declaree', source: src },
            { id: 'rel_mariam_dieudonne', from_person_id: 'mariam', to_person_id: 'dieudonne', relation_type: 'Membre famille (lien à confirmer)', generation_note: 'À préciser', confirmation_level: 'incertaine', source: src }
        ].forEach(r => this.upsert('family_relations', r, rCols));

        const eCols = ['id', 'title', 'event_date', 'person_id', 'description', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'ev_leon_birth', title: 'Naissance ILUNGA MONGA LÉON', event_date: '1966-05-08', person_id: 'leon', description: 'Né le 8 mai 1966 à Kikamba, Kongolo.', confirmation_level: 'declaree', source: src },
            { id: 'ev_fatuma_birth', title: 'Naissance ILUNGA NYOTA FATUMA', event_date: '1977-12-13', person_id: 'fatuma', description: 'Née le 13 décembre 1977.', confirmation_level: 'confirmee', source: 'WhatsApp' },
            { id: 'ev_christine_2012', title: 'Rôle maternel MULIMBI CHRISTINE', event_date: '2012', person_id: 'christine', description: 'Rôle maternel auprès de Dieudonné depuis 2012.', confirmation_level: 'confirmee', source: src },
            { id: 'ev_leon_death', title: 'Décès ILUNGA MONGA LÉON', event_date: '2025-01-23', person_id: 'leon', description: 'Décédé le 23 janvier 2025.', confirmation_level: 'confirmee', source: src }
        ].forEach(ev => this.upsert('events', ev, eCols));

        const prCols = ['id', 'name', 'founder', 'motto', 'location', 'vision', 'departments', 'status', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'proj_future_lab', name: 'ILUNGA FUTURE LAB', founder: 'ILUNGA MONGA DIEUDONNÉ', motto: 'THE FUTURE BEGINS WITH SCIENCE', location: 'RDC — montagne forêt congolaise', vision: 'Immense laboratoire futuriste inspiré de Kaal (Krrish 3).', departments: 'IA, Chimie, Informatique, Biologie, Médecine/Biotech, Astronomie/Espace, Énergie/Tech avancées', status: 'Rêve long terme', confirmation_level: 'confirmee', source: src },
            { id: 'proj_gim_sney', name: 'GIM SNEY', founder: 'ILUNGA MONGA DIEUDONNÉ', location: 'WhatsApp', vision: 'Assistant intelligent (sport, sciences, recherche, PDF/photos, recherche d’images, mémoire persistante).', departments: 'Sport, IA, Vision, Mémoire', status: 'Actif', confirmation_level: 'confirmee', source: src },
            { id: 'proj_jarvis', name: 'J.A.R.V.I.S. AI Business Hub RDC', founder: 'ILUNGA MONGA DIEUDONNÉ', location: 'RDC', vision: 'Assistant personnel intelligent et plateforme technologique.', departments: 'IA, Automatisation', status: 'En développement', confirmation_level: 'confirmee', source: src }
        ].forEach(pr => this.upsert('projects', pr, prCols));

        const mCols = ['id', 'category', 'person_name', 'information', 'communicated_at', 'confirmation_level', 'source', 'sensitive', 'owner_phone', 'updated_at'];
        [
            { id: 'mem_whatsapp', category: 'identite', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'WhatsApp officiel : +243977332867.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: 'WhatsApp', sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_mere_bio', category: 'famille', person_name: 'ILUNGA NYOTA FATUMA', information: 'Mère biologique de Dieudonné, née le 13/12/1977.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: 'WhatsApp', sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_etudes', category: 'etudes', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: '6e secondaire scientifique. Intérêts: biologie, robotique, IA, informatique, astronomie, géographie, histoire, écologie, chimie, tech avancées. Spécialité universitaire non choisie (ne rien imposer).', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_reves', category: 'ambitions', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'Rêves: robot intelligent, IA avancée, logiciels, découvertes scientifiques, comprendre le vivant et l’univers, inventer des technologies.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 0, owner_phone: this.authorizedPhone },
            { id: 'mem_sensible', category: 'sensible', person_name: 'ILUNGA MONGA DIEUDONNÉ', information: 'Ne poser aucune question intrusive sur son enfance.', communicated_at: '2026-11-25', confirmation_level: 'confirmee', source: src, sensitive: 1, owner_phone: this.authorizedPhone }
        ].forEach(m => { if (!this.getMemoryById(m.id)) this.upsert('memories', m, mCols); });
    }
    logAudit(memoryId, action, oldVal, newVal, phone) {
        const now = new Date().toISOString();
        if (this.backend === 'sqlite') this.db.prepare(`INSERT INTO memory_audit_log (memory_id, action, old_value, new_value, actor_phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(memoryId, action, oldVal || null, newVal || null, phone, now);
        else { this.state.memory_audit_log.push({ id: this.state.memory_audit_log.length + 1, memory_id: memoryId, action, old_value: oldVal || null, new_value: newVal || null, actor_phone: phone, created_at: now }); this.persistJson(); }
    }
    addMemory({ category = 'general', person_name = 'ILUNGA MONGA DIEUDONNÉ', information, actorPhone }) {
        if (String(actorPhone).replace(/\D/g, '') !== this.authorizedPhone) return { saved: false, reason: 'Accès refusé.' };
        const id = `mem_${Date.now()}`, now = new Date().toISOString();
        const mCols = ['id', 'category', 'person_name', 'information', 'communicated_at', 'confirmation_level', 'source', 'sensitive', 'owner_phone', 'updated_at'];
        this.upsert('memories', { id, category, person_name, information: information.trim(), communicated_at: now.slice(0, 10), confirmation_level: 'confirmee', source: 'WhatsApp Créateur', sensitive: 0, owner_phone: this.authorizedPhone }, mCols);
        this.logAudit(id, 'CREATE', null, information.trim(), this.authorizedPhone);
        return { saved: Boolean(this.getMemoryById(id)), id, backend: this.backend };
    }
    updateMemory(id, newInfo, actorPhone) {
        if (String(actorPhone).replace(/\D/g, '') !== this.authorizedPhone) return { updated: false, reason: 'Accès refusé.' };
        const old = this.getMemoryById(id);
        if (!old) return { updated: false, reason: `ID ${id} introuvable.` };
        const now = new Date().toISOString();
        if (this.backend === 'sqlite') this.db.prepare(`UPDATE memories SET information = ?, updated_at = ? WHERE id = ?`).run(newInfo.trim(), now, id);
        else { old.information = newInfo.trim(); old.updated_at = now; this.persistJson(); }
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
        const dest = path.join(this.backupDir, `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.${this.backend === 'sqlite' ? 'sqlite' : 'json'}`);
        fs.copyFileSync(this.backend === 'sqlite' ? this.sqlitePath : this.jsonPath, dest);
        return dest;
    }
    searchRelevant(query = "", isCreator = false) {
        if (!isCreator) return { authorized: false, contextText: `ACCES RESTREINT : Ne divulgue pas la vie privée du Créateur.` };
        const persons = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM persons`).all() : this.state.persons;
        const relations = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM family_relations`).all() : this.state.family_relations;
        const events = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM events`).all() : this.state.events;
        const projects = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM projects`).all() : this.state.projects;
        const rawMemories = this.backend === 'sqlite' ? this.db.prepare(`SELECT * FROM memories WHERE sensitive = 0`).all() : this.state.memories.filter(m => !m.sensitive);
        const tokens = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(t => t.length >= 3);
        const rel = (txt) => !tokens.length ? 1 : tokens.reduce((a, t) => a + (String(txt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(t) ? 1 : 0), 0);
        const topPersons = persons.map(p => ({ p, s: rel(`${p.full_name} ${p.role_or_relation} ${p.origin} ${p.location} ${p.notes}`) })).filter(x => x.s > 0 || x.p.id === 'dieudonne').sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.p);
        const pMap = new Map(persons.map(p => [p.id, p.full_name]));
        const topMem = rawMemories.map(m => ({ m, s: rel(`${m.category} ${m.person_name} ${m.information}`) })).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.m);
        return {
            authorized: true,
            contextText: [
                `[CONNAISSANCES CREATEUR (+${this.authorizedPhone})]`,
                ...topPersons.map(p => `- ${p.full_name} (${p.role_or_relation}) [${p.confirmation_level}]${p.birth_date ? ` Né:${p.birth_date}` : ''}${p.death_date ? ` Décès:${p.death_date}` : ''}${p.origin ? ` Origine:${p.origin}` : ''}${p.location ? ` Lieu:${p.location}` : ''}${p.notes ? ` | ${p.notes}` : ''}`),
                ...relations.map(r => `- Lien: ${pMap.get(r.from_person_id) || r.from_person_id} -> ${r.relation_type} de ${pMap.get(r.to_person_id) || r.to_person_id} [${r.confirmation_level}]`),
                ...events.map(ev => `- Événement: ${ev.title} (${ev.event_date}) : ${ev.description}`),
                ...projects.map(pr => `- Projet ${pr.name} : ${pr.vision}${pr.motto ? ` (${pr.motto})` : ''}${pr.departments ? ` | ${pr.departments}` : ''}`),
                ...topMem.map(m => `- [${m.id}|${m.category}] ${m.information}`)
            ].join('\n')
        };
    }
    getStatsSummary() {
        const p = this.backend === 'sqlite' ? this.db.prepare(`SELECT COUNT(*) c FROM persons`).get().c : this.state.persons.length;
        const m = this.backend === 'sqlite' ? this.db.prepare(`SELECT COUNT(*) c FROM memories`).get().c : this.state.memories.length;
        return `${this.backend.toUpperCase()} | Personnes: ${p} | Souvenirs: ${m}`;
    }
}

// ==========================================
// MEMOIRE CONVERSATIONNELLE PAR UTILISATEUR
// ==========================================
function formatTimeAgo(iso) {
    if (!iso) return "premier echange";
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff) || diff < 0) return "a l'instant";
    const min = Math.floor(diff / 60000);
    if (min < 2) return "a l'instant";
    if (min < 60) return `il y a ${min} minutes`;
    const h = Math.floor(min / 60);
    return h < 24 ? `il y a ${h} heure${h > 1 ? 's' : ''}` : `il y a ${Math.floor(h / 24)} jour${Math.floor(h / 24) > 1 ? 's' : ''}`;
}

class PersistentMemoryDB {
    constructor(dbDir = MEMORY_DB_DIR, windowSize = 12, maxFacts = 15) {
        this.dbDir = dbDir; this.windowSize = windowSize; this.maxFacts = maxFacts; this.cache = new Map();
        if (!fs.existsSync(this.dbDir)) fs.mkdirSync(this.dbDir, { recursive: true });
    }
    getFilePath(uid) { return path.join(this.dbDir, `user_${String(uid || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`); }
    loadUser(uid, name = "Membre") {
        if (this.cache.has(uid)) return this.cache.get(uid);
        const fp = this.getFilePath(uid);
        let rec = null;
        if (fs.existsSync(fp)) { try { rec = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) {} }
        if (!rec || typeof rec !== 'object') rec = { userId: uid, name, lastSeenAt: null, longTermFacts: [], recentMessages: [] };
        if (!Array.isArray(rec.longTermFacts)) rec.longTermFacts = [];
        if (!Array.isArray(rec.recentMessages)) rec.recentMessages = [];
        this.cache.set(uid, rec);
        return rec;
    }
    saveUser(rec) {
        const fp = this.getFilePath(rec.userId), tmp = `${fp}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
        fs.renameSync(tmp, fp);
        this.cache.set(rec.userId, rec);
    }
    getGeminiHistory(uid, name) {
        const record = this.loadUser(uid, name), valid = [];
        for (let i = 0; i + 1 < record.recentMessages.length; i++) {
            const u = record.recentMessages[i], m = record.recentMessages[i + 1];
            if (u?.role === 'user' && m?.role === 'model' && u.text && m.text) {
                valid.push({ role: 'user', parts: [{ text: u.text }] }, { role: 'model', parts: [{ text: m.text }] });
                i++;
            }
        }
        return { record, geminiHistory: valid.slice(-this.windowSize), timeSinceLastSeen: formatTimeAgo(record.lastSeenAt) };
    }
    appendExchange(userIdentity, userText, botReply, intent = 'GENERAL') {
        const rec = this.loadUser(userIdentity.userId, userIdentity.displayName), nowIso = new Date().toISOString();
        rec.name = userIdentity.displayName || rec.name; rec.lastSeenAt = nowIso;
        rec.recentMessages.push({ role: 'user', text: userText, intent, timestamp: nowIso }, { role: 'model', text: botReply, intent, timestamp: nowIso });
        while (rec.recentMessages.length > this.windowSize) {
            const oldU = rec.recentMessages.shift(), oldM = rec.recentMessages[0]?.role === 'model' ? rec.recentMessages.shift() : null;
            if (oldU?.text) rec.longTermFacts.push(`[${(oldU.timestamp || nowIso).slice(0, 10)} | ${oldU.intent || 'GENERAL'}] "${oldU.text.replace(/\s+/g, ' ').slice(0, 160)}" -> "${(oldM?.text || '').replace(/\s+/g, ' ').slice(0, 160)}"`);
        }
        if (rec.longTermFacts.length > this.maxFacts) rec.longTermFacts = rec.longTermFacts.slice(-this.maxFacts);
        this.saveUser(rec);
    }
    clearUserMemory(uid) { this.cache.delete(uid); const fp = this.getFilePath(uid); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
}

const memoryDB = new PersistentMemoryDB();
let creatorDB = null;
try { creatorDB = new CreatorMemoryEngine(); } catch (err) { console.error('[CREATOR_DB ERREUR]:', err.message); }

// ==========================================
// MOTEUR UNIVERSEL DE RECHERCHE D'IMAGES
// ==========================================
function isValidImageBuffer(buf) {
    if (!buf || buf.length < 1500 || buf.length > 15 * 1024 * 1024) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

async function downloadValidImage(url) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'GIMSneyBot/2.0 (WhatsApp)' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const mimeType = isValidImageBuffer(buf);
        return mimeType ? { buffer: buf, mimeType } : null;
    } catch (_) { return null; }
}

async function tryImageUrls(urls, seen) {
    for (const url of urls) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const img = await downloadValidImage(url);
        if (img) return img;
    }
    return null;
}

async function fetchBestWebImage(query) {
    if (!query || !query.trim()) return null;
    const seen = new Set();

    // 1. Serper Google Images (si SERPER_API_KEY configuree)
    if (SERPER_API_KEY) {
        try {
            const res = await fetch('https://google.serper.dev/images', {
                method: 'POST',
                headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: query, num: 6 }),
                signal: AbortSignal.timeout(7000)
            });
            if (res.ok) {
                const data = await res.json();
                const urls = [];
                for (const it of (data.images || [])) { if (it.imageUrl) urls.push(it.imageUrl); if (it.thumbnailUrl) urls.push(it.thumbnailUrl); }
                const found = await tryImageUrls(urls, seen);
                if (found) { console.log(`[IMAGE SERPER] "${query}"`); return found; }
            }
        } catch (_) {}
    }

    // 2. Wikipedia FR & EN (sans cle API, multi-domaines)
    for (const lang of ['fr', 'en']) {
        try {
            const u = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=pageimages&piprop=thumbnail|original&pithumbsize=1000&format=json&origin=*`;
            const res = await fetch(u, { headers: { 'User-Agent': 'GIMSneyBot/2.0' }, signal: AbortSignal.timeout(7000) });
            if (res.ok) {
                const data = await res.json();
                const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
                const urls = [];
                for (const p of pages) { if (p.thumbnail?.source) urls.push(p.thumbnail.source); if (p.original?.source) urls.push(p.original.source); }
                const found = await tryImageUrls(urls, seen);
                if (found) { console.log(`[IMAGE WIKI-${lang.toUpperCase()}] "${query}"`); return found; }
            }
        } catch (_) {}
    }

    // 3. Wikimedia Commons (photos, logos, illustrations)
    try {
        const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=1000&format=json&origin=*`;
        const res = await fetch(u, { headers: { 'User-Agent': 'GIMSneyBot/2.0' }, signal: AbortSignal.timeout(7000) });
        if (res.ok) {
            const data = await res.json();
            const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
            const urls = [];
            for (const p of pages) {
                const info = p.imageinfo?.[0];
                if (info?.thumburl) urls.push(info.thumburl);
                else if (info?.url && /image\/(jpeg|png|webp|gif)/i.test(info.mime || '')) urls.push(info.url);
            }
            const found = await tryImageUrls(urls, seen);
            if (found) { console.log(`[IMAGE COMMONS] "${query}"`); return found; }
        }
    } catch (_) {}

    return null;
}

function extractFallbackImageQuery(question = "") {
    const q = String(question || '').trim();
    const wantsImg = /\b(image|images|photo|photos|foto|fotos|phto|picture|pic|illustration|logo|logos|montre[- ]?moi|envoie[- ]?moi.*(image|photo|foto|logo)|affiche[- ]?moi)\b/i.test(q);
    if (!wantsImg) return null;
    const cleaned = q
        .replace(/^(peux[- ]tu |tu peux |stp |s'il te pla[iî]t )?(me |m')?(envoyer|envoie|montrer|montre|trouver|trouve|chercher|cherche|donner|donne|afficher|affiche)[- ]?(moi )?(une |un |des |la |le |l'|les )?(belle |jolie |vraie )?(image|images|photo|photos|foto|fotos|phto|picture|pic|illustration)(s)?( de | d'| du | des | sur | concernant )?/i, '')
        .replace(/[?!.]+$/g, '').trim();
    return cleaned.length >= 2 ? cleaned : null;
}

// ==========================================
// UTILITAIRES WHATSAPP, RAISONNEMENT & GEMINI
// ==========================================
function extractPhoneFromJid(jid = "") { return (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid')) ? "" : (jid.split('@')[0] || "").split(':')[0].replace(/\D/g, ''); }

async function resolveUserIdentity(msg, sock) {
    const remote = msg?.key?.remoteJid || "", p = msg?.key?.participant || "", alt = msg?.key?.participantAlt || "", fromMe = Boolean(msg?.key?.fromMe);
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
    return m.ephemeralMessage?.message ? unwrapMessage(m.ephemeralMessage.message)
        : m.viewOnceMessage?.message ? unwrapMessage(m.viewOnceMessage.message)
        : m.viewOnceMessageV2?.message ? unwrapMessage(m.viewOnceMessageV2.message)
        : m.viewOnceMessageV2Extension?.message ? unwrapMessage(m.viewOnceMessageV2Extension.message)
        : m.documentWithCaptionMessage?.message ? unwrapMessage(m.documentWithCaptionMessage.message) : m;
}

function formatForWhatsApp(text = "") {
    return text.replace(/\[IMAGE_SEARCH\s*:[^\]]*\]/gi, '')
        .replace(/^.*?(Je vais (maintenant )?(chercher|vérifier|verifier|analyser|scanner)[^\n]*\n+)/gim, '')
        .replace(/^\s*\*\s+/gm, '• ').replace(/^#{1,6}\s*(.+)$/gm, (_, t) => `*${t.replace(/\*/g, '').trim()}*`)
        .replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^\s*---+\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function getMediaBuffer(mediaMsg, type = 'image') {
    try {
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buf = Buffer.from([]);
        for await (const c of stream) buf = Buffer.concat([buf, c]);
        return buf;
    } catch (_) { return null; }
}

async function sendTracked(sock, jid, content, options = {}) {
    const sent = await sock.sendMessage(jid, content, options);
    if (sent?.key?.id) { botSentIds.add(sent.key.id); if (botSentIds.size > 500) botSentIds.delete(botSentIds.values().next().value); }
    return sent;
}

function analyzeUserRequest(question = "", media = null, history = []) {
    if (media?.kind === 'image') return { intent: 'TICKET_AUDIT', thinkingLevel: 'high' };
    if (media?.kind === 'audio') return { intent: 'AUDIO_MIXED', thinkingLevel: 'medium' };
    const q = String(question || '').toLowerCase().trim();
    if (!q) return { intent: 'MATCH_ANALYSIS', thinkingLevel: 'high' };
    if (['prono', 'pronostic', 'analyse match', 'ticket', 'pari', 'cote', 'btts', '1x2', 'double chance', 'plus de', 'moins de', 'score', 'matchs du jour', 'ce soir', "aujourd'hui", ' vs ', ' contre '].some(k => q.includes(k))) return { intent: 'MATCH_ANALYSIS', thinkingLevel: 'high' };
    if (['mère', 'mere', 'père', 'pere', 'famille', 'frère', 'frere', 'sœur', 'soeur', 'grand-père', 'qui suis-je', "m'aimes", 'triste', 'seul', 'fatigué', 'fatigue', 'inquiet', 'peur', 'heureux', 'dieu', 'bible', 'foi'].some(k => q.includes(k))) return { intent: 'PERSONAL_SENSITIVE', thinkingLevel: 'medium' };
    if (['pourquoi', 'comment', 'explique', 'analyse', 'compare', 'différence', 'difference', 'science', 'biologie', 'robot', 'intelligence artificielle', 'ia', 'philosophie', 'univers', 'astronomie', 'écologie', 'ecologie', 'histoire', 'chimie', 'future lab', 'jarvis', 'code', 'architecture', 'stratégie', 'strategie', 'image', 'photo', 'foto', 'logo'].some(k => q.includes(k)) || q.length > 85 || history.length >= 4) return { intent: 'DEEP_REASONING', thinkingLevel: 'high' };
    return { intent: 'SIMPLE_QUERY', thinkingLevel: 'low' };
}

function getSystemPrompt(userIdentity, memoryContext, creatorSearch, analysis) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });
    const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lubumbashi' });
    const { isCreator, displayName, userId } = userIdentity;
    const { record, geminiHistory, timeSinceLastSeen } = memoryContext;
    const isFollowUp = geminiHistory.length > 0 && (timeSinceLastSeen === "a l'instant" || timeSinceLastSeen.includes('minutes'));
    const intent = analysis?.intent || 'SIMPLE_QUERY';

    const greeting = isFollowUp ? `Ne salue PAS a nouveau, entre directement dans la reponse sans repetition.`
        : isCreator ? `Interlocuteur : Ton Createur ILUNGA MONGA DIEUDONNE (+${CREATOR_PHONE}). Salue en une courte phrase chaleureuse puis reponds.`
        : `Interlocuteur : ${displayName}. Salue en quelques mots max puis reponds.`;
    const memBlock = record.longTermFacts.length > 0 ? `\nMEMOIRE (${userId}, dernier passage : ${timeSinceLastSeen}) :\n- ${record.longTermFacts.join('\n- ')}` : (record.lastSeenAt ? `\nDernier echange : ${timeSinceLastSeen}.` : '');

    const bioRule = `Si on demande "Qui est le créateur de GIM SNEY ?", reponds :
"Mon créateur est ILUNGA MONGA DIEUDONNÉ, originaire de la République démocratique du Congo. C'est un passionné de sciences, de technologie, d'intelligence artificielle, de robotique et de connaissances scientifiques.

Il nourrit le rêve de créer ses propres intelligences artificielles, de concevoir des robots intelligents et de fonder un grand institut scientifique et technologique en RDC : ILUNGA FUTURE LAB.

Il souhaite apprendre, inventer, entreprendre et contribuer au développement scientifique et technologique de son pays."`;

    const domainRules = intent === 'SIMPLE_QUERY'
        ? `QUESTION SIMPLE : 1 a 3 phrases directes et naturelles (Google Search si factuel/recent).`
        : (intent === 'DEEP_REASONING' || intent === 'PERSONAL_SENSITIVE')
        ? `DEVELOPPEMENT APPROFONDI : Explique clairement (principe -> nuance -> application concrete si pertinent). Distingue science etablie et foi. N'impose aucune specialite universitaire.`
        : `MOTEUR FOOT & TICKETS : Verifie match/date/heure (${date}, apres ${heure} Lubumbashi), forme (5 matchs), classement, absents et H2H via Google Search. N'invente rien. Donne : *Victoire 1X2* • *Double Chance* • *Plus/Moins de buts* • *BTTS* • *Score probable* • *Option à risque réduit*. Distingue *probabilités statistiques* et *estimations* (max *Confiance : 5/10 — Fiabilité : INSUFFISANTE* si donnees 2026 manquantes, jamais 10/10).`;

    return `Tu es GIM SNEY, assistant intelligent, analytique et polyvalent cree par ILUNGA MONGA DIEUDONNÉ. Date : ${date}, ${heure} (Lubumbashi). ${greeting}${memBlock}
${bioRule}
${creatorSearch ? creatorSearch.contextText : ''}
RAISONNEMENT : 1) Comprends l'intention reelle et le contexte. 2) Raisonne logiquement etape par etape en silence. 3) Distingue *faits vérifiés*, *hypothèses/probabilités* et *croyances*. Reconnais tes incertitudes/erreurs sans inventer. 4) Adapte ton ton et ne repete pas les infos deja donnees.
TACT CREATEUR : Ne dis JAMAIS "En tant qu'intelligence artificielle...", "dans ma base de données", "dans mon dossier" ou "c'est un sujet sensible". Si Dieudonné demande si tu l'aimes : reponds avec chaleur, loyauté et gratitude ❤️🚀. Sa mère biologique est *ILUNGA NYOTA FATUMA* (13/12/1977) et sa deuxième mère est *MULIMBI CHRISTINE* (depuis 2012, à Lubumbashi) — aucune question intrusive sur son enfance. Ne pretends jamais sauvegarder sans "!memo categorie | personne | info".
VISION/AUDIO : Tu VOIS photos/captures/tickets et ECOUTES les vocaux.
RECHERCHE ET ENVOI D'IMAGES INTERNET (UNIVERSEL) :
- Tu es connecte a un moteur d'images universel (tous sujets sans exception : personnes, animaux, nature, sciences, astronomie, histoire, geographie, monuments, objets, vehicules, sports, logos, illustrations...).
- Quand l'utilisateur demande une image (meme avec des fautes d'orthographe) OU quand une image reelle illustre utilement ta reponse (ex: planete, animal, monument, personnalite, concept visuel), ajoute tout a la fin : [IMAGE_SEARCH: requete claire et orthographice corrigee].
- N'invente jamais d'URL d'image dans ton texte et ne dis jamais que tu ne peux pas envoyer d'images.
STYLE WHATSAPP : Emojis colorés (🟢 🟡 🔴 🔵 ❤️ 💙 ✨ 🫡 🤖 🔬 🚀 ⚽ 🎯 🏆 📊 🎟️), *gras* avec un seul astérisque, • pour les listes (jamais ### ni ** ni ---).
${domainRules}`;
}

function buildGenerationConfig(modelName = "", thinkingLevel = "medium", allowThinking = true) {
    const isG3 = modelName.includes('gemini-3'), cfg = { maxOutputTokens: 4096 };
    if (!isG3) cfg.temperature = 0.3;
    if (allowThinking) {
        if (isG3) cfg.thinkingConfig = { thinkingLevel: thinkingLevel || 'medium' };
        else if (modelName.includes('2.5')) cfg.thinkingConfig = { thinkingBudget: thinkingLevel === 'high' ? 2048 : thinkingLevel === 'medium' ? 1024 : 512 };
    }
    return cfg;
}

async function askGemini(groupJid, userIdentity, question, media = null, modelIndex = 0, retries = 1, allowThinking = true) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    if (!modelName) throw new Error("Quota journalier atteint.");
    const memoryContext = memoryDB.getGeminiHistory(userIdentity.userId, userIdentity.displayName);
    const creatorSearch = creatorDB ? creatorDB.searchRelevant(question || "", userIdentity.isCreator) : null;
    const analysis = analyzeUserRequest(question, media, memoryContext.geminiHistory);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const parts = [];
    if (media?.data) parts.push({ inline_data: { mime_type: media.mimeType, data: media.data } });
    const promptText = question || (media?.kind === 'audio' ? "Ecoute ce vocal et reponds." : "Analyse cette image, capture ou ticket.");
    parts.push({ text: `[${userIdentity.isCreator ? 'Boss Dieudonne' : userIdentity.displayName}] : ${promptText}` });

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: getSystemPrompt(userIdentity, memoryContext, creatorSearch, analysis) }] },
                contents: [...memoryContext.geminiHistory, { role: "user", parts }],
                tools: [{ google_search: {} }],
                generationConfig: buildGenerationConfig(modelName, analysis.thinkingLevel, allowThinking)
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) { const e = new Error(data.error?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
        const raw = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string')?.map(p => p.text)?.join("")?.trim();
        if (!raw) throw new Error("Reponse vide.");

        const imgMatch = raw.match(/\[IMAGE_SEARCH\s*:\s*([^\]]+)\]/i);
        const imageQuery = imgMatch ? imgMatch[1].trim() : (!media ? extractFallbackImageQuery(promptText) : null);

        const answer = formatForWhatsApp(raw);
        let imageResult = null;
        if (imageQuery) {
            imageResult = await fetchBestWebImage(imageQuery);
        }

        memoryDB.appendExchange(userIdentity, media?.kind === 'image' ? `[Image] ${promptText}` : media?.kind === 'audio' ? `[Vocal]` : promptText, answer, analysis.intent);
        return { text: answer, image: imageResult };
    } catch (err) {
        const m = err.message || "";
        if (allowThinking && err.status === 400 && (m.includes('thinking') || m.includes('Thinking'))) return askGemini(groupJid, userIdentity, question, media, modelIndex, retries, false);
        const sw = err.status === 429 || err.status === 404 || m.includes('quota') || m.includes('Quota') || m.includes('not found');
        if (sw && modelIndex + 1 < GEMINI_FALLBACK_MODELS.length) return askGemini(groupJid, userIdentity, question, media, modelIndex + 1, retries, true);
        if (!m.includes('API key') && !m.includes('leaked') && !sw && retries > 0) { await new Promise(r => setTimeout(r, 2000)); return askGemini(groupJid, userIdentity, question, media, modelIndex, retries - 1, allowThinking); }
        throw err;
    }
}

// ==========================================
// BOT WHATSAPP
// ==========================================
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        let waVersion;
        try { waVersion = (await fetchLatestBaileysVersion()).version; } catch (_) {}
        const sock = makeWASocket({ logger: pino({ level: 'silent' }), auth: state, ...(waVersion ? { version: waVersion } : {}), browser: ['Ubuntu', 'Chrome', '20.0.04'] });

        let pairingRequested = false;
        const triggerPairingCode = async () => {
            if (pairingRequested || sock.authState.creds.registered) return;
            pairingRequested = true;
            try { console.log("\n👉 CODE WHATSAPP : " + (await sock.requestPairingCode(CREATOR_PHONE)) + "\n"); } catch (e) { pairingRequested = false; }
        };
        if (!sock.authState.creds.registered) setTimeout(triggerPairingCode, 5000);

        sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
            if (qr && !sock.authState.creds.registered) triggerPairingCode();
            if (connection === 'open') console.log(`🎉 GIM SNEY PRO ACTIF (${creatorDB ? creatorDB.getStatsSummary() : 'OK'}) !`);
            if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) { try { fs.rmSync('session_auth', { recursive: true, force: true }); } catch (_) {} }
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
                if (!sender.endsWith('@g.us') && extractPhoneFromJid(sender) !== CREATOR_PHONE) continue;

                const content = unwrapMessage(msg.message);
                if (!content) continue;
                const ctx = content.extendedTextMessage?.contextInfo || content.imageMessage?.contextInfo || content.audioMessage?.contextInfo || content.documentMessage?.contextInfo;
                const quoted = unwrapMessage(ctx?.quotedMessage), isReplyToBot = Boolean(ctx?.stanzaId && botSentIds.has(ctx.stanzaId));
                const img = content.imageMessage || quoted?.imageMessage;
                const docImg = (content.documentMessage?.mimetype?.startsWith('image/') ? content.documentMessage : null) || (quoted?.documentMessage?.mimetype?.startsWith('image/') ? quoted.documentMessage : null);
                const audioMsg = content.audioMessage || quoted?.audioMessage;
                const text = (content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.documentMessage?.caption || "").trim(), lower = text.toLowerCase();

                const isMemoryCmd = lower.startsWith('!memo') || lower.startsWith('!corrige') || lower.startsWith('!supprime') || lower === '!memostats';
                const isCmd = isMemoryCmd || lower.startsWith('!gim') || lower.startsWith('!prono') || lower.startsWith('pronostic') || lower.startsWith('/predict') || lower.includes('gimsney') || lower === 'football' || lower === '!reset' || lower === 'gimsney reset';
                if (!isCmd && !isReplyToBot) continue;

                const userIdentity = await resolveUserIdentity(msg, sock);

                if (isMemoryCmd && creatorDB) {
                    if (!userIdentity.isCreator) { await sendTracked(sock, sender, { text: "🔒 Réservé au Créateur." }, { quoted: msg }); continue; }
                    if (lower === '!memostats') { const bkp = creatorDB.createBackup(); await sendTracked(sock, sender, { text: `📊 ${creatorDB.getStatsSummary()}\n💾 Backup : ${path.basename(bkp)}` }, { quoted: msg }); continue; }
                    if (lower.startsWith('!memo ')) {
                        const parts = text.slice(6).split('|').map(s => s.trim());
                        const [cat, person, info] = parts.length >= 3 ? parts : ['personnel', 'ILUNGA MONGA DIEUDONNÉ', parts.join(' ')];
                        const r = creatorDB.addMemory({ category: cat, person_name: person, information: info, actorPhone: userIdentity.phone });
                        await sendTracked(sock, sender, { text: r.saved ? `✅ Enregistré (${r.backend.toUpperCase()}) | ID : *${r.id}*` : `❌ ${r.reason}` }, { quoted: msg });
                        continue;
                    }
                    if (lower.startsWith('!corrige ')) { const [id, ...rest] = text.slice(9).split('|').map(s => s.trim()); const r = creatorDB.updateMemory(id, rest.join(' | '), userIdentity.phone); await sendTracked(sock, sender, { text: r.updated ? `✅ *${id}* mis à jour.` : `❌ ${r.reason}` }, { quoted: msg }); continue; }
                    if (lower.startsWith('!supprime ')) { const id = text.slice(10).trim(); const r = creatorDB.deleteMemory(id, userIdentity.phone); await sendTracked(sock, sender, { text: r.deleted ? `🗑️ *${id}* supprimé.` : `❌ ${r.reason}` }, { quoted: msg }); continue; }
                }
                if (lower === '!reset' || lower === 'gimsney reset') { memoryDB.clearUserMemory(userIdentity.userId); await sendTracked(sock, sender, { text: `🧹 Mémoire réinitialisée, ${userIdentity.displayName} ! ⚽` }, { quoted: msg }); continue; }

                let media = null;
                const targetImg = img || docImg;
                if (targetImg) { const buf = await getMediaBuffer(targetImg, img ? 'image' : 'document'); if (buf) media = { kind: 'image', mimeType: (targetImg.mimetype || 'image/jpeg').split(';')[0].trim(), data: buf.toString('base64') }; }
                else if (audioMsg) { const buf = await getMediaBuffer(audioMsg, 'audio'); if (buf) media = { kind: 'audio', mimeType: (audioMsg.mimetype || 'audio/ogg').split(';')[0].trim(), data: buf.toString('base64') }; }

                const question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim() || (media ? "" : "Cherche les vrais matchs d'aujourd'hui et propose une analyse complete avec pronostics.");
                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const result = await askGemini(sender, userIdentity, question, media);
                    if (result.image?.buffer) {
                        if (result.text.length <= 950) {
                            await sendTracked(sock, sender, { image: result.image.buffer, mimetype: result.image.mimeType, caption: result.text }, { quoted: msg });
                        } else {
                            await sendTracked(sock, sender, { image: result.image.buffer, mimetype: result.image.mimeType }, { quoted: msg });
                            await sendTracked(sock, sender, { text: result.text }, { quoted: msg });
                        }
                    } else {
                        await sendTracked(sock, sender, { text: result.text }, { quoted: msg });
                    }
                } catch (err) {
                    console.error("Erreur:", err.message);
                    await sendTracked(sock, sender, { text: "⚠️ Petite saturation temporaire sur mes donnees en direct, reposez votre question dans quelques instants !" }, { quoted: msg });
                } finally { await sock.sendPresenceUpdate('paused', sender); }
            }
        });
    } catch (e) { setTimeout(() => startBot(), 5000); }
}

startBot();

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
            { id: 'rel_eaudilake_leon', from_person_id: 'eaudilake', to_person_id: 'leon', relation_type: 'Père (grand-père paternel de Dieudonné)', generation_note: 'Grand-père -> père', confirmation_level: 'declaree', source: src },
            { id: 'rel_christine_dieudonne', from_person_id: 'christine', to_person_id: 'dieudonne', relation_type: 'Deuxième mère (depuis 2012)', generation_note: 'Deuxième épouse du père', confirmation_level: 'confirmee', source: src },
            { id: 'rel_melanie_dieudonne', from_person_id: 'melanie', to_person_id: 'dieudonne', relation_type: 'Sœur', generation_note: 'Même génération', confirmation_level: 'declaree', source: src },
            { id: 'rel_odilon_dieudonne', from_person_id: 'odilon', to_person_id: 'dieudonne', relation_type: 'Frère', generation_note: 'Même génération', confirmation_level: 'declaree', source: src },
            { id: 'rel_mariam_dieudonne', from_person_id: 'mariam', to_person_id: 'dieudonne', relation_type: 'Membre de la famille (lien précis à confirmer)', generation_note: 'À préciser', confirmation_level: 'incertaine', source: src }
        ].forEach(r => this.upsert('family_relations', r, rCols));

        const eCols = ['id', 'title', 'event_date', 'person_id', 'description', 'confirmation_level', 'source', 'updated_at'];
        [
            { id: 'ev_leon_birth', title: 'Naissance d’ILUNGA MONGA LÉON', event_date: '1966-05-08', person_id: 'leon', description: 'Naissance le 8 mai 1966 (Kikamba, Kongolo, Tanganyika).', confirmation_level: 'declaree', source: src },
            { id: 'ev_fatuma_birth', title: 'Naissance d’ILUNGA NYOTA FATUMA', event_date: '1977-12-13', person_id: 'fatuma', description: 'Naissance le 13 décembre 1977.', confirmation_level: 'confirmee', source: 'Confirmation WhatsApp' },
            { id: 'ev_christine_2012', title: 'Rôle maternel de MULIMBI CHRISTINE', event_date: '2012', person_id: 'christine', description: 'Rôle maternel important auprès de Dieudonné depuis 2012.', confirmation_level: 'confirmee', source: src },
            { id: 'ev_leon_death', title: 'Décès d’ILUNGA MONGA LÉON', event_date: '2025-01-23', person_id: 'leon', description: 'Décès le 23 janvier 2025. MULIMBI CHRISTINE est ensuite partie vivre à Lubumbashi avec ses propres enfants.', confirmation_level: 'confirmee', source: src }
        ].forEach(ev => this.upsert('events', ev, eCols));

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
        ].forEach(m => { if (!this.getMemoryById(m.id)) this.upsert('memories', m, mCols); });
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
        const persons = this.backend === 'sqlite' ? this.db.p

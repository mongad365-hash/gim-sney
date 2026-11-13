const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
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

const histories = new Map();
const HISTORY_LIMIT = 10;
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
// FILTRE STRICT GROUPES UNIQUEMENT
// ==========================================
function shouldProcessMessage({ isGroup, text = "", isReplyToBot = false }) {
    // STRICT : GIM SNEY ne repond JAMAIS dans les conversations privees avec tes contacts
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

function getSystemPrompt(isCreator, senderName, isFollowUp = false, intent = 'SIMPLE_QUERY') {
    const { date, heure } = getLubumbashiDateTime();

    let greetingRule;
    if (isFollowUp) {
        greetingRule = `SUITE DE CONVERSATION : Ne salue PAS a nouveau. Reponds directement sans aucune formule d'accueil.`;
    } else if (isCreator) {
        greetingRule = `INTERLOCUTEUR : Ton Createur ILUNGA MONGA DIEUDONNE. Salue en une phrase ultra-courte maximum (ex: "Bonjour Créateur ! 🫡 Voici...") puis donne immediatement la reponse.`;
    } else {
        greetingRule = `INTERLOCUTEUR : ${senderName || 'Membre du groupe'}. Salue en quelques mots maximum (ex: "Salut ${senderName || 'frérot'} ! Voici...") puis donne immediatement la reponse.`;
    }

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

async function askGemini(senderJid, question, isCreator, senderName, media = null, modelIndex = 0, retries = 1) {
    const modelName = GEMINI_FALLBACK_MODELS[modelIndex];
    if (!modelName) {
        throw new Error("Quota journalier atteint sur tous les modeles Gemini.");
    }

    const history = histories.get(senderJid) || [];
    const isFollowUp = history.length > 0;
    const intent = classifySportsIntent(question, media);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const currentParts = [];
    if (media?.data) {
        currentParts.push({
            inline_data: {
                mime_type: media.mimeType,
                data: media.data
            }
        });
    }

    const promptText = question || (
        media?.kind === 'audio'
            ? "Ecoute attentivement ce message vocal et reponds directement a la demande."
            : "Verifie chaque match de ce ticket Betpawa via Google Search, identifie les risques et donne un verdict structure."
    );

    currentParts.push({ text: `[Message de ${isCreator ? 'Boss Dieudonne' : senderName}] : ${promptText}` });

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName, isFollowUp, intent) }] },
        contents: [
            ...history,
            { role: "user", parts: currentParts }
        ],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096
        }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || data.error) {
            const errMsg = data.error?.message || `HTTP ${res.status}`;
            const err = new Error(errMsg);
            err.status = res.status;
            throw err;
        }

        const candidate = data.candidates?.[0];
        const queries = candidate?.groundingMetadata?.webSearchQueries || [];
        const sources = candidate?.groundingMetadata?.groundingChunks || [];
        console.log(`[MOTEUR FOOT] Modele=${modelName} | Intent=${intent} | Requetes=${queries.length} | Sources=${sources.length}`);

        const rawAnswer = candidate?.content?.parts
            ?.filter(p => typeof p.text === 'string')
            ?.map(p => p.text)
            ?.join("")
            ?.trim();

        if (!rawAnswer) {
            throw new Error(`Reponse vide (finishReason: ${candidate?.finishReason || 'inconnu'}).`);
        }

        const answer = formatForWhatsApp(rawAnswer);

        const historyUserLabel = media?.kind === 'image'
            ? `[Image/Ticket de ${senderName}] : ${promptText}`
            : media?.kind === 'audio'
            ? `[Note vocale de ${senderName}]`
            : `[Message de ${isCreator ? 'Boss Dieudonne' : senderName}] : ${promptText}`;

        history.push(
            { role: "user", parts: [{ text: historyUserLabel }] },
            { role: "model", parts: [{ text: answer }] }
        );
        histories.set(senderJid, history.slice(-HISTORY_LIMIT));

        return answer;
    } catch (err) {
        const msg = err.message || "";
        const isQuotaOrModelError =
            err.status === 429 ||
            err.status === 404 ||
            msg.includes('quota') ||
            msg.includes('Quota') ||
            msg.includes('not found') ||
            msg.includes('RESOURCE_EXHAUSTED');

        if (isQuotaOrModelError && modelIndex + 1 < GEMINI_FALLBACK_MODELS.length) {
            console.warn(`[FALLBACK] ${modelName} indisponible (${err.status || 'err'}) -> bascule sur ${GEMINI_FALLBACK_MODELS[modelIndex + 1]}`);
            return askGemini(senderJid, question, isCreator, senderName, media, modelIndex + 1, retries);
        }

        const isAuthError = msg.includes('API key') || msg.includes('leaked') || msg.includes('PERMISSION_DENIED');
        if (!isAuthError && !isQuotaOrModelError && retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(senderJid, question, isCreator, senderName, media, modelIndex, retries - 1);
        }

        console.error(`[GEMINI ECHEC] ${modelName}: ${msg}`);
        throw err;
    }
}

// ==========================================
// BOT WHATSAPP BAILEYS
// ==========================================
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(CREATOR_PHONE);
                    console.log("\n=================================");
                    console.log("👉 CODE WHATSAPP : " + code);
                    console.log("=================================\n");
                } catch (e) {
                    console.error("Erreur code:", e.message);
                }
            }, 6000);
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log('🎉 GIM SNEY PRO EST 100% ACTIF SUR WHATSAPP (GROUPES UNIQUEMENT) !');
            }
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                if (code !== DisconnectReason.loggedOut) {
                    setTimeout(() => startBot(), 3000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg?.message) continue;

                const msgId = msg.key?.id;
                if (msgId && botSentIds.has(msgId)) continue;

                const sender = msg.key.remoteJid;
                if (!sender || sender === 'status@broadcast') continue;

                const isGroup = sender.endsWith('@g.us');
                // SECURITE ABSOLUE : bloque immediatement tout message hors groupe
                if (!isGroup) continue;

                const participant = msg.key.participant || "";
                const isFromMe = Boolean(msg.key.fromMe);
                const senderName = msg.pushName || "Frerot";

                const isCreator = isFromMe ||
                    participant.includes(CREATOR_PHONE) ||
                    sender.includes(CREATOR_PHONE);

                const content = unwrapMessage(msg.message);
                if (!content) continue;

                const contextInfo =
                    content.extendedTextMessage?.contextInfo ||
                    content.imageMessage?.contextInfo ||
                    content.audioMessage?.contextInfo;

                const quotedContent = unwrapMessage(contextInfo?.quotedMessage);
                const quotedId = contextInfo?.stanzaId;
                const isReplyToBot = Boolean(quotedId && botSentIds.has(quotedId));

                const img = content.imageMessage || quotedContent?.imageMessage;
                const audioMsg = content.audioMessage || quotedContent?.audioMessage;

                const caption = content.imageMessage?.caption || "";
                const text = (
                    content.conversation ||
                    content.extendedTextMessage?.text ||
                    caption ||
                    ""
                ).trim();

                if (!shouldProcessMessage({ isGroup, text, isReplyToBot })) continue;

                const lower = text.toLowerCase();
                if (lower === '!reset' || lower === 'gimsney reset') {
                    histories.delete(sender);
                    await sendTracked(sock, sender, { text: "🧹 Memoire nettoyee ! On repart sur de nouvelles bases propres. ⚽" }, { quoted: msg });
                    continue;
                }

                let media = null;
                if (img) {
                    const buf = await getMediaBuffer(img, 'image');
                    if (buf) {
                        const cleanMime = (img.mimetype || 'image/jpeg').split(';')[0].trim();
                        media = { kind: 'image', mimeType: cleanMime, data: buf.toString('base64') };
                    }
                } else if (audioMsg) {
                    const buf = await getMediaBuffer(audioMsg, 'audio');
                    if (buf) {
                        const cleanMime = (audioMsg.mimetype || 'audio/ogg').split(';')[0].trim();
                        media = { kind: 'audio', mimeType: cleanMime, data: buf.toString('base64') };
                    }
                }

                let question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim();
                if (!question && media?.kind === 'image') {
                    question = "Analyse en detail ce ticket Betpawa ou cette capture d'ecran et donne ton avis d'expert.";
                } else if (!question && media?.kind === 'audio') {
                    question = "";
                } else if (!question) {
                    question = "Cherche les vrais matchs d'aujourd'hui et propose une analyse complete avec pronostics.";
                }

                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const reply = await askGemini(sender, question, isCreator, senderName, media);
                    await sendTracked(sock, sender, { text: reply }, { quoted: msg });
                    console.log("✅ Reponse envoyee avec succes dans le groupe !");
                } catch (err) {
                    console.error("Erreur groupe:", err.message);
                    await sendTracked(sock, sender, {
                        text: `⚠️ Les gars, petite saturation temporaire sur mes donnees en direct, reposez votre question dans quelques instants !`
                    }, { quoted: msg });
                } finally {
                    await sock.sendPresenceUpdate('paused', sender);
                }
            }
        });
    } catch (e) {
        console.error("Erreur demarrage:", e.message);
        setTimeout(() => startBot(), 5000);
    }
}

// ==========================================
// TESTS DU MOTEUR SPORTIF (--test / --test-live)
// ==========================================
function runUnitTests() {
    console.log("🧪 Demarrage des tests unitaires du moteur GIM SNEY...\n");

    // Test 1 : Blocage strict des contacts prives
    assert.strictEqual(shouldProcessMessage({ isGroup: false, text: "gimsney salut" }), false);
    assert.strictEqual(shouldProcessMessage({ isGroup: false, text: "", isReplyToBot: true }), false);
    assert.strictEqual(shouldProcessMessage({ isGroup: true, text: "salut les gars" }), false);
    assert.strictEqual(shouldProcessMessage({ isGroup: true, text: "Gimsney analyse" }), true);
    assert.strictEqual(shouldProcessMessage({ isGroup: true, text: "", isReplyToBot: true }), true);
    console.log("✅ Test 1 passe : Blocage strict des chats prives & declencheurs groupe");

    // Test 2 : Classification des intentions
    assert.strictEqual(classifySportsIntent("Qui a gagne la CAN 2023 ?"), 'SIMPLE_QUERY');
    assert.strictEqual(classifySportsIntent("Analyse Serbie vs Allemagne"), 'MATCH_ANALYSIS');
    assert.strictEqual(classifySportsIntent("Donne moi 4 matchs du jour avec pronostic"), 'DAILY_ANALYSIS');
    assert.strictEqual(classifySportsIntent("", { kind: 'image', mimeType: 'image/jpeg', data: 'abc' }), 'TICKET_AUDIT');
    assert.strictEqual(classifySportsIntent("", { kind: 'audio', mimeType: 'audio/ogg', data: 'abc' }), 'AUDIO_MIXED');
    console.log("✅ Test 2 passe : classifySportsIntent");

    // Test 3 : Couverture complete -> confiance elevee (jamais 10/10)
    const fullSheet = `
[EXISTENCE]: CONFIRME
[COMPETITION_DATE_HEURE]: Ligue des Nations, aujourd'hui 20h45
[FORME_5_MATCHS]: 3V 1N 1D vs 4V 1N 0D
[CLASSEMENT_STATS]: 2e (11 buts marques, 4 encaisses) vs 1er (14 buts, 3 encaisses)
[ABSENCES_BLESSURES]: Aucun absent majeur
[H2H]: 2 victoires, 1 nul sur les 3 derniers duels
[ENJEU]: Qualification pour les quarts`;
    const covFull = evaluateDataCoverage(fullSheet, 2, 4);
    assert.strictEqual(covFull.matchNotFound, false);
    assert.strictEqual(covFull.completenessPct, 100);
    assert.strictEqual(covFull.reliabilityLabel, 'ELEVEE');
    assert.strictEqual(covFull.maxAllowedConfidence, 9);
    console.log("✅ Test 3 passe : evaluateDataCoverage");

    // Test 4 : Formatage WhatsApp
    const messy = "Je vais maintenant chercher les statistiques.\n### ⚽ *Mali vs Rwanda*\n**Analyse :**\n*   *Point 1*\n---";
    const cleaned = formatForWhatsApp(messy);
    assert.ok(!cleaned.includes('Je vais maintenant chercher'));
    assert.ok(!cleaned.includes('###'));
    assert.ok(!cleaned.includes('**'));
    assert.ok(cleaned.includes('*⚽ Mali vs Rwanda*'));
    assert.ok(cleaned.includes('• *Point 1*'));
    console.log("✅ Test 4 passe : formatForWhatsApp\n");

    console.log("🎉 Tous les tests unitaires ont reussi !");
}

async function runLiveTests() {
    console.log("🌐 Demarrage des tests LIVE (Gemini + Google Search)...\n");
    try {
        const testAntiHallu = await askGemini(
            "test-live-1",
            "Analyse Borussia Dortmund vs Eintracht Francfort ce soir",
            true,
            "Dieudonne"
        );
        console.log("--- TEST LIVE 1 (Anti-hallucination) ---\n" + testAntiHallu + "\n");

        const testRealMatch = await askGemini(
            "test-live-2",
            "Analyse le meilleur match de football de ce soir avec tous tes pronostics",
            true,
            "Dieudonne"
        );
        console.log("--- TEST LIVE 2 (Analyse reelle du jour) ---\n" + testRealMatch + "\n");
        console.log("✅ Tests LIVE termines !");
    } catch (err) {
        console.error("❌ Echec test LIVE:", err.message);
        process.exit(1);
    }
}

// ==========================================
// POINT D'ENTREE
// ==========================================
if (process.argv.includes('--test')) {
    runUnitTests();
} else if (process.argv.includes('--test-live')) {
    runLiveTests();
} else {
    startKeepAliveServer();
    startBot();
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const assert = require('assert');

// ==========================================
// CONFIGURATION OFFICIELLE (INCHANGEE)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const CREATOR_PHONE = "243977332867";
const SELF_URL = "https://gim-sney.onrender.com";

const histories = new Map();
const HISTORY_LIMIT = 10; // 5 echanges complets (user + model)
const botSentIds = new Set(); // Anti-boucle infinie

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

    // Auto-ping toutes les 10 minutes pour empecher Render de dormir
    setInterval(() => {
        fetch(SELF_URL).catch(() => {});
    }, 10 * 60 * 1000);
}

// ==========================================
// UTILITAIRES WHATSAPP & MEDIAS
// ==========================================
function unwrapMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return unwrapMessage(message.viewOnceMessageV2Extension.message);
    return message;
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
            maxAllowedConfidence = 9; // Jamais 10/10 : aucun prono n'est certain
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

async function gatherRealFootballData(question, intent, retries = 1) {
    const { date, heure } = getLubumbashiDateTime();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const researchPrompt = `Tu es un moteur de verification de donnees sportives en temps reel.
Date actuelle : ${date}, heure actuelle : ${heure} a Lubumbashi (UTC+2).
Demande utilisateur (${intent}) : "${question}"

MISSION STRICTE — COLLECTE FACTUELLE UNIQUEMENT (AUCUN PRONOSTIC) :
Utilise Google Search pour verifier et rassembler les faits reels du ou des matchs concernes.
Pour chaque match identifie (max 4 matchs s'il s'agit d'une carte du jour) :
1. Verifie si le match existe reellement a la date demandee (ou apres ${heure} aujourd'hui). Attention aux treves internationales FIFA.
2. Si un match demande n'a pas lieu a cette date (deja joue, reporte ou inexistant), indique clairement : [EXISTENCE]: MATCH NON PREVU (avec la vraie date/statut).
3. Sinon, remplis chaque balise ci-dessous avec des faits reels chiffres. Si une donnee n'est pas trouvee sur le web, ecris exactement DONNEE_INSUFFISANTE :

MATCH : <Equipe A vs Equipe B>
[EXISTENCE]: CONFIRME
[COMPETITION_DATE_HEURE]: <Competition, date exacte, heure a Lubumbashi>
[FORME_5_MATCHS]: <5 derniers matchs + scores des 2 equipes + bilan domicile/exterieur>
[CLASSEMENT_STATS]: <Position au classement, buts marques/encaisses, solidite defensive et efficacite offensive>
[ABSENCES_BLESSURES]: <Joueurs blesses, suspendus ou absents confirmes>
[H2H]: <Confrontations directes recentes pertinentes avec scores>
[ENJEU]: <Motivation, objectif classement/qualification>

Ne redige aucune introduction ni conclusion.`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: researchPrompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 1024 }
        }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const candidate = data.candidates?.[0];
        const queries = candidate?.groundingMetadata?.webSearchQueries || [];
        const sources = candidate?.groundingMetadata?.groundingChunks || [];
        const factSheet = candidate?.content?.parts
            ?.filter(p => !p.thought && typeof p.text === 'string')
            ?.map(p => p.text)
            ?.join("")
            ?.trim() || "";

        const coverage = evaluateDataCoverage(factSheet, queries.length, sources.length);
        console.log(`[MOTEUR FOOT] Intent=${intent} | Requetes=${queries.length} | Sources=${sources.length} | Fiabilite=${coverage.reliabilityLabel} (${coverage.completenessPct}%)`);

        return { factSheet, queries, sources, coverage };
    } catch (err) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 1500));
            return gatherRealFootballData(question, intent, retries - 1);
        }
        console.warn("[MOTEUR FOOT] Fallback recherche directe:", err.message);
        return null;
    }
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
- Reponds en 1 a 3 phrases courtes (ou 3 a 6 phrases si la question demande une explication).
- Utilise Google Search si la question porte sur un fait recent.`
        : `SYSTEME D'ANALYSE ET DE PRONOSTICS FOOTBALLISTIQUES :
1. VERIFICATION AVANT ANALYSE :
   - Si la fiche de donnees indique qu'un match n'existe pas ou n'a pas lieu a cette date, signale-le immediatement avec les vrais faits (ne fais JAMAIS d'analyse sur un match fictif).
   - N'invente JAMAIS de statistique, score, classement ou blessure absents des donnees verifiees. Si une information manque, signale-le clairement.
2. ANALYSE FACTUELLE OBLIGATOIRE (par match) :
   - Synthetise sans blabla : forme des 5 derniers matchs, bilan domicile/exterieur, attaque/defense (buts marques/encaisses), absences/blesses confirmes, H2H et enjeu.
3. MARCHES A PROPOSER POUR CHAQUE MATCH ANALYSE :
   - *Victoire 1X2*
   - *Double Chance*
   - *Plus/Moins de buts* (ex: +1.5 / +2.5 / -3.5)
   - *BTTS* (Les deux equipes marquent : Oui/Non)
   - *Score probable*
   - *Option a risque reduit*
   Justifie chaque choix par les faits reels.
4. FIABILITE & PROBABILITES :
   - Distingue explicitement les *probabilites statistiques observees* (ex: frequence sur les 5 derniers matchs ou H2H) des *estimations qualitatives*.
   - Ne presente JAMAIS un pronostic comme certain.
   - Respecte strictement le plafond de confiance calcule selon les donnees disponibles (ex: *Confiance : 7/10 — Fiabilité : MOYENNE*).
5. FORMAT MULTI-MATCHS / TICKET :
   - Si 4 matchs : presente les 4 analyses directement avec titres courts, chiffres cles et les 6 marches, sans introduction ni repetition.`;

    return `Tu es GIM SNEY, analyste sportif d'elite du groupe WhatsApp "Pronostic du sport".
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date et heure actuelles : ${date}, ${heure} a Lubumbashi (RDC).

${greetingRule}

REGLES REDACTIONNELLES OBLIGATOIRES (STYLE CHATGPT : CONCIS, DIRECT, PRECIS) :
1. REPONSE DIRECTE : Entre directement dans le sujet, sans longue introduction.
2. ZERO SALUTATION REPETEE : Ne repete jamais une salutation.
3. AUCUNE ANNONCE D'ACTION : N'ecris jamais "Je vais verifier...", "Je scanne...", "Je me mets en mode analyse...". Donne directement le resultat.
4. ZERO REMPLISSAGE : Interdiction des formules inutiles ("Excellent Boss", "Accrochez-vous", "Je me lance", "Voici du lourd").
5. PHRASES COURTES : Style clair, structure, naturel. Jamais de "En tant qu'IA...".
6. ZERO REPETITION : Ne repete aucune information deja donnee.

STYLE VISUEL WHATSAPP :
- Titres courts et nets.
- Paragraphes aeres et listes claires.
- Emojis moderes (⚽, 🎯, 📊, 🎟️, 🟢, 🟡, 🔴).
- Mets les elements cles en gras WhatsApp avec un seul asterisque (*Equipe A vs Equipe B*, *1X2*, *Confiance*).

${footballRules}`;
}

async function askGemini(senderJid, question, isCreator, senderName, media = null, retries = 2) {
    const history = histories.get(senderJid) || [];
    const isFollowUp = history.length > 0;
    const intent = classifySportsIntent(question, media);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // Passe 1 : Collecte factuelle temps reel pour les demandes d'analyse/pronostic texte
    let researchBundle = null;
    if (intent === 'MATCH_ANALYSIS' || intent === 'DAILY_ANALYSIS') {
        researchBundle = await gatherRealFootballData(question, intent);
    }

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

    let enrichedPrompt = `[Message de ${isCreator ? 'Boss Dieudonne' : senderName}] : ${promptText}`;
    if (researchBundle?.factSheet) {
        const { coverage, factSheet } = researchBundle;
        enrichedPrompt += `\n\n[DONNEES VERIFIEES EN TEMPS REEL — NE RIEN INVENTER AU-DELA]\n` +
            `Fiabilite des donnees : ${coverage.reliabilityLabel} (${coverage.completenessPct}% des criteres verifies, ${coverage.sourcesCount} sources web).\n` +
            `Plafond maximal de confiance autorise : ${coverage.maxAllowedConfidence}/10.\n` +
            (coverage.missingFields.length ? `Donnees manquantes a signaler si pertinent : ${coverage.missingFields.join(', ')}.\n` : '') +
            `\nFICHE FACTUELLE :\n${factSheet}`;
    }

    currentParts.push({ text: enrichedPrompt });

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName, isFollowUp, intent) }] },
        contents: [
            ...history,
            { role: "user", parts: currentParts }
        ],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 1024 }
        }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const candidate = data.candidates?.[0];
        const queries = candidate?.groundingMetadata?.webSearchQueries;
        if (queries?.length) {
            console.log(`[SEARCH] Requetes Google (Passe 2):`, queries);
        }

        const answer = candidate?.content?.parts
            ?.filter(p => !p.thought && typeof p.text === 'string')
            ?.map(p => p.text)
            ?.join("")
            ?.trim();

        if (!answer) throw new Error(`Reponse vide (finishReason: ${candidate?.finishReason || 'inconnu'}).`);

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
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(senderJid, question, isCreator, senderName, media, retries - 1);
        }
        throw err;
    }
}

// ==========================================
// BOT WHATSAPP BAILEYS (INCHANGE)
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
                console.log('🎉 GIM SNEY PRO EST 100% ACTIF SUR WHATSAPP !');
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

                const lower = text.toLowerCase();

                if (lower === '!reset' || lower === 'gimsney reset') {
                    histories.delete(sender);
                    await sendTracked(sock, sender, { text: "🧹 Memoire nettoyee ! On repart sur de nouvelles bases propres. ⚽" }, { quoted: msg });
                    continue;
                }

                const isCommandTrigger =
                    lower.startsWith('!gim') ||
                    lower.startsWith('!prono') ||
                    lower.startsWith('pronostic') ||
                    lower.startsWith('/predict') ||
                    lower.includes('gimsney') ||
                    lower === 'football';

                const isPrivateMedia = !isGroup && Boolean(img || audioMsg);
                const isTrigger = isCommandTrigger || isReplyToBot || isPrivateMedia;

                if (!isTrigger) continue;

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
                    console.log("✅ Reponse envoyee avec succes !");
                } catch (err) {
                    console.error("Erreur:", err.message);
                    await sendTracked(sock, sender, {
                        text: `⚠️ Les gars, petite saturation sur mes donnees en direct, reposez votre question dans quelques secondes !`
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

    // Test 1 : Classification des intentions
    assert.strictEqual(classifySportsIntent("Qui a gagne la CAN 2023 ?"), 'SIMPLE_QUERY');
    assert.strictEqual(classifySportsIntent("Analyse Serbie vs Allemagne"), 'MATCH_ANALYSIS');
    assert.strictEqual(classifySportsIntent("Donne moi 4 matchs du jour avec pronostic"), 'DAILY_ANALYSIS');
    assert.strictEqual(classifySportsIntent("", { kind: 'image', mimeType: 'image/jpeg', data: 'abc' }), 'TICKET_AUDIT');
    assert.strictEqual(classifySportsIntent("", { kind: 'audio', mimeType: 'audio/ogg', data: 'abc' }), 'AUDIO_MIXED');
    console.log("✅ Test 1 passe : classifySportsIntent");

    // Test 2 : Couverture complete -> confiance elevee (jamais 10/10)
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
    console.log("✅ Test 2 passe : evaluateDataCoverage (donnees completes)");

    // Test 3 : Donnees insuffisantes -> plafond abaisse automatiquement
    const weakSheet = `
[EXISTENCE]: CONFIRME
[COMPETITION_DATE_HEURE]: Match amical ce soir
[FORME_5_MATCHS]: DONNEE_INSUFFISANTE
[CLASSEMENT_STATS]: DONNEE_INSUFFISANTE
[ABSENCES_BLESSURES]: DONNEE_INSUFFISANTE
[H2H]: 1-1 en 2024
[ENJEU]: Match amical`;
    const covWeak = evaluateDataCoverage(weakSheet, 1, 1);
    assert.strictEqual(covWeak.completenessPct, 50);
    assert.strictEqual(covWeak.reliabilityLabel, 'INSUFFISANTE');
    assert.ok(covWeak.maxAllowedConfidence <= 5);
    assert.strictEqual(covWeak.missingFields.length, 3);
    console.log("✅ Test 3 passe : evaluateDataCoverage (donnees insuffisantes)");

    // Test 4 : Match inexistant -> blocage analyse
    const missingMatch = `[EXISTENCE]: MATCH NON PREVU AUJOURD'HUI`;
    const covMissing = evaluateDataCoverage(missingMatch, 1, 2);
    assert.strictEqual(covMissing.matchNotFound, true);
    assert.strictEqual(covMissing.maxAllowedConfidence, 0);
    console.log("✅ Test 4 passe : Detection match inexistant");

    // Test 5 : Verification du prompt systeme
    const pFollow = getSystemPrompt(true, "Dieudonne", true, 'MATCH_ANALYSIS');
    assert.ok(pFollow.includes("Ne salue PAS a nouveau"));
    assert.ok(pFollow.includes("Double Chance") && pFollow.includes("BTTS") && pFollow.includes("Score probable"));
    console.log("✅ Test 5 passe : Regles redactionnelles et 6 marches presents\n");

    console.log("🎉 Tous les tests unitaires ont reussi !");
}

async function runLiveTests() {
    console.log("🌐 Demarrage des tests LIVE (Gemini + Google Search)...\n");
    try {
        // Test Live 1 : Anti-hallucination (match non prevu aujourd'hui)
        const testAntiHallu = await askGemini(
            "test-live-1",
            "Analyse Borussia Dortmund vs Eintracht Francfort ce soir",
            true,
            "Dieudonne"
        );
        console.log("--- TEST LIVE 1 (Anti-hallucination) ---\n" + testAntiHallu + "\n");

        // Test Live 2 : Analyse reelle d'un match du jour avec 6 marches
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

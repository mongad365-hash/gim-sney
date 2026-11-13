const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const CREATOR_PHONE = "243977332867";
const SELF_URL = "https://gim-sney.onrender.com";

const histories = new Map();
const HISTORY_LIMIT = 10; // 5 echanges complets (user + model)
const botSentIds = new Set(); // Anti-boucle infinie

// Serveur Web Render & Anti-sommeil 24h/24
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

process.on('uncaughtException', (err) => console.error('[ERREUR]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE]:', err.message));

// Deballe proprement les messages ephemeres / vue unique
function unwrapMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return unwrapMessage(message.viewOnceMessageV2Extension.message);
    return message;
}

// Telechargement securise des medias (images / vocaux)
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

// Envoi avec suivi d'ID pour eviter que le bot ne se reponde a lui-meme
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

function getSystemPrompt(isCreator, senderName, isFollowUp = false) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Africa/Lubumbashi'
    });
    const heure = now.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Lubumbashi'
    });

    let greetingRule;
    if (isFollowUp) {
        greetingRule = `SUITE DE CONVERSATION : Ne salue PAS a nouveau. Reponds directement sans aucune formule d'accueil.`;
    } else if (isCreator) {
        greetingRule = `INTERLOCUTEUR : Ton Createur ILUNGA MONGA DIEUDONNE. Salue en une phrase ultra-courte maximum (ex: "Bonjour Créateur ! 🫡 Voici...") puis donne immediatement la reponse.`;
    } else {
        greetingRule = `INTERLOCUTEUR : ${senderName || 'Membre du groupe'}. Salue en quelques mots maximum (ex: "Salut ${senderName || 'frérot'} ! Voici...") puis donne immediatement la reponse.`;
    }

    return `Tu es GIM SNEY, analyste sportif d'elite du groupe WhatsApp "Pronostic du sport".
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date et heure actuelles : ${date}, ${heure} a Lubumbashi (RDC).

${greetingRule}

REGLE N°0 — VERIFICATION TEMPS REEL (ZERO HALLUCINATION) :
- Utilise Google Search systematiquement avant de citer un match du jour, classement, composition, blessure ou cote.
- N'invente JAMAIS de match de memoire. Verifie la date (${date}) et l'heure (${heure}) pour ne proposer que des matchs reels non termines (attention aux treves internationales FIFA).
- Si une information fiable est introuvable, dis-le simplement sans inventer.

REGLES REDACTIONNELLES OBLIGATOIRES (STYLE CHATGPT : CONCIS, DIRECT, PRECIS) :
1. REPONSE DIRECTE : Entre directement dans le sujet, sans longue introduction ni mise en scene.
2. ZERO SALUTATION REPETEE : Ne repete jamais une salutation dans la meme reponse ni dans les echanges suivants.
3. AUCUNE ANNONCE D'ACTION : N'annonce jamais ce que tu vas faire ("Je vais verifier...", "Je scanne le calendrier...", "Je me mets en mode analyse..."). Donne directement le resultat final.
4. ZERO REMPLISSAGE : Interdiction stricte des formules inutiles ("Excellent Boss", "Accrochez-vous", "Je me lance", "Je reviens vers vous", "C'est parti", "Voici du lourd").
5. PHRASES COURTES : Style clair, naturel, dense et precis. Jamais de "En tant qu'IA...".
6. ZERO REPETITION : Ne repete jamais une information ou une statistique deja donnee.
7. LONGUEUR ADAPTEE A LA QUESTION :
   - Question simple : 1 a 3 phrases.
   - Question normale : 3 a 6 phrases.
   - Analyse complexe : reponse detaillee, structuree et sans remplissage.
   - Analyse de 4 matchs : presente les 4 analyses directement avec titres courts, statistiques cles et pronostics fermes, sans introduction inutile ni repetition.

STYLE VISUEL WHATSAPP :
- Titres courts et nets.
- Paragraphes aeres et listes claires (ou tableau compact si pertinent).
- Emojis moderes (⚽, 🎯, 📊, 🎟️, 🟢, 🔴).
- Informations importantes en gras WhatsApp avec un seul asterisque (*Equipe A vs Equipe B*, *Pronostic*, *Confiance : 8/10*).

EXPERTISE FOOT & BETPAWA :
- Pronostic : appuie-toi sur les vraies donnees (forme recente, absents, enjeu, domicile/exterieur), donne un *choix principal ferme*, une *option Safe* (Double Chance, +1.5 buts) et un *indice de confiance /10*.
- Ticket Betpawa / capture : identifie les matchs, pointe les matchs pieges selon l'actualite du jour et donne un verdict tranche (valider, modifier ou remplacer).
- Note vocale : ecoute et reponds directement a la demande.
- Tranche toujours sans longs avertissements moraux.`;
}

async function askGemini(senderJid, question, isCreator, senderName, media = null, retries = 2) {
    const history = histories.get(senderJid) || [];
    const isFollowUp = history.length > 0;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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
            : "Analyse en detail ce ticket Betpawa ou cette capture d'ecran."
    );

    const taggedPrompt = `[Message de ${isCreator ? 'Boss Dieudonne' : senderName}] : ${promptText}`;
    currentParts.push({ text: taggedPrompt });

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName, isFollowUp) }] },
        contents: [
            ...history,
            { role: "user", parts: currentParts }
        ],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            thinkingConfig: {
                thinkingBudget: 1024
            }
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
            console.log(`[SEARCH] Requetes Google effectuees:`, queries);
        } else {
            console.log(`[SEARCH] Aucune requete Google declenchee pour: "${promptText.slice(0, 60)}"`);
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
            : taggedPrompt;

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

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        // Code WhatsApp si besoin
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

                // Detection image et audio (directs ou cites)
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

                // Commande de reinitialisation memoire
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

                // Telechargement media (priorite image, sinon audio)
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
                    question = "Cherche les vrais matchs d'aujourd'hui et propose un beau ticket avec cotes, analyse et pronostics fermes.";
                }

                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const reply = await askGemini(sender, question, isCreator, senderName, media);
                    await sendTracked(sock, sender, { text: reply }, { quoted: msg });
                    console.log("✅ Reponse envoyee avec succes !");
                } catch (err) {
                    console.error("Erreur:", err.message);
                    await sendTracked(sock, sender, {
                        text: `⚠️ Les gars, j'analyse les cotes en direct sur Betpawa, reposez votre question dans quelques secondes !`
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

startBot();

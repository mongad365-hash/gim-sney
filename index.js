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

function getSystemPrompt(isCreator, senderName) {
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

    const greetingRule = isCreator
        ? `L'interlocuteur est TON UNIQUE CREATEUR ET PATRON : l'ingenieux ILUNGA MONGA DIEUDONNE en personne. Salue-le avec deferente et respect de Boss (ex: "Salut mon Createur et Boss Dieudonne ! 🫡👑").`
        : `L'interlocuteur est un membre du groupe (${senderName || 'l\'ami'}). Salue-le comme un frere de foot ("Salut la famille", "Salut frerot").`;

    return `Tu es GIM SNEY, le pronostiqueur star et le cerveau du groupe WhatsApp "Pronostic du sport".
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date et heure actuelles : ${date}, il est ${heure} a Lubumbashi, RDC.

${greetingRule}

REGLE D'OR N°0 — VERIFICATION TEMPS REEL OBLIGATOIRE (ZERO HALLUCINATION) :
- Tu as acces a l'outil Google Search. UTILISE-LE SYSTEMATIQUEMENT avant de proposer, citer ou analyser N'IMPORTE QUEL match du jour, classement, composition, blessure ou cote !
- N'INVENTE JAMAIS un match de memoire ! Verifie toujours la date exacte (${date}) et l'heure actuelle (${heure} a Lubumbashi) pour ne proposer que des matchs reels qui ne sont pas encore termines.
- Attention aux treves internationales FIFA : s'il n'y a pas de championnats (Bundesliga, Premier League, Ligue 1, etc.) aujourd'hui, cherche les vrais matchs du jour (Ligue des Nations, eliminatoires Mondial/CAN, matchs amicaux, etc.).
- Si meme apres recherche tu ne trouves pas d'information fiable sur un match, dis-le honnetement au lieu d'inventer.

REGLES D'OR DE COMPORTEMENT :
1. PARLE COMME UN HUMAIN PASSIONNE DE FOOT : Pas de "En tant qu'IA..." ou "Selon mes algorithmes...". Sois direct, chaleureux et complice.
2. FORMAT EN PARAGRAPHES COURTS : Aere bien ton texte avec des sauts de ligne. Utilise des emojis (⚽, 🎟️, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🟡, 🔴).
3. ANALYSE PRO DES MATCHS :
   - Appuie-toi sur les vraies infos trouvees sur Google : forme recente, absents/blesses majeurs, enjeu et stats domicile/exterieur.
   - Donne toujours : le choix principal ferme, une option "Securite / Safe" (ex: Double Chance, +1.5 buts) et un indice de confiance sur 10 (ex: Confiance : 8/10 🎯).
4. ANALYSE DES CAPTURES ET TICKETS BETPAWA :
   - Tu peux voir et lire les images et captures d'ecran !
   - Si on te montre un ticket ou des cotes, lis chaque equipe, repere les matchs pieges et donne ton avis franc (valider, modifier ou remplacer).
5. NOTES VOCALES :
   - Si on t'envoie un vocal, ecoute-le attentivement et reponds directement a la demande.
6. DECISION FERME : Prends toi-meme la decision, donne ton pronostic ferme sans longs avertissements de morale.`;
}

async function askGemini(senderJid, question, isCreator, senderName, media = null, retries = 2) {
    const history = histories.get(senderJid) || [];
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
            : "Analyse en detail cette capture d'ecran ou ce ticket Betpawa."
    );

    const taggedPrompt = `[Message de ${isCreator ? 'Boss Dieudonne' : senderName}] : ${promptText}`;
    currentParts.push({ text: taggedPrompt });

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName) }] },
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

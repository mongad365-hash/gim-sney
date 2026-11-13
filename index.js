const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";
const SELF_URL = "https://gim-sney.onrender.com";

let botStatus = "Actif avec Vision Multimodale";
const histories = new Map();
const HISTORY_LIMIT = 4;

// Serveur Web Render & Anti-sommeil
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GIM SNEY IA Vision est en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT);

setInterval(() => {
    fetch(SELF_URL).catch(() => {});
}, 10 * 60 * 1000);

process.on('uncaughtException', (err) => console.error('[ERREUR]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE]:', err.message));

// Fonction pour télécharger l'image depuis WhatsApp
async function getMediaBuffer(mediaMsg, type = 'image') {
    const stream = await downloadContentFromMessage(mediaMsg, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

function getSystemPrompt(isCreator, senderName) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });

    let greetingRule = isCreator
        ? `L'interlocuteur est TON UNIQUE CRÉATEUR ET PATRON : le grand ILUNGA MONGA DIEUDONNÉ en personne. Salue-le avec déférence et respect de Boss (ex: "Salut mon Créateur et Boss Dieudonné ! 🫡👑").`
        : `L'interlocuteur est un membre du groupe nommé ${senderName || 'l\'ami'}. Parle-lui comme un frère de football ("Salut la famille", "Salut frérot"), chaleureux et complice.`;

    return `Tu es GIM SNEY, le pronostiqueur star et le cerveau d'élite du groupe WhatsApp "Pronostic du sport".
Créateur officiel : l'ingénieux ILUNGA MONGA DIEUDONNÉ (mongad365@gmail.com).
Date : ${date} à Lubumbashi, RDC.

${greetingRule}

SUPER-POUVOIR DE VISION :
- TU VOIS PARFAITEMENT LES IMAGES ET CAPTURES D'ÉCRAN !
- Ne dis JAMAIS "je suis une IA textuelle" ou "je ne peux pas voir les images". Tu as des yeux ultra-puissants grâce à Gemini 2.5 Flash !
- Si on t'envoie une capture d'écran d'un ticket Betpawa, d'un match ou d'une composition d'équipe : lis les équipes, les cotes, repère les pièges et donne ton avis franc et direct en paragraphes clairs.

RÈGLES DE STYLE :
1. Parle comme un être humain passionné et expert, jamais comme un robot.
2. Fais des paragraphes courts, bien aérés et percutants avec émojis (⚽, 🎟️, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴).
3. Prends des décisions fermes sur les pronostics et les tickets Betpawa.`;
}

async function askGemini(senderJid, question, isCreator, senderName, base64Image = null, retries = 2) {
    const history = histories.get(senderJid) || [];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const currentParts = [];
    if (base64Image) {
        currentParts.push({
            inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
            }
        });
    }
    currentParts.push({ text: question || "Analyse en détail cette capture d'écran de match ou ce ticket Betpawa." });

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName) }] },
        contents: [
            ...history,
            { role: "user", parts: currentParts }
        ],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 850
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

        const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
        if (!answer) throw new Error("Réponse vide de l'IA.");

        // Enregistre sans l'image lourde pour ne pas saturer la mémoire
        history.push(
            { role: "user", parts: [{ text: base64Image ? `[Capture d'écran analysée] : ${question}` : question }] },
            { role: "model", parts: [{ text: answer }] }
        );
        histories.set(senderJid, history.slice(-HISTORY_LIMIT));

        return answer;
    } catch (err) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(senderJid, question, isCreator, senderName, base64Image, retries - 1);
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

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log('🎉 GIM SNEY AVEC VISION EST EN LIGNE !');
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
            const msg = messages[0];
            if (!msg?.message) return;

            const sender = msg.key.remoteJid;
            const participant = msg.key.participant || "";
            const isFromMe = Boolean(msg.key.fromMe);
            const senderName = msg.pushName || "Frérot";

            const isCreator = (!sender.endsWith('@g.us') && isFromMe) || 
                              participant.includes(CREATOR_PHONE) || 
                              (isFromMe && participant.includes(CREATOR_PHONE));

            // Détection des images (directe ou citée)
            const img = msg.message?.imageMessage || 
                        msg.message?.ephemeralMessage?.message?.imageMessage || 
                        msg.message?.viewOnceMessage?.message?.imageMessage || 
                        msg.message?.viewOnceMessageV2?.message?.imageMessage;

            const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

            let base64Image = null;
            if (img) {
                try {
                    const buf = await getMediaBuffer(img, 'image');
                    base64Image = buf.toString('base64');
                } catch (e) {
                    console.error("Erreur téléchargement image:", e.message);
                }
            } else if (quotedImg) {
                try {
                    const buf = await getMediaBuffer(quotedImg, 'image');
                    base64Image = buf.toString('base64');
                } catch (e) {
                    console.error("Erreur téléchargement image citée:", e.message);
                }
            }

            const caption = img?.caption || "";
            const text = (
                msg.message.conversation || 
                msg.message.extendedTextMessage?.text || 
                caption || 
                ""
            ).trim();

            const lower = text.toLowerCase();

            const isTrigger = lower.startsWith('!gim') || 
                              lower.startsWith('!prono') || 
                              lower.startsWith('pronostic') || 
                              lower.startsWith('/predict') || 
                              lower.startsWith('gimsney') || 
                              lower.includes('gimsney') ||
                              lower === 'football' ||
                              Boolean(base64Image && !sender.endsWith('@g.us')); // En privé, toute image déclenche l'IA

            if (!isTrigger) return;

            let question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim();
            if (!question && base64Image) {
                question = "Analyse cette capture d'écran, ce match ou ce ticket Betpawa et donne ton avis d'expert.";
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                const reply = await askGemini(sender, question, isCreator, senderName, base64Image);
                await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                console.log("✅ Analyse (avec Vision) envoyée !");
            } catch (err) {
                console.error("Erreur:", err.message);
                await sock.sendMessage(sender, { text: `⚠️ Les gars, j'analyse les cotes en direct, reposez votre question dans 5 secondes !` }, { quoted: msg });
            } finally {
                await sock.sendPresenceUpdate('paused', sender);
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";
const SELF_URL = "https://gim-sney.onrender.com";

const histories = new Map();
const HISTORY_LIMIT = 4;

// Serveur Web Render & Anti-sommeil 24h/24
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GIM SNEY IA est 100% active et en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT, () => {
    console.log(`[HTTP] Serveur actif sur le port ${PORT}`);
});

// Auto-ping toutes les 10 minutes pour empecher Render de dormir
setInterval(() => {
    fetch(SELF_URL).catch(() => {});
}, 10 * 60 * 1000);

process.on('uncaughtException', (err) => console.error('[ERREUR]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE]:', err.message));

// Telechargement securise des images (tickets / captures)
async function getMediaBuffer(mediaMsg, type = 'image') {
    try {
        const stream = await downloadContentFromMessage(mediaMsg, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (e) {
        console.error("Erreur telechargement image:", e.message);
        return null;
    }
}

function getSystemPrompt(isCreator, senderName) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });

    let greetingRule = isCreator
        ? `L'interlocuteur est TON UNIQUE CREATEUR ET PATRON : l'ingenieux ILUNGA MONGA DIEUDONNE en personne. Salue-le avec deferente et respect de Boss (ex: "Salut mon Createur et Boss Dieudonne ! 🫡👑").`
        : `L'interlocuteur est un membre du groupe (${senderName || 'l\'ami'}). Salue-le comme un frere de foot ("Salut la famille", "Salut frerot").`;

    return `Tu es GIM SNEY, le pronostiqueur star et le cerveau du groupe WhatsApp "Pronostic du sport".
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date : ${date} a Lubumbashi, RDC.

${greetingRule}

REGLES D'OR DE COMPORTEMENT :
1. PARLE COMME UN HUMAIN PASSIONNE DE FOOT : Pas de "En tant qu'IA..." ou "Selon mes algorithmes...". Sois direct, chaleureux et complice.
2. FORMAT EN PARAGRAPHES COURTS : Aere bien ton texte avec des sauts de ligne. Utilise des emojis (⚽, 🎟️, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴).
3. ANALYSE DES CAPTURES ET TICKETS BETPAWA :
   - Tu peux voir et lire les images et captures d'ecran !
   - Si on te montre un ticket ou des cotes, lis les equipes, repere les matchs risques et donne ton avis franc en quelques paragraphes.
4. DECISION FERME : Prends toi-meme la decision, donne ton pronostic ferme sans longs avertissements de morale.`;
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
    currentParts.push({ text: question || "Analyse en detail cette capture d'ecran ou ce ticket Betpawa." });

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
        if (!answer) throw new Error("Reponse vide.");

        history.push(
            { role: "user", parts: [{ text: base64Image ? `[Image ticket analysee] : ${question}` : question }] },
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
                console.log('🎉 GIM SNEY EST 100% ACTIF SUR WHATSAPP !');
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
            const senderName = msg.pushName || "Frerot";

            const isCreator = (!sender.endsWith('@g.us') && isFromMe) || 
                              participant.includes(CREATOR_PHONE) || 
                              (isFromMe && participant.includes(CREATOR_PHONE));

            // Detection securisee d'image
            const img = msg.message?.imageMessage || 
                        msg.message?.ephemeralMessage?.message?.imageMessage || 
                        msg.message?.viewOnceMessage?.message?.imageMessage || 
                        msg.message?.viewOnceMessageV2?.message?.imageMessage;

            const quotedImg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

            let base64Image = null;
            if (img) {
                const buf = await getMediaBuffer(img, 'image');
                if (buf) base64Image = buf.toString('base64');
            } else if (quotedImg) {
                const buf = await getMediaBuffer(quotedImg, 'image');
                if (buf) base64Image = buf.toString('base64');
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
                              Boolean(base64Image && !sender.endsWith('@g.us')); // En prive avec image, declenche toujours

            // Evite la boucle si le bot s'envoie un message sans commande
            if (isFromMe && !isTrigger) return;
            if (!isTrigger) return;

            let question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim();
            if (!question && base64Image) {
                question = "Analyse en detail ce ticket Betpawa ou cette capture d'ecran et donne ton avis d'expert.";
            } else if (!question) {
                question = "Propose un beau ticket pour aujourd'hui avec cotes et pronostics fermes.";
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                const reply = await askGemini(sender, question, isCreator, senderName, base64Image);
                await sock.sendMessage(sender, { text: reply }, { quoted: msg });
                console.log("✅ Reponse envoyee avec succes !");
            } catch (err) {
                console.error("Erreur:", err.message);
                await sock.sendMessage(sender, { text: `⚠️ Les gars, j'analyse les cotes en direct sur Betpawa, reposez votre question dans quelques secondes !` }, { quoted: msg });
            } finally {
                await sock.sendPresenceUpdate('paused', sender);
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

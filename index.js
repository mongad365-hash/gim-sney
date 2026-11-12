const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";

let botStatus = "Actif";
const histories = new Map();
const HISTORY_LIMIT = 6;

// Serveur Web Render
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GIM SNEY IA est en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT);

process.on('uncaughtException', (err) => console.error('[ERREUR]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE]:', err.message));

function getSystemPrompt(isCreator, senderName) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });

    let userRole = isCreator
        ? `L'interlocuteur est TON CREATEUR ET BOSS : ILUNGA MONGA DIEUDONNE. Salue-le avec respect de Patron (ex: "A vos ordres mon Createur et Boss Dieudonne ! 🫡👑").`
        : `L'interlocuteur est un membre du groupe (${senderName || 'Membre'}). Sois dynamique, expert et rappelle brievement que tu as ete cree par l'ingenieux ILUNGA MONGA DIEUDONNE.`;

    return `Tu es GIM SNEY, la plus grande intelligence artificielle d'analyse sportive et de pronostics pour Betpawa RDC.
Createur officiel : ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).
Date : ${date}.

${userRole}

CONSIGNE CAPITALE ET OBLIGATOIRE :
- NE POSE JAMAIS DE QUESTIONS INUTILES !
- NE DEMANDE PAS LA DATE NI LE CHAMPIONNAT !
- Des qu'on te cite un sport, une equipe ou deux equipes (ex: "Football", "France vs Italie", "Real Madrid vs Barca"), FAIS DIRECTEMENT L'ANALYSE COMPLETE ET DONNE UN PRONOSTIC FERME SANS HESITER !
- Si c'est un match recent, analyse la derniere confrontation directe et la forme actuelle.
- Donne des pourcentages clairs (ex: 60% Victoire, 25% Nul) et une option Betpawa conseillee.
- Utilise des emojis sportifs : ⚽, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴.`;
}

async function askGemini(senderJid, question, isCreator, senderName, retries = 2) {
    const history = histories.get(senderJid) || [];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator, senderName) }] },
        contents: [
            ...history,
            { role: "user", parts: [{ text: question }] }
        ],
        tools: [{ google_search: {} }]
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
            { role: "user", parts: [{ text: question }] },
            { role: "model", parts: [{ text: answer }] }
        );
        histories.set(senderJid, history.slice(-HISTORY_LIMIT));

        return answer;
    } catch (err) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return askGemini(senderJid, question, isCreator, senderName, retries - 1);
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
            const senderName = msg.pushName || "Membre";

            // Seul Dieudonne a le statut de Boss Createur
            const isCreator = (!sender.endsWith('@g.us') && isFromMe) || 
                              participant.includes(CREATOR_PHONE) || 
                              (isFromMe && participant.includes(CREATOR_PHONE));

            const text = (
                msg.message.conversation || 
                msg.message.extendedTextMessage?.text || 
                msg.message.imageMessage?.caption || ""
            ).trim();

            const lower = text.toLowerCase();

            const isTrigger = lower.startsWith('!gim') || 
                              lower.startsWith('!prono') || 
                              lower.startsWith('pronostic') || 
                              lower.startsWith('/predict') || 
                              lower.startsWith('gimsney') || 
                              lower === 'football';

            if (!isTrigger) return;

            let question = text.replace(/^(!gim|!prono|\/predict|pronostic|gimsney)\s*/i, '').trim();
            if (!question || lower === 'football') {
                question = "Donne directement les 3 meilleurs pronostics football d'aujourd'hui pour Betpawa avec pourcentages et cotes sans poser de questions.";
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                const reply = await askGemini(sender, question, isCreator, senderName);
                await sock.sendMessage(sender, { text: reply }, { quoted: msg });
            } catch (err) {
                console.error("Erreur:", err.message);
                await sock.sendMessage(sender, { text: `⚠️ *GIM SNEY :* L'IA analyse un gros volume de matchs, relance ta question dans 5 secondes.` }, { quoted: msg });
            } finally {
                await sock.sendPresenceUpdate('paused', sender);
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

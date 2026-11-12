const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";

let botStatus = "Actif";
const histories = new Map();
const HISTORY_LIMIT = 4;

// Serveur Web Render 24h/24
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

    let bossGreeting = isCreator
        ? `L'interlocuteur est TON UNIQUE CREATEUR ET BOSS : ILUNGA MONGA DIEUDONNE. Salue-le en UNE SEULE COURTE LIGNE au debut : "A vos ordres Boss Dieudonne ! 🫡👑".`
        : `L'interlocuteur est un membre du groupe (${senderName || 'Membre'}). Salue-le brievement et rappelle que tu as ete cree par ILUNGA MONGA DIEUDONNE.`;

    return `Tu es GIM SNEY, la plus grande IA de pronostics sportifs pour Betpawa RDC.
Createur : ILUNGA MONGA DIEUDONNE.
Date : ${date}.

${bossGreeting}

CONSIGNES STRICTES DE STYLE (TRES IMPORTANT) :
1. SOIS COURT, DIRECT ET SANS BLA-BLA ! Maximum 2 petits paragraphes. Pas de longs discours.
2. PRENDS TOI-MEME LA DECISION ! Ne donne pas de lecons de morale ni de conseils de gestion d'argent. Tranche comme un expert autonome.
3. NE POSE AUCUNE QUESTION. Analyse directement.

FORMAT OBLIGATOIRE DE TES REPONSES :
⚽ *[NOM DU MATCH / SPORT]*

📊 *Analyse tactique :* (2 phrases simples et percutantes sur les forces en presence).

🎯 *DECISION GIM SNEY :*
• *Mon choix ferme :* [Victoire Equipe / Nul / etc.]
• *Score exact estime :* [ex: 2 - 1]
• *Indice de confiance :* [ex: 75% 🟢]
• *Option Betpawa :* [ex: Plus de 1.5 buts ou Double Chance]`;
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
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 600 // Limite la taille pour interdire les longs romans
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
                console.log('🎉 GIM SNEY EST PRET !');
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
                question = "Donne ton pronostic ferme et ton score estime pour le grand match de football d'aujourd'hui sans bavardage.";
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                const reply = await askGemini(sender, question, isCreator, senderName);
                await sock.sendMessage(sender, { text: reply }, { quoted: msg });
            } catch (err) {
                console.error("Erreur:", err.message);
                await sock.sendMessage(sender, { text: `⚠️ *GIM SNEY :* Analyse en cours, repose ta question dans 5 secondes.` }, { quoted: msg });
            } finally {
                await sock.sendPresenceUpdate('paused', sender);
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

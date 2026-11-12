const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// ==========================================
// CONFIGURATION OFFICIELLE GIM SNEY
// ==========================================
const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = (process.env.PHONE_NUMBER || "243977332867").replace(/\D/g, "");
const SELF_URL = "https://gim-sney.onrender.com";

let botStatus = "Demarrage du serveur...";
let currentPairingCode = "";
const histories = new Map();
const HISTORY_LIMIT = 10;

// ==========================================
// 1. SERVEUR WEB & SYSTÈME ANTI-SOMMEIL
// ==========================================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>GIM SNEY IA - Statut</title>
            <style>
                body { font-family: -apple-system, sans-serif; text-align: center; padding: 25px; background: #0b0f19; color: #fff; }
                .card { background: #131b2e; border: 2px solid #00ff88; border-radius: 12px; padding: 20px; max-width: 440px; margin: 20px auto; }
                .code-box { font-size: 34px; font-weight: bold; color: #00ff88; letter-spacing: 4px; background: #1e293b; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .badge { display: inline-block; padding: 5px 12px; border-radius: 14px; font-size: 13px; font-weight: bold; background: #1e293b; color: #38bdf8; }
                .btn { display: inline-block; background: #00ff88; color: #000; font-weight: bold; padding: 10px 18px; border-radius: 8px; text-decoration: none; margin-top: 10px; }
            </style>
        </head>
        <body>
            <h1>⚽ GIM SNEY | IA SPORTIVE</h1>
            <p>Superviseur Cloud • Créateur : <strong>ILUNGA MONGA DIEUDONNÉ</strong></p>
            <div class="card">
                <span class="badge">Statut en direct</span>
                <p style="font-size: 17px; margin-top: 10px;">${botStatus}</p>
                ${currentPairingCode ? `
                    <p style="margin-top: 15px; color: #f8fafc;">👉 Tape vite ce code dans WhatsApp :</p>
                    <div class="code-box">${currentPairingCode}</div>
                    <p style="font-size: 12px; color: #94a3b8;">WhatsApp > 3 points > Appareils connectés > Connecter un appareil > Lier avec un numéro</p>
                ` : ''}
            </div>
            <p><a href="/" class="btn" onclick="location.reload(); return false;">🔄 Actualiser</a></p>
        </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`[HTTP] Serveur actif sur le port ${PORT}`);
});

// Auto-réveil : Envoie un ping toutes les 10 minutes pour empêcher Render de dormir
setInterval(() => {
    fetch(SELF_URL).catch(() => {});
}, 10 * 60 * 1000);

process.on('uncaughtException', (err) => console.error('[ERREUR INTERCEPTÉE]:', err.message));
process.on('unhandledRejection', (err) => console.error('[PROMESSE REJETÉE]:', err.message));

// ==========================================
// 2. PROMPT SYSTÈME & IDENTITÉ
// ==========================================
function getSystemPrompt(isCreator) {
    const now = new Date();
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lubumbashi' });
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lubumbashi' });

    let creatorContext = isCreator
        ? `⭐ RÈGLE SPÉCIALE : Tu t'adresses directement à TON UNIQUE CRÉATEUR ET PATRON : l'ingénieux ILUNGA MONGA DIEUDONNÉ en personne. Salue-le avec déférence et grand respect de Boss (ex: "À vos ordres mon Créateur et Boss Dieudonné ! 🫡👑"), puis réponds avec excellence à sa demande.`
        : `Tu t'adresses à un membre du groupe. Sois poli, dynamique et rappelle que tu as été conçu par ILUNGA MONGA DIEUDONNÉ (mongad365@gmail.com).`;

    return `Tu es GIM SNEY, une intelligence artificielle multimodale d'élite, experte en analyse sportive, tactique et pronostics probabilistes pour Betpawa RDC.
Créateur unique : ILUNGA MONGA DIEUDONNÉ.
Date actuelle : ${date} à ${time}.

${creatorContext}

RÈGLES WHATSAPP :
- Fais des réponses percutantes, bien structurées avec des puces.
- Entoure les titres importants d'astérisques pour les mettre en gras (ex: *ANALYSE TACTIQUE :*).
- Utilise des émojis sportifs : ⚽, 🏀, 🎾, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴.
- Donne des pronostics clairs avec pourcentages et conseils fiables pour Betpawa RDC.`;
}

// ==========================================
// 3. APPEL GOOGLE GEMINI AVEC RECHERCHE WEB
// ==========================================
async function askGemini(senderJid, question, isCreator) {
    const history = histories.get(senderJid) || [];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator) }] },
        contents: [
            ...history,
            { role: "user", parts: [{ text: question }] }
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1200 }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const candidate = data.candidates?.[0];
    const answer = candidate?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!answer) throw new Error("L'IA n'a pas pu générer de réponse.");

    history.push(
        { role: "user", parts: [{ text: question }] },
        { role: "model", parts: [{ text: answer }] }
    );
    histories.set(senderJid, history.slice(-HISTORY_LIMIT));

    return answer;
}

// ==========================================
// 4. MOTEUR WHATSAPP BAILEYS
// ==========================================
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('session_auth');
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        // Génération du code à 8 chiffres pour ton téléphone
        if (!sock.authState.creds.registered) {
            botStatus = "Génération du code de liaison...";
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(CREATOR_PHONE);
                    currentPairingCode = code;
                    botStatus = "Code prêt ! Tapez-le vite dans WhatsApp :";
                    console.log(`\n=================================\n👉 CODE WHATSAPP : ${code}\n=================================\n`);
                } catch (err) {
                    botStatus = "Erreur code: " + err.message;
                }
            }, 6000);
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                currentPairingCode = "";
                botStatus = "🟢 GIM SNEY est 100% connecté et actif sur WhatsApp !";
                console.log('\n==============================================\n🎉 VICTOIRE ! GIM SNEY EST CONNECTÉ !\n==============================================\n');
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                botStatus = `Reconnexion automatique (${statusCode})...`;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
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

            // Détection du Créateur Dieudonné
            const isCreator = isFromMe || sender.includes(CREATOR_PHONE) || participant.includes(CREATOR_PHONE);

            const text = (
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                ""
            ).trim();

            const lower = text.toLowerCase();

            // Mots-clés déclencheurs
            const isTrigger = lower.startsWith('!gim') ||
                              lower.startsWith('!prono') ||
                              lower === 'pronostic' ||
                              lower.startsWith('pronostic ') ||
                              lower === '/help' ||
                              lower.startsWith('/predict') ||
                              lower.startsWith('gimsney') ||
                              lower.startsWith('gim sney');

            // Évite la boucle infinie si le bot parle tout seul
            if (isFromMe && !isTrigger) return;
            if (!isTrigger) return;

            console.log(`📩 Commande reçue [Créateur: ${isCreator}] :`, text);

            if (lower === '/reset') {
                histories.delete(sender);
                await sock.sendMessage(sender, { text: "🧹 *GIM SNEY :* Mémoire réinitialisée avec succès." }, { quoted: msg });
                return;
            }

            let question = text.replace(/^(!gim|!prono|\/predict|pronostic|\/help|gimsney|gim sney)\s*/i, '').trim();
            if (!question || lower === '/help') {
                question = "Présente-toi et donne les meilleurs pronostics foot d'aujourd'hui pour Betpawa RDC.";
            }

            try {
                await sock.sendPresenceUpdate('composing', sender);
                const reponse = await askGemini(sender, question, isCreator);
                await sock.sendMessage(sender, { text: reponse }, { quoted: msg });
                console.log("✅ Réponse envoyée !");
            } catch (err) {
                console.error("Erreur Gemini :", err.message);
                await sock.sendMessage(sender, { text: `⚠️ *GIM SNEY :* ${err.message}` }, { quoted: msg });
            } finally {
                await sock.sendPresenceUpdate('paused', sender);
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

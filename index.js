const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration sécurisée
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const PHONE_NUMBER = process.env.PHONE_NUMBER || "243977332867";

// Serveur Web pour que Render garde le bot allumé 24h/24
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GIM SNEY IA est en ligne 24h/24 !\nCree par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT, () => {
    console.log(`Serveur web actif sur le port ${PORT}`);
});

function getSystemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    return `Tu es GIM SNEY, une intelligence artificielle multimodale d'elite, experte en analyse sportive, tactique et pronostics probabilistes.
Tu as ete concu et developpe par ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).

Date actuelle : ${dateStr} a ${timeStr}.
REGLES D'IDENTITE :
1. Qui es-tu ? Tu es GIM SNEY, IA d'analyse sportive d'elite.
2. Qui t'a cree ? Ton createur unique est ILUNGA MONGA DIEUDONNE.
3. REGLE WHATSAPP : Fais des reponses percutantes, structurees avec des puces, sans texte inutilement trop long.
4. Utilise des emojis sportifs : ⚽, 🏀, 🎾, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴.
5. Donne des pronostics clairs avec pourcentages et conseils fiables pour Betpawa RDC.`;
}

async function askGemini(promptText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt() }] },
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        tools: [{ google_search: {} }]
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log("\n=================================");
                console.log("👉 TON CODE DE CONNEXION WHATSAPP :");
                console.log("👉👉  " + code + "  👈👈");
                console.log("=================================\n");
            } catch (err) {
                console.log("Erreur code:", err.message);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('\n==============================================');
            console.log('🎉 VICTOIRE ! GIM SNEY EST 100% ACTIF SUR WHATSAPP !');
            console.log('==============================================\n');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Écoute de tous les messages (dans ton groupe et en privé)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || "";
        
        const lower = text.toLowerCase().trim();

        const isTrigger = lower.startsWith('!gim') || 
                          lower.startsWith('!prono') || 
                          lower === 'pronostic' || 
                          lower.startsWith('pronostic ') ||
                          lower === '/help' ||
                          lower.startsWith('/predict') ||
                          lower.startsWith('/');

        if (isTrigger) {
            console.log("📩 Message recu :", text);
            
            let question = text.replace(/^(!gim|!prono|\/predict|pronostic|\/help|\/)\s*/i, '').trim();
            if (!question || lower === '/help') {
                question = "Presente-toi comme GIM SNEY cree par ILUNGA MONGA DIEUDONNE et donne les meilleurs pronostics foot d'aujourd'hui pour Betpawa RDC.";
            }

            try {
                const reponse = await askGemini(question);
                await sock.sendMessage(sender, { text: reponse }, { quoted: msg });
                console.log("✅ Reponse envoyee !");
            } catch (err) {
                console.error("Erreur:", err.message);
                await sock.sendMessage(sender, { text: "⚠️ GIM SNEY : " + err.message });
            }
        }
    });
}

startBot();

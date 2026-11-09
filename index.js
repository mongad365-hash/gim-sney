const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Configuration officielle
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";

let botStatus = "Demarrage en cours...";
let currentPairingCode = "";

// Page Web pour voir le code sur https://gim-sney.onrender.com
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>GIM SNEY WhatsApp Bot</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding: 25px; background: #0b0f19; color: #fff; }
                .box { background: #131b2e; border: 2px solid #00ff88; border-radius: 12px; padding: 20px; margin: 20px auto; max-width: 420px; }
                .code { font-size: 34px; font-weight: bold; color: #00ff88; letter-spacing: 4px; background: #1e293b; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .btn { display: inline-block; background: #00ff88; color: #000; font-weight: bold; padding: 12px 20px; text-decoration: none; border-radius: 8px; margin-top: 15px; }
            </style>
        </head>
        <body>
            <h1>⚽ GIM SNEY | IA SPORTIVE</h1>
            <p>Cree par <strong>ILUNGA MONGA DIEUDONNE</strong></p>
            <div class="box">
                <h3>Etat du robot :</h3>
                <p style="font-size: 18px; color: #38bdf8;">${botStatus}</p>
                ${currentPairingCode ? `
                    <p style="margin-top:15px;">👉 Tape vite ce code dans WhatsApp :</p>
                    <div class="code">${currentPairingCode}</div>
                    <p style="font-size: 13px; color: #94a3b8;">WhatsApp > 3 points > Appareils connectes > Connecter un appareil > Lier avec un numero</p>
                ` : ''}
            </div>
            <p><a href="/" class="btn" onclick="location.reload(); return false;">🔄 Actualiser la page</a></p>
        </body>
        </html>
    `);
}).listen(PORT, () => {
    console.log(`Serveur web actif sur le port ${PORT}`);
});

process.on('uncaughtException', (err) => console.error('Erreur interceptee:', err.message));
process.on('unhandledRejection', (err) => console.error('Promesse rejetee:', err.message));

function getSystemPrompt(isCreator) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let creatorContext = isCreator
        ? `ATTENTION : La personne qui te parle MAINTENANT est TON UNIQUE CREATEUR ET PATRON : l'ingenieux ILUNGA MONGA DIEUDONNE en personne ! Salue-le avec grand respect de Boss (ex: "A vos ordres mon Createur et Boss Dieudonne ! 🫡👑"), puis reponds avec brio a sa demande.`
        : `Tu t'adresses a un membre du groupe. Sois poli, dynamique et rappelle que tu as ete concu par ILUNGA MONGA DIEUDONNE (mongad365@gmail.com).`;

    return `Tu es GIM SNEY, une intelligence artificielle multimodale d'elite, experte en analyse sportive, tactique et pronostics probabilistes pour Betpawa RDC.
Createur unique : ILUNGA MONGA DIEUDONNE.
Date actuelle : ${dateStr} a ${timeStr}.

${creatorContext}

REGLES WHATSAPP :
- Fais des reponses percutantes, bien structurees avec des puces.
- Entoure les titres importants d'asterisques pour les mettre en gras (ex: *ANALYSE TACTIQUE :*).
- Utilise des emojis sportifs : ⚽, 🏀, 🎾, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴.
- Donne des pronostics clairs avec pourcentages et conseils fiables pour Betpawa RDC.`;
}

async function askGemini(promptText, isCreator) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        system_instruction: { parts: [{ text: getSystemPrompt(isCreator) }] },
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
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        return data.candidates[0].content.parts[0].text;
    } else {
        throw new Error("L'IA n'a pas renvoye de texte.");
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

        if (!sock.authState.creds.registered) {
            botStatus = "Generation du code WhatsApp en cours...";
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(CREATOR_PHONE);
                    currentPairingCode = code;
                    botStatus = "Code pret ! Tapez-le vite dans WhatsApp ci-dessous :";
                    console.log("\n👉 CODE WHATSAPP : " + code + "\n");
                } catch (err) {
                    botStatus = "Erreur code : " + err.message;
                }
            }, 6000);
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                currentPairingCode = "";
                botStatus = "🎉 GIM SNEY EST 100% CONNECTE ET ACTIF SUR WHATSAPP !";
                console.log('🎉 VICTOIRE ! GIM SNEY EST 100% ACTIF SUR WHATSAPP !');
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                botStatus = `Reconnexion en cours (${statusCode})...`;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg?.message) return;

            const sender = msg.key.remoteJid;
            const participant = msg.key.participant || "";
            const isFromMe = Boolean(msg.key.fromMe);

            // Reconnaissance de Dieudonne (le Boss)
            const isCreator = isFromMe || 
                              sender.includes(CREATOR_PHONE) || 
                              participant.includes(CREATOR_PHONE);

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
                              lower.startsWith('gimsney') ||
                              lower.startsWith('gim sney');

            if (isTrigger) {
                console.log(`📩 Commande recue [Createur: ${isCreator}] :`, text);
                
                let question = text.replace(/^(!gim|!prono|\/predict|pronostic|\/help|gimsney|gim sney)\s*/i, '').trim();
                if (!question || lower === '/help') {
                    question = "Presente-toi et donne les meilleurs pronostics foot d'aujourd'hui pour Betpawa RDC.";
                }

                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const reponse = await askGemini(question, isCreator);
                    await sock.sendMessage(sender, { text: reponse }, { quoted: msg });
                    console.log("✅ Reponse envoyee !");
                } catch (err) {
                    console.error("Erreur Gemini :", err.message);
                    await sock.sendMessage(sender, { text: "⚠️ *GIM SNEY :* " + err.message });
                }
            }
        });
    } catch (e) {
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

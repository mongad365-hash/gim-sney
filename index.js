const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// ==========================================
// 1. CONFIGURATION OFFICIELLE
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6KeFgt7wruY4XiA-_lb7u5SjVftPUIq6kQTbA3VPv891A";
const CREATOR_PHONE = "243977332867";

// Serveur Web pour que Render garde le bot allumé 24h/24
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('GIM SNEY IA est en ligne 24h/24 !\nCreee par ILUNGA MONGA DIEUDONNE.');
}).listen(PORT, () => {
    console.log(`Serveur web actif sur le port ${PORT}`);
});

// Sécurité anti-crash
process.on('uncaughtException', (err) => console.error('Erreur interceptee:', err.message));
process.on('unhandledRejection', (err) => console.error('Promesse rejetee:', err.message));

function getSystemPrompt(isCreator) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    let creatorContext = isCreator
        ? `ATTENTION : La personne qui te parle MAINTENANT est TON CRÉATEUR ET PATRON : l'ingénieux ILUNGA MONGA DIEUDONNÉ en personne ! Salue-le avec grand respect de Boss (par exemple : "À vos ordres mon Créateur et Boss Dieudonné ! 🫡👑"), puis réponds avec brio à sa demande.`
        : `Tu t'adresses à un membre du groupe. Sois poli, dynamique et rappelle que tu as été conçu par ILUNGA MONGA DIEUDONNÉ (mongad365@gmail.com).`;

    return `Tu es GIM SNEY, une intelligence artificielle multimodale d'élite, experte en analyse sportive, tactique et pronostics probabilistes pour Betpawa RDC.
Créateur unique : ILUNGA MONGA DIEUDONNÉ.
Date actuelle : ${dateStr} à ${timeStr}.

${creatorContext}

RÈGLES WHATSAPP :
- Fais des réponses percutantes, bien structurées avec des puces.
- Entoure les titres importants d'astérisques pour les mettre en gras (ex: *ANALYSE TACTIQUE :*).
- Utilise des émojis sportifs : ⚽, 🏀, 🎾, 🏆, 📊, 🎯, 💡, 💰, 🟢, 🔴.
- Donne des pronostics clairs avec pourcentages et conseils fiables pour Betpawa RDC.`;
}

// Vraie URL officielle de Google Gemini avec recherche web
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
        throw new Error("L'IA n'a pas renvoyé de texte.");
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
                console.log('\n==============================================');
                console.log('🎉 VICTOIRE ! GIM SNEY EST 100% ACTIF SUR WHATSAPP !');
                console.log('==============================================\n');
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`Connexion fermée (${statusCode}). Reconnexion automatique dans 3 secondes...`);
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Écoute de tous les messages (y compris tes propres messages de test)
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg?.message) return;

            const sender = msg.key.remoteJid;
            const participant = msg.key.participant || "";
            const isFromMe = Boolean(msg.key.fromMe);

            // Reconnaissance de Dieudonné (le Boss)
            const isCreator = isFromMe || 
                              sender.includes(CREATOR_PHONE) || 
                              participant.includes(CREATOR_PHONE);

            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || "";
            
            const lower = text.toLowerCase().trim();

            // Mots-clés déclencheurs
            const isTrigger = lower.startsWith('!gim') || 
                              lower.startsWith('!prono') || 
                              lower === 'pronostic' || 
                              lower.startsWith('pronostic ') ||
                              lower === '/help' ||
                              lower.startsWith('/predict') ||
                              lower.startsWith('gimsney') ||
                              lower.startsWith('gim sney');

            if (isTrigger) {
                console.log(`📩 Commande reçue [Créateur: ${isCreator}] :`, text);
                
                let question = text.replace(/^(!gim|!prono|\/predict|pronostic|\/help|gimsney|gim sney)\s*/i, '').trim();
                if (!question || lower === '/help') {
                    question = "Présente-toi et donne les meilleurs pronostics foot d'aujourd'hui pour Betpawa RDC.";
                }

                try {
                    // Indique que le robot écrit
                    await sock.sendPresenceUpdate('composing', sender);
                    
                    const reponse = await askGemini(question, isCreator);
                    await sock.sendMessage(sender, { text: reponse }, { quoted: msg });
                    console.log("✅ Réponse envoyée !");
                } catch (err) {
                    console.error("Erreur Gemini :", err.message);
                    await sock.sendMessage(sender, { text: "⚠️ *GIM SNEY :* " + err.message }, { quoted: msg });
                }
            }
        });
    } catch (e) {
        console.error("Erreur critique startBot :", e.message);
        setTimeout(() => startBot(), 5000);
    }
}

startBot();

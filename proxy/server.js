// NutriTrack AI Proxy — deploy su Railway (o qualsiasi host Node)
// Risolve il problema CORS e tiene la API key server-side (mai esposta al client).
//
// Setup Railway:
//   1. Crea un nuovo progetto su railway.app, collega questo repo (o cartella)
//   2. Aggiungi la variabile d'ambiente: ANTHROPIC_API_KEY = sk-ant-api03-...
//      (opzionale per Gemini: GEMINI_API_KEY = AIzaSy...)
//   3. Railway rileva package.json e avvia `node server.js`
//   4. Copia l'URL pubblico Railway in NutriTrack → Settings → Proxy endpoint
//      es. https://nutritrack-proxy.up.railway.app/v1/messages

const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' })); // limit alto per immagini base64 (foto AI)

// CORS — permette le richieste dall'app (GitHub Pages e Capacitor)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'nutritrack-proxy' }));

// Endpoint Anthropic — formato identico all'API ufficiale
app.post('/v1/messages', async (req, res) => {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
});

// Endpoint Gemini (opzionale) — se preferisci centralizzare anche Gemini
app.post('/v1/gemini', async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(400).json({ error: 'GEMINI_API_KEY non configurata' }); return; }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NutriTrack proxy in ascolto sulla porta ' + PORT));

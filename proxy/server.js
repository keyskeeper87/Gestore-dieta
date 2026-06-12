// NutriTrack AI Proxy — deploy su Railway (o qualsiasi host Node)
// Risolve CORS, tiene la API key server-side, ed evita il 429 di Gemini.
//
// L'app NutriTrack, in modalità "Proxy endpoint", invia SEMPRE richieste in
// formato Anthropic. Questo proxy le accetta e, in base alla chiave configurata,
// le inoltra ad Anthropic (passthrough) OPPURE a Gemini (con conversione automatica
// del formato richiesta/risposta). Per l'app la differenza è invisibile.
//
// Setup Railway:
//   1. railway.app → New Project → Deploy from GitHub repo
//   2. Root Directory: /proxy  (se i file sono in una sottocartella)
//   3. Variables — imposta UNA delle due:
//        GEMINI_API_KEY     = AIzaSy...        (gratuito, consigliato)
//        ANTHROPIC_API_KEY  = sk-ant-api03-... (a pagamento)
//      Se ci sono entrambe, vince Anthropic (modificabile con PROVIDER).
//   4. Settings → Networking → Generate Domain → copia l'URL
//   5. In NutriTrack → Settings → AI & API → Proxy endpoint:
//        https://<tuo-dominio>.up.railway.app/v1/messages

const express = require('express');
const app = express();

app.use(express.json({ limit: '12mb' })); // limite alto per le immagini base64 (foto AI)

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_KEY    = process.env.GEMINI_API_KEY || '';
// Provider: esplicito via env, altrimenti auto in base alla chiave presente
const PROVIDER = (process.env.PROVIDER || (ANTHROPIC_KEY ? 'anthropic' : 'gemini')).toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// Health check
app.get('/', (req, res) => res.json({
  status: 'ok',
  service: 'nutritrack-proxy',
  provider: PROVIDER,
  keyConfigured: PROVIDER === 'anthropic' ? !!ANTHROPIC_KEY : !!GEMINI_KEY
}));

// ── Conversione formato Anthropic → Gemini ────────────────────────────
function anthropicToGemini(body) {
  const messages = body.messages || [];
  const contents = messages.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let parts;
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      parts = m.content.map(block => {
        if (block.type === 'text') return { text: block.text };
        if (block.type === 'image' && block.source) {
          return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
        }
        return { text: '' };
      });
    } else {
      parts = [{ text: '' }];
    }
    return { role, parts };
  });
  // maxOutputTokens: usa quello richiesto, con un minimo di 1024 per evitare troncamenti
  const maxOut = Math.max(body.max_tokens || 1024, 1024);
  const genCfg = { maxOutputTokens: maxOut };
  // JSON mode: se il prompt chiede JSON, forza Gemini a produrre JSON valido
  const promptText = JSON.stringify(contents).toLowerCase();
  if (promptText.includes('json')) {
    genCfg.responseMimeType = 'application/json';
  }
  return { contents, generationConfig: genCfg };
}

// ── Conversione risposta Gemini → Anthropic ───────────────────────────
function geminiToAnthropic(data) {
  let text = '';
  try {
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content
      ? data.candidates[0].content.parts : [];
    text = (parts || []).map(p => p.text || '').join('');
  } catch (e) { text = ''; }
  // Se Gemini ha bloccato la risposta (safety) o non ha prodotto testo
  if (!text && data.promptFeedback && data.promptFeedback.blockReason) {
    text = '[Risposta bloccata da Gemini: ' + data.promptFeedback.blockReason + ']';
  }
  return {
    id: 'gemini-proxy',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn'
  };
}

// ── Endpoint principale (formato Anthropic in ingresso) ───────────────
app.post('/v1/messages', async (req, res) => {
  try {
    if (PROVIDER === 'gemini') {
      if (!GEMINI_KEY) { res.status(500).json({ error: { message: 'GEMINI_API_KEY non configurata su Railway' } }); return; }
      const gemBody = anthropicToGemini(req.body);
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
        + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gemBody)
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = (data.error && data.error.message) ? data.error.message : ('Gemini HTTP ' + r.status);
        res.status(r.status).json({ error: { message: msg } });
        return;
      }
      res.json(geminiToAnthropic(data));
      return;
    }

    // PROVIDER === 'anthropic' — passthrough puro
    if (!ANTHROPIC_KEY) { res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY non configurata su Railway' } }); return; }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('NutriTrack proxy [' + PROVIDER + '] in ascolto sulla porta ' + PORT));

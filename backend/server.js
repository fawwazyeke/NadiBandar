import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (dotenv ESM compat)
try {
  const env = readFileSync(join(__dirname, '../.env'), 'utf8');
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch {}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;

if (!OPENAI_KEY) { console.error('OPENAI_API_KEY not set in .env'); process.exit(1); }
if (!SERPER_KEY) console.warn('SERPER_API_KEY not set — web search disabled');

// ── District data + name index ──────────────────────────────────────
const DISTRICTS = JSON.parse(
  readFileSync(join(__dirname, '../public/data/districts.json'), 'utf8')
);

const DISTRICT_INDEX = new Map();
for (const d of DISTRICTS) {
  DISTRICT_INDEX.set(d.name.toLowerCase(), d);
  // Index each word so "Johor Bahru" also matches on "bahru"
  for (const word of d.name.toLowerCase().split(/\s+/)) {
    if (word.length > 3 && !DISTRICT_INDEX.has(word)) DISTRICT_INDEX.set(word, d);
  }
}

function findMentionedDistricts(query) {
  const q = query.toLowerCase();
  const qWords = q.split(/\W+/);
  const seen = new Set();
  const found = [];
  for (const [key, d] of DISTRICT_INDEX) {
    // Multi-word keys (e.g. "johor bahru"): substring match is fine
    // Single-word keys (e.g. "port"): must be a whole word to avoid "port" matching inside "transport"
    const matches = key.includes(' ') ? q.includes(key) : qWords.includes(key);
    if (matches && !seen.has(d.id)) {
      seen.add(d.id);
      found.push(d);
    }
  }
  return found.slice(0, 3);
}

// ── District context builder ────────────────────────────────────────
function score(count, pop, per) {
  if (!pop) return 0;
  return Math.min(200, Math.round((count / Math.max(pop / per, 0.001)) * 100));
}

function needed(count, pop, per) {
  const req = Math.ceil(pop / per);
  const gap = req - count;
  return gap > 0 ? `needs ${gap} more` : `${count - req} above standard`;
}

function districtContext(d) {
  const p = d.population || 1;
  return `District: ${d.name}, ${d.state}
Population: ${d.population.toLocaleString()} | Area: ${d.area_km2} km² | Density: ${d.density}/km²
Hospitals/clinics : ${d.hospitals}  (score ${score(d.hospitals, p, 10000)}/100 — ${needed(d.hospitals, p, 10000)})
Schools           : ${d.schools}   (score ${score(d.schools, p, 5000)}/100  — ${needed(d.schools, p, 5000)})
Police stations   : ${d.police}    (score ${score(d.police, p, 10000)}/100 — ${needed(d.police, p, 10000)})
Markets           : ${d.markets}   (score ${score(d.markets, p, 10000)}/100 — ${needed(d.markets, p, 10000)})
Pharmacies        : ${d.pharmacies} (score ${score(d.pharmacies, p, 2000)}/100 — ${needed(d.pharmacies, p, 2000)})
Transit stops     : ${d.transport_stops} (score ${score(d.transport_stops, p, 5000)}/100 — ${needed(d.transport_stops, p, 5000)})
Poverty rate: ${d.poverty_rate ?? 'N/A'}% | Median income: RM${d.income_median?.toLocaleString() ?? 'N/A'} | Unemployment: ${d.unemployment_rate ?? 'N/A'}%
Piped water: ${d.piped_water ?? 'N/A'}% | Electricity: ${d.electricity ?? 'N/A'}%`;
}

// ── Metric-based RAG ────────────────────────────────────────────────
const FACILITY_STANDARDS = {
  hospitals: { key: 'hospitals', per: 10_000 },
  schools:   { key: 'schools',   per: 5_000  },
  police:    { key: 'police',    per: 10_000 },
  markets:   { key: 'markets',   per: 10_000 },
  pharmacies:{ key: 'pharmacies',per: 2_000  },
  transport: { key: 'transport_stops', per: 5_000 },
};

function detectFacility(query) {
  const q = query.toLowerCase();
  if (/hospital|clinic|health|medical/.test(q))    return 'hospitals';
  if (/school|educat|learn|student/.test(q))       return 'schools';
  if (/police|station|crime|security/.test(q))     return 'police';
  if (/market|pasar|food/.test(q))                 return 'markets';
  if (/pharmac|drug|medicine|dispensary/.test(q))  return 'pharmacies';
  if (/transport|bus|train|transit|commut/.test(q))return 'transport';
  return null;
}

function facilityScore(d, std) {
  const pop = d.population || 1;
  return Math.min(200, Math.round((d[std.key] / Math.max(pop / std.per, 0.001)) * 100));
}

function worstByFacility(facilityName, n = 6) {
  const std = FACILITY_STANDARDS[facilityName];
  if (!std) return [];
  return [...DISTRICTS]
    .filter(d => d.population > 5_000)
    .map(d => ({ d, score: facilityScore(d, std) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map(x => x.d);
}

function overallScore(d) {
  const p = d.population || 1;
  return Object.values(FACILITY_STANDARDS)
    .reduce((sum, std) => sum + Math.min(100, facilityScore(d, std)), 0) / Object.keys(FACILITY_STANDARDS).length;
}

function worstOverall(n = 6) {
  return [...DISTRICTS]
    .filter(d => d.population > 5_000)
    .map(d => ({ d, score: overallScore(d) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map(x => x.d);
}

// ── System prompt ───────────────────────────────────────────────────
const SYSTEM_BASE = `You are Nadi Bandar AI, an urban planning assistant for Malaysia.
You analyse facility gaps across ${DISTRICTS.length} Malaysian districts using real DOSM Census 2020 data, HIES 2024 socioeconomic data, and OpenStreetMap facility counts.

Planning standards (PLANMalaysia JPBD GP004-A 2022 + WHO):
- Hospitals/clinics : 1 per 10,000 residents
- Schools           : 1 per 5,000 residents
- Police stations   : 1 per 10,000 residents
- Markets           : 1 per 10,000 residents
- Transit stops     : 1 per 5,000 residents

A score above 100 means over-served (excess provision). Below 100 means a gap exists.

When district data is provided below, always use those exact numbers. Keep replies under 200 words. Be specific — name districts, give actual counts and gaps. Recommend concrete, actionable interventions. When you use web_search, cite the source at the end of your reply.

Important: When a user asks ANY question that mentions a facility type (hospitals, clinics, schools, police, markets, transport, public transport, etc.) — even if phrased as "where do we get the data", "how is X measured", or "tell me about X" — always answer by analysing the actual district data provided. Do not give generic background information. Instead, highlight which districts are worst-served, what the gaps are, and what action is needed. The district dataset IS the authoritative source; refer to it directly.

Formatting rules: never use LaTeX or mathematical notation (no \\frac, \\text, [ ] formula blocks). Write formulas in plain English, e.g. "Score = (existing / required) × 100".`;

// ── Serper.dev web search ───────────────────────────────────────────
async function serperSearch(query) {
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `${query} Malaysia`, gl: 'my', hl: 'en', num: 5 }),
  });
  if (!resp.ok) throw new Error(`Serper ${resp.status}`);
  const data = await resp.json();
  const parts = [];
  if (data.answerBox?.answer)   parts.push(`Answer: ${data.answerBox.answer}`);
  if (data.answerBox?.snippet)  parts.push(`Summary: ${data.answerBox.snippet}`);
  for (const r of (data.organic || []).slice(0, 4)) {
    parts.push(`• ${r.title}: ${r.snippet} (${r.link})`);
  }
  return parts.join('\n') || 'No results found.';
}

// ── Tool definition ─────────────────────────────────────────────────
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for real-time or specific information about Malaysian facilities, hospitals, clinics, schools, transport, or any urban planning topic. Use when the user asks about specific operating facilities, current news, exact addresses, or anything not covered by the district dataset.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "hospital Petaling Jaya 24 hour" or "new MRT stations 2025"',
        },
      },
      required: ['query'],
    },
  },
};

// ── Express app ─────────────────────────────────────────────────────
const app = express();
// Explicit CORS — handles Railway reverse proxy stripping cors() preflight
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '2mb' }));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, layer } = req.body;

    // RAG: districts mentioned by name, or worst performers for detected facility type
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const query = lastUser?.content ?? '';
    let mentioned = findMentionedDistricts(query);
    let contextLabel = 'MENTIONED DISTRICTS';

    if (mentioned.length === 0) {
      const facility = detectFacility(query);
      if (facility) {
        mentioned = worstByFacility(facility);
        contextLabel = `WORST ${facility.toUpperCase()} COVERAGE (lowest scoring districts)`;
      } else {
        mentioned = worstOverall();
        contextLabel = 'WORST OVERALL COVERAGE (lowest scoring districts)';
      }
    }

    let systemContent = SYSTEM_BASE;
    if (mentioned.length > 0) {
      systemContent += `\n\n--- DISTRICT DATA: ${contextLabel} (DOSM / OSM dataset) ---\n\n`;
      systemContent += mentioned.map(districtContext).join('\n\n');
    }
    if (layer) {
      systemContent += `\n\nThe user is currently viewing the "${layer}" map layer.`;
    }

    // For data-sourcing questions, tell the model to briefly explain provenance then show real numbers
    const isMetaQuery = /where.*(get|find|obtain|from|source|come)|source of|data source|how.*(measure|calculat|score|work)/i.test(query);
    if (isMetaQuery && mentioned.length > 0) {
      systemContent += `\n\nNOTE: The user is asking where the data comes from. Answer in 2-3 sentences: the transport stop counts come from OpenStreetMap (OSM) community mapping, cross-referenced with DOSM Census 2020 population data. Then immediately show 2-3 example districts from the data provided above to illustrate what the dataset looks like. Do not list government agencies or external links.`;
    }

    const oaiMessages = [{ role: 'system', content: systemContent }, ...messages];
    const tools = SERPER_KEY ? [WEB_SEARCH_TOOL] : undefined;

    // First OpenAI call
    let oaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: oaiMessages,
        max_tokens: 450,
        temperature: 0.4,
        ...(tools ? { tools, tool_choice: 'auto' } : {}),
      }),
    });

    if (!oaiResp.ok) {
      const err = await oaiResp.text();
      console.error('OpenAI error:', oaiResp.status, err.slice(0, 200));
      return res.status(oaiResp.status).json({ error: err });
    }

    let oaiData = await oaiResp.json();
    let choice = oaiData.choices?.[0];
    let usedSearch = false;

    // Agentic loop: execute tool calls if needed
    if (choice?.finish_reason === 'tool_calls' && SERPER_KEY) {
      usedSearch = true;
      const assistantMsg = choice.message;
      const toolResults = [];

      for (const tc of (assistantMsg.tool_calls || [])) {
        if (tc.function.name === 'web_search') {
          const args = JSON.parse(tc.function.arguments);
          console.log(`[web_search] "${args.query}"`);
          let result;
          try { result = await serperSearch(args.query); }
          catch (e) { result = `Search failed: ${e.message}`; }
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      }

      // Second call with tool results
      oaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [...oaiMessages, assistantMsg, ...toolResults],
          max_tokens: 450,
          temperature: 0.4,
        }),
      });

      if (!oaiResp.ok) {
        const err = await oaiResp.text();
        return res.status(oaiResp.status).json({ error: err });
      }
      oaiData = await oaiResp.json();
      choice = oaiData.choices?.[0];
    }

    const content = choice?.message?.content ?? 'Sorry, I could not get a response.';
    res.json({ content, usedSearch });
  } catch (e) {
    console.error('Backend error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`RAG: ${DISTRICTS.length} districts indexed`);
  console.log(`Web search: ${SERPER_KEY ? 'enabled (Serper.dev)' : 'disabled — set SERPER_API_KEY in .env to enable'}`);
});

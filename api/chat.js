import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;

const DISTRICTS = JSON.parse(
  readFileSync(join(__dirname, '../public/data/districts.json'), 'utf8')
);

const DISTRICT_INDEX = new Map();
for (const d of DISTRICTS) {
  DISTRICT_INDEX.set(d.name.toLowerCase(), d);
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
    const matches = key.includes(' ') ? q.includes(key) : qWords.includes(key);
    if (matches && !seen.has(d.id)) { seen.add(d.id); found.push(d); }
  }
  return found.slice(0, 3);
}

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

const FACILITY_STANDARDS = {
  hospitals:  { key: 'hospitals',       per: 10_000 },
  schools:    { key: 'schools',         per: 5_000  },
  police:     { key: 'police',          per: 10_000 },
  markets:    { key: 'markets',         per: 10_000 },
  pharmacies: { key: 'pharmacies',      per: 2_000  },
  transport:  { key: 'transport_stops', per: 5_000  },
};

function detectFacility(query) {
  const q = query.toLowerCase();
  if (/hospital|clinic|health|medical/.test(q))     return 'hospitals';
  if (/school|educat|learn|student/.test(q))        return 'schools';
  if (/police|station|crime|security/.test(q))      return 'police';
  if (/market|pasar|food/.test(q))                  return 'markets';
  if (/pharmac|drug|medicine|dispensary/.test(q))   return 'pharmacies';
  if (/transport|bus|train|transit|commut/.test(q)) return 'transport';
  return null;
}

function facilityScore(d, std) {
  return Math.min(200, Math.round((d[std.key] / Math.max((d.population || 1) / std.per, 0.001)) * 100));
}

function worstByFacility(facilityName, n = 6) {
  const std = FACILITY_STANDARDS[facilityName];
  if (!std) return [];
  return [...DISTRICTS]
    .filter(d => d.population > 5_000)
    .map(d => ({ d, score: facilityScore(d, std) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n).map(x => x.d);
}

function worstOverall(n = 6) {
  return [...DISTRICTS]
    .filter(d => d.population > 5_000)
    .map(d => ({ d, score: Object.values(FACILITY_STANDARDS).reduce((s, std) => s + Math.min(100, facilityScore(d, std)), 0) / Object.keys(FACILITY_STANDARDS).length }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n).map(x => x.d);
}

const SYSTEM_BASE = `You are Nadi Bandar AI, an urban planning assistant for Malaysia.
You analyse facility gaps across ${DISTRICTS.length} Malaysian districts using real DOSM Census 2020 data, HIES 2024 socioeconomic data, and OpenStreetMap facility counts.

Planning standards (PLANMalaysia JPBD GP004-A 2022 + WHO):
- Hospitals/clinics : 1 per 10,000 residents
- Schools           : 1 per 5,000 residents
- Police stations   : 1 per 10,000 residents
- Markets           : 1 per 10,000 residents
- Transit stops     : 1 per 5,000 residents

A score above 100 means over-served (excess provision). Below 100 means a gap exists.

When district data is provided below, always use those exact numbers. Keep replies under 200 words. Be specific — name districts, give actual counts and gaps. Recommend concrete, actionable interventions.

Important: When a user asks ANY question that mentions a facility type — always answer by analysing the actual district data provided. Do not give generic background information.

Formatting rules: never use LaTeX or mathematical notation. Write formulas in plain English, e.g. "Score = (existing / required) × 100".`;

async function serperSearch(query) {
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `${query} Malaysia`, gl: 'my', hl: 'en', num: 5 }),
  });
  if (!resp.ok) throw new Error(`Serper ${resp.status}`);
  const data = await resp.json();
  const parts = [];
  if (data.answerBox?.answer)  parts.push(`Answer: ${data.answerBox.answer}`);
  if (data.answerBox?.snippet) parts.push(`Summary: ${data.answerBox.snippet}`);
  for (const r of (data.organic || []).slice(0, 4))
    parts.push(`• ${r.title}: ${r.snippet} (${r.link})`);
  return parts.join('\n') || 'No results found.';
}

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for real-time information about Malaysian facilities, hospitals, schools, transport, or urban planning topics.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const { messages, layer } = req.body;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const query = lastUser?.content ?? '';

    let mentioned = findMentionedDistricts(query);
    let contextLabel = 'MENTIONED DISTRICTS';
    if (mentioned.length === 0) {
      const facility = detectFacility(query);
      if (facility) { mentioned = worstByFacility(facility); contextLabel = `WORST ${facility.toUpperCase()} COVERAGE`; }
      else { mentioned = worstOverall(); contextLabel = 'WORST OVERALL COVERAGE'; }
    }

    let systemContent = SYSTEM_BASE;
    if (mentioned.length > 0) {
      systemContent += `\n\n--- DISTRICT DATA: ${contextLabel} (DOSM / OSM dataset) ---\n\n`;
      systemContent += mentioned.map(districtContext).join('\n\n');
    }
    if (layer) systemContent += `\n\nThe user is currently viewing the "${layer}" map layer.`;

    const isMetaQuery = /where.*(get|find|obtain|from|source|come)|source of|data source|how.*(measure|calculat|score|work)/i.test(query);
    if (isMetaQuery && mentioned.length > 0) {
      systemContent += `\n\nNOTE: The user is asking where the data comes from. Briefly explain data comes from OSM and DOSM Census 2020, then show 2-3 example districts from the data above.`;
    }

    const oaiMessages = [{ role: 'system', content: systemContent }, ...messages];
    const tools = SERPER_KEY ? [WEB_SEARCH_TOOL] : undefined;

    let oaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: oaiMessages, max_tokens: 450, temperature: 0.4, ...(tools ? { tools, tool_choice: 'auto' } : {}) }),
    });

    if (!oaiResp.ok) {
      const err = await oaiResp.text();
      return res.status(oaiResp.status).json({ error: err });
    }

    let oaiData = await oaiResp.json();
    let choice = oaiData.choices?.[0];

    if (choice?.finish_reason === 'tool_calls' && SERPER_KEY) {
      const assistantMsg = choice.message;
      const toolResults = [];
      for (const tc of (assistantMsg.tool_calls || [])) {
        if (tc.function.name === 'web_search') {
          const args = JSON.parse(tc.function.arguments);
          let result;
          try { result = await serperSearch(args.query); }
          catch (e) { result = `Search failed: ${e.message}`; }
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      }
      oaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [...oaiMessages, assistantMsg, ...toolResults], max_tokens: 450, temperature: 0.4 }),
      });
      if (!oaiResp.ok) return res.status(oaiResp.status).json({ error: await oaiResp.text() });
      oaiData = await oaiResp.json();
      choice = oaiData.choices?.[0];
    }

    res.json({ content: choice?.message?.content ?? 'Sorry, I could not get a response.', usedSearch: !!tools && choice?.finish_reason === 'tool_calls' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

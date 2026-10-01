# Money AI

The AI behind the Money Home apps (Money Home, Trip Vault, the 16-Year Ledger, the Expense Tracker), and a command-line
assistant of its own. It **works things out** exactly, **looks things up**, **searches and reads the web**, and has an
AI **reason over what it read** — always with its sources — and it **learns** from what you do.

| Part | What it does |
|---|---|
| `engine/ai.js` | One set of AI keys for every app; the best free AI and model first, then the next (Gemini, Groq, Cerebras, Mistral, OpenRouter, the Private AI in the browser, Ollama, Claude); free-limit rests; strict JSON; answers checked and repaired |
| `engine/brain.js` | Money Brain: lessons learned from your edits (shown and editable in Setup), exact tools (distances, opening hours, a day planner), understanding plain requests, checking document numbers (Aadhaar, PAN, …) |
| `engine/ask.js` | Questions about your own data answered exactly (spending, savings, trips, documents, the plan) |
| `engine/web.js` | Calculators (EMI, SIP, CAGR, GST…), live facts (rates, weather, time, meanings, Wikidata), reading Wikipedia, and **deep answers**: search → read the pages (and links in them) → keep what matters → an AI reasons and answers with [sources]; figures checked against the pages |
| `relay/worker.js` | The one small server: a Cloudflare Worker that searches (Tavily keys in turn → SerpApi/Google → Google Programmable Search) and reads pages (Jina Reader) for the apps. Keys stay on Cloudflare. |
| `cli/ai.mjs` | `ai` — the same engine in your terminal |
| `test/` | Tests and exams (`npm test`, `npm run exam:web`) |

The apps load the engine from `https://anilgupta2606.github.io/ai/`; `./deploy.sh` runs every test and publishes it there.

## The command line — on its own, like Claude

`ai` works with nothing but this Mac and an internet connection: the **model on this Mac** (Ollama, Qwen3 4B Instruct)
is at the wheel and decides what to do — **search** (your own SearXNG on this Mac, no keys), **open pages** (read here with
Mozilla's Readability), **calculate** (sums and day counts, exactly), **read a file** — as often as it needs, then answers
with sources. The program holds it to good habits: a question about now must be searched; a page must be opened before
answering from search snippets; sums and day counts come from the calculator; every figure is checked against what was read.
Tavily and Jina (if set) are used only when your own search engine is down.

One-time pieces on this Mac: Ollama with `qwen3:4b-instruct`; SearXNG in `~/.money-ai/searxng` (settings in
`~/.money-ai/searxng-settings.yml`), started at login by `~/Library/LaunchAgents/com.moneyai.searxng.plist`.

## The command line (all commands)

```sh
cd ~/AI && npm link          # once: makes the `ai` command
ai setup                     # search keys (Tavily, SerpApi, Google) and AI keys — kept in ~/.money-ai/ (only you can read it)
ai "what did the RBI decide on the repo rate?"      # searches, reads, answers with sources
ai "EMI for 50 lakh at 8.5% for 20 years"           # worked out exactly
ai -f notes.md "what did the hotel cost?"           # from a file (text, markdown, CSV, JSON, HTML)
ai                                                   # a conversation
ai status                                            # what is set up
```

## Web search in the apps: this Mac first, the relay as backup

The apps' Ask searches the web through **this Mac's helper** when it is there (`cli/serve.mjs` on 127.0.0.1:8899: your
SearXNG to search, pages read on the Mac — no keys; started at login by `~/Library/LaunchAgents/com.moneyai.local.plist`;
`ai serve` runs it by hand), and through **your Cloudflare relay** (Tavily and Jina keys) everywhere else — a phone, or the
Mac with the helper off. The choice is made by itself on every question.

## The relay (web search for the apps) — once

1. `cd ~/AI/relay && npx wrangler login` — approve in the browser (your Cloudflare account).
2. `npx wrangler deploy` — prints its address, like `https://money-relay.<you>.workers.dev`.
3. Its secrets (each asks for the value; nothing is stored in the code):
   ```sh
   npx wrangler secret put RELAY_TOKEN     # any long random text — the apps' password to the relay
   npx wrangler secret put TAVILY_KEYS     # one or more Tavily keys, comma-separated
   npx wrangler secret put SERPAPI_KEY     # optional: serpapi.com (Google results)
   npx wrangler secret put GOOGLE_API_KEY  # optional: Google Programmable Search …
   npx wrangler secret put GOOGLE_CX       # … and its search engine ID
   npx wrangler secret put JINA_KEY        # optional: higher limits for reading pages
   ```
4. Money Home → Setup → **Web search**: paste the address and the token → **Save and test**.

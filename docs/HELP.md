# AI — help

Everything the AI can do and every setting. In the terminal: `ai help`, or `/help` in a conversation (it also shows your settings as they are now). On the page: type `/` in the box.

## Asking

| | |
|---|---|
| `ai "question"` | One answer. Sums and dates are worked out exactly, facts looked up, anything else searched, read and answered with sources. |
| `ai` | A conversation: follow-up questions keep the thread. Type /help inside it. Every conversation is kept. |
| `ai --resume` | Pick a past chat (the page's too) and carry on where you left off. ai --resume 2: the second newest. |
| `ai sessions` | List your chats, newest first. |
| `ai -f notes.pdf "question"` | Answer from a file (text, Markdown, CSV, JSON, HTML) as well as the web. |
| `ai --cloud "question"` | A hard question may be written by a bigger cloud model, from what your Mac found. |
| `ai --no-web "question"` | Only what it knows, no search. |
| `ai --no-ai "question"` | Only the web's own sentences, no AI. |
| `ai --json "question"` | The answer as JSON (for scripts). |
| `ai ui` | The same AI as a page in your browser (http://127.0.0.1:8899). |

## In a conversation (type these after ›)

| | |
|---|---|
| `/goal <what you want>` | A goal for this conversation; every answer works toward it. /goal alone clears it. |
| `/rule <a rule>` | A rule every answer must follow from now on (saved in your rules file). |
| `/remember <a fact>` | Remember something about you ("I live in Pune"); given to every answer. |
| `/fresh <question>` | Ask again from scratch, without a saved 👍 answer. |
| `/wrong <what is right>` | Correct the last answer; questions like it get your lesson first. |
| `/good` | Keep the last answer (👍): the same question gets it straight back. |
| `/file <path>` | Add a file to the conversation. |
| `/cloud on \| off` | Let a bigger cloud model write the hard answers. |
| `/off <tool> · /on <tool>` | Switch a tool off or on: web, read, calc, market, code, connectors. |
| `/connectors` | The data sources it can ask, and which are on. |
| `/learned` | Its rules, your rules, the mistakes it was caught making, lessons, kept answers. |
| `/status` | What is running and set up. |
| `/resume <n>` | Switch to a past chat (/resume alone lists them). |
| `/new` | Start a new chat (this one stays: ai --resume). |
| `/help · /exit` | This help · leave. |

## On the page (ai ui, or anilgupta2606.github.io/ai/chat/)

| | |
|---|---|
| `Sidebar` | New chat, search, your chats by day (the terminal's too), Connectors, What it learned, your account (theme, cloud, keys, sign out). |
| `While it works` | Every step live (open any to see what it found); the answer appears as it is written; ■ stops it. |
| `On an answer` | Copy · Retry · 👍 keep · 👎 correct; sources as cards; charts for markets; code with Copy. |
| `📎 · 🎤` | Attach files, a folder, images or a photo · speak your question. |
| `Keys` | Enter ask · Shift+Enter new line · ⌘K new chat · / jump to the box · / in the box: commands. |
| `⤓ (top right)` | Export the chat as a Markdown file. |

## Settings (one command each)

| | |
|---|---|
| `ai status` | What is running: your search engine, the model on this Mac, cloud AIs, backups. |
| `ai cloud on \| off` | Cloud AI for hard questions, always or never. ai cloud shows which cloud keys it has. |
| `ai off <tool> · ai on <tool>` | Switch a tool off or on for the terminal: web, read, calc, market, code, connectors. |
| `ai connectors` | List the data connectors (manage them on the page: Connectors). |
| `ai rules` | The rules every answer is checked against, yours, and what it has learned. |
| `ai teach "lesson" · ai forget <n>` | Correct the last answer · drop lesson n (numbers from ai rules). |
| `ai setup` | Keys: web search backups (Tavily, SerpApi, Google, Jina) and AI services. Or, on the AI page: account → "Copy my AI keys to this Mac". |

## Where your settings live (all on this Mac, readable only by you)

| | |
|---|---|
| `~/.money-ai/config.json` | Keys (search backups, AI services), cloud on/off, switched-off tools. |
| `~/.money-ai/rules.md` | Your rules — one per line starting with "- ". Edit freely. |
| `~/.money-ai/connectors.json` | Your data connectors: Wikipedia, Dictionary, Exchange rates, Books, GitHub, Hacker News, Weather, News, Research papers, Stack Overflow, Crypto prices, Public holidays, Places, Python packages, npm packages, Similar words — and yours. |
| `~/.money-ai/store.json` | Its memory: lessons, mistakes, kept answers, what you asked it to remember. |
| `~/.money-ai/sessions/` | Your chats (the page's and the terminal's), the newest 100. |
| `~/.money-ai/workspace/` | Where code it writes is run (in a sandbox: no internet, no files outside it). The last 20 runs. |
| `~/.money-ai/selfexam.json` | The last weekly self-exam (log: selfexam.log). |

## What runs in the background (started at login)

| | |
|---|---|
| `com.moneyai.searxng` | Your own search engine (SearXNG) on port 8888. |
| `com.moneyai.local` | The helper on port 8899: the AI page, and search/reading for your apps. |
| `com.moneyai.selfexam` | The weekly self-exam, Sundays 10:00 (or when the Mac next wakes). |
| `Ollama` | The models on this Mac: qwen3:4b-instruct (questions), qwen2.5-coder:3b (code), gemma3:4b (pictures). |
| `Restart one` | launchctl kickstart -k gui/$(id -u)/com.moneyai.local   (or .searxng) |

## How it answers

| | |
|---|---|
| `Research first` | A question about now is searched and its two best pages read before the model thinks; a market question gets real prices first. |
| `Tools` | Web search, reading pages, calculator (sums, dates, EMI, compound interest), market analysis with charts, running code, files, connectors. |
| `Rules` | Every draft is checked (R1–R11: search what changes, cite what was read, numbers from sources, sums right, dates past/future…) and sent back to fix. |
| `Code` | Code in an answer is run before you see it; any "Output" shown is what really printed. |
| `Pictures` | On the page: 📎 → Images (or Take a photo on a phone). gemma3 on this Mac describes it and reads its text; on a phone, Gemini. Check exact figures — small models can misread a digit. |
| `Files and folders` | On the page: 📎 → Files (PDF, Excel, Word, PowerPoint, CSV, text, code) or Folder (its text and code files, up to 40). Each Excel sheet becomes a table. |
| `Analysing tables` | Every table gets an exact summary worked out in code: totals, averages, and totals per category and per month. Its files are also in the code sandbox, so it can run Python on the real data. |
| `Learning` | Mistakes caught become lessons for questions like them; your corrections, 👍 answers and the weekly self-exam too. |

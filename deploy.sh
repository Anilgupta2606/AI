#!/bin/sh
# Publish the AI engine into the site (anilgupta2606.github.io/ai/), where every app loads it.
# Runs every test and exam first; stops if one fails.  Usage: ./deploy.sh   (the relay: npm run relay:deploy)
set -e
cd "$(dirname "$0")"
SITE="${SITE:-../Anilgupta2606.github.io}"
npm test --silent
node --check relay/worker.js
REV="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
mkdir -p "$SITE/ai"
cp engine/ai.js engine/brain.js engine/ask.js engine/web.js "$SITE/ai/"
mkdir -p "$SITE/ai/chat" && cp cli/ui.html "$SITE/ai/chat/index.html"          # the AI's own page (the same one the Mac serves)
cp cli/market.mjs "$SITE/ai/market.mjs"                                        # the market analysis, for the browser (prices via the relay)
cd "$SITE"
git add ai/ai.js ai/brain.js ai/ask.js ai/web.js ai/market.mjs ai/chat/index.html
if git diff --cached --quiet; then echo "The site already has AI $REV."; exit 0; fi
git commit -q -m "AI engine $REV (published from the AI repo)"
git push -q
echo "Published AI $REV - live in a minute at https://anilgupta2606.github.io/ai/ (the page: /ai/chat/)"

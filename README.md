# Satoyama GP

An arcade racing game for the browser and Steam Deck, built with three.js. Four courses run from rural Japan to the city: Sakura Valley Circuit, Hakone Lakes Pass, the Shonan Coastal Highway and the Tokyo Shuto Expressway at night. Race AI rivals alone, or up to six drivers online.

## Features

- Procedural terrain, roads, guardrails, flora, lakes and a night-time city with neon signage and skyline panoramas.
- Vehicle physics with AI rivals, lap timing and a results screen.
- Online races over a zero-dependency WebSocket relay (`relay.mjs`). Each client simulates its own car and the relay only forwards state between drivers in a room.
- Gamepad and keyboard input, graphics presets and post-processing, with settings saved locally.
- Synthesized engine audio and generated race music.

## Running locally

```bash
npm install
npm run dev        # Vite dev server
npm run build      # production build into dist/
node server.mjs    # serves dist/ plus the /ws race relay
```

[STEAMDECK_SETUP.md](STEAMDECK_SETUP.md) covers installing it on a Steam Deck as an auto-updating kiosk app.

## Assets

Textures, skyline panoramas and music were generated with Google's models, and 3D models with the TRELLIS.2 pipeline. The scripts in `tools/` regenerate them. `generate_textures.sh` and `generate_music.sh` call `tools/genai.py`, a small client for the public Gemini API, so set `GEMINI_API_KEY` before running them.


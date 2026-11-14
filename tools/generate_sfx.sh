#!/usr/bin/env bash
# Generates the sound-effect set with the ElevenLabs Sound Effects API and writes
# compact MP3s to public/audio/sfx/<name>.mp3 (served at /audio/sfx/). The game
# keeps its synthesised engine and simply stays quiet for any file that is missing.
#
# The key is read from $ELEVENLABS_API_KEY, else ./.env, else ../gothic/.env
# (either ELEVENLABS_API_KEY=... or ELEVENLABS=...). .env is git-ignored.
#
#   bash tools/generate_sfx.sh              # generate missing effects
#   FORCE=1 bash tools/generate_sfx.sh go   # re-roll one
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for env in "${ROOT}/.env" "${ROOT}/../gothic/.env"; do
  if [ -z "${ELEVENLABS_API_KEY:-}${ELEVENLABS:-}" ] && [ -f "${env}" ]; then set -a; . "${env}"; set +a; fi
done
ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-${ELEVENLABS:-}}"
: "${ELEVENLABS_API_KEY:?Set ELEVENLABS_API_KEY in .env (ElevenLabs account -> Profile -> API keys)}"
OUT="${ROOT}/public/audio/sfx"
mkdir -p "${OUT}"

# name | kind | duration seconds | prompt
#   shot: trimmed of leading/trailing silence and loudness-normalised
#   loop: tail cross-faded into the head so it repeats seamlessly, mono
# checkpoint, final_lap and finish are layered stingers: see tools/generate_stingers.py
SFX=(
  "count|shot|0.5|single short electronic race start light beep, clean mid-pitch sine tone, dry, no reverb"
  "go|shot|1.0|single long bright high-pitched electronic race start beep, green light go signal, clean, dry"
  "ui_start|shot|0.8|arcade racing game menu confirm, bright synth chime with a fast rising whoosh, punchy"
  "lap|shot|1.2|arcade racing lap completed jingle, bright three-note rising synth bell arpeggio, short, clean"
  "impact_light|shot|0.5|car bumper bump, dull plastic and metal thud, light fender tap, dry, close, short"
  "impact_heavy|shot|1.0|car crash into a metal guardrail, heavy metal crunch with a short glass and debris rattle, dry, close, punchy"
  "scrape|shot|0.9|car body scraping along a metal guardrail at speed, harsh grinding metal screech, short, dry"
  "shift|shot|0.5|sports car sequential gear shift, quick mechanical clunk with a short turbo blow-off hiss, dry, close"
  "whoosh|shot|0.7|fast car passing by very close, quick doppler air whoosh, short, dry"
  "wrong_way|shot|1.2|arcade warning alarm, three fast harsh descending buzzer beeps, short, dry"
  "reset|shot|0.9|soft magical teleport whoosh with a gentle sparkle, respawn sound, short"
  "skid|loop|5.0|continuous car tyres skidding and screeching on asphalt, steady sustained tyre squeal, no engine, no start, no stop"
  "gravel|loop|5.0|continuous car tyres rolling fast over loose gravel and dirt, steady crunchy rumble, no engine, no start, no stop"
  "ambience|loop|22.0|peaceful Japanese countryside in spring, gentle breeze through trees, bush warbler and sparrow birdsong, a distant stream, calm steady natural ambience, no music, no people"
)

for entry in "${SFX[@]}"; do
  IFS='|' read -r name kind dur prompt <<< "${entry}"
  if [ "$#" -gt 0 ] && [[ ! " $* " == *" ${name} "* ]]; then continue; fi
  dst="${OUT}/${name}.mp3"
  if [ -z "${FORCE:-}" ] && [ -s "${dst}" ]; then echo "= ${name} exists"; continue; fi
  tmp="/tmp/satoyama_sfx_${name}.mp3"
  echo "> ${name} (${kind}, ${dur}s)"   # the endpoint accepts 0.5s..22s
  curl -sS --fail-with-body -X POST "https://api.elevenlabs.io/v1/sound-generation" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "duration_seconds": float(sys.argv[2]), "prompt_influence": 0.55}))' "${prompt}" "${dur}")" \
    -o "${tmp}" || { echo "ERROR ${name}: $(head -c 400 "${tmp}")"; rm -f "${tmp}"; continue; }
  if [ "${kind}" = "loop" ]; then
    total="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmp}")"
    fade="$(python3 -c 'import sys; print(min(1.5, float(sys.argv[1]) * 0.2))' "${total}")"
    ffmpeg -y -hide_banner -loglevel error -i "${tmp}" -filter_complex \
      "[0]loudnorm=I=-20:TP=-2:LRA=7,asplit[a][b];[a]atrim=start=${fade},asetpts=N/SR/TB[body];[b]atrim=end=${fade},asetpts=N/SR/TB[head];[body][head]acrossfade=d=${fade}:c1=qsin:c2=qsin" \
      -ac 1 -ar 44100 -codec:a libmp3lame -qscale:a 4 "${dst}"
  else
    # Trim silence so hits land on the frame that triggers them
    ffmpeg -y -hide_banner -loglevel error -i "${tmp}" \
      -af "silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.08:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-1.5:LRA=9" \
      -ar 44100 -codec:a libmp3lame -qscale:a 4 "${dst}"
  fi
  rm -f "${tmp}"
done
ls -la "${OUT}"
echo "SFX_DONE"

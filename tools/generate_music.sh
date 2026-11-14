#!/usr/bin/env bash
# Generates the Lyria 3 score into public/audio/music/<name>.mp3 (served at /audio/music/).
#
# Lyria decides the length of a full song itself, so each track is asked for the
# longest form it will write and re-rolled up to TRIES times; the longest take wins.
# Takes are kept in /tmp/satoyama_music so a re-run only fills in what is missing.
#
#   bash tools/generate_music.sh            # generate missing tracks
#   FORCE=1 bash tools/generate_music.sh    # re-roll everything
#   MIN_SECONDS=200 TRIES=4 bash tools/generate_music.sh race1
set -u
G=tools/genai.py
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/public/audio/music"
TMP=/tmp/satoyama_music
MIN_SECONDS="${MIN_SECONDS:-170}"   # stop re-rolling once a take is at least this long
TRIES="${TRIES:-3}"
mkdir -p "${OUT_DIR}" "${TMP}"

STYLE="Write the longest full-length piece you can: an extended instrumental of well over three minutes with an intro, main theme, second verse, a contrasting bridge, a solo section, a breakdown, a final big chorus and an outro that leads back into the intro so it loops. Instrumental video game soundtrack for a sunny arcade racing game set on a mountain road through the Japanese countryside in cherry-blossom season. Polished, bright, punchy studio mix. No vocals, no lyrics, no spoken words, instrumental only."

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | cut -d. -f1; }

gen() {
  local name="$1"; shift
  local dst="${OUT_DIR}/${name}.mp3"
  if [ -z "${FORCE:-}" ] && [ -s "${dst}" ]; then echo "= ${name} exists ($(dur "${dst}")s)"; return; fi
  local best="" best_d=0 i take d
  for i in $(seq 1 "${TRIES}"); do
    take="${TMP}/${name}_${i}.mp3"
    if [ -n "${FORCE:-}" ] || [ ! -s "${take}" ]; then
      rm -f "${take}"
      "$G" -prod -timeout=600s -output="${take}" music -model=lyria-3-full-song-mp3 "$* ${STYLE}" 2>&1 \
        | grep -E "Successfully|rror|denied|quota" | tail -2
    fi
    [ -s "${take}" ] || { echo "! ${name} take ${i} failed"; continue; }
    d="$(dur "${take}")"; d="${d:-0}"
    echo "> ${name} take ${i}: ${d}s"
    if [ "${d}" -gt "${best_d}" ]; then best="${take}"; best_d="${d}"; fi
    [ "${best_d}" -ge "${MIN_SECONDS}" ] && break
  done
  if [ -n "${best}" ]; then
    cp "${best}" "${dst}"; chmod 644 "${dst}"
    echo "+ ${name}: ${best_d}s"
  else
    echo "ERROR ${name}: no take succeeded"
  fi
}

declare -A TRACKS=(
  [title]="Title screen theme: breezy, nostalgic Japanese city pop and jazz fusion at 104 BPM in E major, warm electric piano chords, clean chorus guitar, fretless bass, soft brushed drums, a lyrical koto and shakuhachi melody, shimmering synth pads, a gentle wind-chime sparkle. Relaxed, sunny, inviting, a touch wistful."
  [race1]="Main race theme: high-energy arcade racing jazz fusion at 168 BPM in A major, slap bass, tight driving drums with fast hi-hats, bright brass section stabs, a soaring lead synth trading the melody with a shamisen, funky clean rhythm guitar, an electric piano solo, key change up for the last chorus. Exhilarating, joyful, full throttle."
  [race2]="Race theme: driving melodic eurobeat-flavoured synth rock at 158 BPM in D minor turning to F major in the chorus, galloping synth bass, punchy four-on-the-floor kick and snare, saw lead hooks, taiko drum fills, a koto riff answering an electric guitar lead, a guitar solo in the bridge. Fast, determined, heroic, sunlit."
  [race3]="Race theme: uplifting drum and bass meets Japanese fusion at 174 BPM in G major, rolling breakbeats, deep warm sub bass, airy pads, sparkling piano riffs, a shakuhachi and violin lead melody, plucked koto arpeggios, a breakdown with only piano and wind before the drums slam back in. Flowing, fast, blue-sky euphoria."
  [results]="Results screen theme after the race: laid-back celebratory jazz funk at 112 BPM in B-flat major, smooth electric piano, walking fretless bass, light funky drums, warm horn section riffs, a mellow saxophone lead with koto ornaments, hand claps in the chorus. Satisfied, proud, sunset glow."
)
ORDER=(title race1 race2 race3 results)
[ "$#" -gt 0 ] && ORDER=("$@")

for name in "${ORDER[@]}"; do
  [ -n "${TRACKS[$name]:-}" ] || { echo "unknown track: ${name}"; continue; }
  gen "${name}" "${TRACKS[$name]}" &
done
wait
ls -la "${OUT_DIR}"
echo "MUSIC_DONE"

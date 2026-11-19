#!/usr/bin/env bash
# Generates the Lyria score into public/audio/music/<name>.mp3 (served at /audio/music/).
#
# Lyria decides the length of a full song itself, so each track is asked for the
# longest form it will write and re-rolled up to TRIES times; the longest take wins.
# Takes are kept in /tmp/satoyama_music so a re-run only fills in what is missing.
#
#   bash tools/generate_music.sh            # generate missing tracks
#   FORCE=1 bash tools/generate_music.sh    # re-roll everything
#   MIN_SECONDS=200 TRIES=4 bash tools/generate_music.sh race1
set -u
GENAI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/genai.py"
genai() { python3 "$GENAI" "$@"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/public/audio/music"
TMP=/tmp/satoyama_music
MIN_SECONDS="${MIN_SECONDS:-170}"   # stop re-rolling once a take is at least this long
TRIES="${TRIES:-3}"
TARGET_LUFS="${TARGET_LUFS:--16.5}"
mkdir -p "${OUT_DIR}" "${TMP}"

STYLE="Write the longest full-length piece you can: an extended instrumental of well over three minutes with an intro, build-up, a hard-hitting drop, a second verse, a breakdown, a bigger second drop and an outro that leads back into the intro so it loops. Modern racing video game soundtrack, the kind of current electronic music heard in today's big-budget street and festival racing games: contemporary club-ready production, a loud punchy beat that never lets up, heavy sidechained sub bass, crisp modern drums, wide glossy synths, cinematic risers and impacts. Unmistakably Japanese: traditional Japanese instruments (shamisen, koto, shakuhachi, taiko) and Japanese pentatonic melodies are featured as the lead hooks on top of the electronic beat, set on a mountain road through the Japanese countryside in cherry-blossom season. Loud, clean, polished 2020s master. No vocals, no lyrics, no spoken words, instrumental only."

# Night-city courses keep the production brief but swap the countryside setting for the city and ask for a brighter mood.
STYLE_CITY="${STYLE/set on a mountain road through the Japanese countryside in cherry-blossom season/set on the neon-lit elevated expressways of Tokyo at night. Bright, upbeat, feel-good major-key energy throughout, never dark or moody}"

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | cut -d. -f1; }

gen() {
  local name="$1"; shift
  local dst="${OUT_DIR}/${name}.mp3"
  if [ -z "${FORCE:-}" ] && [ -s "${dst}" ]; then echo "= ${name} exists ($(dur "${dst}")s)"; return; fi
  local best="" best_d=0 i take d style="${STYLE}"
  case "${name}" in tokyo*) style="${STYLE_CITY}" ;; esac
  for i in $(seq 1 "${TRIES}"); do
    take="${TMP}/${name}_${i}.mp3"
    if [ -n "${FORCE:-}" ] || [ ! -s "${take}" ]; then
      rm -f "${take}"
      genai music --timeout=600 --out="${take}" "$* ${style}" 2>&1 \
        | grep -E "Successfully|rror|denied|quota" | tail -2
    fi
    [ -s "${take}" ] || { echo "! ${name} take ${i} failed"; continue; }
    d="$(dur "${take}")"; d="${d:-0}"
    echo "> ${name} take ${i}: ${d}s"
    if [ "${d}" -gt "${best_d}" ]; then best="${take}"; best_d="${d}"; fi
    [ "${best_d}" -ge "${MIN_SECONDS}" ] && break
  done
  if [ -n "${best}" ]; then
    # Lyria masters vary by ~5 dB from track to track: bring each to the same loudness with a plain gain
    # (plus a safety limiter) so the playlist does not jump in level.
    local lufs gain
    lufs="$(ffmpeg -hide_banner -nostats -i "${best}" -af ebur128=framelog=quiet -f null - 2>&1 | awk '/^ +I:/ { v = $2 } END { print v }')"
    gain="$(python3 -c 'import sys; print(round(max(-12, min(12, float(sys.argv[1]) - float(sys.argv[2]))), 2))' "${TARGET_LUFS}" "${lufs:-${TARGET_LUFS}}")"
    ffmpeg -y -hide_banner -loglevel error -i "${best}" -af "volume=${gain}dB,alimiter=limit=0.94:level=disabled" -codec:a libmp3lame -b:a 192k "${dst}"
    chmod 644 "${dst}"
    echo "+ ${name}: ${best_d}s, ${lufs} LUFS -> ${gain} dB"
  else
    echo "ERROR ${name}: no take succeeded"
  fi
}

declare -A TRACKS=(
  [title]="Title screen theme: moody, confident melodic trap and future bass at 150 BPM half-time in D minor, booming 808 sub bass, crisp trap hi-hat rolls and a heavy snare on the half-time backbeat, a hypnotic plucked koto hook, breathy shakuhachi phrases, wide supersaw chords swelling in the drop, deep taiko hits as impacts. Cool, stylish, anticipation before a street race at dawn."
  [race1]="Main race theme: high-octane modern drum and bass at 174 BPM in F minor, fast punchy two-step breakbeat, growling reese bass and deep sub, an aggressive tsugaru shamisen riff as the main hook answered by a soaring supersaw lead, thundering taiko fills into every drop, shakuhachi stabs, a half-time breakdown with koto before the final drop. Relentless, adrenaline, flat-out speed."
  [race2]="Race theme: hard-hitting Japanese drift phonk and trap at 140 BPM in C-sharp minor, distorted booming 808 bass slides, a driving cowbell melody, crunchy claps and rapid hi-hats, a dark catchy shamisen hook doubled by a detuned synth lead, koto arpeggios, taiko and big impacts on the drops, tyre-smoke swagger. Aggressive, menacing, night-time mountain pass touge drifting energy."
  [race3]="Race theme: festival bass house and electro at 128 BPM in G minor, pumping four-on-the-floor kick with heavy sidechain, a gritty wobbling bassline, offbeat open hats and claps, a bright anthemic koto and supersaw melody over the drop, taiko ensemble rolls in the build-ups, shakuhachi lead in the breakdown, huge festival-style risers. Euphoric, sunlit, big-crowd racing festival energy."
  [results]="Results screen theme after the race: confident modern chill trap and future garage beat at 96 BPM in A minor, deep warm 808 sub, crisp swung hi-hats, snappy snare and rimshots, a laid-back plucked koto melody with shakuhachi answers, lush filtered synth pads, soft taiko accents, vinyl-free clean modern sound. Cool-down, victorious, golden-hour afterglow."
)
# Hakone Lakes Pass has its own playlist (levels.js `music`).
TRACKS[hakone1]="Race theme for a mountain lake road at golden hour: uplifting liquid drum and bass at 172 BPM in E minor, rolling breakbeat with crisp ghost snares, a warm deep sub bass, a shimmering koto arpeggio as the main hook, long expressive shakuhachi melodies, wide airy pads, bright piano chords in the drops and a soaring emotional lead; fast and flowing, wistful but driving, the feeling of chasing the sunset along the water. Instrumental, no vocals."
TRACKS[hakone2]="Race theme for hairpin bends through a cedar forest at dusk: high-energy 1990s style eurobeat and italo disco at 156 BPM in B minor, pounding four-on-the-floor kick, galloping octave synth bass, bright brass stabs, a blazing fast tsugaru shamisen riff trading phrases with a glossy supersaw lead, dramatic key lifts into each chorus, taiko fills before the drops; relentless, heroic, pure mountain-pass adrenaline. Instrumental, no vocals."
# Coastal sea course has its own sunlit ocean-highway playlist (levels.js `music`).
TRACKS[coast1]="Race theme for a sunlit Japanese coastal highway beside crashing turquoise ocean surf: euphoric high-tempo Japanese city-pop fusion and melodic drum and bass at 170 BPM in A major, crisp rolling breakbeat, slap-bass groove layered over warm sub bass, sparkling electric piano chords, soaring brass section hits, bright clean rhythm guitar skanks, and a joyous glossy synth-and-saxophone lead trading phrases with plucked shamisen runs; breezy, sun-drenched summer ocean drive adrenaline. Instrumental, no vocals."
TRACKS[coast2]="Race theme for sweeping cliffside ocean bends and fishing villages by the sea: driving melodic progressive house and nu-disco synthwave at 132 BPM in F-sharp minor lifting to A major, punchy four-on-the-floor kick, pumping sidechained arpeggiated synth bass, shimmering 12-string guitar and koto plucks, bright trumpet and synth brass stabs, crashing surf-like white-noise risers into a huge sunlit anthemic chorus lead; exhilarating open-water horizon energy. Instrumental, no vocals."
# Tokyo Shuto Expressway has its own neon night-expressway playlist (levels.js `music`).
TRACKS[tokyo1]="Race theme for a joyful night drive through neon-lit Tokyo: bright, upbeat Japanese future funk and city-pop nu-disco house at 128 BPM in E-flat major, bouncy four-on-the-floor kick with hand claps, a funky octave-jumping slap bass groove, chicken-scratch rhythm guitar, sparkling electric piano major-seventh chords, punchy chopped brass stabs, glittering synth arpeggios and an irresistibly catchy, happy lead synth hook doubled by plucked koto, with a filter-sweep breakdown and an even bigger feel-good final chorus with a key lift. Fun, glamorous, dance-floor energy, smiling at 200 km/h. Instrumental, no vocals."
TRACKS[tokyo2]="Race theme for flat-out fun on the Tokyo expressway at night: exhilarating, upbeat high-energy Japanese arcade racing eurobeat and J-pop style hyper dance at 158 BPM in A major, pounding four-on-the-floor kick, galloping octave synth bass, bright triumphant supersaw anthem melody, blazing tsugaru shamisen riffs answering the lead, sparkling bell arpeggios, snare-roll build-ups, crowd-pleasing key change into the last chorus, taiko fills before each drop. Sunny, heroic, celebratory, pure arcade joy and speed. Instrumental, no vocals."
ORDER=(title race1 race2 race3 results hakone1 hakone2 coast1 coast2 tokyo1 tokyo2)
[ "$#" -gt 0 ] && ORDER=("$@")

for name in "${ORDER[@]}"; do
  [ -n "${TRACKS[$name]:-}" ] || { echo "unknown track: ${name}"; continue; }
  gen "${name}" "${TRACKS[$name]}" &
done
wait
ls -la "${OUT_DIR}"
echo "MUSIC_DONE"

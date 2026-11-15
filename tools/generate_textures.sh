#!/usr/bin/env bash
# Generates the gemini-image texture maps for the city course into public/textures/city/*.webp.
# Images are generated into /tmp/satoyama_tex (kept, so a re-run only fills in what is missing), then cropped,
# scaled and converted with ffmpeg. The game tiles them with mirrored repeat, so they need not be seamless.
#   bash tools/generate_textures.sh
set -u
G=tools/genai.py
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="${ROOT}/public/textures/city"
mkdir -p /tmp/satoyama_tex "${D}"
gen() { local n="$1"; shift; [ -s "/tmp/satoyama_tex/$n.png" ] && return; "$G" -prod -timeout=90s -output="/tmp/satoyama_tex/$n.png" image -model=gemini-image-2-flash-lite-png "$*" 2>&1 | grep -E "Successfully|rror" | tail -1; }
FLAT="Seamless tileable texture, perfectly flat orthographic straight-on front elevation filling the entire frame edge to edge, no perspective, no sky, no ground, no building edges, no text, photorealistic, sharp."
gen facade_glass "$FLAT Modern Tokyo glass curtain-wall office tower facade at night: a regular grid of 12 columns by 16 floors of rectangular office windows separated by slim dark aluminium mullions and dark spandrel bands, about sixty percent of the windows lit from inside in varied warm white and cool white with faint glimpses of ceilings, desks and blinds, the rest dark reflective glass." &
gen facade_office "$FLAT Japanese mid-rise office building facade at night clad in pale grey ceramic tiles with eight floors of long horizontal ribbon windows in aluminium frames, about half of the windows lit warm white and cool white showing ceilings and blinds, the others dark, thin floor bands, subtle rain streaks." &
gen facade_apartment "$FLAT Japanese residential apartment block facade at night: a regular grid of ten floors by eight bays of balconies with white railings on cream tiled walls, sliding glass doors behind, roughly half glowing warm yellow through curtains, some with laundry poles and air-conditioner units, the rest dark." &
gen facade_retail "Seamless tileable texture, perfectly flat orthographic straight-on front elevation filling the entire frame edge to edge, no perspective, no sky, photorealistic, sharp: one continuous row of five glowing ground-floor Japanese city shopfronts at night separated by dark tiled pillars: a noodle restaurant with plain indigo noren curtains and warm paper lanterns, a bright convenience store window with stocked shelves, a game arcade entrance outlined in pink and cyan neon tubes, a wood-fronted cafe with plants, a white-lit pharmacy. Above each shop a plain blank glowing light-box fascia in a single flat colour. Absolutely no writing anywhere: no letters, no kanji, no kana, no numbers, no logos, every sign is a blank coloured panel" &
wait
gen billboard_a "Glowing LED billboard advertisement artwork filling the whole frame: a steaming bowl of ramen with chopsticks on a deep red background with bold abstract graphic shapes, vivid, high contrast, flat graphic poster design, no text, no letters, no logos" &
gen billboard_b "Glowing LED billboard advertisement artwork filling the whole frame: a retro city-pop illustration of a pink and orange sunset over the sea with palm trees and a cyan grid horizon, vivid neon colours, flat graphic poster design, no text, no letters, no logos" &
gen billboard_c "Glowing LED billboard advertisement artwork filling the whole frame: an ice-cold soda can splashing with droplets on an electric blue background with bold diagonal stripes, vivid, high contrast, flat graphic poster design, no text, no letters, no logos, blank can" &
wait
gen billboard_d "Glowing LED billboard advertisement artwork filling the whole frame: a stylised lucky cat maneki-neko figurine on a bright yellow and magenta sunburst background, vivid, high contrast, flat graphic poster design, no text, no letters, no logos" &
gen pavement "Seamless tileable texture, perfectly flat top-down orthographic photograph of a clean Japanese city sidewalk: grey rectangular concrete paving slabs in a running bond pattern with thin dark joints, subtle stains and wear, evenly lit overcast daylight, no shadows, no objects, no text, photorealistic, sharp" &
# gen plaza "Seamless tileable texture, perfectly flat top-down orthographic photograph of worn dark city asphalt and concrete car park surface with faint cracks, oil stains and patched tar seams, evenly lit overcast daylight, no shadows, no markings, no objects, no text, photorealistic, sharp" &
wait
cd /tmp/satoyama_tex
W="-c:v libwebp -quality 84 -loglevel error -y"
ffmpeg -i facade_glass.png -vf scale=1024:-2 $W "$D/facade_glass.webp"
ffmpeg -i facade_office.png -vf scale=768:-2 $W "$D/facade_office.webp"
ffmpeg -i facade_apartment.png -vf scale=928:-2 $W "$D/facade_apartment.webp"
ffmpeg -i facade_retail.png -vf "crop=iw:ih*0.86:0:ih*0.06,scale=1536:-2" $W "$D/facade_retail.webp"
# the billboard art comes back framed by a little scenery: keep the middle (check the crops after re-generating)
ffmpeg -i billboard_a.png -vf "crop=iw*0.86:ih*0.86:iw*0.07:ih*0.07,scale=512:-2" $W "$D/billboard_a.webp"
ffmpeg -i billboard_b.png -vf "crop=iw*0.72:ih*0.68:iw*0.14:ih*0.16,scale=768:-2" $W "$D/billboard_b.webp"
ffmpeg -i billboard_c.png -vf "crop=iw*0.68:ih*0.64:iw*0.16:ih*0.15,scale=768:-2" $W "$D/billboard_c.webp"
ffmpeg -i billboard_d.png -vf "crop=iw*0.90:ih*0.90:iw*0.05:ih*0.05,scale=768:-2" $W "$D/billboard_d.webp"
ffmpeg -i pavement.png -vf "crop=ih:ih:(iw-ih)/2:0,scale=512:512" $W "$D/pavement.webp"
ls -la "$D"

# ---- road, lawn and far-skyline maps. The skylines are generated on chroma green and keyed to alpha.
G2() { local n="$1"; shift; [ -s "/tmp/satoyama_tex/$n.png" ] || "$G" -prod -timeout=90s -output="/tmp/satoyama_tex/$n.png" image -model=gemini-image-2-flash-lite-png "$*" 2>&1 | grep -E "Successfully|rror" | tail -1; }
KEY="Everything behind and above the buildings is a perfectly flat uniform pure chroma-key green (#00FF00) background with no sky, no clouds, no glow, no water, no reflection, no ground. Photorealistic, sharp"
G2 asphalt "Top-down flat view of a rain-damp city road surface at night for a racing game ground texture: dark charcoal asphalt with fine stone aggregate, faint darker tar seams running lengthwise, slight sheen in shallow worn wheel tracks, tiny scattered lighter chips. Uniform coverage edge to edge, no painted lines, no objects, no perspective, even neutral lighting"
G2 lawn "Seamless tileable texture, perfectly flat top-down orthographic photograph of a neatly mown city park lawn, short dense green grass with subtle mowing variation and a few clover patches, evenly lit overcast daylight, no shadows, no objects, no paths, photorealistic, sharp"
G2 skyline_a "Ultra-wide panoramic strip: the distant skyline of a huge Japanese metropolis at night seen from far across a bay, a continuous dense row of dozens of high-rise office towers and apartment blocks of varied heights with a few taller skyscrapers, thousands of tiny lit windows in warm white and cool white, red aviation warning lights on rooftops, a few small colourful illuminated signs, buildings standing side by side in one straight flat row with a level base along the bottom edge of the image. $KEY"
G2 skyline_b "Ultra-wide panoramic strip: a distant night-time city skyline of a Japanese downtown business district seen from far away, one continuous straight row of many modern glass skyscrapers and mid-rise blocks of clearly different heights standing side by side, lit office windows in grids, illuminated crowns, red rooftop beacon lights, level base along the bottom edge of the image. $KEY"
cd /tmp/satoyama_tex
ffmpeg -i asphalt.png -vf "scale=1024:-2" $W "$D/asphalt.webp"
ffmpeg -i lawn.png -vf "crop=ih:ih:(iw-ih)/2:0,scale=512:512" $W "$D/lawn.webp"
# crop to the band of buildings (check the fractions after re-generating), then key out the green
ffmpeg -i skyline_a.png -vf "crop=iw:ih*0.47:0:ih*0.265,colorkey=0x18F010:0.30:0.06,despill=type=green:mix=0.9,format=yuva420p" $W "$D/skyline_a.webp"
ffmpeg -i skyline_b.png -vf "crop=iw:ih*0.43:0:ih*0.375,colorkey=0x18F010:0.30:0.06,despill=type=green:mix=0.9,format=yuva420p" $W "$D/skyline_b.webp"

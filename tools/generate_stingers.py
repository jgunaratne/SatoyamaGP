#!/usr/bin/env python3
"""Builds the checkpoint, final-lap and finish stingers by layering ElevenLabs sound effects.

Asked for a whole stinger in one prompt, the model returns one element of it (a lone pluck,
or a lone thump). So each stinger is designed the way a sound designer would: one focused
prompt per layer (whoosh, hit, sub, melody, shimmer), each trimmed and peak-normalised, then
placed on a timeline and mixed with ffmpeg.

  public/audio/sfx/checkpoint.mp3, final_lap.mp3, finish.mp3

  python3 tools/generate_stingers.py                       # build missing stingers
  python3 tools/generate_stingers.py --force final_lap     # re-roll every layer of one
  python3 tools/generate_stingers.py --force final_lap:2   # re-roll a single layer (index from 0)
Layers are cached in /tmp/satoyama_stingers. Needs ffmpeg; standard library only.
Key: $ELEVENLABS_API_KEY, else ./.env, else ../gothic/.env (ELEVENLABS_API_KEY= or ELEVENLABS=).
"""
import json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'audio', 'sfx')
TMP = '/tmp/satoyama_stingers'

# layer: (prompt, seconds to ask for, gain dB, anchor, time s)
#   anchor 'start': the layer begins at `time`;  'end': the layer finishes at `time` (risers into a hit)
STINGERS = {
    'checkpoint': [
        ('quick soft airy upward whoosh swish, short, clean, no impact', 0.5, -9, 'end', 0.22),
        ('single bright koto pluck layered with a glassy synth bell, one clear high major-key note, clean, ringing, no reverb wash', 1.2, -1, 'start', 0.16),
        ('second higher bright koto pluck with a glassy synth bell, one clear note a fifth above, clean, ringing', 1.2, -2, 'start', 0.30),
        ('tight punchy deep sub bass kick thump, single short hit, electronic, clean', 0.5, -5, 'start', 0.16),
        ('delicate sparkling high chime shimmer, short magical glitter tail, soft', 1.2, -13, 'start', 0.30),
    ],
    'final_lap': [
        ('rising synth riser sweep with accelerating snare roll, building tension, cuts off abruptly at the top', 1.0, -7, 'end', 0.95),
        ('huge cinematic boom impact with a deep sub drop, single massive hit, modern trailer style', 2.0, -3, 'start', 0.90),
        ('two thundering taiko drum hits in quick succession, big Japanese festival drums, powerful, dry', 1.0, -3, 'start', 0.90),
        ('urgent bright synth brass fanfare stab, two rising notes, heroic racing game alert, punchy, modern', 1.4, -2, 'start', 0.95),
        ('single sharp aggressive shamisen strum strike, bright and percussive, dry', 0.8, -5, 'start', 0.90),
    ],
    'finish': [
        ('fast rising synth riser whoosh building to a peak, cuts off abruptly at the top', 0.8, -8, 'end', 0.75),
        ('huge cinematic boom impact with a deep sub drop, single massive hit, modern trailer style', 2.0, -4, 'start', 0.70),
        ('triumphant modern synth brass victory fanfare, bright ascending major-key four-note phrase ending on a big held chord, '
         'festival EDM racing game win jingle, punchy, euphoric', 3.5, -1, 'start', 0.75),
        ('fast celebratory taiko drum roll ending on one big accented hit, Japanese festival drums, powerful', 1.6, -5, 'end', 2.3),
        ('large outdoor festival crowd erupting into cheers, applause and whistles, celebration, fading out', 5.0, -9, 'start', 0.8),
        ('fireworks bursting and crackling in the sky, several bright pops with sparkling crackle, celebration', 3.5, -11, 'start', 1.6),
        ('bright sparkling ascending chime glissando shimmer, magical victory glitter', 1.5, -11, 'start', 0.8),
    ],
}


def api_key():
    for k in ('ELEVENLABS_API_KEY', 'ELEVENLABS'):
        if os.environ.get(k):
            return os.environ[k]
    for env in (os.path.join(ROOT, '.env'), os.path.join(ROOT, '..', 'gothic', '.env')):
        if os.path.isfile(env):
            for line in open(env):
                k, _, v = line.strip().partition('=')
                if k.replace('export ', '').strip() in ('ELEVENLABS_API_KEY', 'ELEVENLABS') and v:
                    return v.strip().strip('"\'')
    sys.exit('Set ELEVENLABS_API_KEY in .env')


def generate(prompt, seconds, path, key):
    body = json.dumps({'text': prompt, 'duration_seconds': max(0.5, seconds), 'prompt_influence': 0.6}).encode()
    req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation', data=body,
                                 headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            open(path, 'wb').write(r.read())
        return True
    except urllib.error.HTTPError as e:
        print(f'  ! API error {e.code}: {e.read()[:300].decode(errors="replace")}')
        return False


def ff(*args):
    return subprocess.run(['ffmpeg', '-y', '-hide_banner', '-nostats', *args], capture_output=True, text=True, check=True).stderr


def prepare(raw, wav):
    """Trim leading/trailing silence and peak-normalise to -1 dBFS; returns the duration."""
    trim = ('silenceremove=start_periods=1:start_silence=0.005:start_threshold=-40dB,areverse,'
            'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse')
    peak = float(re.search(r'max_volume: (-?[\d.]+) dB', ff('-i', raw, '-af', trim + ',volumedetect', '-f', 'null', '-')).group(1))
    ff('-i', raw, '-af', f'{trim},volume={-1 - peak:.2f}dB,afade=t=in:d=0.004', '-ar', '44100', '-ac', '2', wav)
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav],
                                capture_output=True, text=True, check=True).stdout)


def build(name, force, key):
    wavs, starts = [], []
    for k, (prompt, seconds, gain, anchor, at) in enumerate(STINGERS[name]):
        raw = os.path.join(TMP, f'{name}_{k}.mp3')
        if (force is True or force == k or not os.path.isfile(raw)) and not generate(prompt, seconds, raw, key):
            return False
        wav = os.path.join(TMP, f'{name}_{k}.wav')
        dur = prepare(raw, wav)
        start = max(0.0, at - dur if anchor == 'end' else at)
        print(f'  {name}[{k}] {dur:.2f}s at {start:.2f}s {gain:+d} dB  {prompt[:60]}')
        wavs.append(wav); starts.append(start)
    shift = min(starts)  # no dead air before the first layer
    graph = ''.join(f'[{k}]volume={STINGERS[name][k][2]}dB,adelay={round((s - shift) * 1000)}:all=1[l{k}];' for k, s in enumerate(starts))
    graph += ''.join(f'[l{k}]' for k in range(len(wavs))) + f'amix=inputs={len(wavs)}:normalize=0:duration=longest,alimiter=limit=0.89:level=disabled[m]'
    mixed = os.path.join(TMP, f'{name}_mix.wav')
    ff(*sum((['-i', w] for w in wavs), []), '-filter_complex', graph, '-map', '[m]', mixed)
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mixed], capture_output=True, text=True, check=True).stdout)
    ff('-i', mixed, '-af', f'afade=t=out:st={max(0, total - 0.25):.2f}:d=0.25', '-codec:a', 'libmp3lame', '-qscale:a', '3', os.path.join(OUT, f'{name}.mp3'))
    print(f'+ {name}.mp3: {total:.2f}s, {len(wavs)} layers')
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    key = api_key()
    for arg in args or STINGERS:
        name, _, layer = arg.partition(':')
        if name not in STINGERS:
            print(f'unknown stinger: {name}'); continue
        if not force and os.path.isfile(os.path.join(OUT, f'{name}.mp3')) and os.path.isfile(os.path.join(TMP, f'{name}_mix.wav')):
            print(f'= {name} exists'); continue
        build(name, (int(layer) if layer else True) if force else False, key)


if __name__ == '__main__':
    main()

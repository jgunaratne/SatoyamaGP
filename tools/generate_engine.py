#!/usr/bin/env python3
"""Builds the sampled engine: steady-rpm loops from the ElevenLabs Sound Effects API.

The game cross-fades these loops by rpm and pitches each one with playbackRate, so it has
to know the real engine speed of every recording. The model only roughly honours the rpm
in the prompt and often drifts, so each take is analysed: the firing frequency is tracked
over time (autocorrelation, searched around the requested rpm), the longest steady stretch
is cut out, cross-faded into a seamless loop, and its measured rpm is written to engine.json.

  public/audio/sfx/engine_<layer>.mp3   idle | low | mid | high (on throttle), off (overrun)
  public/audio/sfx/engine.json          {"idle": 870, "low": 2480, ...}  measured rpm

  python3 tools/generate_engine.py            # build missing layers
  python3 tools/generate_engine.py --force mid high
Takes are cached in /tmp/satoyama_engine. Needs ffmpeg; standard library only.
Key: $ELEVENLABS_API_KEY, else ./.env, else ../gothic/.env (ELEVENLABS_API_KEY= or ELEVENLABS=).
"""
import array, json, math, os, statistics, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'audio', 'sfx')
TMP = '/tmp/satoyama_engine'
SR = 4000            # analysis rate: firing frequencies sit below 300 Hz
CYL = 4              # four-stroke firing frequency = rpm / 60 * CYL / 2
TRIES = 4
MIN_LOOP, MAX_SPREAD = 2.5, 0.03   # accept a take with >= 2.5 s whose pitch stays within 3 %

BASE = ('tuned naturally aspirated inline four cylinder sports car engine, close exhaust and engine bay recording, '
        'perfectly steady constant engine speed, continuous unchanging drone, no revving, no acceleration, '
        'no gear shifts, no tyre noise, no wind')
LAYERS = {  # name: (requested rpm, prompt)
    'idle': (900, 'car engine idling at 900 rpm, low lumpy burble, ' + BASE),
    'low': (2500, 'car engine held at a steady 2500 rpm, smooth low growl, ' + BASE),
    'mid': (4500, 'car engine held at a steady 4500 rpm under load, strong raspy mid-range roar, ' + BASE),
    'high': (7500, 'car engine held at a steady 7500 rpm near redline at full throttle, screaming high-pitched race engine wail, ' + BASE),
    'off': (4000, 'car engine coasting off throttle at 4000 rpm, engine braking, muffled hollow overrun hum with light exhaust burble, '
                  'steady constant engine speed, continuous unchanging drone, no revving, no gear shifts'),
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


def generate(prompt, path, key):
    body = json.dumps({'text': prompt, 'duration_seconds': 6.0, 'prompt_influence': 0.7}).encode()
    req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation', data=body,
                                 headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            open(path, 'wb').write(r.read())
        return True
    except urllib.error.HTTPError as e:
        print(f'  ! API error {e.code}: {e.read()[:300].decode(errors="replace")}')
        return False


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return array.array('f', raw)


def f0(x, lo, hi):
    """Strongest autocorrelation peak with a period between 1/hi and 1/lo seconds."""
    n, mean = len(x), sum(x) / len(x)
    x = [v - mean for v in x]
    a, b = max(2, int(SR / hi)), min(n // 2, int(SR / lo) + 1)
    ac = {}
    for lag in range(a - 1, b + 2):
        ac[lag] = sum(x[i] * x[i + lag] for i in range(n - lag)) / (n - lag)
    k = max(range(a, b + 1), key=ac.get)
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    d = y0 - 2 * y1 + y2
    return SR / (k + (0.5 * (y0 - y2) / d if d else 0))


def steadiest(path, rpm):
    """(start s, end s, measured rpm, spread) of the longest stretch whose pitch stays within MAX_SPREAD."""
    x, want = load(path), rpm / 60 * CYL / 2
    win, hop = SR // 2, SR // 4
    fs = [f0(x[s:s + win], want * 0.7, want * 1.4) for s in range(0, len(x) - win + 1, hop)]
    best = (0, 0)
    for i in range(len(fs)):
        lo = hi = fs[i]
        for j in range(i, len(fs)):
            lo, hi = min(lo, fs[j]), max(hi, fs[j])
            if (hi - lo) / lo > MAX_SPREAD:
                break
            if j - i > best[1] - best[0] or best == (0, 0):
                best = (i, j)
    i, j = best
    seg = fs[i:j + 1]
    med = statistics.median(seg)
    return i * hop / SR, (j * hop + win) / SR, med * 60 * 2 / CYL, (max(seg) - min(seg)) / med


def build(name, force, key):
    rpm, prompt = LAYERS[name]
    dst = os.path.join(OUT, f'engine_{name}.mp3')
    best = None
    for t in range(1, TRIES + 1):
        take = os.path.join(TMP, f'{name}_{t}.mp3')
        if (force or not os.path.isfile(take)) and not generate(prompt, take, key):
            continue
        s, e, real, spread = steadiest(take, rpm)
        print(f'  {name} take {t}: steady {s:.2f}-{e:.2f}s ({e - s:.1f}s) at {real:.0f} rpm, drift {spread * 100:.1f}%')
        if best is None or e - s > best[2] - best[1]:
            best = (take, s, e, real)
        if e - s >= MIN_LOOP:
            break
    if best is None:
        print(f'ERROR {name}: no take'); return None
    take, s, e, real = best
    if e - s < MIN_LOOP:
        print(f'  ! {name}: best steady stretch is only {e - s:.1f}s')
    fade = min(0.5, (e - s) * 0.2)
    # cut the steady stretch, then cross-fade its tail into its head so the loop has no seam
    graph = (f'[0]atrim={s}:{e},asetpts=N/SR/TB,highpass=f=20,loudnorm=I=-19:TP=-2:LRA=5,asplit[a][b];'
             f'[a]atrim=start={fade},asetpts=N/SR/TB[body];[b]atrim=end={fade},asetpts=N/SR/TB[head];'
             f'[body][head]acrossfade=d={fade}:c1=qsin:c2=qsin')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', take, '-filter_complex', graph, '-ac', '1', '-ar', '44100',
                    '-codec:a', 'libmp3lame', '-qscale:a', '3', dst], check=True)
    print(f'+ engine_{name}.mp3: {e - s - fade:.1f}s loop at {real:.0f} rpm')
    return round(real)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    meta_path = os.path.join(OUT, 'engine.json')
    meta = json.load(open(meta_path)) if os.path.isfile(meta_path) else {}
    key = api_key()
    for name in args or LAYERS:
        if name not in LAYERS:
            print(f'unknown layer: {name}'); continue
        if not force and name in meta and os.path.isfile(os.path.join(OUT, f'engine_{name}.mp3')):
            print(f'= {name} exists ({meta[name]} rpm)'); continue
        rpm = build(name, force, key)
        if rpm:
            meta[name] = rpm
    json.dump({k: meta[k] for k in LAYERS if k in meta}, open(meta_path, 'w'), indent=1)
    print(open(meta_path).read())


if __name__ == '__main__':
    main()

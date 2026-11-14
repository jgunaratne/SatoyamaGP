# Steam Deck Agent Deployment Runbook — Satoyama GP (Auto-Update + Build from GitHub on Startup)

> [!IMPORTANT]
> **Instructions for the Coding Agent on the Steam Deck:**
> Run every step below as the standard `deck` user (`$HOME` = `/home/deck`).
> - **Do NOT use `sudo` or `steamos-readonly disable`**. Everything installs in user-space (`~/.local/share/satoyama-gp`, `~/.local/bin`, `~/.var/app`, `~/.local/share/Steam`) and survives SteamOS system updates.
> - Execute the steps in order (`Step 1` → `Step 5`). Do not skip `Step 5` verification, and report its output back to the user.
> - Every block is idempotent: if a step fails, fix the cause and re-run that block.

---

## Architecture Overview

1. **Startup GitHub auto-update + rebuild (`~/.local/share/satoyama-gp/bin/bootstrap.sh`)**
   - Every launch runs a bounded `git fetch --depth 1 origin main` against the public repo `github.com/jgunaratne/SatoyamaGP`.
   - **New commits**: resets `repo/` to `FETCH_HEAD`, then rebuilds (see next point).
   - **Up to date**: boots straight into the game.
   - **Offline / slow Wi-Fi**: the fetch times out (default 12 s) and the installed build boots from the SSD.
2. **Satoyama GP is a Vite project: the game must be built on the Deck**
   - `dist/` is **not** in git, and `server.mjs` only serves `dist/`. Unlike Monkemon, a plain checkout is not playable.
   - `bootstrap.sh` runs `npm ci` (only when `package-lock.json` changed) and `vite build` (only when the checked-out commit differs from the last built commit).
   - The build goes to `dist.next/` and is swapped into `dist/` only on success. A failed build keeps the previous `dist/` playable and is retried on the next launch.
   - Expect roughly 90 MB for `dist/`, 250 MB for the shallow checkout, plus `node_modules/`.
3. **Local zero-dependency game server (`server.mjs` on `127.0.0.1:8741`)**
   - Runs on a user-space Node.js `v22` LTS binary (`~/.local/share/satoyama-gp/node/bin/node`). Vite 8 requires Node `^20.19.0 || >=22.12.0`.
   - Serves the build, byte-range `.mp3` audio, `.glb` models, and the online-race WebSocket relay at `/ws`.
   - Stopped via `trap` when the user quits with **STEAM → Exit Game**.
4. **Native `1280×800` kiosk display + Steam Input gamepad**
   - Google Chrome Flatpak (`com.google.Chrome`) in `--kiosk --app` mode with a dedicated profile, so settings in `localStorage` (graphics preset, audio, driver name) persist.
   - `flatpak --user override --filesystem=/run/udev:ro com.google.Chrome` exposes Steam Input's controller to `navigator.getGamepads()` in Gaming Mode.
5. **Steam Gaming Mode integration**
   - Renders 5 Steam Grid artworks and registers the shortcut in binary `shortcuts.vdf` (`LastPlayTime = now`, `"Favorite"`), so **Satoyama GP** shows up on the Gaming Mode Home screen.

Installed layout:

```text
~/.local/share/satoyama-gp/
  repo/         shallow git checkout (+ node_modules/, dist/ built locally)
  node/         Node.js v22 runtime (with npm)
  bin/          bootstrap.sh, launch.sh   (outside the git tree on purpose)
  logs/         update.log, launcher.log, server.log, chrome.log
  built.sha     commit that dist/ was built from
  deps.sha256   package-lock.json hash that node_modules/ was installed from
~/.local/bin/satoyama-gp -> bin/bootstrap.sh
```

---

## Step 1: Shallow-Clone `jgunaratne/SatoyamaGP`

The repository is public, so anonymous HTTPS works and Gaming Mode launches need no credentials.

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/satoyama-gp"
REPO="$ROOT/repo"
REMOTE_URL="https://github.com/jgunaratne/SatoyamaGP.git"
mkdir -p "$ROOT"
export GIT_TERMINAL_PROMPT=0

git ls-remote "$REMOTE_URL" HEAD >/dev/null   # must succeed without prompting

if [ -d "$REPO/.git" ]; then
  git -C "$REPO" remote set-url origin "$REMOTE_URL"
  git -C "$REPO" fetch --depth 1 --prune origin main
  git -C "$REPO" reset --hard FETCH_HEAD
else
  rm -rf "$REPO"
  git clone --branch main --single-branch --depth 1 "$REMOTE_URL" "$REPO"
fi

# Keep shallow updates compact over time
git -C "$REPO" config gc.reflogExpire 2.days
git -C "$REPO" config gc.reflogExpireUnreachable 2.days
git -C "$REPO" config gc.auto 256

echo "Checked out Satoyama GP @ $(git -C "$REPO" rev-parse --short HEAD): $(git -C "$REPO" log -1 --format=%s)"
```

> [!NOTE]
> **Agent instruction:** If `git ls-remote` fails with an authentication error, the repo has been made private. Stop and tell the user. The fix is a read-only deploy key, as in the Monkemon runbook: create `~/.ssh/satoyama_gp_deploy_key`, have the user add the public key at `https://github.com/jgunaratne/SatoyamaGP/settings/keys`, then re-run this step with `REMOTE_URL=git@github.com:jgunaratne/SatoyamaGP.git`. `bootstrap.sh` picks that key up automatically if the file exists.

---

## Step 2: Install User-Space Node.js `v22` and Google Chrome Flatpak (`udev` Gamepad Enabled)

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/satoyama-gp"
NODE_DIR="$ROOT/node"
NODE_CHANNEL="latest-v22.x"
mkdir -p "$ROOT"

# 1. User-space Node.js v22 LTS, including npm (SHA-256 verified from nodejs.org)
if [ -x "$NODE_DIR/bin/node" ] && [ -e "$NODE_DIR/bin/npm" ] && "$NODE_DIR/bin/node" --version >/dev/null 2>&1; then
  echo "Node.js already installed: $("$NODE_DIR/bin/node" --version)"
else
  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  BASE_URL="https://nodejs.org/dist/$NODE_CHANNEL"
  SUMS="$(curl -fsSL --retry 3 "$BASE_URL/SHASUMS256.txt")"
  TARBALL="$(printf '%s\n' "$SUMS" | grep -oE "node-v[0-9.]+-linux-${ARCH}\.tar\.xz" | head -n 1)"
  [ -n "$TARBALL" ] || { echo "Failed to resolve Node.js tarball from $BASE_URL" >&2; exit 1; }

  TMP_DIR="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP_DIR/$TARBALL" "$BASE_URL/$TARBALL"
  (cd "$TMP_DIR" && printf '%s\n' "$SUMS" | grep " ${TARBALL}\$" | sha256sum -c --quiet -)
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$TMP_DIR/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP_DIR"
  echo "Installed Node.js $("$NODE_DIR/bin/node" --version) to $NODE_DIR"
fi

# 2. Google Chrome Flatpak (user scope) + Steam Deck controller udev permission
if ! flatpak info com.google.Chrome >/dev/null 2>&1; then
  flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y --noninteractive flathub com.google.Chrome
fi

# Mandatory so navigator.getGamepads() detects Steam Input's controller inside Gaming Mode
flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
echo "Chrome Flatpak + /run/udev:ro gamepad access configured."
```

---

## Step 3: Install the Auto-Updater/Builder (`bootstrap.sh`), Kiosk Launcher (`launch.sh`), `.desktop` Entry, and Run the First Build

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="$HOME/.local/share/satoyama-gp"
BIN_DIR="$ROOT/bin"
LOG_DIR="$ROOT/logs"
mkdir -p \
  "$BIN_DIR" \
  "$LOG_DIR" \
  "$HOME/.local/bin" \
  "$HOME/.local/share/applications" \
  "$HOME/.local/share/icons/hicolor/256x256/apps"

cat > "$BIN_DIR/bootstrap.sh" << 'EOF'
#!/usr/bin/env bash
# Satoyama GP — Steam Deck startup auto-updater, builder and launcher entrypoint.
# Every launch:
#   1. Checks github.com/jgunaratne/SatoyamaGP for new commits on $SATOYAMA_BRANCH (default: main)
#      and resets $REPO to FETCH_HEAD. Offline or slow Wi-Fi: gives up after $SATOYAMA_FETCH_TIMEOUT s.
#   2. If the checkout differs from the last built commit: `npm ci` (only when package-lock.json
#      changed) and `vite build` into dist.next/, swapped into dist/ only on success.
#   3. Executes launch.sh (local Node server.mjs + 1280x800 Chrome kiosk).
set -uo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="${SATOYAMA_HOME:-$HOME/.local/share/satoyama-gp}"
REPO="${SATOYAMA_REPO:-$ROOT/repo}"
LOGS="$ROOT/logs"
BRANCH="${SATOYAMA_BRANCH:-main}"
SSH_KEY="${SATOYAMA_SSH_KEY:-$HOME/.ssh/satoyama_gp_deploy_key}"
FETCH_TIMEOUT="${SATOYAMA_FETCH_TIMEOUT:-12}"
NPM_TIMEOUT="${SATOYAMA_NPM_TIMEOUT:-300}"
BUILD_TIMEOUT="${SATOYAMA_BUILD_TIMEOUT:-180}"
PROFILE_DIR="$HOME/.var/app/com.google.Chrome/data/satoyama-gp-profile"
BUILT_FILE="$ROOT/built.sha"
DEPS_FILE="$ROOT/deps.sha256"

mkdir -p "$LOGS"
LOG="$LOGS/update.log"
log() { printf '%s [satoyama-update] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG" >&2; }

export PATH="$ROOT/node/bin:$PATH"   # npm and vite are `#!/usr/bin/env node` scripts
export GIT_TERMINAL_PROMPT=0
GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new"
if [ -f "$SSH_KEY" ]; then
  GIT_SSH_COMMAND="$GIT_SSH_COMMAND -i $SSH_KEY -o IdentitiesOnly=yes"
fi
export GIT_SSH_COMMAND

if [ -n "${SATOYAMA_REMOTE:-}" ]; then
  REMOTE="$SATOYAMA_REMOTE"
elif [ -f "$SSH_KEY" ]; then
  REMOTE="git@github.com:jgunaratne/SatoyamaGP.git"
else
  REMOTE="$(git -C "$REPO" remote get-url origin 2>/dev/null || echo 'https://github.com/jgunaratne/SatoyamaGP.git')"
fi

current_sha() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "none"; }

purge_http_cache_keep_settings() {
  # /models/*.glb are served with max-age=86400 and are not fingerprinted, so clear the HTTP and
  # bytecode caches after every new build. NEVER touch "$PROFILE_DIR/Default/Local Storage".
  rm -rf \
    "$PROFILE_DIR/Default/Cache" \
    "$PROFILE_DIR/Default/Code Cache" \
    "$PROFILE_DIR/Default/GPUCache" 2>/dev/null || true
}

update_repo() {
  if [ ! -d "$REPO/.git" ]; then
    log "ERROR: $REPO is missing .git — run Step 1 in STEAMDECK_SETUP.md"
    return 1
  fi
  if [ "$(git -C "$REPO" remote get-url origin 2>/dev/null)" != "$REMOTE" ]; then
    git -C "$REPO" remote set-url origin "$REMOTE" 2>/dev/null || git -C "$REPO" remote add origin "$REMOTE"
  fi

  local before after
  before="$(current_sha)"

  if ! timeout "$FETCH_TIMEOUT" git -C "$REPO" \
    -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=5 \
    fetch --depth 1 --prune --quiet origin "$BRANCH" >>"$LOG" 2>&1; then
    log "GitHub unreachable or timed out (${FETCH_TIMEOUT}s) — keeping local checkout $before"
    return 0
  fi

  if [ "$(git -C "$REPO" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse FETCH_HEAD)" ]; then
    log "Up to date ($before)"
    return 0
  fi

  # dist/, dist.next/ and node_modules/ are untracked or ignored, so reset --hard leaves them alone.
  if ! git -C "$REPO" reset --hard --quiet FETCH_HEAD >>"$LOG" 2>&1; then
    log "ERROR: git reset failed — keeping $before"
    return 1
  fi

  git -C "$REPO" gc --auto --quiet >>"$LOG" 2>&1 || true
  after="$(current_sha)"
  log "UPDATED $before -> $after: $(git -C "$REPO" log -1 --format=%s)"
}

ensure_build() {
  local head built lock_hash
  head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none)"
  built="$(cat "$BUILT_FILE" 2>/dev/null || true)"
  if [ "$head" = "$built" ] && [ -s "$REPO/dist/index.html" ]; then
    return 0
  fi
  if [ ! -x "$ROOT/node/bin/node" ]; then
    log "ERROR: Node.js missing at $ROOT/node — run Step 2 in STEAMDECK_SETUP.md"
    return 1
  fi

  lock_hash="$(sha256sum "$REPO/package-lock.json" 2>/dev/null | cut -d' ' -f1)"
  if [ ! -x "$REPO/node_modules/.bin/vite" ] || [ "$lock_hash" != "$(cat "$DEPS_FILE" 2>/dev/null || true)" ]; then
    log "Installing build dependencies (npm ci, needs network)"
    if (cd "$REPO" && timeout "$NPM_TIMEOUT" npm ci --no-audit --no-fund --loglevel=error) >>"$LOG" 2>&1; then
      printf '%s\n' "$lock_hash" > "$DEPS_FILE"
    else
      rm -f "$DEPS_FILE"
      log "ERROR: npm ci failed (see $LOG) — keeping previous build ${built:0:7}"
      return 1
    fi
  fi

  log "Building ${head:0:7} (vite build)"
  rm -rf "$REPO/dist.next"
  if (cd "$REPO" && timeout "$BUILD_TIMEOUT" node_modules/.bin/vite build --outDir dist.next --emptyOutDir --logLevel warn) >>"$LOG" 2>&1 \
    && [ -s "$REPO/dist.next/index.html" ]; then
    rm -rf "$REPO/dist.prev"
    [ -d "$REPO/dist" ] && mv "$REPO/dist" "$REPO/dist.prev"
    mv "$REPO/dist.next" "$REPO/dist"
    rm -rf "$REPO/dist.prev"
    printf '%s\n' "$head" > "$BUILT_FILE"
    purge_http_cache_keep_settings
    log "BUILT ${head:0:7} ($(du -sh "$REPO/dist" 2>/dev/null | cut -f1))"
  else
    rm -rf "$REPO/dist.next"
    log "ERROR: vite build failed (see $LOG) — keeping previous build ${built:0:7}"
    return 1
  fi
}

status() {
  local node_bin="$ROOT/node/bin/node" chrome_ver="not installed" udev="no" built
  built="$(cat "$BUILT_FILE" 2>/dev/null || true)"
  if flatpak info com.google.Chrome >/dev/null 2>&1; then
    chrome_ver="$(flatpak info com.google.Chrome 2>/dev/null | awk -F': *' '/^ *Version/ {print $2; exit}')"
    flatpak --user override --show com.google.Chrome 2>/dev/null | grep -q '/run/udev' && udev="yes"
  fi
  echo "Satoyama GP Steam Deck Status"
  echo "  repo:     $REPO @ $(current_sha) ($BRANCH) — $(git -C "$REPO" log -1 --format=%s 2>/dev/null || echo '?')"
  echo "  remote:   $REMOTE"
  echo "  build:    ${built:0:7} $([ -s "$REPO/dist/index.html" ] && du -sh "$REPO/dist" | cut -f1 || echo 'MISSING dist/')$([ "$built" = "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" ] && echo ' (current)' || echo ' (STALE — rebuild pending)')"
  echo "  node:     $([ -x "$node_bin" ] && "$node_bin" --version || echo missing) ($node_bin)"
  echo "  chrome:   com.google.Chrome $chrome_ver (udev gamepad access: $udev)"
  echo "  launcher: $HOME/.local/bin/satoyama-gp -> $(readlink -f "$HOME/.local/bin/satoyama-gp" 2>/dev/null || echo missing)"
  echo "  settings: $PROFILE_DIR/Default/Local Storage"
  echo "  logs:     $LOGS"
  [ -f "$LOG" ] && { echo "  recent updates:"; tail -n 5 "$LOG" | sed 's/^/    /'; }
  return 0
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --update-only) update_repo; ensure_build; exit $? ;;
  --no-update) shift; ensure_build || true ;;
  *) update_repo || true; ensure_build || true ;;
esac

exec bash "$ROOT/bin/launch.sh" "$@"
EOF

cat > "$BIN_DIR/launch.sh" << 'EOF'
#!/usr/bin/env bash
# Satoyama GP — local Node server.mjs + 1280x800 Google Chrome kiosk launcher.
set -uo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

ROOT="${SATOYAMA_HOME:-$HOME/.local/share/satoyama-gp}"
REPO="${SATOYAMA_REPO:-$ROOT/repo}"
LOGS="$ROOT/logs"
PORT="${SATOYAMA_PORT:-8741}"
BIND="${SATOYAMA_HOST:-127.0.0.1}"
BROWSER="${SATOYAMA_BROWSER:-chrome}"
PIDFILE="$ROOT/server.pid"
NODE_BIN="$ROOT/node/bin/node"

mkdir -p "$LOGS"
log() { printf '%s [satoyama-launch] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOGS/launcher.log" >&2; }
# server.mjs has no health endpoint: a healthy server returns the game's index.html.
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -q 'Satoyama GP'; }

if [ ! -x "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    log "ERROR: Node.js binary missing at $NODE_BIN"
    exit 1
  fi
fi

if [ ! -s "$REPO/dist/index.html" ]; then
  log "ERROR: $REPO/dist/index.html is missing — the game was never built. Run: satoyama-gp --update-only (needs network), then check $LOGS/update.log"
  exit 1
fi

# Always stop any leftover server.mjs so newly pulled server/relay code takes effect immediately
if [ -f "$PIDFILE" ]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 15); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$PIDFILE"
fi

SERVER_PID=""
if healthy; then
  log "Reusing active Satoyama GP server on 127.0.0.1:${PORT}"
else
  ( cd "$REPO" && HOST="$BIND" PORT="$PORT" exec "$NODE_BIN" server.mjs ) >>"$LOGS/server.log" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PIDFILE"
  for _ in $(seq 1 100); do
    healthy && break
    sleep 0.1
  done
  if ! healthy; then
    log "ERROR: server.mjs failed to start on ${BIND}:${PORT} (check $LOGS/server.log)"
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
    exit 1
  fi
  log "Started server.mjs (PID $SERVER_PID, build $(cut -c1-7 "$ROOT/built.sha" 2>/dev/null || echo '?')) on ${BIND}:${PORT}"
fi

APP="com.google.Chrome"
[ "$BROWSER" = "chromium" ] && APP="org.chromium.Chromium"
PROFILE_DIR="$HOME/.var/app/$APP/data/satoyama-gp-profile"
mkdir -p "$PROFILE_DIR"

# Remove stale singleton locks if the Deck lost power mid-session
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonSocket"

cleanup() {
  pkill -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
}
trap cleanup EXIT INT TERM HUP

# No query by default: the game auto-detects a graphics preset and remembers the in-game choice.
#   SATOYAMA_Q=low|medium|high|ultra   force a graphics preset for this launch (?q=)
#   SATOYAMA_SERVER=wss://host/ws      use another relay for online races (?server=)
#   SATOYAMA_QUERY=a=b&c=d             extra raw query parameters
QUERY=""
[ -n "${SATOYAMA_Q:-}" ] && QUERY="q=$SATOYAMA_Q"
[ -n "${SATOYAMA_SERVER:-}" ] && QUERY="${QUERY:+$QUERY&}server=$SATOYAMA_SERVER"
[ -n "${SATOYAMA_QUERY:-}" ] && QUERY="${QUERY:+$QUERY&}$SATOYAMA_QUERY"
URL="http://127.0.0.1:${PORT}/${QUERY:+?$QUERY}"

if [ "$BROWSER" = "none" ]; then
  log "Server-only mode ready at $URL"
  if [ -n "$SERVER_PID" ]; then wait "$SERVER_PID"; else sleep infinity; fi
  exit 0
fi

CHROME_FLAGS=(
  --user-data-dir="$PROFILE_DIR"
  --no-first-run
  --no-default-browser-check
  --password-store=basic
  --disable-session-crashed-bubble
  --hide-crash-restore-bubble
  --disable-infobars
  --disable-background-networking
  --disable-component-update
  --disable-features=TranslateUI
  --enable-gpu-rasterization
  --enable-zero-copy
  --ignore-gpu-blocklist
  --autoplay-policy=no-user-gesture-required
  --window-size=1280,800
  --window-position=0,0
  --force-device-scale-factor=1
  --kiosk
  --app="$URL"
)

log "Launching $APP -> $URL"
/usr/bin/flatpak run --branch=stable --arch=x86_64 "$APP" "${CHROME_FLAGS[@]}" "$@" >>"$LOGS/chrome.log" 2>&1 &
CHROME_PID=$!
wait "$CHROME_PID"
EOF

chmod +x "$BIN_DIR/bootstrap.sh" "$BIN_DIR/launch.sh"
ln -sfn "$BIN_DIR/bootstrap.sh" "$HOME/.local/bin/satoyama-gp"

cat > "$HOME/.local/share/applications/satoyama-gp.desktop" << EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Satoyama GP
Comment=Satoyama GP — Sakura Valley arcade racer (auto-updates from GitHub on startup)
Exec="$HOME/.local/bin/satoyama-gp"
Path=$HOME/.local/bin
Icon=$HOME/.local/share/icons/hicolor/256x256/apps/satoyama-gp.png
Terminal=false
Categories=Game;Racing;
StartupNotify=false
EOF

chmod +x "$HOME/.local/share/applications/satoyama-gp.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

# First build: npm ci (downloads vite + three from registry.npmjs.org) and vite build.
"$HOME/.local/bin/satoyama-gp" --update-only
test -s "$ROOT/repo/dist/index.html" && echo "First build OK: $(du -sh "$ROOT/repo/dist" | cut -f1)"
```

> [!NOTE]
> **Agent instruction:** If the first build fails, read `~/.local/share/satoyama-gp/logs/update.log`. Do not work around it by committing or copying a `dist/` from elsewhere; fix the cause (usually no network for `npm ci`, or a Node version below 22.12) and re-run `~/.local/bin/satoyama-gp --update-only`.

---

## Step 4: Render Steam Grid Artwork and Register in `shortcuts.vdf`

### 4A. Render all 5 Steam Grid artworks (`920×430`, `600×900`, `1920×620`, `1280×720` transparent logo, `256×256` icon)

Headless Chrome composites the repo's own concept renders (`assets_src/models/concepts/*.png`) with the game's title-screen palette. The files are copied into Chrome's Flatpak cache directory because the sandbox cannot read `~/.local/share/satoyama-gp`.

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

REPO="$HOME/.local/share/satoyama-gp/repo"
ART_DIR="$HOME/.var/app/com.google.Chrome/cache/satoyama-gp-art"
rm -rf "$ART_DIR"
mkdir -p "$ART_DIR"
cp "$REPO/assets_src/models/concepts/car_red.concept.png" "$ART_DIR/car_red.png"
cp "$REPO/assets_src/models/concepts/car_white.concept.png" "$ART_DIR/car_white.png"
cp "$REPO/assets_src/models/concepts/torii.concept.png" "$ART_DIR/torii.png"

python3 - "$ART_DIR" << 'PYEOF'
import os
import subprocess
import sys

art_dir = sys.argv[1]

# The kanji subtitle needs a Japanese font; leave it out rather than render empty boxes.
try:
    has_cjk = bool(subprocess.run(["fc-list", ":lang=ja", "family"], capture_output=True, text=True).stdout.strip())
except Exception:
    has_cjk = False
KANJI = '<div class="kanji">里山グランプリ</div>' if has_cjk else ""

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #0b0c10; color: #fff;
  font-family: "Barlow Condensed", "Roboto Condensed", "Noto Sans", "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif; }
body { position: relative; }
.bg { position: absolute; inset: 0; background-repeat: no-repeat; background-size: cover; filter: saturate(1.25) contrast(1.12) brightness(.9); }
.tint { position: absolute; inset: 0; mix-blend-mode: multiply; }
.shade { position: absolute; inset: 0; }
.copy { position: absolute; z-index: 5; }
.kanji { color: #ffe14a; font-weight: 700; letter-spacing: .5em; }
.title { font-weight: 900; font-style: italic; line-height: .86; letter-spacing: -.01em; text-shadow: 0 4px 22px rgba(0,0,0,.6); }
.title em { color: #ff2a7f; font-style: inherit; }
.lvl { font-weight: 800; font-style: italic; letter-spacing: .26em; white-space: nowrap; }
.lvl b { display: inline-block; background: #ff2a7f; padding: .1em .6em; margin-right: .7em; letter-spacing: .18em; box-shadow: .3em .3em 0 #ffe14a; }
"""

PAGES = {
    "wide": (920, 430, False, f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}
      .bg {{ background-image: url('car_red.png'); background-position: 100% 55%; background-size: 760px auto; }}
      .tint {{ background: linear-gradient(120deg, #2a1030 0%, #7a2a55 55%, #ffd9e6 100%); }}
      .shade {{ background: linear-gradient(95deg, rgba(11,12,16,.97) 0%, rgba(11,12,16,.78) 36%, rgba(11,12,16,0) 72%); }}
      .copy {{ left: 40px; bottom: 44px; }}
      .kanji {{ font-size: 19px; margin-bottom: 10px; }}
      .title {{ font-size: 104px; }}
      .lvl {{ font-size: 17px; margin-top: 22px; }}
    </style></head><body>
      <div class="bg"></div><div class="tint"></div><div class="shade"></div>
      <div class="copy">{KANJI}<div class="title">SATOYAMA<br><em>GP</em></div>
        <div class="lvl"><b>LEVEL 01</b>SAKURA VALLEY CIRCUIT</div></div>
    </body></html>"""),

    "portrait": (600, 900, False, f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}
      .bg {{ background-image: url('car_red.png'); background-position: 46% 0; background-size: auto 560px; }}
      .tint {{ background: linear-gradient(180deg, #ffd9e6 0%, #7a2a55 50%, #2a1030 100%); }}
      .shade {{ background: linear-gradient(180deg, rgba(11,12,16,0) 30%, rgba(11,12,16,.9) 58%, #0b0c10 70%); }}
      .copy {{ left: 38px; right: 38px; bottom: 56px; }}
      .kanji {{ font-size: 22px; margin-bottom: 14px; }}
      .title {{ font-size: 124px; }}
      .lvl {{ font-size: 17px; margin-top: 30px; }}
      .bar {{ position: absolute; left: 0; top: 0; bottom: 0; width: 10px; background: #ff2a7f; z-index: 6; }}
    </style></head><body>
      <div class="bg"></div><div class="tint"></div><div class="shade"></div><div class="bar"></div>
      <div class="copy">{KANJI}<div class="title">SATOYAMA<br><em>GP</em></div>
        <div class="lvl"><b>LEVEL 01</b>SAKURA VALLEY</div></div>
    </body></html>"""),

    "hero": (1920, 620, False, f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}
      .bg {{ background-image: url('car_white.png'); background-position: 92% 58%; background-size: 1180px auto; }}
      .gate {{ position: absolute; left: 330px; top: -40px; width: 1000px; height: 700px; background: url('torii.png') center / contain no-repeat; opacity: .5; mix-blend-mode: multiply; }}
      .tint {{ background: linear-gradient(110deg, #2a1030 0%, #a23a6c 50%, #ffe6ee 100%); }}
      .shade {{ background: linear-gradient(90deg, rgba(11,12,16,.92) 0%, rgba(11,12,16,.25) 55%, rgba(11,12,16,.5) 100%), linear-gradient(180deg, rgba(11,12,16,0) 40%, rgba(11,12,16,.85) 100%); }}
    </style></head><body>
      <div class="bg"></div><div class="gate"></div><div class="tint"></div><div class="shade"></div>
    </body></html>"""),

    "logo": (1280, 720, True, f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{CSS}
      html, body {{ background: transparent !important; }}
      .copy {{ left: 56px; bottom: 54px; }}
      .kanji {{ font-size: 30px; margin-bottom: 14px; text-shadow: 0 3px 12px rgba(0,0,0,.8); }}
      .title {{ font-size: 190px; text-shadow: 0 6px 30px rgba(0,0,0,.85); }}
      .lvl {{ font-size: 26px; margin-top: 34px; text-shadow: 0 3px 12px rgba(0,0,0,.8); }}
      .lvl b {{ text-shadow: none; }}
    </style></head><body>
      <div class="copy">{KANJI}<div class="title">SATOYAMA <em>GP</em></div>
        <div class="lvl"><b>LEVEL 01</b>SAKURA VALLEY CIRCUIT</div></div>
    </body></html>"""),

    "icon": (256, 256, False, """<!DOCTYPE html><html><head><meta charset="utf-8"><style>""" + CSS + """
      body { background: #0b0c10; display: flex; align-items: center; justify-content: center; border: 8px solid #ff2a7f; }
      .gp { font-size: 150px; font-weight: 900; font-style: italic; line-height: 1; letter-spacing: -.04em; color: #fff; text-shadow: 8px 8px 0 #ff2a7f; transform: translate(-6px, -4px); }
      .stripe { position: absolute; left: 0; right: 0; bottom: 26px; height: 12px; background: #ffe14a; transform: skewY(-6deg); }
    </style></head><body><div class="stripe"></div><div class="gp">GP</div></body></html>"""),
}

env = {k: v for k, v in os.environ.items() if k not in ("LD_LIBRARY_PATH", "LD_PRELOAD")}

for name, (w, h, transparent, html) in PAGES.items():
    html_path = os.path.join(art_dir, f"{name}.html")
    png_path = os.path.join(art_dir, f"{name}.png")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    cmd = [
        "/usr/bin/flatpak", "run", "--command=/app/bin/chrome", "com.google.Chrome",
        "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--virtual-time-budget=3000",
        f"--window-size={w},{h}",
        f"--screenshot={png_path}",
    ]
    if transparent:
        cmd.append("--default-background-color=00000000")
    cmd.append(f"file://{html_path}")
    subprocess.run(cmd, env=env, check=True)
    print(f"Rendered {png_path} ({os.path.getsize(png_path)} bytes)")
PYEOF

cp "$ART_DIR/icon.png" "$HOME/.local/share/icons/hicolor/256x256/apps/satoyama-gp.png"
```

### 4B. Safely update `shortcuts.vdf`, install `grid/` artwork, and reload Steam

> [!WARNING]
> Steam overwrites `shortcuts.vdf` on shutdown if it is edited while Steam is running. The script below inspects ancestor PIDs first, so that if the coding agent runs in a terminal nested under `gamescope-session`, it never kills its own parent session.

```bash
python3 - << 'PYEOF'
import os
import shutil
import struct
import subprocess
import time
import zlib

HOME = os.path.expanduser("~")
EXE_RAW = os.path.join(HOME, ".local/bin/satoyama-gp")
EXE_QUOTED = f'"{EXE_RAW}"'
START_DIR_QUOTED = f'"{os.path.dirname(EXE_RAW)}"'
ICON_PATH = os.path.join(HOME, ".local/share/icons/hicolor/256x256/apps/satoyama-gp.png")
DESKTOP_PATH = os.path.join(HOME, ".local/share/applications/satoyama-gp.desktop")
ART_DIR = os.path.join(HOME, ".var/app/com.google.Chrome/cache/satoyama-gp-art")
APP_NAME = "Satoyama GP"

APPID = (zlib.crc32((EXE_QUOTED + APP_NAME).encode("utf-8")) & 0xFFFFFFFF) | 0x80000000

BIN_MAP = 0x00
BIN_STR = 0x01
BIN_INT32 = 0x02
BIN_FLOAT32 = 0x03
BIN_PTR = 0x04
BIN_WIDESTR = 0x05
BIN_COLOR = 0x06
BIN_UINT64 = 0x07
BIN_END = 0x08
BIN_INT64 = 0x0A


def read_cstr(buf, pos):
    end = buf.index(0, pos)
    return buf[pos:end].decode("utf-8", errors="replace"), end + 1


def parse_binary_vdf(buf, pos=0):
    out = {}
    n = len(buf)
    while pos < n:
        t = buf[pos]
        pos += 1
        if t == BIN_END:
            break
        key, pos = read_cstr(buf, pos)
        if t == BIN_MAP:
            val, pos = parse_binary_vdf(buf, pos)
            out[key] = ("map", val)
        elif t == BIN_STR:
            val, pos = read_cstr(buf, pos)
            out[key] = ("str", val)
        elif t in (BIN_INT32, BIN_PTR, BIN_COLOR):
            val = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
            out[key] = (t, val)
        elif t == BIN_FLOAT32:
            val = struct.unpack_from("<f", buf, pos)[0]
            pos += 4
            out[key] = (t, val)
        elif t in (BIN_UINT64, BIN_INT64):
            val = struct.unpack_from("<Q", buf, pos)[0]
            pos += 8
            out[key] = (t, val)
        elif t == BIN_WIDESTR:
            end = pos
            while end + 1 < n and not (buf[end] == 0 and buf[end + 1] == 0):
                end += 2
            val = buf[pos:end].decode("utf-16-le", errors="replace")
            pos = end + 2
            out[key] = (t, val)
        else:
            raise ValueError(f"Unsupported binary VDF tag 0x{t:02x} at byte {pos - 1}")
    return out, pos


def dump_binary_vdf(mapping):
    chunks = bytearray()
    for key, (t, val) in mapping.items():
        kbytes = key.encode("utf-8") + b"\x00"
        if t == "map":
            chunks.append(BIN_MAP)
            chunks.extend(kbytes)
            chunks.extend(dump_binary_vdf(val))
        elif t == "str":
            chunks.append(BIN_STR)
            chunks.extend(kbytes)
            chunks.extend(str(val).encode("utf-8") + b"\x00")
        elif t in ("int", BIN_INT32, BIN_PTR, BIN_COLOR):
            tag = BIN_INT32 if t == "int" else t
            chunks.append(tag)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<I", int(val) & 0xFFFFFFFF))
        elif t == BIN_FLOAT32:
            chunks.append(BIN_FLOAT32)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<f", float(val)))
        elif t in (BIN_UINT64, BIN_INT64):
            chunks.append(t)
            chunks.extend(kbytes)
            chunks.extend(struct.pack("<Q", int(val) & 0xFFFFFFFFFFFFFFFF))
        elif t == BIN_WIDESTR:
            chunks.append(BIN_WIDESTR)
            chunks.extend(kbytes)
            chunks.extend(str(val).encode("utf-16-le") + b"\x00\x00")
    chunks.append(BIN_END)
    return bytes(chunks)


def ancestor_comm_names():
    names = set()
    pid = os.getpid()
    while pid > 1:
        try:
            with open(f"/proc/{pid}/comm", "r", encoding="utf-8") as f:
                names.add(f.read().strip())
            with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as f:
                stat = f.read()
            ppid = int(stat[stat.rfind(")") + 2:].split()[1])
            if ppid == pid:
                break
            pid = ppid
        except Exception:
            break
    return names


def proc_running(name):
    return subprocess.run(["pgrep", "-x", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def wait_steam_exit(timeout=15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not proc_running("steam"):
            return True
        time.sleep(0.5)
    return not proc_running("steam")


ancestors = ancestor_comm_names()
in_gamescope_tree = any("gamescope" in a for a in ancestors)
was_gamescope_active = (
    subprocess.run(["systemctl", "--user", "is-active", "--quiet", "gamescope-session"]).returncode == 0
    or proc_running("gamescope")
)
was_desktop_steam_active = (not was_gamescope_active) and proc_running("steam")

restart_mode = "none"
if was_gamescope_active and not in_gamescope_tree:
    print("Gaming Mode active (agent on SSH/background) -> stopping gamescope-session cleanly before VDF edit...")
    subprocess.run(["systemctl", "--user", "stop", "gamescope-session"], check=False)
    wait_steam_exit(15.0)
    restart_mode = "gamescope"
elif was_desktop_steam_active:
    print("Desktop Steam active -> shutting down Steam cleanly before VDF edit...")
    subprocess.run(["steam", "-shutdown"], check=False)
    wait_steam_exit(15.0)
    restart_mode = "desktop_steam"
elif was_gamescope_active and in_gamescope_tree:
    print("Agent running inside gamescope-session -> will also invoke steamos-add-to-steam live.")
    restart_mode = "live_inside_gamescope"

userdata_roots = set()
for candidate in [
    os.path.join(HOME, ".local/share/Steam/userdata"),
    os.path.join(HOME, ".steam/steam/userdata"),
]:
    if os.path.isdir(candidate):
        userdata_roots.add(os.path.realpath(candidate))

user_dirs = []
for root in sorted(userdata_roots):
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if entry.isdigit() and int(entry) > 0 and os.path.isdir(full):
            user_dirs.append(full)

if not user_dirs:
    raise RuntimeError("No Steam userdata/<STEAM_ID3> directories found! Log into Steam once on the Deck first.")

now_ts = int(time.time())


def build_shortcut_entry(existing_map=None):
    base = dict(existing_map) if existing_map else {}
    base["appid"] = ("int", APPID)
    base["AppName"] = ("str", APP_NAME)
    base["Exe"] = ("str", EXE_QUOTED)
    base["StartDir"] = ("str", START_DIR_QUOTED)
    base["icon"] = ("str", ICON_PATH)
    base["ShortcutPath"] = ("str", "")
    base["LaunchOptions"] = ("str", "")
    base["IsHidden"] = ("int", 0)
    base["AllowDesktopConfig"] = ("int", 1)
    base["AllowOverlay"] = ("int", 1)
    base["OpenVR"] = ("int", 0)
    base["Devkit"] = ("int", 0)
    base["DevkitGameID"] = ("str", "")
    base["DevkitOverrideAppID"] = ("int", 0)
    base["LastPlayTime"] = ("int", now_ts)
    base["FlatpakAppID"] = ("str", "")
    tags = dict(base.get("tags", ("map", {}))[1])
    if not any(v[1] == "Favorite" for v in tags.values() if v[0] == "str"):
        tags[str(len(tags))] = ("str", "Favorite")
    base["tags"] = ("map", tags)
    return ("map", base)


def install_grid_art(grid_dir, target_appid):
    os.makedirs(grid_dir, exist_ok=True)
    mapping = {
        "wide.png": f"{target_appid}.png",
        "portrait.png": f"{target_appid}p.png",
        "hero.png": f"{target_appid}_hero.png",
        "logo.png": f"{target_appid}_logo.png",
        "icon.png": f"{target_appid}_icon.png",
    }
    for src_name, dst_name in mapping.items():
        src = os.path.join(ART_DIR, src_name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(grid_dir, dst_name))


for udir in user_dirs:
    cfg_dir = os.path.join(udir, "config")
    os.makedirs(cfg_dir, exist_ok=True)
    vdf_path = os.path.join(cfg_dir, "shortcuts.vdf")

    root = {}
    if os.path.isfile(vdf_path) and os.path.getsize(vdf_path) > 0:
        shutil.copy2(vdf_path, f"{vdf_path}.bak.{now_ts}")
        with open(vdf_path, "rb") as f:
            root, _ = parse_binary_vdf(f.read())

    sc_key = next((k for k in root if k.lower() == "shortcuts"), "shortcuts")
    shortcuts = dict(root.get(sc_key, ("map", {}))[1])

    matched_idx = None
    existing_appids = {APPID}
    for idx, (t, entry) in shortcuts.items():
        if t != "map":
            continue
        name_val = entry.get("AppName", entry.get("appname", ("str", "")))[1]
        exe_val = entry.get("Exe", entry.get("exe", ("str", "")))[1]
        if name_val == APP_NAME or "satoyama-gp" in str(exe_val):
            matched_idx = idx
            if "appid" in entry:
                existing_appids.add(int(entry["appid"][1]) & 0xFFFFFFFF)
            break

    if matched_idx is not None:
        shortcuts[matched_idx] = build_shortcut_entry(shortcuts[matched_idx][1])
        print(f"[{os.path.basename(udir)}] Updated shortcut #{matched_idx} (AppID={APPID})")
    else:
        next_idx = str(max([int(k) for k in shortcuts if k.isdigit()] + [-1]) + 1)
        shortcuts[next_idx] = build_shortcut_entry()
        print(f"[{os.path.basename(udir)}] Added shortcut #{next_idx} (AppID={APPID})")

    root[sc_key] = ("map", shortcuts)
    encoded = dump_binary_vdf(root)
    _, end_pos = parse_binary_vdf(encoded)
    assert end_pos == len(encoded), "Binary VDF round-trip verification failed"

    tmp_path = f"{vdf_path}.tmp"
    with open(tmp_path, "wb") as f:
        f.write(encoded)
    os.replace(tmp_path, vdf_path)

    grid_dir = os.path.join(cfg_dir, "grid")
    for aid in existing_appids:
        install_grid_art(grid_dir, aid)
    print(f"[{os.path.basename(udir)}] Installed 5 Steam Deck grid artworks for AppID(s): {sorted(existing_appids)}")

if restart_mode == "gamescope":
    print("Restarting Gaming Mode (gamescope-session)...")
    subprocess.run(["systemctl", "--user", "start", "gamescope-session"], check=False)
elif restart_mode == "desktop_steam":
    print("Relaunching Desktop Steam in background...")
    subprocess.Popen(["steam", "-silent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
elif restart_mode == "live_inside_gamescope":
    if os.path.isfile("/usr/bin/steamos-add-to-steam"):
        subprocess.run(["/usr/bin/steamos-add-to-steam", DESKTOP_PATH], check=False)
    print("NOTE: Restart Steam once finished so Gaming Mode reloads shortcuts.vdf & custom grid art.")

print("Steam Gaming Mode registration complete!")
PYEOF
```

---

## Step 5: Post-Install Verification Checklist (Mandatory)

Run this block and report the output back to the user:

```bash
set -euo pipefail
unset LD_LIBRARY_PATH LD_PRELOAD

# 1. Status: checkout, build, Node runtime, Chrome Flatpak, udev gamepad override
"$HOME/.local/bin/satoyama-gp" --status

# 2. Startup auto-update + build path, non-interactive
"$HOME/.local/bin/satoyama-gp" --update-only

# 3. Smoke-test the local server: index.html, hashed JS bundle, models, byte-range audio
SATOYAMA_BROWSER=none "$HOME/.local/bin/satoyama-gp" --no-update >/dev/null 2>&1 &
TEST_PID=$!
for _ in $(seq 1 50); do curl -fsS -o /dev/null http://127.0.0.1:8741/ 2>/dev/null && break; sleep 0.2; done
curl -fsS http://127.0.0.1:8741/ | grep -o '<title>[^<]*</title>'
BUNDLE="$(curl -fsS http://127.0.0.1:8741/ | grep -oE '/assets/index-[^"]+\.js' | head -n 1)"
curl -fsS -o /dev/null -w "bundle $BUNDLE: %{http_code} %{size_download} bytes\n" "http://127.0.0.1:8741$BUNDLE"
curl -fsS -o /dev/null -w "models/index.json: %{http_code}\n" http://127.0.0.1:8741/models/index.json
curl -fsS -o /dev/null -w "audio range: %{http_code}\n" -H 'Range: bytes=0-1023' http://127.0.0.1:8741/audio/music/title.mp3
kill "$TEST_PID" 2>/dev/null || true
wait "$TEST_PID" 2>/dev/null || true

# 4. Steam Grid artwork files
ls -lh "$HOME"/.local/share/Steam/userdata/*/config/grid/* 2>/dev/null | tail -n 10 || true
```

Expected results:
- `--status` shows `(udev gamepad access: yes)`, a commit on `main`, and `build: <sha> … (current)`.
- `--update-only` finishes without any prompt and logs `Up to date (<sha>)`. It must not rebuild a second time.
- The smoke test prints `<title>Satoyama GP — Sakura Valley</title>`, `bundle … 200`, `models/index.json: 200`, and `audio range: 206`.
- All 5 grid images (`<appid>.png`, `<appid>p.png`, `<appid>_hero.png`, `<appid>_logo.png`, `<appid>_icon.png`) exist in `userdata/<STEAM_ID3>/config/grid/`.

Then ask the user to launch **Satoyama GP** from Gaming Mode once and confirm three things the checks above cannot cover: the game renders, the controller works after pressing any button, and the frame rate is acceptable (see graphics note below).

---

## Steam Deck Controls & Launch Options Reference

### Controller mapping (Steam's standard **Gamepad** template, no remapping needed)

The game hides the controller until one of its buttons is pressed. That is a browser privacy rule.

| Action | Steam Deck control |
| :--- | :--- |
| **Steer** | **Left Stick** or **D-Pad** |
| **Gas** | **`R2`** (analog) |
| **Brake** | **`L2`** (analog) |
| **Handbrake** · confirm in menus | **`A`** |
| **Look back** · back in menus | **`B`** |
| **Change camera** | **`Y`** |
| **Online race lobby** | **`X`** |
| **Reset car** | **`View`** (top-left) |
| **Pause / settings (controls, graphics)** | **`Menu`** (`≡`, top-right) |
| **Type name or room code in the lobby** | **`STEAM` + `X`** (on-screen keyboard) |
| **Quit (stops server + kiosk)** | **`STEAM`** → **Exit Game** |

### Graphics preset

The game picks a preset from the GPU name and only steps down for Intel, Adreno, Apple and software renderers, so the Deck's AMD APU is expected to get **`high`** (4× MSAA). This has not been measured on a Deck. If the frame rate is poor, open **`Menu` → graphics** in-game and pick **`medium`**; the choice is saved. Dynamic resolution scaling is on in every preset.

### Optional Steam launch options (Steam → Satoyama GP → Gear → Properties → Launch Options)

- **Default** (auto-detected preset, in-game choice remembered, GitHub update on boot): *(leave blank)*
- **Force a preset for every launch** (overrides the saved in-game choice):
  ```text
  SATOYAMA_Q=medium %command%
  ```
- **Skip the GitHub check** (fastest boot):
  ```text
  %command% --no-update
  ```
- **Host online races for other devices on the same Wi-Fi**: the relay normally listens on loopback only, so the online lobby only ever contains this Deck. Binding to all interfaces lets others open `http://<deck-ip>:8741/` in a browser and join the Deck's room code.
  ```text
  SATOYAMA_HOST=0.0.0.0 %command%
  ```
- **Join races on another Satoyama GP server**: that server must be started with `ORIGINS=http://127.0.0.1:8741`, otherwise its relay rejects the Deck.
  ```text
  SATOYAMA_SERVER=wss://example.host/ws %command%
  ```

### Inspect status and logs (SSH or Konsole)

```bash
~/.local/bin/satoyama-gp --status
tail -n 50 ~/.local/share/satoyama-gp/logs/update.log ~/.local/share/satoyama-gp/logs/server.log
```

### Uninstall

```bash
rm -rf ~/.local/share/satoyama-gp ~/.local/bin/satoyama-gp \
  ~/.local/share/applications/satoyama-gp.desktop \
  ~/.local/share/icons/hicolor/256x256/apps/satoyama-gp.png \
  ~/.var/app/com.google.Chrome/data/satoyama-gp-profile \
  ~/.var/app/com.google.Chrome/cache/satoyama-gp-art
```

Then remove the **Satoyama GP** shortcut from the Steam library (Gear → Manage → Remove non-Steam game).

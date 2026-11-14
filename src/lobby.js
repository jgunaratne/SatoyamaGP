// The online lobby panel: room code, invite link, driver list, name and join-by-code fields.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function loadName() {
  try { return localStorage.getItem('satoyama.name') || ''; } catch { return ''; }
}

export class Lobby {
  // onJoin(code): join another room. onName(name): the driver renamed themselves. onStart / onLeave: buttons.
  constructor({ onJoin, onName, onStart, onLeave }) {
    this.el = {};
    for (const id of ['lobby', 'lobbyStatus', 'lobbyCode', 'lobbyCopy', 'lobbyRows', 'lobbyName', 'lobbyJoin', 'lobbyJoinBtn', 'lobbyStart', 'lobbyLeave', 'lobbyHint']) this.el[id] = $(id);
    const e = this.el;
    e.lobbyName.value = loadName();
    e.lobbyName.addEventListener('change', () => {
      const name = e.lobbyName.value.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12).toUpperCase();
      e.lobbyName.value = name;
      try { localStorage.setItem('satoyama.name', name); } catch { /* private mode */ }
      onName(name);
    });
    const join = () => {
      const code = e.lobbyJoin.value.trim().toUpperCase();
      if (/^[A-Z0-9]{3,8}$/.test(code)) { e.lobbyJoin.value = ''; e.lobbyJoin.blur(); onJoin(code); }
    };
    e.lobbyJoinBtn.addEventListener('click', join);
    for (const f of [e.lobbyName, e.lobbyJoin]) f.addEventListener('keydown', (ev) => {
      if (ev.code === 'Enter') { ev.preventDefault(); if (f === e.lobbyJoin) join(); else f.blur(); }
      if (ev.code === 'Escape') f.blur();
    });
    e.lobbyStart.addEventListener('click', onStart);
    e.lobbyLeave.addEventListener('click', onLeave);
    e.lobbyCopy.addEventListener('click', () => {
      const done = (ok) => { e.lobbyCopy.textContent = ok ? 'LINK COPIED' : 'COPY FAILED — SHARE THE ADDRESS BAR'; setTimeout(() => { e.lobbyCopy.textContent = 'COPY INVITE LINK'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false));
      else done(false);
    });
  }
  get name() { return this.el.lobbyName.value || 'DRIVER'; }
  show(on) { this.el.lobby.classList.toggle('hidden', !on); }

  // v = { status, code, players:[{id, name}], hostId, myId, canStart, hint }
  render(v) {
    const e = this.el;
    e.lobbyStatus.textContent = v.status;
    e.lobbyCode.textContent = v.code || '––––';
    e.lobbyRows.innerHTML = v.players.map((p, i) => `<div class="row${p.id === v.myId ? ' me' : ''}"><span><b>${i + 1}</b>${esc(p.name)}${p.id === v.myId ? ' (YOU)' : ''}</span><span>${p.id === v.hostId ? 'HOST' : ''}</span></div>`).join('');
    e.lobbyStart.classList.toggle('hidden', !v.canStart);
    e.lobbyHint.textContent = v.hint;
  }
}

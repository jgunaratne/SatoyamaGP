const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ORD = ['', 'ST', 'ND', 'RD', 'TH', 'TH', 'TH', 'TH', 'TH'];

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export class Hud {
  constructor(track, total) {
    this.track = track; this.el = {};
    for (const id of ['hud', 'posN', 'posOf', 'lapN', 'lapOf', 'time', 'split', 'rpmArc', 'kmh', 'gear', 'map', 'banner', 'bannerT', 'bannerS', 'count', 'wrong', 'title', 'results', 'resHead', 'resRows', 'fps']) this.el[id] = $(id);
    this.el.posOf.textContent = total;
    this.cache = {}; this.bannerT = 0;
    // pre-render the minimap outline
    const S = 300, bg = (this.mapBg = document.createElement('canvas')); bg.width = bg.height = S;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
    const sc = (S - 36) / Math.max(maxX - minX, maxZ - minZ);
    this.mx = (x) => S / 2 + (x - (minX + maxX) / 2) * sc; this.mz = (z) => S / 2 + (z - (minZ + maxZ) / 2) * sc;
    const g = bg.getContext('2d');
    const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 4) { const k = i % track.N; g.lineTo(this.mx(track.px[k]), this.mz(track.pz[k])); } g.closePath(); };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 11; g.stroke();
    path(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#ffe14a'; g.fillRect(this.mx(track.px[0]) - 7, this.mz(track.pz[0]) - 2.5, 14, 5);
    this.mapCtx = this.el.map.getContext('2d');
  }
  set(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; this.el[id].textContent = v; } }
  show(id, on) { this.el[id].classList.toggle('hidden', !on); }
  banner(text, sub = '', dur = 2.2) {
    this.el.bannerT.textContent = text; this.el.bannerS.textContent = sub;
    this.el.banner.classList.add('on'); this.bannerT = dur;
  }
  count(text) {
    const c = this.el.count; c.textContent = text; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  }
  update(dt, s) {
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('on');
    this.set('posN', s.pos); this.set('lapN', s.lap); this.set('lapOf', s.laps);
    this.set('time', fmtTime(s.time));
    this.set('kmh', Math.round(Math.abs(s.speed) * 3.6));
    this.set('gear', s.reverse ? 'R' : s.gear);
    const f = Math.min(1, Math.max(0, (s.rpm - 800) / 6800));
    this.el.rpmArc.setAttribute('stroke-dasharray', `${(f * 414.7).toFixed(1)} 553`);
    this.el.rpmArc.style.stroke = f > 0.87 ? '#ff2a7f' : '#fff';
    this.show('wrong', s.wrongWay);
    const g = this.mapCtx;
    g.clearRect(0, 0, 300, 300); g.drawImage(this.mapBg, 0, 0);
    for (const r of s.rivals) { g.fillStyle = r.color; g.beginPath(); g.arc(this.mx(r.x), this.mz(r.z), 6, 0, 7); g.fill(); }
    g.fillStyle = '#ff2a7f'; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.arc(this.mx(s.x), this.mz(s.z), 9, 0, 7); g.fill(); g.stroke();
  }
  results(rows, place) {
    this.el.resHead.innerHTML = place === 1 ? 'RACE <em>WON!</em>' : `FINISHED <em>${place}${ORD[place]}</em>`;
    this.el.resRows.innerHTML = rows.map((r, i) => `<div class="row${r.me ? ' me' : ''}"><span><b>${i + 1}</b>${esc(r.name)}</span><span>${r.time}</span></div>`).join('');
    this.show('results', true);
  }
}
export { ORD };

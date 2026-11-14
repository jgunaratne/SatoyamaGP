import * as THREE from 'three';

// Cinematic post stack: HDR scene -> anamorphic bokeh DOF -> bloom pyramid -> horizontal lens
// streaks -> composite (barrel distortion, chromatic aberration, radial speed blur, sun flare,
// ACES tonemap, grade, vignette, grain, letterbox).

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;

// Sun occlusion is resolved once per vertex (3 lookups total) instead of per pixel.
const COMP_VS = /* glsl */ `
uniform sampler2D tDepth; uniform vec3 uSun; varying vec2 vUv; varying float vSunVis;
void main(){
  vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.);
  float vis = 0.;
  if (uSun.z > 0.) {
    for (int i = 0; i < 9; i++) {
      vec2 o = vec2(float(i % 3) - 1., float(i / 3) - 1.) * .005;
      vis += step(.99999, texture2D(tDepth, clamp(uSun.xy + o, 0., 1.)).x);
    }
    vec2 e = min(uSun.xy, 1. - uSun.xy);
    vis *= smoothstep(-.08, .06, min(e.x, e.y)) / 9.;
  }
  vSunVis = vis;
}`;

const DOF_FS = /* glsl */ `
uniform sampler2D tColor, tDepth; uniform vec2 uTexel;
uniform float uNear, uFar, uFocusNear, uFocusFar, uFarScale, uNearScale, uMaxBlur, uRad;
varying vec2 vUv;
float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float coc(float d){
  float f = max(0., 1. / uFocusFar - 1. / d) * uFarScale;
  float n = max(0., 1. / d - 1. / uFocusNear) * uNearScale;
  return min(max(f, n), uMaxBlur);
}
void main(){
  float cd = lin(vUv), cs = coc(cd);
  vec3 col = texture2D(tColor, vUv).rgb; float tot = 1., radius = uRad;
  // golden-angle spiral, squeezed horizontally -> tall oval "anamorphic" bokeh
  for (float ang = 0.; radius < uMaxBlur; ang += 2.39996323) {
    vec2 tc = vUv + vec2(cos(ang) * .55, sin(ang)) * uTexel * radius;
    vec3 sc = texture2D(tColor, tc).rgb; float sd = lin(tc), ss = coc(sd);
    if (sd > cd) ss = clamp(ss, 0., cs * 2.);
    float m = smoothstep(radius - .5, radius + .5, ss);
    col += mix(col / tot, sc, m); tot += 1.;
    radius += uRad / radius;
  }
  gl_FragColor = vec4(col / tot, 1.);
}`;

const BRIGHT_FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThr; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-.5, -.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(.5, -.5)).rgb
         + texture2D(tColor, vUv + uTexel * vec2(-.5, .5)).rgb + texture2D(tColor, vUv + uTexel * vec2(.5, .5)).rgb;
  c = min(c * .25, vec3(24.));
  float br = max(c.r, max(c.g, c.b)), k = uThr * .5;
  float soft = clamp(br - uThr + k, 0., 2. * k); soft = soft * soft / (4. * k + 1e-4);
  gl_FragColor = vec4(c * max(soft, br - uThr) / max(br, 1e-4), 1.);
}`;

const DOWN_FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb * 4.;
  c += texture2D(tColor, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tColor, vUv + uTexel * vec2(1., -1.)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tColor, vUv + uTexel * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(c / 8., 1.);
}`;

const UP_FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uGain; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1., 0.)).rgb + texture2D(tColor, vUv + uTexel * vec2(1., 0.)).rgb
         + texture2D(tColor, vUv + uTexel * vec2(0., -1.)).rgb + texture2D(tColor, vUv + uTexel * vec2(0., 1.)).rgb;
  c += (texture2D(tColor, vUv + uTexel * vec2(-.5, -.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(.5, -.5)).rgb
      + texture2D(tColor, vUv + uTexel * vec2(-.5, .5)).rgb + texture2D(tColor, vUv + uTexel * vec2(.5, .5)).rgb) * 2.;
  gl_FragColor = vec4(c / 12. * uGain, 1.);
}`;

const STREAK_FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uDir; uniform float uSub; varying vec2 vUv;
void main(){
  vec3 c = vec3(0.); float tw = 0.;
  for (int i = -5; i <= 5; i++) {
    float w = exp(-float(i * i) / 14.);
    c += max(texture2D(tColor, vUv + uDir * float(i)).rgb - uSub, 0.) * w; tw += w;
  }
  gl_FragColor = vec4(c / tw, 1.);
}`;

const COMP_FS = /* glsl */ `
uniform sampler2D tScene, tBloom, tStreak;
uniform vec2 uRes; uniform vec3 uSun;
varying float vSunVis;
uniform float uTime, uSpeed, uCA, uBloom, uStreak, uExposure, uLetterbox, uFade, uVignette, uFlare, uDistort, uSat, uGrain;
varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  float asp = uRes.x / uRes.y;
  vec2 c0 = vUv - .5;
  // mild anamorphic barrel distortion (corners pinned)
  vec2 uv = .5 + c0 * (1. + uDistort * dot(c0, c0)) / (1. + uDistort * .5);
  vec2 cc = uv - .5;
  float rr = length(cc * vec2(1., .75));
  vec2 dir = cc * uSpeed * .075 * smoothstep(.1, .55, rr);
  vec2 ca = cc * vec2(1., .35) * uCA * (.25 + rr * rr * 4.);
  float jit = hash(gl_FragCoord.xy + fract(uTime) * 91.);
  vec3 col = vec3(0.);
  for (int i = 0; i < SAMPLES; i++) {
    vec2 u = uv - dir * ((float(i) + jit) / float(SAMPLES));
    col.r += texture2D(tScene, u + ca).r; col.g += texture2D(tScene, u).g; col.b += texture2D(tScene, u - ca).b;
  }
  col /= float(SAMPLES);
  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 streak = texture2D(tStreak, uv).rgb;
  col += bloom * uBloom + streak * vec3(.42, .62, 1.) * uStreak;

  // sun: anamorphic flare, occluded by scene depth
  if (vSunVis > .001) {
    float vis = vSunVis;
    vec2 p = (vUv - uSun.xy) * vec2(asp, 1.);
    float d = length(p);
    vec3 fl = vec3(1., .78, .5) * .012 / (d * d * 6. + .012);
    fl += vec3(.3, .55, 1.) * exp(-abs(p.y) * 60.) * exp(-abs(p.x) * 1.5) * .8;
    fl += vec3(.75, .88, 1.) * exp(-abs(p.y) * 420.) * exp(-abs(p.x) * .85) * .7;
    vec2 axis = vec2(.5) - uSun.xy;
    for (int i = 0; i < 5; i++) {
      float k = i == 0 ? .45 : i == 1 ? .8 : i == 2 ? 1.25 : i == 3 ? 1.7 : 2.15;
      float sz = i == 0 ? .035 : i == 1 ? .02 : i == 2 ? .07 : i == 3 ? .045 : .12;
      vec2 q = (vUv - (uSun.xy + axis * k)) * vec2(asp, 1.7);
      float gd = length(q);
      vec3 tint = i == 2 ? vec3(.25, .5, 1.) : i == 4 ? vec3(.2, .35, .9) : vec3(.5, .8, .6);
      fl += tint * (smoothstep(sz, sz * .7, gd) * .03 + smoothstep(sz * .2, 0., abs(gd - sz * .92)) * .03);
    }
    col += fl * vis * uFlare;
  }

  col *= uExposure;
  col *= 1. - uVignette * pow(rr * 1.55, 2.4);
  col = aces(col);
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, uSat);
  col = mix(col * vec3(.93, 1., 1.07), col, smoothstep(0., .4, l));       // teal shadows
  col = mix(col, col * vec3(1.05, 1., .93), smoothstep(.35, .95, l));     // warm highlights
  col = pow(max(col, 0.), vec3(1. / 2.2));
  col += (hash(gl_FragCoord.xy * 1.31 + fract(uTime * 7.) * 53.) - .5) * uGrain;
  float lb = uLetterbox * max(0., .5 * (1. - asp / 2.39)) * .7;
  col *= step(lb, vUv.y) * step(vUv.y, 1. - lb);
  gl_FragColor = vec4(col * uFade, 1.);
}`;

export class Post {
  constructor(renderer, q) {
    this.r = renderer; this.q = q;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, null); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    const T = () => ({ value: null }), V2 = () => ({ value: new THREE.Vector2() }), F = (v = 0) => ({ value: v });
    this.mDof = mk(DOF_FS, { tColor: T(), tDepth: T(), uTexel: V2(), uNear: F(), uFar: F(), uFocusNear: F(4), uFocusFar: F(40), uFarScale: F(200), uNearScale: F(30), uMaxBlur: F(4), uRad: F(1) });
    this.mBright = mk(BRIGHT_FS, { tColor: T(), uTexel: V2(), uThr: F(this.hdr ? 1.15 : 0.8) });
    this.mDown = mk(DOWN_FS, { tColor: T(), uTexel: V2() });
    this.mUp = mk(UP_FS, { tColor: T(), uTexel: V2(), uGain: F(1) }, { blending: THREE.AdditiveBlending, transparent: true });
    this.mStreak = mk(STREAK_FS, { tColor: T(), uDir: V2(), uSub: F(0) });
    this.mComp = mk(COMP_FS, {
      tScene: T(), tBloom: T(), tStreak: T(), tDepth: T(), uRes: V2(), uSun: { value: new THREE.Vector3() },
      uTime: F(), uSpeed: F(), uCA: F(0.0028), uBloom: F(0.16), uStreak: F(0.55), uExposure: F(1.25), uLetterbox: F(), uFade: F(1),
      uVignette: F(0.5), uFlare: F(1), uDistort: F(0.07), uSat: F(1.12), uGrain: F(0.028),
    }, { defines: { SAMPLES: q.blurSamples }, vertexShader: COMP_VS });
    this.targets = [];
    this.w = this.h = 0;
  }

  setSize(w, h) {
    w = Math.max(64, Math.floor(w)); h = Math.max(64, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const t of this.targets) t.dispose();
    this.targets = [];
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = (W, H, opts = {}) => {
      const t = new THREE.WebGLRenderTarget(Math.max(2, W), Math.max(2, H), { type, depthBuffer: false, ...opts });
      this.targets.push(t); return t;
    };
    this.rtScene = rt(w, h, { depthBuffer: true, samples: this.q.msaa, depthTexture: new THREE.DepthTexture(w, h) });
    this.rtDof = rt(w, h);
    this.mips = [];
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < 6; i++) { this.mips.push(rt(mw, mh)); mw >>= 1; mh >>= 1; }
    this.rtS1 = rt(w >> 2, h >> 2); this.rtS2 = rt(w >> 2, h >> 2);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, p) {
    const r = this.r, w = this.w, h = this.h;
    r.autoClear = false;
    r.setRenderTarget(this.rtScene); r.clear();
    r.render(scene, camera);

    let src = this.rtScene;
    if (this.q.dofTaps > 0) {
      const u = this.mDof.uniforms, sc = h / 1080;
      u.tColor.value = this.rtScene.texture; u.tDepth.value = this.rtScene.depthTexture;
      u.uTexel.value.set(sc / w, sc / h);
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uFocusNear.value = p.focusNear; u.uFocusFar.value = p.focusFar;
      u.uFarScale.value = p.farScale; u.uNearScale.value = p.nearScale; u.uMaxBlur.value = p.maxBlur;
      u.uRad.value = Math.max(0.35, (p.maxBlur * p.maxBlur) / (2 * this.q.dofTaps));
      this.pass(this.mDof, this.rtDof);
      src = this.rtDof;
    }

    // bloom pyramid
    const m = this.mips;
    this.mBright.uniforms.tColor.value = src.texture; this.mBright.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.pass(this.mBright, m[0]);
    for (let i = 1; i < m.length; i++) {
      this.mDown.uniforms.tColor.value = m[i - 1].texture; this.mDown.uniforms.uTexel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height);
      this.pass(this.mDown, m[i]);
    }
    // lens streaks from the quarter-res bright buffer (before upsampling pollutes it)
    const su = this.mStreak.uniforms, sw = this.rtS1.width;
    su.tColor.value = m[1].texture; su.uDir.value.set(1.3 / sw, 0); su.uSub.value = 0.5; this.pass(this.mStreak, this.rtS1);
    su.tColor.value = this.rtS1.texture; su.uDir.value.set(4.5 / sw, 0); su.uSub.value = 0; this.pass(this.mStreak, this.rtS2);
    su.tColor.value = this.rtS2.texture; su.uDir.value.set(14 / sw, 0); this.pass(this.mStreak, this.rtS1);
    for (let i = m.length - 1; i > 0; i--) {
      this.mUp.uniforms.tColor.value = m[i].texture; this.mUp.uniforms.uTexel.value.set(1 / m[i].width, 1 / m[i].height);
      this.pass(this.mUp, m[i - 1]);
    }

    const c = this.mComp.uniforms;
    c.tScene.value = src.texture; c.tBloom.value = m[0].texture; c.tStreak.value = this.rtS1.texture; c.tDepth.value = this.rtScene.depthTexture;
    c.uRes.value.set(w, h); c.uTime.value = p.time; c.uSpeed.value = p.speed; c.uLetterbox.value = p.letterbox; c.uFade.value = p.fade;
    c.uSun.value.copy(p.sun);
    r.setRenderTarget(null);
    this.pass(this.mComp, null);
  }
}

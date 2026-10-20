// renderer.js — Claude Racer v2: career, shop tabs, passives, perfect-shift.
import {
  CARS, CAR_KEYS, PARTS, PART_KEYS, PASSIVES, PASSIVE_KEYS,
  GEAR_RATIOS, REDLINE, IDLE, SHIFT_RPM, maxGear,
  speedFromRpm, rpmFromSpeed, torqueFactor, rpmZone,
  perfectWindow, isPerfectShift, accel,
  freshSave, migrate,
  partLevelCost, partTierCost, carCost, passiveCost, mechanicDiscount,
  carStats, CHAPTERS, STAGES_PER_CHAPTER, makeRival, earnings, PERFECT_CREDIT, RACE_DISTANCE,
  stageCharacter,
} from "./game.mjs";

const STAGE_CAR_COLORS = ["#e5484d","#4ea1ff","#38d39f","#e8b84b","#a06bff","#ff7ac6","#7affd1","#ff9f43"];
const STAGE_CAR_SHAPES = ["coupe","muscle","hatch","gt","porsche","hyper"];

// ── save state ─────────────────────────────────────────────────────────────
let S = freshSave();
async function loadGame() {
  if (window.racer && window.racer.load) {
    const raw = await window.racer.load();
    if (raw) S = migrate(raw);
  }
}
function persist() { if (window.racer && window.racer.save) window.racer.save(S); }

// ── deterministic-ish rng seeded per race (avoids Date/Math.random ban? no ban here) ──
function rng() { return Math.random(); }

// ══ AUDIO — full synthesized sound design, zero external files (CSP-safe) ══
let AC = null, masterGain = null, sfxBus = null, musicBus = null;
let soundOn = true;
function audio() {
  if (!AC) {
    AC = new AudioContext();
    masterGain = AC.createGain(); masterGain.gain.value = soundOn ? 0.9 : 0; masterGain.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(masterGain);
    musicBus = AC.createGain(); musicBus.gain.value = 0.5; musicBus.connect(masterGain);
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function setSound(on) { soundOn = on; if (masterGain) masterGain.gain.setTargetAtTime(on ? 0.9 : 0, AC.currentTime, 0.05); }

// ── engine: aggressive V-engine model (ดุดัน) ──────────────────────────────
//  • firing-pulse LFO gates the tone → the "BRAP-BRAP" lope of a real motor
//  • two detuned saws = thick, angry mid
//  • sub sine = chest rumble ; square whine = top-end scream
//  • waveshaper overdrive = distorted, throaty grit
//  • steady filtered-noise layer = intake/exhaust turbulence
let engA=null, engB=null, engSub=null, engWhine=null, engGain=null, engFilter=null,
    engShaper=null, engFire=null, engFireGain=null, engToneGain=null,
    engNoise=null, engNoiseGain=null, engNoiseFilter=null;
function makeDriveCurve(amount) {
  const n = 1024, curve = new Float32Array(n), k = amount;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return curve;
}
function startEngine() {
  const ac = audio();
  if (engA) return;
  engA = ac.createOscillator(); engB = ac.createOscillator();
  engSub = ac.createOscillator(); engWhine = ac.createOscillator();
  engToneGain = ac.createGain(); engGain = ac.createGain();
  engFilter = ac.createBiquadFilter(); engShaper = ac.createWaveShaper();
  engA.type = "sawtooth"; engB.type = "sawtooth"; engSub.type = "sine"; engWhine.type = "square";
  engB.detune.value = 22;                       // detune → thick beating
  engFilter.type = "lowpass"; engFilter.frequency.value = 1100; engFilter.Q.value = 6;
  engShaper.curve = makeDriveCurve(9); engShaper.oversample = "4x";  // overdrive grit

  // firing-pulse tremolo: LFO → gain, gives the pulsing lope/growl
  engFire = ac.createOscillator(); engFireGain = ac.createGain();
  engFire.type = "sawtooth"; engFire.frequency.value = 30;
  engFireGain.gain.value = 0.5;                 // depth of the pulse
  engToneGain.gain.value = 0;                   // base (DC) level, set by throttle
  engFire.connect(engFireGain); engFireGain.connect(engToneGain.gain);

  [engA, engB, engSub, engWhine].forEach(o => o.connect(engToneGain));
  engToneGain.connect(engShaper); engShaper.connect(engFilter);
  engFilter.connect(engGain); engGain.connect(sfxBus);
  engGain.gain.value = 0;

  // intake/exhaust noise bed
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  engNoise = ac.createBufferSource(); engNoise.buffer = buf; engNoise.loop = true;
  engNoiseFilter = ac.createBiquadFilter(); engNoiseFilter.type = "bandpass"; engNoiseFilter.frequency.value = 900; engNoiseFilter.Q.value = 0.7;
  engNoiseGain = ac.createGain(); engNoiseGain.gain.value = 0;
  engNoise.connect(engNoiseFilter); engNoiseFilter.connect(engNoiseGain); engNoiseGain.connect(engGain);

  [engA, engB, engSub, engWhine, engFire, engNoise].forEach(o => o.start());
}
function engineTo(rpm, throttle) {
  if (!engA) return; const ac = audio(); const t = ac.currentTime;
  const rr = rpm / REDLINE;
  const f = 46 + rr * 190;                       // fundamental (cylinder firing)
  engA.frequency.setTargetAtTime(f, t, 0.03);
  engB.frequency.setTargetAtTime(f, t, 0.03);
  engSub.frequency.setTargetAtTime(f * 0.5, t, 0.04);
  engWhine.frequency.setTargetAtTime(f * 3, t, 0.05);       // top-end scream grows with revs
  // firing pulse speeds up with rpm → faster, angrier lope
  engFire.frequency.setTargetAtTime(f * 0.5 + 8, t, 0.04);
  engFireGain.gain.setTargetAtTime(0.35 - rr * 0.22, t, 0.05); // pulse smooths out at high rpm
  // louder & brighter on throttle; scream layer only when pushing
  engToneGain.gain.setTargetAtTime(0.05 + throttle * 0.05 + rr * 0.03, t, 0.04);
  engGain.gain.setTargetAtTime(0.5 + throttle * 0.35, t, 0.05);
  engFilter.frequency.setTargetAtTime(520 + rr * 3400 + throttle * 600, t, 0.04);
  engFilter.Q.setTargetAtTime(5 + rr * 5, t, 0.05);
  engNoiseFilter.frequency.setTargetAtTime(700 + rr * 2600, t, 0.05);
  engNoiseGain.gain.setTargetAtTime(0.06 + throttle * 0.10 + rr * 0.05, t, 0.05);
}
function stopEngine() { if (engGain) { try { engGain.gain.setTargetAtTime(0, audio().currentTime, 0.15); } catch {} } }
// exhaust pop/backfire on lift or over-rev — throaty crackle
function exhaustPop() {
  try { const ac = audio(), now = ac.currentTime;
    noiseBurst(now, 0.09, 0.22, 220); tone(now, "square", 90, 40, 0.08, 0.10);
  } catch {}
}

// ── background music: looping arpeggio + bass, synthesized bar-by-bar ──
let musicTimer = null, musicPlaying = false, musicStep = 0;
const MUSIC_SCALE = [0, 3, 5, 7, 10, 12, 10, 7]; // minor-pentatonic riff
const MUSIC_ROOT = 110; // A2
function musicNote(semi, dur, when, type, gain, bus) {
  const ac = audio();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = MUSIC_ROOT * Math.pow(2, semi / 12);
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(bus || musicBus); o.start(when); o.stop(when + dur + 0.05);
}
function startMusic() {
  if (musicPlaying) return; audio(); musicPlaying = true; musicStep = 0;
  const stepMs = 200;   // faster, driving tempo
  const doStep = () => {
    if (!musicPlaying) return;
    const ac = audio(), now = ac.currentTime, s = musicStep;
    const lead = MUSIC_SCALE[s % MUSIC_SCALE.length] + 12;
    musicNote(lead, 0.18, now, "sawtooth", 0.07);                 // gritty lead
    // driving distorted bassline (every step)
    musicNote(MUSIC_SCALE[Math.floor(s / 2) % MUSIC_SCALE.length] - 12, 0.19, now, "square", 0.06);
    if (s % 4 === 0) { // punchy kick
      const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.setValueAtTime(150, now);
      o.frequency.exponentialRampToValueAtTime(45, now + 0.11); g.gain.setValueAtTime(0.16, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      o.connect(g); g.connect(musicBus); o.start(now); o.stop(now + 0.17);
    }
    if (s % 2 === 1) { // hi-hat tick
      const b = ac.createBuffer(1, ac.sampleRate * 0.03, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const sN = ac.createBufferSource(); sN.buffer = b; const g = ac.createGain(); g.gain.value = 0.04;
      const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 7000;
      sN.connect(f); f.connect(g); g.connect(musicBus); sN.start(now);
    }
    musicStep++;
    musicTimer = setTimeout(doStep, stepMs);
  };
  doStep();
}
function stopMusic() { musicPlaying = false; if (musicTimer) clearTimeout(musicTimer); }
function musicDuck(down) { if (musicBus) musicBus.gain.setTargetAtTime(down ? 0.18 : 0.5, audio().currentTime, 0.3); }
function noiseBurst(now, dur, gain, hp) {
  const ac = audio();
  const b = ac.createBuffer(1, Math.max(1, ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const sN = ac.createBufferSource(); sN.buffer = b;
  const g = ac.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 400;
  sN.connect(f); f.connect(g); g.connect(sfxBus); sN.start(now);
}
function tone(now, type, f0, f1, dur, gain) {
  const ac = audio();
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
  o.frequency.setValueAtTime(f0, now);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
  g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  o.connect(g); g.connect(sfxBus); o.start(now); o.stop(now + dur + 0.02);
}
function sfx(kind) {
  try {
    const ac = audio(), now = ac.currentTime;
    if (kind === "shift") { // mechanical CLACK + throttle blip + exhaust bark
      noiseBurst(now, 0.04, 0.16, 1600); tone(now, "square", 240, 70, 0.09, 0.14);
      tone(now + 0.02, "sawtooth", 300, 520, 0.06, 0.10); exhaustPop();
    }
    else if (kind === "perfect") { // crisp rev-match sparkle + turbo flutter
      tone(now, "triangle", 700, 1150, 0.12, 0.15); tone(now + 0.05, "sine", 1500, 1800, 0.1, 0.09);
      for (let i = 0; i < 3; i++) tone(now + 0.08 + i * 0.03, "sine", 2400, 2400, 0.02, 0.05); // BOV flutter
    }
    else if (kind === "nitro") { // deep whoosh + roar
      noiseBurst(now, 0.6, 0.28, 260); tone(now, "sawtooth", 110, 520, 0.55, 0.10); tone(now, "sine", 60, 180, 0.5, 0.12);
    }
    else if (kind === "upgrade") { [523, 784, 1047].forEach((f, i) => tone(now + i * 0.06, "triangle", f, f, 0.12, 0.12)); }  // buy chime
    else if (kind === "buycar") { [392, 523, 659, 880, 1047].forEach((f, i) => tone(now + i * 0.08, "triangle", f, f, 0.16, 0.13)); } // fanfare
    else if (kind === "click") { tone(now, "square", 420, 420, 0.04, 0.06); }
    else if (kind === "count") { tone(now, "square", 440, 440, 0.12, 0.12); }
    else if (kind === "go") { tone(now, "square", 880, 880, 0.3, 0.16); }
    else if (kind === "win") { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(now + i * 0.12, "triangle", f, f, 0.32, 0.14)); }
    else if (kind === "lose") { tone(now, "sawtooth", 220, 70, 0.6, 0.12); tone(now + 0.15, "sawtooth", 180, 55, 0.6, 0.08); }
  } catch {}
}
// legacy alias — existing calls to blip(...) still work
function blip(kind) { sfx(kind); }

// ── car sprite ─────────────────────────────────────────────────────────────
// Distinct side-profile silhouettes per chassis shape. Wheels + headlight shared.
function darken(hex, f = 0.72) {
  const c = hex.replace("#", ""); const n = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const r = Math.round(parseInt(n.slice(0,2),16)*f), g = Math.round(parseInt(n.slice(2,4),16)*f), b = Math.round(parseInt(n.slice(4,6),16)*f);
  return `rgb(${r},${g},${b})`;
}
function carSVG(color, spoiler, shape = "hatch") {
  const dk = darken(color, 0.62);
  const wheels = `
    <ellipse cx="26" cy="39" rx="3" ry="2" fill="#000" opacity=".35"/>
    <ellipse cx="72" cy="39" rx="3" ry="2" fill="#000" opacity=".35"/>
    <circle cx="26" cy="35" r="8.5" fill="#0c0c0e" stroke="#2a2a30" stroke-width="2"/><circle cx="26" cy="35" r="3.4" fill="#666"/><circle cx="26" cy="35" r="1.3" fill="#aaa"/>
    <circle cx="72" cy="35" r="8.5" fill="#0c0c0e" stroke="#2a2a30" stroke-width="2"/><circle cx="72" cy="35" r="3.4" fill="#666"/><circle cx="72" cy="35" r="1.3" fill="#aaa"/>`;
  const light = `<ellipse cx="87" cy="26" rx="2.6" ry="2" fill="#fff3b0"/><ellipse cx="10" cy="27" rx="1.6" ry="2" fill="#e5484d" opacity=".8"/>`;
  let body, glass, extra = "";

  if (shape === "porsche") {
    // 911: low nose, fastback roofline sweeping to the tail (rear-engine hump)
    body = `<path d="M8 31 Q10 27 20 26 Q30 17 46 16 Q62 15 74 20 Q84 24 88 28 L89 31 Z" fill="${color}"/>
            <path d="M8 31 L89 31 L89 33 Q50 35 8 33 Z" fill="${dk}"/>`;
    glass = `<path d="M31 18 Q44 16.5 58 17.5 Q66 18.5 71 22 L64 22.5 L34 22.5 Z" fill="#20303f" opacity=".92"/>
             <path d="M46 17 L46 22.3" stroke="#0d1620" stroke-width="1"/>`;
    extra = `<rect x="20" y="24.5" width="52" height="1.4" fill="${dk}"/>`; // beltline
  } else if (shape === "gt") {
    // GT: long low wedge nose, tight cabin
    body = `<path d="M6 31 Q9 25 30 23 L48 16 Q64 15 78 21 Q86 25 90 30 L90 31 Z" fill="${color}"/>
            <path d="M6 31 L90 31 L90 33 Q48 35 6 33 Z" fill="${dk}"/>`;
    glass = `<path d="M40 17 L62 17 Q70 19 74 23 L44 23 Z" fill="#1a2836" opacity=".9"/>`;
  } else if (shape === "hyper") {
    // Hypercar: ultra-low, sharp, canopy cockpit
    body = `<path d="M4 31 Q8 27 34 24 L50 15 Q68 14 84 20 Q90 24 92 30 L92 31 Z" fill="${color}"/>
            <path d="M4 31 L92 31 L92 32.5 Q50 34.5 4 32.5 Z" fill="${dk}"/>`;
    glass = `<path d="M42 16 L60 16 Q66 18 68 22 L46 22 Z" fill="#101a26" opacity=".92"/>`;
    extra = `<path d="M6 30 L20 27 L20 30 Z" fill="${dk}"/>`; // front splitter
  } else if (shape === "muscle") {
    // Muscle: long flat hood, boxy cabin, aggressive stance
    body = `<path d="M8 30 L14 22 L40 20 L58 20 L62 15 L74 15 L80 22 L88 24 L88 30 Z" fill="${color}"/>
            <rect x="8" y="30" width="80" height="3" fill="${dk}"/>`;
    glass = `<path d="M42 20.5 L58 20.5 L61 16 L72 16 L74 20.5 Z" fill="#1c2a38" opacity=".9"/>`;
    extra = `<rect x="42" y="17" width="16" height="2" fill="${dk}"/>`; // hood scoop
  } else if (shape === "coupe") {
    // Coupe: smooth rounded roof
    body = `<path d="M10 30 Q14 22 36 20 Q52 13 66 15 Q80 17 86 26 L88 30 Z" fill="${color}"/>
            <path d="M10 30 L88 30 L88 32.5 Q48 34 10 32.5 Z" fill="${dk}"/>`;
    glass = `<path d="M34 21 Q50 15 62 16.5 Q70 17.5 74 22 L40 22 Z" fill="#1c2c3a" opacity=".9"/>`;
  } else {
    // Hatch: short, tall, friendly
    body = `<path d="M12 30 Q16 16 40 14 L58 13 Q74 13 84 24 L86 30 Z" fill="${color}"/>
            <rect x="10" y="30" width="78" height="3" fill="${dk}"/>`;
    glass = `<path d="M40 15 L56 14 L64 22 L38 22 Z" fill="#bfe3ff" opacity=".85"/>`;
  }
  const wing = spoiler ? (shape === "porsche"
    ? `<path d="M12 24 Q16 20 24 21 L24 24 Z" fill="#1a1a1e"/><rect x="10" y="22" width="16" height="2.6" rx="1" fill="#1a1a1e"/>` // ducktail
    : `<rect x="6" y="16" width="12" height="3.4" rx="1" fill="#111"/><rect x="7" y="18" width="2.6" height="11" fill="#111"/><rect x="15" y="18" width="2.6" height="11" fill="#111"/>`) : "";
  return `<svg viewBox="0 0 96 44">${wing}${body}${extra}${glass}${light}${wheels}</svg>`;
}

// ── stick-man stage character with accessories ───────────────────────────────
// Draws a little figure (head/body/arms/legs) plus hat/glasses/beard/necklace.
// viewBox 0 0 40 74. Head centered at (20,14) r=8.
function personSVG(ch, scale = 1) {
  const s = ch.shirt || "#e5484d";
  const skin = "#e8c39a";
  let g = "";
  // legs + body + arms (simple runner-ish stance)
  g += `<line x1="20" y1="44" x2="14" y2="64" stroke="#2a2a30" stroke-width="4.5" stroke-linecap="round"/>`;
  g += `<line x1="20" y1="44" x2="26" y2="64" stroke="#2a2a30" stroke-width="4.5" stroke-linecap="round"/>`;
  g += `<path d="M20 26 L20 46 M13 47 L27 47" stroke="${s}" stroke-width="9" stroke-linecap="round"/>`; // torso (shirt)
  g += `<line x1="20" y1="30" x2="9" y2="40" stroke="${s}" stroke-width="4.5" stroke-linecap="round"/>`;
  g += `<line x1="20" y1="30" x2="31" y2="40" stroke="${s}" stroke-width="4.5" stroke-linecap="round"/>`;
  g += `<circle cx="9" cy="40" r="2.4" fill="${skin}"/><circle cx="31" cy="40" r="2.4" fill="${skin}"/>`; // hands
  // head
  g += `<circle cx="20" cy="14" r="8" fill="${skin}" stroke="#c99" stroke-width="0.5"/>`;

  // ── beard ──
  const bd = ch.beard;
  const bc = "#3a2a1a";
  if (bd && bd !== "none") {
    if (bd === "mustache" || bd === "handlebar" || bd === "pencil" || bd === "fu manchu" || bd === "stache-thin")
      g += `<path d="M15 17 Q20 20 25 17" stroke="${bc}" stroke-width="${bd==="stache-thin"?1.4:2.6}" fill="none" stroke-linecap="round"/>`;
    else if (bd === "goatee" || bd === "soul patch" || bd === "van dyke")
      g += `<path d="M18 20 Q20 24 22 20 Z" fill="${bc}"/>` + (bd==="van dyke"?`<path d="M15 17 Q20 19 25 17" stroke="${bc}" stroke-width="2" fill="none"/>`:"");
    else // full-ish beards wrap the jaw
      g += `<path d="M12 14 Q13 24 20 25 Q27 24 28 14 Q24 20 20 20 Q16 20 12 14 Z" fill="${bc}" opacity="${bd==="stubble"?0.5:0.95}"/>`;
  }
  // ── glasses ──
  const gl = ch.glasses;
  if (gl && gl !== "none") {
    if (gl === "eyepatch") g += `<path d="M16 12 L24 10" stroke="#111" stroke-width="1.4"/><circle cx="17" cy="13" r="2.6" fill="#111"/>`;
    else if (gl === "monocle") g += `<circle cx="23" cy="13" r="2.8" fill="none" stroke="#333" stroke-width="1"/><line x1="23" y1="16" x2="24" y2="20" stroke="#333" stroke-width="0.6"/>`;
    else {
      const lens = (gl==="shades"||gl==="aviator"||gl==="clout"||gl==="thug"||gl==="ski") ? "#1a1a1e" : "#bfe3ff";
      const op = lens==="#1a1a1e"?0.9:0.6;
      g += `<circle cx="16" cy="13" r="2.7" fill="${lens}" opacity="${op}" stroke="#333" stroke-width="0.8"/><circle cx="24" cy="13" r="2.7" fill="${lens}" opacity="${op}" stroke="#333" stroke-width="0.8"/><line x1="18.6" y1="13" x2="21.4" y2="13" stroke="#333" stroke-width="0.8"/>`;
    }
  } else {
    g += `<circle cx="16.5" cy="13" r="1" fill="#333"/><circle cx="23.5" cy="13" r="1" fill="#333"/>`; // eyes
  }
  // ── hat ──
  const ht = ch.hat;
  const hatColors = { cap:"#e5484d","backwards cap":"#4ea1ff", beanie:"#38d39f", cowboy:"#8a5a2a", tophat:"#111", fedora:"#5a4632", helmet:"#c0c0c8", crown:"#e8b84b", visor:"#38d39f", bucket:"#7a8b3a", headband:"#e5484d", bandana:"#c0392b", santa:"#e5484d", party:"#a06bff", pirate:"#111", chef:"#f0eee6", hardhat:"#e8b84b", wizard:"#5f27cd", halo:"#ffe08a", mohawk:"#e5484d", afro:"#2a1a0a" };
  const hc = hatColors[ht] || "#e5484d";
  if (ht && ht !== "none") {
    if (ht === "cap") g += `<path d="M11 8 Q20 2 29 8 L29 9 L11 9 Z" fill="${hc}"/><path d="M27 8 Q34 8 34 10 L27 10 Z" fill="${hc}"/>`;
    else if (ht === "backwards cap") g += `<path d="M11 8 Q20 2 29 8 L29 9 L11 9 Z" fill="${hc}"/><path d="M13 8 Q6 8 6 10 L13 10 Z" fill="${hc}"/>`;
    else if (ht === "beanie") g += `<path d="M11 9 Q20 0 29 9 Z" fill="${hc}"/><rect x="11" y="8" width="18" height="2.6" fill="${hc}"/>`;
    else if (ht === "cowboy") g += `<ellipse cx="20" cy="9" rx="15" ry="2.6" fill="${hc}"/><path d="M14 9 Q14 2 26 2 Q26 9 26 9 Z" fill="${hc}"/>`;
    else if (ht === "tophat") g += `<ellipse cx="20" cy="8" rx="12" ry="2" fill="${hc}"/><rect x="14" y="-6" width="12" height="14" fill="${hc}"/><rect x="14" y="4" width="12" height="2" fill="#e5484d"/>`;
    else if (ht === "fedora") g += `<ellipse cx="20" cy="8" rx="13" ry="2.4" fill="${hc}"/><path d="M14 8 Q14 1 26 1 L26 8 Z" fill="${hc}"/><rect x="14" y="6" width="12" height="1.6" fill="#111"/>`;
    else if (ht === "helmet") g += `<path d="M11 10 Q11 1 29 3 Q29 10 29 10 Z" fill="${hc}"/><rect x="11" y="9" width="18" height="2" fill="#888"/>`;
    else if (ht === "crown") g += `<path d="M12 8 L12 2 L16 6 L20 1 L24 6 L28 2 L28 8 Z" fill="${hc}"/><circle cx="20" cy="3" r="1" fill="#e5484d"/>`;
    else if (ht === "visor") g += `<path d="M12 9 Q20 4 28 9 Z" fill="none"/><path d="M11 9 L30 9 Q34 9 33 11 L11 11 Z" fill="${hc}"/><rect x="12" y="7" width="16" height="2.4" rx="1" fill="${hc}"/>`;
    else if (ht === "bucket") g += `<ellipse cx="20" cy="9" rx="12" ry="2.4" fill="${hc}"/><path d="M13 9 Q13 2 27 2 L27 9 Z" fill="${hc}"/>`;
    else if (ht === "headband") g += `<rect x="11" y="7" width="18" height="3" rx="1" fill="${hc}"/>`;
    else if (ht === "bandana") g += `<path d="M11 8 Q20 3 29 8 L29 10 L11 10 Z" fill="${hc}"/><path d="M28 9 L33 12 L29 12 Z" fill="${hc}"/>`;
    else if (ht === "santa") g += `<path d="M11 9 Q20 0 29 9 Z" fill="${hc}"/><circle cx="29" cy="2" r="2.4" fill="#fff"/><rect x="11" y="8" width="18" height="2.6" fill="#fff"/>`;
    else if (ht === "party") g += `<path d="M20 -4 L14 9 L26 9 Z" fill="${hc}"/><circle cx="20" cy="-4" r="1.6" fill="#e8b84b"/>`;
    else if (ht === "pirate") g += `<path d="M10 8 Q20 3 30 8 L30 9 L10 9 Z" fill="${hc}"/><path d="M12 8 Q20 1 28 8 Z" fill="${hc}"/><circle cx="20" cy="5" r="1.6" fill="#fff"/>`;
    else if (ht === "chef") g += `<rect x="14" y="4" width="12" height="5" fill="${hc}"/><ellipse cx="20" cy="3" rx="7" ry="3.4" fill="${hc}"/>`;
    else if (ht === "hardhat") g += `<path d="M11 9 Q11 2 29 3 Q29 9 29 9 Z" fill="${hc}"/><rect x="19" y="2" width="2" height="7" fill="#c98b1f"/>`;
    else if (ht === "wizard") g += `<path d="M20 -8 L12 9 L28 9 Z" fill="${hc}"/><circle cx="17" cy="2" r="1" fill="#e8b84b"/><circle cx="22" cy="5" r="0.9" fill="#e8b84b"/>`;
    else if (ht === "halo") g += `<ellipse cx="20" cy="2" rx="7" ry="2" fill="none" stroke="${hc}" stroke-width="1.6"/>`;
    else if (ht === "mohawk") g += `<path d="M18 6 Q20 -4 22 6 Z" fill="${hc}"/>`;
    else if (ht === "afro") g += `<circle cx="20" cy="7" r="10" fill="${hc}"/><circle cx="20" cy="14" r="8" fill="${skin}"/>`;
    else g += `<path d="M11 8 Q20 2 29 8 Z" fill="${hc}"/>`;
  }
  // ── necklace ──
  const nk = ch.necklace;
  if (nk && nk !== "none") {
    const goldish = /gold|chain|bling|medallion|pendant|locket/.test(nk) ? "#e8b84b" : "#cfd6e6";
    if (nk === "tie") g += `<path d="M20 26 L18 30 L20 38 L22 30 Z" fill="#e5484d"/>`;
    else if (nk === "bowtie") g += `<path d="M17 27 L20 29 L17 31 Z M23 27 L20 29 L23 31 Z" fill="#111"/>`;
    else if (nk === "scarf" || nk === "bandana-neck") g += `<path d="M14 26 Q20 30 26 26 L26 29 Q20 33 14 29 Z" fill="#e5484d"/>`;
    else if (nk === "headphones") g += `<path d="M12 12 Q20 2 28 12" stroke="#111" stroke-width="1.6" fill="none"/><rect x="10.5" y="11" width="3" height="5" rx="1" fill="#111"/><rect x="26.5" y="11" width="3" height="5" rx="1" fill="#111"/>`;
    else if (nk === "cross") g += `<path d="M14 25 Q20 30 26 25" stroke="${goldish}" stroke-width="1" fill="none"/><rect x="19.3" y="29" width="1.4" height="5" fill="${goldish}"/><rect x="18" y="30.5" width="4" height="1.4" fill="${goldish}"/>`;
    else if (nk === "spikes") g += `<path d="M13 26 Q20 31 27 26" stroke="#888" stroke-width="1.4" fill="none" stroke-dasharray="1 1.5"/>`;
    else g += `<path d="M13 26 Q20 32 27 26" stroke="${goldish}" stroke-width="1.6" fill="none"/><circle cx="20" cy="31" r="1.6" fill="${goldish}"/>`;
  }
  return `<svg viewBox="0 0 40 74" style="transform:scale(${scale})${ch.flip?" scaleX(-1)":""}">${g}</svg>`;
}

// ── tachometer (perfect-shift band widens with Sharp Mind) ───────────────────
const TCX = 100, TCY = 105, TR = 78, TA0 = -220, TA1 = 40;
const tRad = (d) => (d * Math.PI) / 180;
const tPt = (a, r) => [TCX + r * Math.cos(tRad(a)), TCY + r * Math.sin(tRad(a))];
const rpmToDeg = (rpm) => TA0 + (Math.min(rpm, REDLINE + 800) / (REDLINE + 800)) * (TA1 - TA0);
function arcPath(a0, b0, r) {
  const [x0, y0] = tPt(rpmToDeg(a0), r), [x1, y1] = tPt(rpmToDeg(b0), r);
  const large = (rpmToDeg(b0) - rpmToDeg(a0)) > 180 ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
function buildTach(sharpMind = 0) {
  const svg = document.getElementById("tachSvg");
  const pw = perfectWindow(sharpMind);
  let arcs = "";
  arcs += `<path d="${arcPath(0, 5600, TR)}" fill="none" stroke="#38d39f" stroke-width="7"/>`;
  arcs += `<path d="${arcPath(5600, SHIFT_RPM, TR)}" fill="none" stroke="#e8b84b" stroke-width="7"/>`;
  arcs += `<path d="${arcPath(SHIFT_RPM, REDLINE + 800, TR)}" fill="none" stroke="#e5484d" stroke-width="7"/>`;
  // perfect-shift band (glowing green) — visibly grows with Sharp Mind
  arcs += `<path d="${arcPath(pw.lo, pw.hi, TR)}" fill="none" stroke="#9dffce" stroke-width="11" opacity=".9" stroke-linecap="round"/>`;
  // ideal marker line at center (only visible/precise once Sharp Mind bought)
  if (sharpMind > 0) {
    const [mx, my] = tPt(rpmToDeg(pw.center), TR + 8);
    const [mx2, my2] = tPt(rpmToDeg(pw.center), TR - 14);
    arcs += `<line x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${my2.toFixed(1)}" stroke="#fff" stroke-width="2.5"/>`;
  }
  let ticks = "";
  for (let r = 0; r <= REDLINE + 800; r += 1000) {
    const d = rpmToDeg(r), [x1, y1] = tPt(d, TR - 6), [x2, y2] = tPt(d, TR - 15), [lx, ly] = tPt(d, TR - 27);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#cfcad2" stroke-width="2"/>`;
    ticks += `<text x="${lx.toFixed(1)}" y="${(ly+4).toFixed(1)}" fill="#9a95a0" font-size="10" font-family="monospace" text-anchor="middle">${r/1000}</text>`;
  }
  svg.innerHTML = `${arcs}${ticks}
    <line id="tNeedle" x1="${TCX}" y1="${TCY}" x2="${(TCX+TR-18)}" y2="${TCY}" stroke="#e5484d" stroke-width="3" stroke-linecap="round" transform="rotate(${TA0} ${TCX} ${TCY})"/>
    <circle cx="${TCX}" cy="${TCY}" r="8" fill="#1a1a1e" stroke="#555" stroke-width="2"/>`;
}
function setNeedle(rpm) { const nd = document.getElementById("tNeedle"); if (nd) nd.setAttribute("transform", `rotate(${rpmToDeg(rpm)} ${TCX} ${TCY})`); }

// ── scenery ────────────────────────────────────────────────────────────────
function svgURI(w, h, inner) { return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${inner}</svg>`)}")`; }
function makeCity(w, h, colors, lit) {
  let r = "", x = 0, i = 0;
  while (x < w) {
    const bw = 26 + ((i * 37) % 46), bh = 40 + ((i * 53) % (h - 30)), c = colors[i % colors.length];
    r += `<rect x='${x}' y='${h - bh}' width='${bw}' height='${bh}' fill='${c}'/>`;
    if (lit) for (let wy = h - bh + 8; wy < h - 6; wy += 12) for (let wx = x + 4; wx < x + bw - 5; wx += 10) if ((wx + wy + i) % 3 === 0) r += `<rect x='${wx}' y='${wy}' width='4' height='5' fill='#ffe9a8' opacity='0.8'/>`;
    x += bw + 6; i++;
  }
  return svgURI(w, h, r);
}
function makeTrees(w, h) {
  let r = `<rect x='0' y='${h-14}' width='${w}' height='14' fill='#2f5230'/>`, x = 0, i = 0;
  while (x < w) {
    const k = i % 3;
    if (k === 0) r += `<rect x='${x+14}' y='${h-30}' width='6' height='22' fill='#5a3a22'/><circle cx='${x+17}' cy='${h-38}' r='20' fill='#356b32'/><circle cx='${x+28}' cy='${h-32}' r='14' fill='#3f7a3a'/>`;
    else if (k === 1) r += `<rect x='${x+16}' y='${h-26}' width='5' height='18' fill='#5a3a22'/><polygon points='${x+18},${h-58} ${x+2},${h-24} ${x+34},${h-24}' fill='#2f5e33'/>`;
    else r += `<circle cx='${x+16}' cy='${h-16}' r='12' fill='#3a6b38'/><rect x='${x+30}' y='${h-52}' width='3' height='44' fill='#555'/><circle cx='${x+31}' cy='${h-52}' r='4' fill='#ffe08a'/>`;
    x += 46 + (i % 3) * 8; i++;
  }
  return svgURI(w, h, r);
}
function makeRoadLines(w, h) {
  let r = `<rect x='0' y='6' width='${w}' height='4' fill='#e8d8a0' opacity='0.7'/><rect x='0' y='${h-10}' width='${w}' height='5' fill='#e8d8a0' opacity='0.7'/>`;
  for (const [yy, dash, op] of [[h*0.30,40,0.5],[h*0.52,60,0.7],[h*0.78,90,0.95]]) for (let x = 0; x < w; x += dash * 2) r += `<rect x='${x}' y='${yy}' width='${dash}' height='${3+op*3}' fill='#ffffff' opacity='${op}'/>`;
  return svgURI(w, h, r);
}
const SCENE = { farW: 900, midW: 700, treeW: 640, lineW: 400 };
function buildScenery() {
  document.getElementById("farCity").style.backgroundImage = makeCity(SCENE.farW, 120, ["#3a4a63","#43526e","#4c5c78"], false);
  document.getElementById("midCity").style.backgroundImage = makeCity(SCENE.midW, 150, ["#2c3a52","#354663","#283349","#3d4f6e"], true);
  document.getElementById("trees").style.backgroundImage = makeTrees(SCENE.treeW, 90);
  document.getElementById("roadLines").style.backgroundImage = makeRoadLines(SCENE.lineW, document.getElementById("road").offsetHeight || 200);
}
const scroll = { far: 0, mid: 0, tree: 0, line: 0, curb: 0 };
function scrollScenery(speed, dt) {
  const v = speed / 3.6;
  scroll.far += v*dt*6; scroll.mid += v*dt*14; scroll.tree += v*dt*40; scroll.line += v*dt*130; scroll.curb += v*dt*130;
  document.getElementById("farCity").style.backgroundPositionX = `-${scroll.far % SCENE.farW}px`;
  document.getElementById("midCity").style.backgroundPositionX = `-${scroll.mid % SCENE.midW}px`;
  document.getElementById("trees").style.backgroundPositionX = `-${scroll.tree % SCENE.treeW}px`;
  document.getElementById("roadLines").style.backgroundPositionX = `-${scroll.line % (SCENE.lineW*2)}px`;
  document.getElementById("curbTop").style.backgroundPositionX = `-${scroll.curb % 52}px`;
}

// ── screens ──────────────────────────────────────────────────────────────────
function show(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === id)); }
function setCash(v) { document.getElementById("cashTag").textContent = "$" + v; const sc = document.getElementById("shopCash"); if (sc) sc.textContent = "$" + v; }

function refreshMenu() {
  const st = carStats(S);
  document.getElementById("mCash").textContent = "$" + S.cash;
  document.getElementById("mWins").textContent = S.stats.wins;
  document.getElementById("mRaces").textContent = S.stats.races;
  document.getElementById("mPerfect").textContent = S.stats.perfectShifts;
  document.getElementById("mTop").textContent = st.topSpeed + " km/h";
  setCash(S.cash);
}

// ═══ CHAPTER MAP ═══
let viewChapter = 0;
function chapterUnlocked(ci) { return ci <= S.progress.chapter; }
function stageUnlocked(ci, si) {
  if (ci < S.progress.chapter) return true;
  if (ci === S.progress.chapter) return si <= S.progress.stage;
  return false;
}
function stageCleared(ci, si) {
  return ci < S.progress.chapter || (ci === S.progress.chapter && si < S.progress.stage);
}
function buildMap() {
  viewChapter = Math.min(viewChapter, S.progress.chapter);
  const tabs = document.getElementById("chapTabs");
  tabs.innerHTML = "";
  CHAPTERS.forEach((c, ci) => {
    const t = document.createElement("div");
    const unlocked = chapterUnlocked(ci);
    t.className = "chapTab" + (ci === viewChapter ? " on" : "") + (unlocked ? "" : " locked");
    t.innerHTML = `Ch.${ci + 1} ${unlocked ? c.name : "🔒"}`;
    if (unlocked) t.addEventListener("click", () => { viewChapter = ci; buildMap(); });
    tabs.appendChild(t);
  });
  const c = CHAPTERS[viewChapter];
  document.querySelector("#chapInfo .cn").textContent = `Chapter ${viewChapter + 1}: ${c.name}`;
  document.querySelector("#chapInfo .ci").textContent = c.intro;

  const grid = document.getElementById("stageGrid");
  grid.innerHTML = "";
  for (let si = 0; si < STAGES_PER_CHAPTER; si++) {
    const cell = document.createElement("div");
    const unlocked = stageUnlocked(viewChapter, si), cleared = stageCleared(viewChapter, si);
    const isNext = viewChapter === S.progress.chapter && si === S.progress.stage;
    cell.className = "stageCell" + (unlocked ? "" : " locked") + (cleared ? " cleared" : "") + (isNext ? " next" : "");
    const ch = stageCharacter(viewChapter, si, false);
    const rc = STAGE_CAR_COLORS[(viewChapter * 3 + si) % STAGE_CAR_COLORS.length];
    const rs = STAGE_CAR_SHAPES[(viewChapter + si) % STAGE_CAR_SHAPES.length];
    cell.innerHTML = `<div class="scene">
        <div class="who">${personSVG(ch, 0.9)}</div>
        <div class="ride">${carSVG(rc, si % 2 === 0, rs)}</div>
      </div>
      <div class="sn">${si + 1}</div><div class="sl">RACE</div>${cleared ? '<div class="star">⭐</div>' : ""}`;
    if (unlocked) cell.addEventListener("click", () => startCareerRace(viewChapter, si, false));
    grid.appendChild(cell);
  }
  // boss cell
  const bossUnlocked = stageUnlocked(viewChapter, STAGES_PER_CHAPTER);
  const bossCleared = stageCleared(viewChapter, STAGES_PER_CHAPTER);
  const bossNext = viewChapter === S.progress.chapter && S.progress.stage === STAGES_PER_CHAPTER;
  const boss = document.createElement("div");
  boss.className = "stageCell boss" + (bossUnlocked ? "" : " locked") + (bossCleared ? " cleared" : "") + (bossNext ? " next" : "");
  const bch = stageCharacter(viewChapter, STAGES_PER_CHAPTER, true);
  const bshape = ["muscle","gt","gt","porsche","hyper"][viewChapter] || "gt";
  boss.innerHTML = `<div class="scene">
      <div class="who">${personSVG(bch, 1.0)}</div>
      <div class="ride">${carSVG("#111827", true, bshape)}</div>
    </div>
    <div class="sn">👑 ${c.boss}</div><div class="sl">BOSS</div>${bossCleared ? '<div class="star">⭐</div>' : ""}`;
  if (bossUnlocked) boss.addEventListener("click", () => startCareerRace(viewChapter, STAGES_PER_CHAPTER, true));
  grid.appendChild(boss);
}

// ═══ SHOP ═══
let shopTab = "parts";
function buildShop() {
  setCash(S.cash);
  document.querySelectorAll(".shopTab").forEach((t) => t.classList.toggle("on", t.dataset.tab === shopTab));
  const body = document.getElementById("shopBody");
  body.innerHTML = "";
  if (shopTab === "parts") body.appendChild(buildParts());
  else if (shopTab === "cars") body.appendChild(buildCars());
  else body.appendChild(buildPassives());

  const st = carStats(S), pw = perfectWindow(st.sharpMind);
  document.getElementById("csCar").textContent = CARS[S.activeCar].name;
  document.getElementById("csPower").textContent = Math.round(st.power);
  document.getElementById("csTop").textContent = st.topSpeed + " km/h";
  document.getElementById("csGrip").textContent = st.grip.toFixed(2);
  document.getElementById("csShift").textContent = Math.round(st.shiftMs) + "ms";
  document.getElementById("csPerfect").textContent = "±" + Math.round((pw.hi - pw.lo) / 2) + " rpm";
}
function buildParts() {
  const g = document.createElement("div"); g.className = "grid4";
  for (const key of PART_KEYS) {
    const p = PARTS[key], st = S.parts[key];
    const lvlCost = partLevelCost(S, key), tierCost = partTierCost(S, key);
    const pips = Array.from({ length: p.levelMax }, (_, i) => `<div class="pip ${i < st.level ? "f" : ""}"></div>`).join("");
    const tierName = p.tiers[st.tier];
    let btns = "";
    if (lvlCost != null) btns += `<button class="buy" data-lvl="${key}" ${S.cash < lvlCost ? "disabled" : ""}>LV+ $${lvlCost}</button>`;
    else btns += `<button class="buy max" disabled>LV MAX</button>`;
    if (tierCost != null) btns += `<button class="buy tier" data-tier="${key}" ${S.cash < tierCost ? "disabled" : ""}>${p.tiers[st.tier+1]} $${tierCost}</button>`;
    else btns += `<button class="buy max" disabled>TOP TIER</button>`;
    const card = document.createElement("div"); card.className = "card2";
    card.innerHTML = `<div class="ico">${p.icon}</div>
      <div class="pn">${p.name}</div>
      <div class="tier">${tierName} · Lv ${st.level}/${p.levelMax}</div>
      <div class="pd">${partDesc(key)}</div>
      <div class="pips">${pips}</div>
      <div class="btnrow">${btns}</div>`;
    g.appendChild(card);
  }
  g.querySelectorAll("[data-lvl]").forEach((b) => b.addEventListener("click", () => buyPartLevel(b.dataset.lvl)));
  g.querySelectorAll("[data-tier]").forEach((b) => b.addEventListener("click", () => buyPartTier(b.dataset.tier)));
  return g;
}
function partDesc(key) {
  return { engine:"Raises peak power & torque.", turbo:"Big top-end power once revs climb.",
    wheels:"More grip → less wheelspin.", tires:"Launch traction + grip.",
    spoiler:"Downforce → grip at speed.", aero:"Lowers drag → higher top speed.",
    gearbox:"Snappier shifts, wider power band.", nitrous:"Boost charges. SHIFT to fire." }[key] || "";
}
function buildCars() {
  const g = document.createElement("div"); g.className = "grid3";
  for (const key of CAR_KEYS) {
    const car = CARS[key], owned = S.ownedCars.includes(key), active = S.activeCar === key;
    const cost = carCost(S, key);
    const card = document.createElement("div");
    card.className = "card2" + (owned ? " owned" : "") + (active ? " active" : "");
    card.style.position = "relative";
    let btn = active ? `<button class="buy max" disabled>ACTIVE</button>`
      : owned ? `<button class="buy" data-use="${key}">SELECT</button>`
      : `<button class="buy tier" data-buycar="${key}" ${S.cash < cost ? "disabled" : ""}>BUY $${cost}</button>`;
    card.innerHTML = `${active ? '<div class="badge on">ACTIVE</div>' : (owned ? '<div class="badge" style="background:#2a3a2a;color:#8fd">OWNED</div>' : "")}
      <div class="carart">${carSVG(car.color, key === "porsche" || key === "gt" || key === "hyper", car.shape)}</div>
      <div class="pn">${car.name}</div>
      <div class="tier">PWR ${car.basePower} · GRIP ${car.baseGrip} · DRAG ${car.baseDrag}</div>
      <div class="pd">${car.blurb}</div>
      <div class="btnrow">${btn}</div>`;
    g.appendChild(card);
  }
  g.querySelectorAll("[data-buycar]").forEach((b) => b.addEventListener("click", () => buyCar(b.dataset.buycar)));
  g.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => { S.activeCar = b.dataset.use; persist(); buildShop(); }));
  return g;
}
function buildPassives() {
  const g = document.createElement("div"); g.className = "grid4";
  for (const key of PASSIVE_KEYS) {
    const p = PASSIVES[key], lvl = S.passives[key] || 0, cost = passiveCost(S, key);
    const pips = Array.from({ length: p.max }, (_, i) => `<div class="pip ${i < lvl ? "f" : ""}"></div>`).join("");
    const btn = cost != null ? `<button class="buy" data-pass="${key}" ${S.cash < cost ? "disabled" : ""}>UP $${cost}</button>` : `<button class="buy max" disabled>MAX</button>`;
    const card = document.createElement("div"); card.className = "card2";
    card.innerHTML = `<div class="ico">${p.icon}</div><div class="pn">${p.name}</div>
      <div class="tier">Lv ${lvl}/${p.max}</div><div class="pd">${p.desc}</div>
      <div class="pips">${pips}</div><div class="btnrow">${btn}</div>`;
    g.appendChild(card);
  }
  g.querySelectorAll("[data-pass]").forEach((b) => b.addEventListener("click", () => buyPassive(b.dataset.pass)));
  return g;
}
function buyPartLevel(key) { const c = partLevelCost(S, key); if (c == null || S.cash < c) return; S.cash -= c; S.parts[key].level++; persist(); buildShop(); sfx("upgrade"); }
function buyPartTier(key) { const c = partTierCost(S, key); if (c == null || S.cash < c) return; S.cash -= c; S.parts[key].tier++; S.parts[key].level = 0; persist(); buildShop(); sfx("buycar"); }
function buyCar(key) { const c = carCost(S, key); if (c == null || S.cash < c || S.ownedCars.includes(key)) return; S.cash -= c; S.ownedCars.push(key); S.activeCar = key; persist(); buildShop(); sfx("buycar"); }
function buyPassive(key) { const c = passiveCost(S, key); if (c == null || S.cash < c) return; S.cash -= c; S.passives[key]++; persist(); buildShop(); sfx("upgrade"); if (key === "sharpMind") buildTach(S.passives.sharpMind); }

// ═══════════════════════════════════════════════════════════════════════════
//  RACE ENGINE
// ═══════════════════════════════════════════════════════════════════════════
const R = {
  active: false, loopOn: false, phase: "ready",
  rpm: IDLE, gear: 0, speed: 0, dist: 0, throttle: 0, shifting: 0,
  nitroActive: 0, nitroLeft: 0, boost: 0,
  opp: null, oppDist: 0, oppSpeed: 0, oppRpm: IDLE, oppGear: 0,
  last: 0, stats: null, keys: {},
  ctx: null, // { chapter, stage, isBoss, career }
};
const el = {};
function cacheEls() {
  ["playerCar","oppCar","gearNum","gearBox","rpmNum","speedNum","speedBar","distVal","distanceLabel","oppVal","nitroVal","shiftLite","msgM","msgS","raceTag","perfectPop","finline"].forEach((id) => el[id] = document.getElementById(id));
  el.player = el.playerCar; el.opp = el.oppCar; el.lights = document.querySelectorAll("#lights .l");
}

function startCareerRace(chapter, stage, isBoss) { beginRace({ chapter, stage, isBoss, career: true }); }
function startQuickRace() { const p = S.progress; beginRace({ chapter: p.chapter, stage: p.stage, isBoss: false, career: false }); }

function beginRace(ctx) {
  R.ctx = ctx;
  R.stats = carStats(S);
  R.rpm = IDLE; R.gear = 0; R.speed = 0; R.dist = 0; R.throttle = 0; R.shifting = 0;
  R.nitroActive = 0; R.nitroLeft = R.stats.nitrous; R.boost = 0; R.perfects = 0;
  R.opp = makeRival(R.stats.power, ctx.chapter, ctx.stage, ctx.isBoss, rng, ctx.career);
  // Quick Race = a livelier arcade run scaled to you (close sprints);
  // Career = a FIXED difficulty ladder — out-tune it and you dominate.
  R.quick = !ctx.career;
  R.oppPerfectChance = R.quick ? 0.28 : 0.0;   // random rival perfect-shifts in quick race
  R.oppBoost = 0;
  if (R.quick) { R.opp.power = Math.round(R.opp.power * 1.06); }  // slight edge → faster, punchier
  R.oppDist = 0; R.oppSpeed = 0; R.oppRpm = IDLE; R.oppGear = 0;
  R.phase = "ready"; R.active = true;

  buildTach(R.stats.sharpMind);
  el.player.innerHTML = carSVG(CARS[S.activeCar].color, S.parts.spoiler.tier > 0, CARS[S.activeCar].shape);
  el.opp.innerHTML = carSVG(R.opp.color, true, R.opp.shape || "coupe");
  el.oppVal.textContent = R.opp.name;
  el.nitroVal.textContent = R.nitroLeft;
  const ch = CHAPTERS[ctx.chapter];
  el.raceTag.textContent = ctx.isBoss ? `👑 BOSS · ${ch.name}` : `Ch.${ctx.chapter+1} · Stage ${ctx.stage+1} · ${ch.name}`;
  if (ctx.isBoss) { el.msgM.textContent = R.opp.name; el.msgS.textContent = ch.bossStory; }
  else { el.msgM.textContent = "STAGE"; el.msgS.textContent = "hold X to launch"; }
  el.msgM.style.color = "";
  el.lights.forEach((l) => l.classList.remove("on", "go"));
  el.gearBox.classList.remove("perfect");
  updateHud(); syncKnob(); positionCars(); startEngine();

  show("race");
  if (!R.loopOn) { R.loopOn = true; R.last = performance.now(); requestAnimationFrame(tick); }
}

function positionCars() {
  el.player.style.left = (4 + (R.dist / RACE_DISTANCE) * 82) + "%";
  el.opp.style.left = (4 + (R.oppDist / RACE_DISTANCE) * 82) + "%";
}

let countTimer = null;
function beginCountdown() {
  if (R.phase !== "ready") return;
  R.phase = "count"; el.msgM.textContent = ""; el.msgS.textContent = "";
  let i = 0;
  const seq = () => {
    if (i < 3) { el.lights[i].classList.add("on"); sfx("count"); i++; countTimer = setTimeout(seq, 600); }
    else { el.lights.forEach((l) => { l.classList.remove("on"); l.classList.add("go"); }); R.phase = "run"; R.last = performance.now(); el.msgM.textContent = "GO!"; sfx("go"); musicDuck(true); setTimeout(() => { if (R.phase === "run") el.msgM.textContent = ""; }, 600); }
  };
  seq();
}

function shift(dir) { shiftToGear(R.gear + dir); }
function shiftToGear(ng) {
  if (R.phase !== "run" || R.shifting > 0) return;
  if (ng < 0 || ng >= maxGear() || ng === R.gear) return;
  // perfect-shift check (only when upshifting)
  if (ng > R.gear && isPerfectShift(R.rpm, R.stats.sharpMind)) {
    R.boost = 900; // ms of momentum boost
    S.stats.perfectShifts++;
    R.perfects = (R.perfects || 0) + 1;
    el.perfectPop.textContent = `PERFECT! +$${PERFECT_CREDIT}`;
    el.perfectPop.classList.remove("show"); void el.perfectPop.offsetWidth; el.perfectPop.classList.add("show");
    blip("perfect");
  } else blip("shift");
  R.gear = ng;
  R.shifting = R.stats.shiftMs;
  R.rpm = Math.max(IDLE, rpmFromSpeed(R.speed, R.gear));
  syncKnob();
}
function fireNitro() {
  if (R.phase !== "run" || R.nitroLeft <= 0 || R.nitroActive > 0) return;
  R.nitroLeft--; R.nitroActive = 1600; el.nitroVal.textContent = R.nitroLeft; blip("nitro");
}

function updateHud() {
  const zone = rpmZone(R.rpm);
  el.gearNum.textContent = R.gear + 1;
  el.rpmNum.innerHTML = Math.round(R.rpm) + "<small>RPM</small>";
  el.speedNum.textContent = Math.round(R.speed);
  el.speedBar.style.width = Math.min(100, (R.speed / (R.stats.topSpeed || 300)) * 100) + "%";
  el.distVal.textContent = Math.round(R.dist) + " m";
  el.distanceLabel.textContent = Math.round(R.dist) + " / " + RACE_DISTANCE + " m";
  setNeedle(R.rpm);
  el.gearBox.classList.toggle("warn", zone === "yellow" || zone === "red");
  el.gearBox.classList.toggle("over", zone === "over");
  const inPerfect = isPerfectShift(R.rpm, R.stats.sharpMind) && R.gear < maxGear() - 1;
  el.gearBox.classList.toggle("perfect", inPerfect);
  const needShift = (zone === "red" || zone === "over") && R.gear < maxGear() - 1;
  el.shiftLite.classList.toggle("show", needShift || inPerfect);
  if (inPerfect) { el.shiftLite.textContent = "PERFECT ↑"; el.shiftLite.style.background = "#38d39f"; el.shiftLite.style.color = "#062"; }
  else if (needShift) { el.shiftLite.textContent = "SHIFT ↑"; el.shiftLite.style.background = zone === "over" ? "#e5484d" : "#e8b84b"; el.shiftLite.style.color = "#111"; }
}

function endRace(won) {
  R.phase = "done"; R.active = false; stopEngine(); musicDuck(false);
  S.stats.races++;
  const marginMeters = Math.max(0, R.dist - R.oppDist);
  const e = earnings(R.opp, { won, perfects: R.perfects || 0, marginMeters, isBoss: R.ctx.isBoss }, R.stats.hustler);
  S.cash += e.total;
  if (won) {
    S.stats.wins++; sfx("win");
    if (R.ctx.career) advanceProgress(R.ctx);
  } else sfx("lose");
  persist(); setCash(S.cash);
  el.msgM.textContent = won ? (R.ctx.isBoss ? "👑 BOSS DOWN!" : "🏆 WIN!") : "💀 LOST";
  el.msgM.style.color = won ? "var(--green)" : "var(--red)";
  // earnings breakdown
  const rows = [];
  if (e.purse) rows.push(`purse $${e.purse}`);
  if (e.winBonus) rows.push(`win +$${e.winBonus}`);
  if (e.perfectBonus) rows.push(`${e.perfects}× perfect +$${e.perfectBonus}`);
  if (e.marginBonus) rows.push(`margin +$${e.marginBonus}`);

  // next-stage pop-up: show a NEXT button when a follow-up race exists
  R.nextCtx = won ? nextStageCtx(R.ctx) : null;
  let btns = "";
  if (R.nextCtx) {
    const lbl = R.nextCtx.isBoss ? `⚔ FIGHT ${CHAPTERS[R.nextCtx.chapter].boss}`
      : R.nextCtx.chapter !== R.ctx.chapter ? `▶ CHAPTER ${R.nextCtx.chapter + 1}`
      : `▶ NEXT STAGE ${R.nextCtx.stage + 1}`;
    btns += `<button class="mbtn primary rbtn" id="btnNext">${lbl}</button>`;
  } else if (won && R.ctx.career && R.ctx.isBoss && S.progress.chapter >= CHAPTERS.length - 1) {
    btns += `<div style="color:var(--gold);font-weight:800;margin:6px 0">🏆 CAREER COMPLETE!</div>`;
  }
  btns += `<button class="mbtn rbtn" id="btnRetry">↻ RETRY</button>`;
  if (R.ctx.career) btns += `<button class="mbtn rbtn" id="btnMap">🗺 MAP</button>`;
  btns += `<button class="mbtn rbtn" id="btnMenu">MENU</button>`;

  el.msgS.innerHTML = `<b style="color:var(--green);font-size:18px">+$${e.total}</b>`
    + `<div style="opacity:.65;font-size:10px;margin:4px 0">${rows.join(" · ")}</div>`
    + `${won && R.ctx.career && R.nextCtx ? '<div style="color:var(--clay);font-size:10px">next unlocked</div>' : ""}`
    + `<div class="endbtns">${btns}</div>`
    + `<div style="opacity:.55;font-size:9px;margin-top:5px">N=next · R=retry${R.ctx.career ? " · M=map" : ""} · ESC=menu</div>`;
  // wire the buttons
  const nb = document.getElementById("btnNext"); if (nb) nb.addEventListener("click", () => { sfx("click"); beginRace(R.nextCtx); });
  document.getElementById("btnRetry")?.addEventListener("click", () => { sfx("click"); beginRace(R.ctx); });
  document.getElementById("btnMap")?.addEventListener("click", () => { sfx("click"); exitRace("map"); });
  document.getElementById("btnMenu")?.addEventListener("click", () => { sfx("click"); exitRace("menu"); });
}

// Given a just-finished ctx, return the ctx for the next race (or null).
function nextStageCtx(ctx) {
  if (!ctx.career) return null;
  if (ctx.isBoss) {
    const nc = ctx.chapter + 1;
    if (nc >= CHAPTERS.length) return null;           // finished the game
    if (nc > S.progress.chapter) return null;          // not unlocked (shouldn't happen post-win)
    return { chapter: nc, stage: 0, isBoss: false, career: true };
  }
  if (ctx.stage + 1 < STAGES_PER_CHAPTER)
    return { chapter: ctx.chapter, stage: ctx.stage + 1, isBoss: false, career: true };
  // after last normal stage → the boss
  return { chapter: ctx.chapter, stage: STAGES_PER_CHAPTER, isBoss: true, career: true };
}

function advanceProgress(ctx) {
  // only advance if beating the current frontier
  const atFrontier = ctx.chapter === S.progress.chapter && ctx.stage === S.progress.stage;
  if (!atFrontier) return;
  if (ctx.isBoss) {
    // boss beaten → next chapter
    if (S.progress.chapter < CHAPTERS.length - 1) { S.progress.chapter++; S.progress.stage = 0; }
    else { S.progress.stage = STAGES_PER_CHAPTER + 1; } // game complete marker
  } else if (S.progress.stage < STAGES_PER_CHAPTER) {
    S.progress.stage++; // next stage (STAGES_PER_CHAPTER == boss index)
  }
}

function tick(now) {
  if (!R.loopOn) return;
  const dt = Math.min(0.05, (now - (R.last || now)) / 1000); R.last = now;
  if (R.active && R.phase === "run") {
    R.throttle = R.keys["x"] ? 1 : 0;
    // exhaust crackle on lift-off at high revs (ดุดัน backfire)
    if (R._prevThrottle && !R.throttle && R.rpm > 5000) exhaustPop();
    // sputter when bouncing off the limiter
    if (R.rpm > REDLINE && (R._popT = (R._popT || 0) + dt) > 0.12) { R._popT = 0; exhaustPop(); }
    R._prevThrottle = R.throttle;
    if (R.shifting > 0) R.shifting -= dt * 1000;
    if (R.boost > 0) R.boost -= dt * 1000;
    const canDrive = R.shifting <= 0;
    const nitroMul = R.nitroActive > 0 ? R.stats.nitroPower : 1;
    const boostMul = R.boost > 0 ? 1.25 : 1;
    if (R.nitroActive > 0) R.nitroActive -= dt * 1000;

    const speedRpm = Math.max(IDLE, rpmFromSpeed(R.speed, R.gear));
    if (!canDrive) R.rpm += (speedRpm - R.rpm) * Math.min(1, dt * 8);
    else if (R.throttle > 0) {
      const target = speedRpm + 1500;
      R.rpm += (Math.min(target, REDLINE + 700) - R.rpm) * Math.min(1, dt * 5) + 3400 * R.stats.revRateMul * dt;
      R.rpm = Math.min(R.rpm, REDLINE + 700);
    } else R.rpm += (speedRpm - R.rpm) * Math.min(1, dt * 4);
    R.rpm = Math.max(IDLE, R.rpm);

    const launchTrac = Math.min(1, R.stats.launchGrip + R.speed / 45);
    let a = accel(R.rpm, R.gear, R.stats, canDrive ? R.throttle : 0, launchTrac) * nitroMul * boostMul;
    if (R.rpm > REDLINE) a *= 0.35;
    R.speed += a * dt;
    R.speed -= (R.stats.drag * 0.9 + R.stats.drag * R.speed * R.speed * 0.00013) * dt * 6;
    R.speed = Math.max(0, R.speed);
    R.dist += (R.speed / 3.6) * dt;

    aiStep(dt);
    engineTo(R.rpm, R.throttle);
    scrollScenery(R.speed, dt); positionCars(); updateHud();

    if (R.dist >= RACE_DISTANCE || R.oppDist >= RACE_DISTANCE) endRace(R.dist >= R.oppDist);
  }
  requestAnimationFrame(tick);
}

function aiStep(dt) {
  const o = R.opp;
  const oStats = { power: o.power, grip: 0.75, drag: 0.26, bandBoost: 0.15 };
  const shiftAt = SHIFT_RPM * (0.94 + o.skill * 0.06);
  if (R.oppRpm >= shiftAt && R.oppGear < maxGear() - 1) {
    R.oppGear++;
    // random rival "perfect shift" burst (quick race only) — a shot of momentum
    if (R.oppPerfectChance && Math.random() < R.oppPerfectChance) R.oppBoost = 800;
    R.oppRpm = Math.max(IDLE, rpmFromSpeed(R.oppSpeed, R.oppGear));
  }
  if (R.oppBoost > 0) R.oppBoost -= dt * 1000;
  const oBoostMul = R.oppBoost > 0 ? 1.22 : 1;
  const speedRpm = Math.max(IDLE, rpmFromSpeed(R.oppSpeed, R.oppGear));
  R.oppRpm += (Math.min(speedRpm + 1500, REDLINE + 500) - R.oppRpm) * Math.min(1, dt * 5) + 3200 * dt;
  R.oppRpm = Math.max(IDLE, Math.min(R.oppRpm, REDLINE + 500));
  let a = accel(R.oppRpm, R.oppGear, oStats, o.skill, 0.92) * oBoostMul;
  if (R.oppRpm > REDLINE) a *= 0.4;
  R.oppSpeed += a * dt;
  R.oppSpeed -= (oStats.drag * 0.9 + oStats.drag * R.oppSpeed * R.oppSpeed * 0.00013) * dt * 6;
  R.oppSpeed = Math.max(0, R.oppSpeed);
  R.oppDist += (R.oppSpeed / 3.6) * dt;
}

// ── draggable sequential shifter ─────────────────────────────────────────────
const GEAR_N = maxGear();
let sKnob, sGate, sLabels;
function gearYPct(i) { const top = 14, bot = 86; return bot - (i / (GEAR_N - 1)) * (bot - top); }
function buildShifterGate() {
  sKnob = document.getElementById("sKnob"); sGate = document.getElementById("sGate"); sLabels = document.getElementById("sLabels");
  let html = ""; for (let i = 0; i < GEAR_N; i++) html += `<div class="g" id="sg${i}" style="top:${gearYPct(i)}%">${i + 1}</div>`;
  sLabels.innerHTML = html; syncKnob();
  sKnob.addEventListener("pointerdown", (e) => { e.preventDefault(); sDrag = { moved: false }; sKnob.classList.add("drag"); try { sKnob.setPointerCapture(e.pointerId); } catch {} });
  sKnob.addEventListener("pointermove", (e) => {
    if (!sDrag) return;
    const r = sGate.getBoundingClientRect(); let pct = ((e.clientY - r.top) / r.height) * 100; pct = Math.max(10, Math.min(90, pct));
    sKnob.style.transition = "none"; sKnob.style.top = pct + "%"; sDrag.moved = true;
    const ng = nearestGearFromY(pct); sKnob.querySelector("b").textContent = ng + 1;
    for (let i = 0; i < GEAR_N; i++) document.getElementById("sg" + i)?.classList.toggle("on", i === ng);
  });
  sKnob.addEventListener("pointerup", endShiftDrag); sKnob.addEventListener("pointercancel", endShiftDrag);
}
function syncKnob() { if (!sKnob) return; sKnob.style.transition = ""; sKnob.style.top = gearYPct(R.gear) + "%"; sKnob.querySelector("b").textContent = R.gear + 1; for (let i = 0; i < GEAR_N; i++) document.getElementById("sg" + i)?.classList.toggle("on", i === R.gear); }
function nearestGearFromY(pct) { let best = 0, bd = Infinity; for (let i = 0; i < GEAR_N; i++) { const d = Math.abs(gearYPct(i) - pct); if (d < bd) { bd = d; best = i; } } return best; }
let sDrag = null;
function endShiftDrag() { if (!sDrag) return; sKnob.classList.remove("drag"); const pct = parseFloat(sKnob.style.top); const ng = nearestGearFromY(pct); const moved = sDrag.moved; sDrag = null; if (moved && ng !== R.gear && R.phase === "run") shiftToGear(ng); else syncKnob(); }

// ── input ──────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase(); R.keys[k] = true;
  if (!document.getElementById("race").classList.contains("on")) return;
  if (R.phase === "ready" && k === "x") beginCountdown();
  else if (R.phase === "run") {
    if (k === "d" || k === "arrowright") shift(+1);
    else if (k === "a" || k === "arrowleft") shift(-1);
    else if (k === "shift") fireNitro();
    else if (k === "r") beginRace(R.ctx);
    else if (k === "escape") exitRace("menu");
  } else if (R.phase === "done") {
    if (k === "n" && R.nextCtx) beginRace(R.nextCtx);
    else if (k === "r") beginRace(R.ctx);
    else if (k === "m" && R.ctx.career) exitRace("map");
    else if (k === "escape") exitRace("menu");
  } else if (k === "escape") exitRace("menu");
});
window.addEventListener("keyup", (e) => { R.keys[e.key.toLowerCase()] = false; });

function exitRace(to) {
  R.active = false; R.loopOn = false; stopEngine(); musicDuck(false);
  if (to === "map") { buildMap(); show("map"); }
  else { refreshMenu(); show("menu"); }
}

// ── nav ──────────────────────────────────────────────────────────────────────
function navClick(fn) { return () => { sfx("click"); fn(); }; }
function wire() {
  document.getElementById("btnCareer").addEventListener("click", navClick(() => { buildMap(); show("map"); }));
  document.getElementById("btnQuick").addEventListener("click", navClick(startQuickRace));
  document.getElementById("btnShop").addEventListener("click", navClick(() => { buildShop(); show("shop"); }));
  document.getElementById("mapBack").addEventListener("click", navClick(() => { refreshMenu(); show("menu"); }));
  document.getElementById("mapShop").addEventListener("click", navClick(() => { buildShop(); show("shop"); }));
  document.getElementById("shopBack").addEventListener("click", navClick(() => { refreshMenu(); show("menu"); }));
  document.getElementById("shopRace").addEventListener("click", navClick(startQuickRace));
  document.querySelectorAll(".shopTab").forEach((t) => t.addEventListener("click", () => { sfx("click"); shopTab = t.dataset.tab; buildShop(); }));
  document.getElementById("min").addEventListener("click", () => window.racer && window.racer.minimize());
  document.getElementById("close").addEventListener("click", () => window.racer && window.racer.close());
  // +1000 cash button
  document.getElementById("add1k")?.addEventListener("click", () => {
    S.cash += 1000; persist(); setCash(S.cash); sfx("upgrade");
    refreshMenu();
    if (document.getElementById("shop").classList.contains("on")) buildShop();
  });
  // fullscreen
  const fsBtn = document.getElementById("fs");
  if (fsBtn) fsBtn.addEventListener("click", async () => { if (window.racer && window.racer.toggleFullscreen) await window.racer.toggleFullscreen(); });
  if (window.racer && window.racer.onFullscreen) window.racer.onFullscreen((v) => { if (fsBtn) fsBtn.textContent = v ? "🗗" : "⛶"; });
  // F11 = fullscreen, M = mute
  window.addEventListener("keydown", (e) => {
    if (e.key === "F11") { e.preventDefault(); window.racer && window.racer.toggleFullscreen && window.racer.toggleFullscreen(); }
    else if (e.key.toLowerCase() === "m" && !document.getElementById("race").classList.contains("on")) {
      setSound(!soundOn); const sb = document.getElementById("sound"); if (sb) sb.textContent = soundOn ? "🔊" : "🔇";
    }
  });
  // sound toggle button
  const sBtn = document.getElementById("sound");
  if (sBtn) sBtn.addEventListener("click", () => { setSound(!soundOn); sBtn.textContent = soundOn ? "🔊" : "🔇"; if (soundOn) startMusic(); });
  // first user gesture → unlock audio + start music
  const unlock = () => { audio(); if (soundOn) startMusic(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock);
}

// ── boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  cacheEls();
  await loadGame();
  buildTach(S.passives.sharpMind);
  buildScenery();
  buildShifterGate();
  wire();
  refreshMenu();
  show("menu");
})();

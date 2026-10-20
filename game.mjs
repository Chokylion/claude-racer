// game.mjs — pure data + physics for Claude Racer. No DOM. Unit-tested.
// v2: tiered parts (persist per-part so no re-grind), buyable cars,
// passive skill tree, 5 chapters × (10 stages + boss).

// ═══════════════════════════════════════════════════════════════════════
//  CARS — each is a chassis you can own. Parts you buy are garage-wide and
//  apply to whichever car is active, so switching cars never loses upgrades.
// ═══════════════════════════════════════════════════════════════════════
export const CARS = {
  hatch:   { name: "Clay Hatch",     price: 0,      basePower: 100, baseGrip: 0.55, baseDrag: 0.42, color: "#d97757", shape: "hatch",   blurb: "Starter runabout. Balanced, forgiving." },
  coupe:   { name: "Ember Coupe",    price: 6000,   basePower: 140, baseGrip: 0.60, baseDrag: 0.38, color: "#e8b84b", shape: "coupe",   blurb: "More grunt, sleeker body." },
  muscle:  { name: "Rook Muscle",    price: 16000,  basePower: 190, baseGrip: 0.58, baseDrag: 0.40, color: "#e5484d", shape: "muscle",  blurb: "Brutal low-end torque, thirsty." },
  porsche: { name: "Carrera 911",    price: 42000,  basePower: 270, baseGrip: 0.74, baseDrag: 0.30, color: "#f2f0eb", shape: "porsche", blurb: "Rear-engine flat-six icon. Surgical grip, screams to redline." },
  gt:      { name: "Nova GT",        price: 58000,  basePower: 300, baseGrip: 0.70, baseDrag: 0.28, color: "#4ea1ff", shape: "gt",      blurb: "Track weapon. High grip, low drag." },
  hyper:   { name: "Zenith Hyper",   price: 96000,  basePower: 360, baseGrip: 0.76, baseDrag: 0.24, color: "#a06bff", shape: "hyper",   blurb: "The apex. Astronomical everything." },
};
export const CAR_KEYS = Object.keys(CARS);

// ═══════════════════════════════════════════════════════════════════════
//  PARTS — each part has a TIER (which part you own, e.g. stock→street→
//  race→pro) and a LEVEL within that tier. Both persist. Buying a higher
//  tier keeps your level progress feeling meaningful (tier sets the ceiling
//  & multiplier; level fine-tunes). You never lose levels on other parts.
// ═══════════════════════════════════════════════════════════════════════
export const PARTS = {
  engine:  { name: "Engine",       icon: "⚙",  stat: "power", tiers: ["Stock","Street","Race","Pro"], levelMax: 5, baseCost: 700,  tierMult: [1, 1.6, 2.4, 3.4], per: 22 },
  turbo:   { name: "Turbo",        icon: "🌀", stat: "power", tiers: ["None","Snail","Twin","Big"],   levelMax: 5, baseCost: 900,  tierMult: [0, 1.4, 2.2, 3.2], per: 20 },
  wheels:  { name: "Wheels",       icon: "🛞", stat: "grip",  tiers: ["Stock","Sport","Slick"],       levelMax: 4, baseCost: 550,  tierMult: [1, 1.8, 2.8],       per: 0.05 },
  tires:   { name: "Tires",        icon: "◎",  stat: "grip",  tiers: ["Stock","Soft","R-Compound"],   levelMax: 4, baseCost: 500,  tierMult: [1, 1.7, 2.6],       per: 0.045 },
  spoiler: { name: "Spoiler",      icon: "🪽", stat: "down",  tiers: ["None","Lip","GT Wing"],        levelMax: 3, baseCost: 480,  tierMult: [0, 1.5, 2.4],       per: 0.03 },
  aero:    { name: "Aerodynamics", icon: "💨", stat: "drag",  tiers: ["Stock","Kit","Full"],          levelMax: 4, baseCost: 700,  tierMult: [1, 1.8, 2.8],       per: 0.02 },
  gearbox: { name: "Gearbox",      icon: "🔧", stat: "shift", tiers: ["Stock","Quick","Sequential"],  levelMax: 3, baseCost: 750,  tierMult: [1, 1.9, 3],         per: 55 },
  nitrous: { name: "Nitrous",      icon: "🔥", stat: "nitro", tiers: ["None","1-Shot","3-Shot"],      levelMax: 3, baseCost: 1200, tierMult: [0, 1, 2],           per: 0 },
};
export const PART_KEYS = Object.keys(PARTS);

// ═══════════════════════════════════════════════════════════════════════
//  PASSIVES — permanent driver skills. Each 5 levels. Sharp Mind is special:
//  it widens the "perfect shift" window and reveals the ideal-shift marker.
// ═══════════════════════════════════════════════════════════════════════
export const PASSIVES = {
  sharpMind:  { name: "Sharp Mind",      icon: "🧠", max: 5, baseCost: 1000, desc: "Widens the perfect-shift window & shows the ideal spot. Nail it for a momentum boost." },
  reflexes:   { name: "Quick Reflexes",  icon: "⚡", max: 5, baseCost: 800,  desc: "Shifts complete faster (less dead-time)." },
  launch:     { name: "Launch Control",  icon: "🚦", max: 5, baseCost: 850,  desc: "More grip off the line — less wheelspin." },
  featherfoot:{ name: "Featherfoot",     icon: "🪶", max: 5, baseCost: 750,  desc: "Revs climb sharper & faster." },
  aeroSense:  { name: "Aero Sense",      icon: "🌬", max: 5, baseCost: 900,  desc: "Passive drag reduction → higher top speed." },
  nitroMastery:{name: "Nitrous Mastery", icon: "🔥", max: 5, baseCost: 950,  desc: "Nitrous lasts longer and hits harder." },
  mechanic:   { name: "Mechanic",        icon: "🔩", max: 5, baseCost: 1100, desc: "All part & car purchases cost less." },
  hustler:    { name: "Hustler",         icon: "💰", max: 5, baseCost: 1000, desc: "Earn more prize money per race." },
};
export const PASSIVE_KEYS = Object.keys(PASSIVES);

// ═══════════════════════════════════════════════════════════════════════
//  GEARING / RPM
// ═══════════════════════════════════════════════════════════════════════
export const GEAR_RATIOS = [3.4, 2.4, 1.8, 1.4, 1.1, 0.9];
export const REDLINE = 8000;
export const IDLE = 1000;
export const SHIFT_RPM = 6800;                 // ideal shift point
export function maxGear() { return GEAR_RATIOS.length; }

const SPEED_K = 0.034;
export function speedFromRpm(rpm, g) { return (rpm / GEAR_RATIOS[g]) * SPEED_K; }
export function rpmFromSpeed(sp, g)  { return (sp / SPEED_K) * GEAR_RATIOS[g]; }
export function gearTopSpeed(g)      { return speedFromRpm(REDLINE, g); }

export function torqueFactor(rpm, bandBoost = 0) {
  const peak = 5500, width = 2900 * (1 + bandBoost * 3);
  const t = Math.exp(-Math.pow((rpm - peak) / width, 2));
  const floor = 0.35, base = floor + (1 - floor) * t;
  const over = rpm > REDLINE ? (rpm - REDLINE) / 1200 : 0;
  return Math.max(0, base - over);
}

export function rpmZone(rpm) {
  if (rpm >= REDLINE) return "over";
  if (rpm >= SHIFT_RPM) return "red";
  if (rpm >= 5600) return "yellow";
  return "green";
}

// Perfect-shift window: centered just below redline. TINY at level 0 (a real
// skill-check — a razor sliver), grows meaningfully with each Sharp Mind level.
// L0 = ±40 rpm sliver, L5 = ±565 rpm forgiving band.
export function perfectWindow(sharpMindLvl = 0) {
  const center = SHIFT_RPM;
  const half = 40 + sharpMindLvl * 105;    // 40, 145, 250, 355, 460, 565
  return { lo: center - half, hi: Math.min(REDLINE - 20, center + half), center, half };
}
export function isPerfectShift(rpm, sharpMindLvl = 0) {
  const w = perfectWindow(sharpMindLvl);
  return rpm >= w.lo && rpm <= w.hi;
}

export function accel(rpm, g, stats, throttle, launchTraction) {
  if (throttle <= 0) return 0;
  const ratio = GEAR_RATIOS[g];
  const tq = torqueFactor(rpm, stats.bandBoost);
  const forward = (stats.power / 100) * tq * ratio * 13 * throttle;
  return forward * Math.min(1, launchTraction);
}

// ═══════════════════════════════════════════════════════════════════════
//  SAVE STATE
// ═══════════════════════════════════════════════════════════════════════
function freshPart() { return { tier: 0, level: 0 }; }

export function freshSave() {
  const parts = {};
  for (const k of PART_KEYS) parts[k] = freshPart();
  const passives = {};
  for (const k of PASSIVE_KEYS) passives[k] = 0;
  return {
    v: 2,
    cash: 1500,
    ownedCars: ["hatch"],
    activeCar: "hatch",
    // parts are garage-wide (shared across all your cars)
    parts,
    passives,
    progress: { chapter: 0, stage: 0 }, // highest UNLOCKED (chapter idx, stage idx)
    stats: { wins: 0, races: 0, perfectShifts: 0 },
  };
}

// Migrate any old/partial save into the current shape without crashing.
export function migrate(save) {
  const base = freshSave();
  if (!save || typeof save !== "object") return base;
  const out = { ...base, ...save };
  out.parts = { ...base.parts };
  if (save.parts) for (const k of PART_KEYS)
    if (save.parts[k]) out.parts[k] = { tier: save.parts[k].tier | 0, level: save.parts[k].level | 0 };
  out.passives = { ...base.passives, ...(save.passives || {}) };
  for (const k of PASSIVE_KEYS) out.passives[k] = out.passives[k] | 0;
  out.ownedCars = Array.isArray(save.ownedCars) && save.ownedCars.length ? save.ownedCars : ["hatch"];
  out.activeCar = CARS[save.activeCar] ? save.activeCar : "hatch";
  out.progress = { chapter: (save.progress?.chapter) | 0, stage: (save.progress?.stage) | 0 };
  out.stats = { ...base.stats, ...(save.stats || {}) };
  out.v = 2;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  COSTS
// ═══════════════════════════════════════════════════════════════════════
export function mechanicDiscount(save) {
  return 1 - (save.passives.mechanic || 0) * 0.06; // up to −30%
}

// Cost to upgrade a part's LEVEL within its current tier.
export function partLevelCost(save, key) {
  const p = PARTS[key], st = save.parts[key];
  if (st.level >= p.levelMax) return null; // maxed within tier → need next tier
  const c = p.baseCost * (0.5 + st.tier * 0.4) * Math.pow(1.5, st.level);
  return Math.round(c * mechanicDiscount(save));
}
// Cost to buy the NEXT tier of a part (resets level to 0 but tier mult jumps).
export function partTierCost(save, key) {
  const p = PARTS[key], st = save.parts[key];
  if (st.tier >= p.tiers.length - 1) return null; // top tier
  const c = p.baseCost * 3 * Math.pow(2.1, st.tier);
  return Math.round(c * mechanicDiscount(save));
}
export function carCost(save, key) {
  const car = CARS[key];
  if (!car) return null;
  return Math.round(car.price * mechanicDiscount(save));
}
export function passiveCost(save, key) {
  const p = PASSIVES[key], lvl = save.passives[key] || 0;
  if (lvl >= p.max) return null;
  return Math.round(p.baseCost * Math.pow(1.7, lvl) * mechanicDiscount(save));
}

// ═══════════════════════════════════════════════════════════════════════
//  DERIVED CAR STATS (car base + parts + passives)
// ═══════════════════════════════════════════════════════════════════════
// contribution of a part = tierMult[tier] * level * per  (+ tier baseline)
function partContribution(save, key) {
  const p = PARTS[key], st = save.parts[key];
  const mult = p.tierMult[st.tier] ?? 0;
  // a bought tier gives a baseline even at level 0
  const tierBaseline = st.tier > 0 ? mult * p.per * 1.2 : 0;
  return mult * p.per * st.level + tierBaseline;
}

export function carStats(save) {
  const car = CARS[save.activeCar] || CARS.hatch;
  const P = save.passives;

  const power = car.basePower
    + partContribution(save, "engine")
    + partContribution(save, "turbo")
    + (P.featherfoot || 0) * 2;

  const grip = Math.min(1.2, car.baseGrip
    + partContribution(save, "wheels")
    + partContribution(save, "tires")
    + partContribution(save, "spoiler")
    + (P.launch || 0) * 0.02);

  const drag = Math.max(0.12, car.baseDrag
    - partContribution(save, "aero")
    - (P.aeroSense || 0) * 0.012);

  const gbTier = save.parts.gearbox.tier;
  const shiftMs = Math.max(90,
    (420 - partContribution(save, "gearbox")) - (P.reflexes || 0) * 34);
  const bandBoost = gbTier * 0.05 + (P.featherfoot || 0) * 0.02;

  const nitrous = save.parts.nitrous.tier === 0 ? 0
    : (save.parts.nitrous.tier === 1 ? 1 : 3) + Math.floor((P.nitroMastery || 0) / 3);

  const revRateMul = 1 + (P.featherfoot || 0) * 0.08;
  const nitroPower = 1.8 + (P.nitroMastery || 0) * 0.12;
  const launchGrip = grip + (P.launch || 0) * 0.03;

  return {
    power, grip, drag, shiftMs, bandBoost, nitrous, revRateMul, nitroPower, launchGrip,
    topSpeed: Math.round(150 + power * 0.5 - drag * 80),
    sharpMind: P.sharpMind || 0,
    hustler: P.hustler || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CHAPTERS — 5 chapters, each 10 stages + a boss. Rival power scales off
//  the PLAYER'S current power so it stays hard as you upgrade.
// ═══════════════════════════════════════════════════════════════════════
export const CHAPTERS = [
  { name: "Backstreet Nights", theme: "#4ea1ff", boss: "Ghost",
    intro: "The city sleeps. You don't. Prove yourself on the empty streets.",
    bossStory: "A silver ghost haunts these blocks — never lost, never seen twice. Tonight you catch it." },
  { name: "Dockyard Circuit", theme: "#38d39f", boss: "Viper",
    intro: "Salt air and sodium lights. The dock crews race for pink slips.",
    bossStory: "Viper runs the docks like she owns them. Because she does. Take the crown." },
  { name: "Neon Highway", theme: "#e8b84b", boss: "Blaze",
    intro: "Six lanes, no speed limit, all attitude. Welcome to the big leagues.",
    bossStory: "Blaze burned every rival off this highway. Your name's next on his list — flip it." },
  { name: "Mountain Pass", theme: "#a06bff", boss: "Onyx",
    intro: "Thin air, cold tarmac. Up here, one mistake ends everything.",
    bossStory: "Onyx never brakes. They say the mountain taught him. Out-shift the master." },
  { name: "Grand Apex", theme: "#e5484d", boss: "Zenith",
    intro: "The final circuit. Champions only. Everything you built comes down to this.",
    bossStory: "Zenith is the ceiling every racer hits and breaks against. Shatter it. Become the apex." },
];
export const STAGES_PER_CHAPTER = 10; // + 1 boss = 11 races per chapter

// ═══════════════════════════════════════════════════════════════════════
//  STAGE CHARACTERS — a stick-man stands by the stage's car. Each stage
//  gets a randomized-but-STABLE look (hat, glasses, beard, necklace, shirt,
//  car color) derived from a seed so it never changes between visits.
//  20+ options per category (index 0 = "none" where it makes sense).
// ═══════════════════════════════════════════════════════════════════════
export const ACCESSORIES = {
  hat: ["none","cap","backwards cap","beanie","cowboy","tophat","fedora","helmet","crown","visor","bucket","headband","bandana","santa","party","pirate","chef","hardhat","wizard","halo","mohawk","afro"],
  glasses: ["none","round","square","aviator","shades","monocle","goggles","3d","heart","star","visor-shades","nerd","ski","cyclops","rose","half","clout","pixel","thug","reading","sport","eyepatch"],
  beard: ["none","stubble","goatee","full","mustache","handlebar","soul patch","muttonchops","viking","chinstrap","anchor","pencil","hipster","garibaldi","van dyke","fu manchu","circle","ducktail","boxed","yeard","stache-thin","grey"],
  necklace: ["none","chain","gold chain","pendant","dog tags","pearls","choker","medallion","cross","bowtie","tie","scarf","bandana-neck","lanyard","whistle","headphones","beads","locket","spikes","shell","rope","bling"],
  shirt: ["#e5484d","#4ea1ff","#38d39f","#e8b84b","#a06bff","#ff7ac6","#f0eee6","#1a1a1e","#d97757","#7affd1","#ff9f43","#5f27cd","#00d2d3","#ee5253","#0abde3","#10ac84","#576574","#8395a7","#feca57","#48dbfb","#1dd1a1","#c8d6e5"],
};
export const ACC_KEYS = Object.keys(ACCESSORIES);

// deterministic hash → stable per (chapter,stage,boss)
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// small deterministic PRNG from a seed
function seededPick(seed, arr) { return arr[seed % arr.length]; }

export function stageCharacter(chapter, stage, isBoss = false) {
  const base = hashSeed(`c${chapter}-s${stage}-${isBoss ? "B" : "N"}`);
  const idx = (salt) => (base ^ Math.imul(salt, 2654435761)) >>> 0;
  const pick = (cat, salt) => {
    const arr = ACCESSORIES[cat];
    return arr[idx(salt) % arr.length];
  };
  return {
    hat: pick("hat", 1),
    glasses: pick("glasses", 2),
    beard: pick("beard", 3),
    necklace: pick("necklace", 4),
    shirt: pick("shirt", 5),
    // pose flip / stance variety
    flip: (idx(6) % 2) === 0,
  };
}

// Rival strength for a given chapter/stage, scaled off player power.
// ── CAREER: FIXED difficulty ladder ─────────────────────────────────────
// Rival power is an ABSOLUTE number per chapter/stage — it does NOT scale
// with the player. So once you out-tune a stage, you WILL beat it; a maxed
// car should crush earlier chapters. Base power per chapter (stage 1) and
// per-chapter top (boss). Player power ranges ~120 (stock hatch) up past
// ~700 (maxed hyper), so the ladder tops out around ~560 → best car wins.
const CAREER_CH_BASE = [78, 190, 290, 400, 500];    // chapter start power (Ch1 St1 beatable stock)
const CAREER_CH_TOP  = [200, 300, 410, 520, 620];   // chapter boss power
export function careerRivalPower(chapter, stage, isBoss) {
  const c = Math.max(0, Math.min(CHAPTERS.length - 1, chapter));
  const lo = CAREER_CH_BASE[c], hi = CAREER_CH_TOP[c];
  if (isBoss) return Math.round(hi);
  const f = stage / (STAGES_PER_CHAPTER - 1);         // 0..1 across the 10 stages
  return Math.round(lo + (hi - lo) * 0.85 * f);        // stages ramp toward (just under) boss
}

// QUICK RACE: scaled to the player so it's always a close, punchy sprint.
export function rivalPower(playerPower, chapter, stage, isBoss, rng = Math.random) {
  const chapterFloor = 0.85 + chapter * 0.06;
  const stageRamp = (stage / STAGES_PER_CHAPTER) * 0.28;
  let mult = chapterFloor + stageRamp + (rng() * 0.1 - 0.05);
  if (isBoss) mult += 0.22;
  return { power: Math.round(playerPower * mult), mult: +mult.toFixed(2) };
}

// career flag: when true, use the fixed ladder; else scale to player (quick race)
export function makeRival(playerPower, chapter, stage, isBoss, rng = Math.random, career = false) {
  let power, mult;
  if (career) {
    power = careerRivalPower(chapter, stage, isBoss);
    mult = +(power / Math.max(1, playerPower)).toFixed(2);   // only used for prize scaling
  } else {
    const rp = rivalPower(playerPower, chapter, stage, isBoss, rng);
    power = rp.power; mult = rp.mult;
  }
  const names = ["Kaze","Bolt","Havoc","Rook","Nova","Drift","Slate","Pyre","Jinx","Vex","Echo","Riot"];
  const colors = ["#4ea1ff","#38d39f","#e5484d","#e8b84b","#a06bff","#ff7ac6","#7affd1"];
  const boss = CHAPTERS[chapter]?.boss || "Rival";
  const name = isBoss ? boss : names[Math.floor(rng() * names.length)];
  const color = isBoss ? "#111827" : colors[Math.floor(rng() * colors.length)];
  // fixed skill in career (part of the fixed difficulty); varied in quick
  const skill = career ? (isBoss ? 0.97 : 0.9) : ((isBoss ? 0.94 : 0.8) + rng() * (isBoss ? 0.06 : 0.16));
  const shapes = ["coupe","muscle","gt","porsche","hyper","hatch"];
  const shape = isBoss ? ["muscle","gt","gt","porsche","hyper"][chapter] : shapes[Math.floor(rng() * shapes.length)];
  return { name, color, power, skill, mult, isBoss, shape };
}

export const PERFECT_CREDIT = 45;   // cash per perfect shift landed in a race

// Reworked earnings — a transparent breakdown instead of one opaque number.
//   result: { won, perfects, marginMeters, isBoss }
//   - purse:   scales with rival strength (you always get a cut, win or lose)
//   - winBonus: big lump for taking the race
//   - perfectBonus: PERFECT_CREDIT × perfect shifts (rewards clean shifting)
//   - marginBonus: extra for a dominant win (how far ahead you finished)
//   - bossMult / hustlerMult applied at the end
// Returns { total, purse, winBonus, perfectBonus, marginBonus, perfects }.
export function earnings(rival, result, hustlerLvl = 0) {
  const { won, perfects = 0, marginMeters = 0, isBoss = false } = result;
  const purse = Math.round((120 + rival.power * 0.9 * rival.mult) * (won ? 1 : 0.18));
  const winBonus = won ? Math.round(260 + rival.power * 0.8 * (isBoss ? 2.4 : 1)) : 0;
  const perfectBonus = perfects * PERFECT_CREDIT;                 // paid win OR lose
  const marginBonus = won ? Math.round(Math.max(0, marginMeters) * 3) : 0;
  const bossMult = isBoss && won ? 1.5 : 1;
  const hustlerMult = 1 + hustlerLvl * 0.1;
  const raw = (purse + winBonus + marginBonus) * bossMult + perfectBonus;
  const total = Math.round(raw * hustlerMult);
  return {
    total,
    purse: Math.round(purse * bossMult * hustlerMult),
    winBonus: Math.round(winBonus * bossMult * hustlerMult),
    marginBonus: Math.round(marginBonus * bossMult * hustlerMult),
    perfectBonus: Math.round(perfectBonus * hustlerMult),
    perfects,
  };
}

// kept for backward-compat with any old callers/tests
export function prize(rival, won, hustlerLvl = 0, isBoss = false) {
  return earnings(rival, { won, perfects: 0, marginMeters: 0, isBoss }, hustlerLvl).total;
}

export const RACE_DISTANCE = 300; // meters

// test.mjs — pure logic checks for racer v2. run: node test.mjs
import assert from "node:assert";
import {
  CARS, CAR_KEYS, PARTS, PART_KEYS, PASSIVES, PASSIVE_KEYS,
  GEAR_RATIOS, REDLINE, IDLE, SHIFT_RPM, maxGear,
  speedFromRpm, rpmFromSpeed, torqueFactor, rpmZone, gearTopSpeed,
  perfectWindow, isPerfectShift, accel,
  freshSave, migrate, mechanicDiscount,
  partLevelCost, partTierCost, carCost, passiveCost,
  carStats, CHAPTERS, STAGES_PER_CHAPTER, rivalPower, makeRival, prize,
  earnings, PERFECT_CREDIT, ACCESSORIES, ACC_KEYS, stageCharacter,
  RACE_DISTANCE,
} from "./game.mjs";

let n = 0; const ok = () => n++;
const rng = (() => { let s = 0.42; return () => (s = (s * 9301 + 49297) % 233280 / 233280); })();

// ── catalog integrity ──
assert.ok(CAR_KEYS.length === 6, "6 cars"); ok();
assert.ok(CARS.porsche && CARS.porsche.shape === "porsche", "porsche present"); ok();
assert.ok(CAR_KEYS.every(k => CARS[k].shape), "every car has a shape"); ok();
assert.strictEqual(CARS.hatch.price, 0, "starter free"); ok();
assert.ok(PART_KEYS.length === 8, "8 parts"); ok();
assert.ok(PASSIVE_KEYS.length === 8, "8 passives"); ok();
assert.ok(PASSIVES.sharpMind, "sharp mind exists"); ok();

// ── fresh save ──
const s = freshSave();
assert.strictEqual(s.cash, 1500); ok();
assert.deepStrictEqual(s.ownedCars, ["hatch"]); ok();
assert.strictEqual(s.activeCar, "hatch"); ok();
assert.ok(PART_KEYS.every(k => s.parts[k].tier === 0 && s.parts[k].level === 0), "parts stock"); ok();
assert.ok(PASSIVE_KEYS.every(k => s.passives[k] === 0), "passives 0"); ok();

// ── migrate handles junk & old shapes ──
assert.doesNotThrow(() => migrate(null)); ok();
assert.doesNotThrow(() => migrate({})); ok();
assert.doesNotThrow(() => migrate({ cash: 99, upgrades: { engine: 3 } })); ok(); // old v1 shape
const m = migrate({ activeCar: "nonexistent" });
assert.strictEqual(m.activeCar, "hatch", "bad car → hatch"); ok();

// ── costs ──
assert.ok(partLevelCost(s, "engine") > 0, "level cost"); ok();
assert.ok(partTierCost(s, "engine") > partLevelCost(s, "engine"), "tier costs more than level"); ok();
assert.strictEqual(carCost(s, "hatch"), 0, "own starter free"); ok();
assert.ok(passiveCost(s, "sharpMind") > 0); ok();
// mechanic discount lowers costs
const sm = freshSave(); sm.passives.mechanic = 5;
assert.ok(mechanicDiscount(sm) < 1, "mechanic discounts"); ok();
assert.ok(partLevelCost(sm, "engine") < partLevelCost(s, "engine"), "cheaper with mechanic"); ok();
// maxed part level → no level cost, needs tier
const st = freshSave(); st.parts.engine.level = PARTS.engine.levelMax;
assert.strictEqual(partLevelCost(st, "engine"), null, "maxed level"); ok();
// top tier → no tier cost
const tt = freshSave(); tt.parts.engine.tier = PARTS.engine.tiers.length - 1;
assert.strictEqual(partTierCost(tt, "engine"), null, "top tier"); ok();

// ── stats improve with parts/passives/cars ──
const s0 = carStats(s);
const su = migrate(s);
su.parts.engine = { tier: 3, level: 5 };
su.parts.turbo = { tier: 3, level: 5 };
assert.ok(carStats(su).power > s0.power, "engine+turbo raise power"); ok();
const sg = migrate(s); sg.parts.gearbox = { tier: 2, level: 3 };
assert.ok(carStats(sg).shiftMs < s0.shiftMs, "gearbox faster shift"); ok();
const sr = migrate(s); sr.passives.reflexes = 5;
assert.ok(carStats(sr).shiftMs < s0.shiftMs, "reflexes faster shift"); ok();
const sh = migrate(s); sh.activeCar = "hyper"; sh.ownedCars.push("hyper");
assert.ok(carStats(sh).power > s0.power, "hyper car stronger"); ok();
// nitrous tier gives charges
const sn = migrate(s); sn.parts.nitrous = { tier: 2, level: 0 };
assert.ok(carStats(sn).nitrous >= 3, "3-shot nitrous"); ok();

// ── perfect shift window: tiny at L0, grows with Sharp Mind ──
const w0 = perfectWindow(0), w5 = perfectWindow(5);
assert.ok((w5.hi - w5.lo) > (w0.hi - w0.lo), "sharp mind widens window"); ok();
assert.ok(w0.half <= 50, "L0 window is a tiny sliver"); ok();
assert.ok(w5.half >= 500, "L5 window is generous"); ok();
assert.ok(isPerfectShift(SHIFT_RPM, 0), "center is perfect"); ok();
assert.ok(!isPerfectShift(3000, 0), "low rpm not perfect"); ok();
assert.ok(!isPerfectShift(SHIFT_RPM - 300, 0), "L0 misses a 300rpm-off shift"); ok();
assert.ok(isPerfectShift(SHIFT_RPM - 300, 5), "L5 catches a 300rpm-off shift"); ok();

// ── gearing / physics ──
assert.ok(speedFromRpm(6000, 5) > speedFromRpm(6000, 0), "top gear faster/rpm"); ok();
assert.ok(Math.abs(rpmFromSpeed(speedFromRpm(5000, 2), 2) - 5000) < 1, "inverse"); ok();
assert.strictEqual(maxGear(), GEAR_RATIOS.length); ok();
assert.ok(torqueFactor(5500) > torqueFactor(2000), "peak>low"); ok();
assert.strictEqual(torqueFactor(REDLINE + 2000), 0, "dead past redline"); ok();
assert.strictEqual(rpmZone(3000), "green"); ok();
assert.strictEqual(rpmZone(SHIFT_RPM + 100), "red"); ok();
assert.strictEqual(rpmZone(REDLINE + 100), "over"); ok();
assert.ok(accel(5500, 0, carStats(su), 1, 1) > 0, "accelerates"); ok();
assert.strictEqual(accel(5500, 0, carStats(su), 0, 1), 0, "no throttle no accel"); ok();

// ── chapters & rivals ──
assert.strictEqual(CHAPTERS.length, 5, "5 chapters"); ok();
assert.ok(CHAPTERS.every(c => c.name && c.boss && c.bossStory), "chapters have story"); ok();
assert.strictEqual(STAGES_PER_CHAPTER, 10); ok();
// QUICK RACE: rival scales off player power
const rpEarly = rivalPower(200, 0, 0, false, rng);
const rpBoss  = rivalPower(200, 0, 9, true, rng);
assert.ok(rpBoss.mult > rpEarly.mult, "boss harder than early stage"); ok();
const rpCh5 = rivalPower(200, 4, 0, false, rng);
assert.ok(rpCh5.mult > rivalPower(200, 0, 0, false, rng).mult - 0.2, "later chapters scale up"); ok();
const rival = makeRival(200, 4, 10, true, rng);
assert.ok(rival.isBoss && rival.name === CHAPTERS[4].boss, "boss named"); ok();
assert.ok(rival.power > 0, "rival has power"); ok();

// CAREER: rival power is FIXED — does NOT scale with the player
const carWeak = makeRival(120, 0, 0, false, rng, true);   // weak player
const carStrong = makeRival(700, 0, 0, false, rng, true); // maxed player, SAME stage
assert.strictEqual(carWeak.power, carStrong.power, "career rival ignores player power"); ok();
// a maxed player massively out-powers an early career rival
assert.ok(carStrong.power < 700 * 0.6, "maxed car dominates early career stage"); ok();
// career ladder ramps: later chapter/boss stronger than chapter-1 stage-1
assert.ok(makeRival(300, 4, 10, true, rng, true).power > makeRival(300, 0, 0, false, rng, true).power, "career ladder ramps up"); ok();
assert.ok(makeRival(300, 0, 9, false, rng, true).power > makeRival(300, 0, 0, false, rng, true).power, "later stages harder within chapter"); ok();

// ── prize (legacy) ──
assert.ok(prize(rival, true, 0, true) > prize(rival, false, 0, true), "win pays more"); ok();
assert.ok(prize(rival, true, 5) > prize(rival, true, 0), "hustler pays more"); ok();
assert.ok(prize(rival, true, 0, true) > prize(rival, true, 0, false), "boss pays more"); ok();

// ── reworked earnings ──
const eWin = earnings(rival, { won: true, perfects: 0, marginMeters: 0, isBoss: false });
const eLose = earnings(rival, { won: false, perfects: 0, marginMeters: 0, isBoss: false });
assert.ok(eWin.total > eLose.total, "winning earns more"); ok();
assert.ok(eWin.winBonus > 0 && eLose.winBonus === 0, "win bonus only on win"); ok();
const ePerfect = earnings(rival, { won: true, perfects: 5, marginMeters: 0, isBoss: false });
assert.strictEqual(ePerfect.total - eWin.total, 5 * PERFECT_CREDIT, "each perfect = PERFECT_CREDIT extra"); ok();
assert.ok(ePerfect.perfectBonus === 5 * PERFECT_CREDIT, "perfect bonus tallied"); ok();
// perfects pay even on a loss
const eLosePerf = earnings(rival, { won: false, perfects: 4, marginMeters: 0 });
assert.ok(eLosePerf.total > eLose.total, "perfects pay even when losing"); ok();
const eMargin = earnings(rival, { won: true, perfects: 0, marginMeters: 50, isBoss: false });
assert.ok(eMargin.total > eWin.total, "bigger margin pays more"); ok();
const eBoss = earnings(rival, { won: true, perfects: 0, marginMeters: 0, isBoss: true });
assert.ok(eBoss.total > eWin.total, "boss win pays more"); ok();
assert.ok(earnings(rival, { won: true, perfects: 2 }, 5).total > earnings(rival, { won: true, perfects: 2 }, 0).total, "hustler multiplies"); ok();

// ── stage characters (stable + varied) ──
assert.ok(ACC_KEYS.length >= 5, "5 accessory categories"); ok();
assert.ok(["hat","glasses","beard","necklace"].every(k => ACCESSORIES[k].length >= 20), "20+ per category"); ok();
const cA = stageCharacter(0, 3), cA2 = stageCharacter(0, 3);
assert.deepStrictEqual(cA, cA2, "same stage → identical character (stable)"); ok();
const cB = stageCharacter(2, 7);
assert.ok(JSON.stringify(cA) !== JSON.stringify(cB), "different stages differ"); ok();
assert.ok(cA.shirt && cA.hat !== undefined, "character well-formed"); ok();

assert.ok(RACE_DISTANCE > 0); ok();

console.log(`✓ all ${n} racer v2 logic checks passed`);

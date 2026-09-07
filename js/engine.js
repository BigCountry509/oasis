/*
 * Calibration math and tip ranking.
 *
 * Boom sprayers:
 *   GPM per tip = (GPA x MPH x tip spacing in inches) / 5940
 * The 5940 constant folds together 5280 feet per mile, 60 minutes per hour,
 * 43560 square feet per acre and 12 inches per foot.
 *
 * Air blast sprayers:
 *   total GPM = (GPA x MPH x row spacing in feet) / 495   both sides in one pass
 *   total GPM = (GPA x MPH x row spacing in feet) / 990   one side per pass
 *
 * Tip flow varies with the square root of pressure, so the pressure that makes a
 * given tip deliver a given flow is solved exactly instead of read off a table.
 */

import {
  TIPS,
  DROPLET_CLASSES,
  dropletAtPsi,
  dropletIndex,
  flowAtPsi,
  psiForFlow,
} from './data/nozzles.js';
import { getApplication } from './data/applications.js';

export const BOOM_CONSTANT = 5940;
export const AIRBLAST_BOTH_SIDES = 495;
export const AIRBLAST_ONE_SIDE = 990;

/* ---------- boom formulas ---------- */

export function boomFlowPerTip({ gpa, mph, spacingInches, tipsPerRow = 1 }) {
  return (gpa * mph * spacingInches) / (BOOM_CONSTANT * tipsPerRow);
}

export function boomGpa({ gpm, mph, spacingInches, tipsPerRow = 1 }) {
  return (BOOM_CONSTANT * gpm * tipsPerRow) / (mph * spacingInches);
}

export function boomSpeed({ gpm, gpa, spacingInches, tipsPerRow = 1 }) {
  return (BOOM_CONSTANT * gpm * tipsPerRow) / (gpa * spacingInches);
}

/* ---------- air blast formulas ---------- */

export function airblastConstant(sides) {
  return sides === 'one' ? AIRBLAST_ONE_SIDE : AIRBLAST_BOTH_SIDES;
}

export function airblastTotalFlow({ gpa, mph, rowSpacingFeet, sides = 'both' }) {
  return (gpa * mph * rowSpacingFeet) / airblastConstant(sides);
}

export function airblastGpa({ gpm, mph, rowSpacingFeet, sides = 'both' }) {
  return (gpm * airblastConstant(sides)) / (mph * rowSpacingFeet);
}

/* ---------- shared helpers ---------- */

export function ozPerMinute(gpm) {
  return gpm * 128;
}

/*
 * Tip wear check. A tip is normally retired once it flows more than about 10
 * per cent over its rated output at the pressure you measured it at.
 */
export function tipWear({ tip, psi, measuredOzPerMin }) {
  const expectedGpm = flowAtPsi(tip.gpm40, psi);
  const measuredGpm = measuredOzPerMin / 128;
  const overPercent = ((measuredGpm - expectedGpm) / expectedGpm) * 100;
  return {
    expectedGpm,
    expectedOzPerMin: ozPerMinute(expectedGpm),
    measuredGpm,
    overPercent,
    /* The epsilon keeps a tip measured at exactly ten per cent over from being
     * failed by floating point noise. */
    replace: overPercent > 10 + 1e-9,
  };
}

export function tankMath({ tankGallons, gpa, acres, productRatePerAcre }) {
  const out = {};
  if (tankGallons > 0 && gpa > 0) {
    out.acresPerTank = tankGallons / gpa;
  }
  if (acres > 0 && gpa > 0) {
    out.totalSolution = acres * gpa;
    if (out.acresPerTank) out.tankLoads = acres / out.acresPerTank;
  }
  if (productRatePerAcre > 0) {
    if (out.acresPerTank) out.productPerTank = productRatePerAcre * out.acresPerTank;
    if (acres > 0) out.productTotal = productRatePerAcre * acres;
  }
  return out;
}

/* ---------- scoring ---------- */

function dropletFit(droplet, application) {
  const index = dropletIndex(droplet);
  const idealLow = dropletIndex(application.idealMin);
  const idealHigh = dropletIndex(application.idealMax);
  const acceptLow = dropletIndex(application.acceptMin);
  const acceptHigh = dropletIndex(application.acceptMax);

  if (index >= idealLow && index <= idealHigh) {
    return { fit: 'ideal', score: 55, stepsOff: 0 };
  }
  if (index >= acceptLow && index <= acceptHigh) {
    const stepsOff = index < idealLow ? idealLow - index : index - idealHigh;
    return { fit: 'acceptable', score: Math.max(22, 45 - 10 * stepsOff), stepsOff };
  }
  const stepsOff = index < acceptLow ? acceptLow - index : index - acceptHigh;
  return { fit: 'outside', score: Math.max(0, 12 - 4 * stepsOff), stepsOff };
}

/* Where the solved pressure sits inside the tip's usable window. */
export function pressureWindow(tip) {
  if (tip.psiOptMin && tip.psiOptMax) {
    return { low: tip.psiOptMin, high: tip.psiOptMax, published: true };
  }
  const span = tip.psiMax - tip.psiMin;
  return {
    low: tip.psiMin + span * 0.3,
    high: tip.psiMin + span * 0.7,
    published: false,
  };
}

function pressureScore(tip, psi) {
  const window = pressureWindow(tip);
  if (psi >= window.low && psi <= window.high) return 25;
  if (psi < window.low) {
    const room = window.low - tip.psiMin || 1;
    return Math.max(0, 25 * (1 - (window.low - psi) / room));
  }
  const room = tip.psiMax - window.high || 1;
  return Math.max(0, 25 * (1 - (psi - window.high) / room));
}

const DRIFT_POINTS = { none: 0, moderate: 3, high: 6, max: 8 };

function driftScore(tip, windMph) {
  const base = DRIFT_POINTS[tip.driftClass] ?? 0;
  if (!Number.isFinite(windMph)) return base * 0.6;
  if (windMph < 5) return base * 0.3;
  if (windMph < 8) return base * 0.6;
  if (windMph <= 12) return base;
  return Math.min(12, base * 1.5);
}

function seriesScore(tip, application) {
  const rank = application.preferSeries?.indexOf(tip.seriesId) ?? -1;
  if (rank < 0) return 0;
  return Math.max(2, 12 - rank * 3);
}

/*
 * Minimum droplet class the wind justifies. Extension guidance is to move at
 * least one class coarser once wind gets up, and to stop spraying fine droplets
 * altogether above roughly 10 mph.
 */
export function windDropletFloor(windMph) {
  if (!Number.isFinite(windMph)) return null;
  if (windMph >= 15) return 'VC';
  if (windMph >= 10) return 'C';
  if (windMph >= 8) return 'M';
  return null;
}

/* ---------- boom recommendation ---------- */

function boomWarnings({ tip, psi, droplet, input, application, requiredGpm }) {
  const warnings = [];
  const { gpa, mph, windMph } = input;

  if (gpa < application.gpaMin) {
    warnings.push({
      level: 'warn',
      text: `${gpa} GPA is below the ${application.gpaMin} GPA floor this job normally needs. Coverage will suffer before the tip choice does.`,
    });
  }

  const coarseIndex = dropletIndex('VC');
  if (dropletIndex(droplet.droplet) >= coarseIndex && gpa < 15) {
    warnings.push({
      level: 'warn',
      text: `${droplet.droplet} droplets at only ${gpa} GPA puts very few droplets on each leaf. Lift carrier volume to 15 GPA or more, or pick a finer tip.`,
    });
  }

  if (tip.airInduction && psi < 30) {
    warnings.push({
      level: 'info',
      text: `Air induction tips draw air through the pre-orifice. At ${Math.round(psi)} PSI this tip is at the soft end of its range and the pattern will not be fully developed. 40 PSI and up is where it works best.`,
    });
  }

  const window = pressureWindow(tip);
  if (psi > tip.psiMax * 0.9) {
    warnings.push({
      level: 'info',
      text: `At ${Math.round(psi)} PSI you are near this tip's ${tip.psiMax} PSI ceiling, so there is little room to speed up without going to a bigger tip.`,
    });
  } else if (psi < window.low && !tip.psiOptMin) {
    warnings.push({
      level: 'info',
      text: `${Math.round(psi)} PSI is in the lower part of the range. Pattern uniformity improves with a bit more pressure, so a size smaller tip would let you run higher.`,
    });
  }

  const floor = windDropletFloor(windMph);
  if (floor && dropletIndex(droplet.droplet) < dropletIndex(floor)) {
    warnings.push({
      level: 'warn',
      text: `At ${windMph} mph of wind this ${droplet.droplet} spray is drift prone. ${floor} or coarser is the safer call, or wait for the wind to drop.`,
    });
  }

  if (Number.isFinite(windMph) && windMph > 15) {
    warnings.push({
      level: 'warn',
      text: `${windMph} mph is above the wind limit on most labels. Check the label before you go.`,
    });
  }

  if (mph > 12) {
    warnings.push({
      level: 'info',
      text: `${mph} mph raises boom bounce and pulls more spray into the air behind the machine, whatever tip you fit.`,
    });
  }

  if (!droplet.exact) {
    warnings.push({
      level: 'info',
      text: `TeeJet publishes droplet classes at set pressures. The ${droplet.droplet} shown is the published class at ${droplet.fromPsi} PSI, the nearest step to your ${Math.round(psi)} PSI.`,
    });
  }

  if (application.requiresLabelCheck) {
    warnings.push({
      level: 'critical',
      text: 'This product class carries a mandatory nozzle list on the label. Confirm this exact tip and pressure appear on the current label for your product before you spray.',
    });
  }

  if (requiredGpm > 0 && tip.gpm40 / requiredGpm > 3) {
    warnings.push({
      level: 'info',
      text: 'This tip is much larger than the job needs and is only reachable at very low pressure. Treat it as a fallback.',
    });
  }

  return warnings;
}

export function recommendBoom(input) {
  const application = getApplication(input.applicationId);
  if (!application) throw new Error(`Unknown application: ${input.applicationId}`);

  const spacingInches = input.spacingInches;
  const tipsPerRow = input.tipsPerRow || 1;
  const requiredGpm = boomFlowPerTip({
    gpa: input.gpa,
    mph: input.mph,
    spacingInches,
    tipsPerRow,
  });

  const limitLow = Number.isFinite(input.psiLimitMin) ? input.psiLimitMin : 0;
  const limitHigh = Number.isFinite(input.psiLimitMax) ? input.psiLimitMax : Infinity;

  const candidates = [];
  for (const tip of TIPS) {
    if (tip.sprayerType !== 'boom') continue;
    if (input.seriesFilter?.length && !input.seriesFilter.includes(tip.seriesId)) continue;

    const psi = psiForFlow(tip.gpm40, requiredGpm);
    if (psi < tip.psiMin || psi > tip.psiMax) continue;
    if (psi < limitLow || psi > limitHigh) continue;

    const droplet = dropletAtPsi(tip, psi);
    if (!droplet.droplet) continue;

    const fit = dropletFit(droplet.droplet, application);
    const pressurePoints = pressureScore(tip, psi);
    const driftPoints = driftScore(tip, input.windMph);
    const seriesPoints = seriesScore(tip, application);
    const score = fit.score + pressurePoints + driftPoints + seriesPoints;

    const setPsi = Math.round(psi);
    const gpmAtSetPsi = flowAtPsi(tip.gpm40, setPsi);

    candidates.push({
      tip,
      psi,
      setPsi,
      dropletClass: droplet.droplet,
      dropletFromPsi: droplet.fromPsi,
      dropletExact: droplet.exact,
      fit: fit.fit,
      score,
      breakdown: {
        droplet: fit.score,
        pressure: pressurePoints,
        drift: driftPoints,
        series: seriesPoints,
      },
      requiredGpm,
      gpmAtSetPsi,
      ozPerMinAtSetPsi: ozPerMinute(gpmAtSetPsi),
      gpaAtSetPsi: boomGpa({ gpm: gpmAtSetPsi, mph: input.mph, spacingInches, tipsPerRow }),
      range: boomTipRange({ tip, input, spacingInches, tipsPerRow }),
      warnings: boomWarnings({ tip, psi, droplet, input, application, requiredGpm }),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const usable = candidates.filter((candidate) => candidate.fit !== 'outside');
  const ranked = usable.length >= 3 ? usable : candidates;

  return {
    mode: 'boom',
    application,
    requiredGpm,
    requiredOzPerMin: ozPerMinute(requiredGpm),
    windFloor: windDropletFloor(input.windMph),
    results: ranked.slice(0, 6),
    allConsidered: candidates.length,
    noneIdeal: !candidates.some((candidate) => candidate.fit === 'ideal'),
  };
}

/*
 * The rate and speed window a tip gives you without changing tips: what GPA it
 * covers at your speed, and what speed it covers at your target rate.
 */
function boomTipRange({ tip, input, spacingInches, tipsPerRow }) {
  const flowLow = flowAtPsi(tip.gpm40, tip.psiMin);
  const flowHigh = flowAtPsi(tip.gpm40, tip.psiMax);
  return {
    psiMin: tip.psiMin,
    psiMax: tip.psiMax,
    gpmMin: flowLow,
    gpmMax: flowHigh,
    gpaMinAtSpeed: boomGpa({ gpm: flowLow, mph: input.mph, spacingInches, tipsPerRow }),
    gpaMaxAtSpeed: boomGpa({ gpm: flowHigh, mph: input.mph, spacingInches, tipsPerRow }),
    speedMinAtRate: boomSpeed({ gpm: flowLow, gpa: input.gpa, spacingInches, tipsPerRow }),
    speedMaxAtRate: boomSpeed({ gpm: flowHigh, gpa: input.gpa, spacingInches, tipsPerRow }),
  };
}

/*
 * Pressure and speed table for the chosen tip, so the sheet in the cab covers
 * more than the single setting that was asked for.
 */
export function boomTable({ tip, spacingInches, tipsPerRow = 1, speeds, pressures }) {
  const psiList = pressures || defaultPressureSteps(tip);
  const speedList = speeds || [4, 6, 8, 10, 12, 14];
  return {
    speeds: speedList,
    rows: psiList.map((psi) => {
      const gpm = flowAtPsi(tip.gpm40, psi);
      const droplet = dropletAtPsi(tip, psi);
      return {
        psi,
        gpm,
        droplet: droplet.droplet,
        gpa: speedList.map((mph) => boomGpa({ gpm, mph, spacingInches, tipsPerRow })),
      };
    }),
  };
}

function defaultPressureSteps(tip) {
  const steps = [15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 115];
  return steps.filter((psi) => psi >= tip.psiMin && psi <= tip.psiMax);
}

/* ---------- air blast recommendation ---------- */

/*
 * Volume split across the nozzle positions on one side, bottom position first.
 * Orchard guidance is to put two thirds to three quarters of the output into the
 * top half of the canopy, because that is where the leaf area is.
 */
export function canopyWeights(positions, topShare = 0.7) {
  if (positions < 1) return [];
  if (positions === 1) return [1];
  const topCount = Math.ceil(positions / 2);
  const bottomCount = positions - topCount;
  const weights = [];
  for (let index = 0; index < positions; index += 1) {
    const isTop = index >= bottomCount;
    weights.push(isTop ? topShare / topCount : (1 - topShare) / bottomCount);
  }
  return weights;
}

function tipsInSeries(seriesId) {
  return TIPS.filter((tip) => tip.sprayerType === 'airblast' && tip.seriesId === seriesId);
}

function closestTipAtPsi(seriesTips, psi, targetGpm) {
  let best = null;
  for (const tip of seriesTips) {
    if (psi < tip.psiMin || psi > tip.psiMax) continue;
    const gpm = flowAtPsi(tip.gpm40, psi);
    const error = Math.abs(gpm - targetGpm) / targetGpm;
    if (!best || error < best.error) best = { tip, gpm, error };
  }
  return best;
}

export function recommendAirblast(input) {
  const application = getApplication(input.applicationId);
  if (!application) throw new Error(`Unknown application: ${input.applicationId}`);

  const sides = input.sides || 'both';
  const positions = input.positionsPerSide || 5;
  const topShare = Number.isFinite(input.topShare) ? input.topShare : 0.7;

  const totalGpm = airblastTotalFlow({
    gpa: input.gpa,
    mph: input.mph,
    rowSpacingFeet: input.rowSpacingFeet,
    sides,
  });
  /* With the 495 constant the machine sprays both sides at once, so the total
   * output is shared between two manifolds. With 990 only one manifold runs. */
  const perSideGpm = sides === 'both' ? totalGpm / 2 : totalGpm;
  const weights = canopyWeights(positions, topShare);
  const positionTargets = weights.map((weight) => weight * perSideGpm);

  const seriesIds = input.seriesFilter?.length
    ? input.seriesFilter
    : [...new Set(TIPS.filter((tip) => tip.sprayerType === 'airblast').map((tip) => tip.seriesId))];

  const options = [];
  for (const seriesId of seriesIds) {
    const seriesTips = tipsInSeries(seriesId);
    if (!seriesTips.length) continue;

    for (const psi of airblastPressureSteps(seriesTips, input)) {
      const picks = [];
      let ok = true;
      for (const target of positionTargets) {
        const pick = closestTipAtPsi(seriesTips, psi, target);
        if (!pick) {
          ok = false;
          break;
        }
        picks.push(pick);
      }
      if (!ok) continue;

      const deliveredPerSide = picks.reduce((sum, pick) => sum + pick.gpm, 0);
      const deliveredTotal = sides === 'both' ? deliveredPerSide * 2 : deliveredPerSide;
      const rateError = (deliveredTotal - totalGpm) / totalGpm;
      const actualGpa = airblastGpa({
        gpm: deliveredTotal,
        mph: input.mph,
        rowSpacingFeet: input.rowSpacingFeet,
        sides,
      });

      /*
       * Positions carry different capacities, and capacity changes the droplet
       * class, so each position is classified on its own rather than assuming
       * the whole manifold sprays like the bottom tip.
       */
      const positions = picks.map((pick, index) => {
        const droplet = dropletAtPsi(pick.tip, psi);
        return {
          position: index + 1,
          fromBottom: index + 1,
          share: weights[index],
          targetGpm: positionTargets[index],
          tip: pick.tip,
          gpm: pick.gpm,
          ozPerMin: ozPerMinute(pick.gpm),
          dropletClass: droplet.droplet,
          dropletFromPsi: droplet.fromPsi,
          dropletExact: droplet.exact,
        };
      });

      const fits = positions.map((position) => dropletFit(position.dropletClass, application));
      const fit = {
        fit: fits.every((item) => item.fit === 'ideal')
          ? 'ideal'
          : fits.some((item) => item.fit === 'outside')
            ? 'outside'
            : 'acceptable',
        score: fits.reduce((sum, item) => sum + item.score, 0) / fits.length,
      };
      const headline = dominantDroplet(positions);

      /*
       * Rate accuracy has to stay strictly monotonic. Clamping it at zero once
       * the error passes some threshold makes every bad option tie, and then
       * the ranking falls back to enumeration order and can put a wildly under
       * rate tip set on top.
       */
      const ratePoints = 40 / (1 + Math.abs(rateError) * 20);
      const pressurePoints = airblastPressureScore(psi, picks[0].tip);
      const driftPoints = driftScore(picks[0].tip, input.windMph);
      const seriesPoints = seriesScore(picks[0].tip, application);
      const score = fit.score + ratePoints + pressurePoints + driftPoints + seriesPoints;

      options.push({
        seriesId,
        seriesName: picks[0].tip.seriesName,
        psi,
        positions,
        dropletClass: headline.droplet,
        dropletFromPsi: headline.fromPsi,
        dropletExact: positions.every((position) => position.dropletExact),
        dropletRange: headline.range,
        fit: fit.fit,
        score,
        requiredTotalGpm: totalGpm,
        requiredPerSideGpm: perSideGpm,
        deliveredPerSideGpm: deliveredPerSide,
        deliveredTotalGpm: deliveredTotal,
        rateErrorPercent: rateError * 100,
        actualGpa,
        warnings: airblastWarnings({
          picks,
          positions,
          psi,
          input,
          application,
          rateError,
          deliveredTotal,
          sides,
        }),
      });
    }
  }

  options.sort((a, b) => b.score - a.score);

  /*
   * Tips only come in fixed sizes, so a set never lands exactly on the target.
   * Within 10 per cent is trimmable with ground speed. Anything further out is
   * not a recommendation, it is a warning that the machine cannot do the job as
   * set up, so those are held back and explained instead.
   */
  const onRate = options.filter((option) => Math.abs(option.rateErrorPercent) <= 10);
  /* When nothing can hit the rate, the only thing that matters is which set
   * gets closest, so the usual scoring is set aside. */
  const pool = onRate.length
    ? onRate
    : [...options].sort((a, b) => Math.abs(a.rateErrorPercent) - Math.abs(b.rateErrorPercent));

  /* One option per series and pressure neighbourhood, so the list is not six
   * near identical pressures of the same tip set. */
  const seen = new Set();
  const results = [];
  for (const option of pool) {
    const key = `${option.seriesId}:${Math.round(option.psi / 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(option);
    if (results.length >= 5) break;
  }

  const unreachable = onRate.length
    ? null
    : describeUnreachable({ seriesIds, positions, sides, input, totalGpm, closest: pool[0] });

  return {
    mode: 'airblast',
    application,
    requiredTotalGpm: totalGpm,
    requiredPerSideGpm: perSideGpm,
    requiredTotalOzPerMin: ozPerMinute(totalGpm),
    sides,
    positionsPerSide: positions,
    topShare,
    windFloor: windDropletFloor(input.windMph),
    results,
    allConsidered: options.length,
    onRateCount: onRate.length,
    unreachable,
    noneIdeal: !pool.some((option) => option.fit === 'ideal'),
  };
}

/*
 * Speed that makes a given total flow deliver the target rate. Trimming with
 * ground speed is the standard fix for a tip set that cannot land exactly on
 * rate, because tips only come in fixed sizes.
 */
export function airblastTrimSpeed({ gpm, gpa, rowSpacingFeet, sides }) {
  return (gpm * airblastConstant(sides)) / (gpa * rowSpacingFeet);
}

/*
 * Why no tip set gets within 10 per cent, and what to change about it. There
 * are three different reasons and they need different answers:
 *
 *   over  - the target needs more flow than these tips can pass wide open
 *   under - the target needs less flow than they pass at their lowest pressure
 *   fixed sizes - the target sits inside that envelope, but the canopy split
 *                 forces small tips on the low positions and no combination of
 *                 the sizes that exist adds up to the target at one shared
 *                 pressure. This is the common one, and the fix is ground speed.
 */
function describeUnreachable({ seriesIds, positions, sides, input, totalGpm, closest }) {
  let best = null;
  for (const seriesId of seriesIds) {
    const seriesTips = tipsInSeries(seriesId);
    if (!seriesTips.length) continue;
    const capacity = airblastCapacity({
      seriesTips,
      positionCount: positions,
      sides,
      mph: input.mph,
      rowSpacingFeet: input.rowSpacingFeet,
    });
    if (!best || capacity.maxTotalGpm > best.capacity.maxTotalGpm) {
      best = { seriesId, seriesName: seriesTips[0].seriesName, capacity };
    }
  }
  if (!best) return null;

  const { capacity } = best;
  const constant = airblastConstant(sides);
  const speedFor = (gpm) => (gpm * constant) / (input.gpa * input.rowSpacingFeet);

  if (totalGpm > capacity.maxTotalGpm) {
    return {
      direction: 'over',
      seriesName: best.seriesName,
      capacity,
      speedLimit: speedFor(capacity.maxTotalGpm),
      advice: [
        `${fmtRate(input.gpa)} GPA at ${fmtRate(input.mph)} mph needs ${totalGpm.toFixed(1)} GPM, which is more than ${positions} of these tips per side can flow even wide open.`,
        `At this speed the most they will put out is about ${capacity.maxGpa.toFixed(0)} GPA.`,
        `Slow to about ${speedFor(capacity.maxTotalGpm).toFixed(1)} mph, or add nozzle positions.`,
        `For volumes this high, disc and core nozzles go far larger than the cone tips listed here.`,
      ],
    };
  }

  if (totalGpm < capacity.minTotalGpm) {
    return {
      direction: 'under',
      seriesName: best.seriesName,
      capacity,
      speedLimit: speedFor(capacity.minTotalGpm),
      advice: [
        `${fmtRate(input.gpa)} GPA at ${fmtRate(input.mph)} mph only needs ${totalGpm.toFixed(2)} GPM, less than ${positions} of these tips per side will flow at their lowest pressure.`,
        `At this speed the least they will put out is about ${capacity.minGpa.toFixed(0)} GPA.`,
        `Speed up to about ${speedFor(capacity.minTotalGpm).toFixed(1)} mph, or run fewer nozzle positions.`,
      ],
    };
  }

  const trimSpeed = closest
    ? airblastTrimSpeed({
        gpm: closest.deliveredTotalGpm,
        gpa: input.gpa,
        rowSpacingFeet: input.rowSpacingFeet,
        sides,
      })
    : null;

  return {
    direction: 'fixed sizes',
    seriesName: best.seriesName,
    capacity,
    trimSpeed,
    advice: [
      `The machine can flow this rate, but tips only come in fixed sizes and the canopy split puts small tips on the bottom positions, so no combination lands within 10 per cent at one shared pressure.`,
      closest
        ? `The closest set below is ${Math.abs(closest.rateErrorPercent).toFixed(0)} per cent ${closest.rateErrorPercent < 0 ? 'under' : 'over'} rate.`
        : null,
      trimSpeed
        ? `Run that set at about ${trimSpeed.toFixed(1)} mph instead of ${fmtRate(input.mph)} mph and you are on rate.`
        : null,
      `Changing the number of nozzle positions, or the share on the top half, also changes what sizes the split asks for.`,
    ].filter(Boolean),
  };
}

function fmtRate(value) {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '?';
}

/*
 * Cone tips run from 30 all the way to 300 PSI, but running at the top of that
 * range to hit a rate is the wrong answer: it makes the spray finer, wears
 * everything faster and loads the pump, when fitting a larger orifice at
 * moderate pressure gives the same output. So moderate pressure scores full
 * marks and the top of the range is discouraged. TeeJet notes the plain cone
 * tips are suited to work at 40 PSI and up, which sets the soft floor.
 */
export function airblastPressureScore(psi, tip) {
  const floor = Math.max(tip.psiMin, 40);
  const comfortable = 150;
  if (psi < floor) return 0;
  if (psi <= comfortable) return 15;
  const span = tip.psiMax - comfortable || 1;
  return Math.max(0, 15 * (1 - (psi - comfortable) / span));
}

/*
 * What this machine can physically deliver at this speed and row spacing: the
 * smallest tip in the family at its lowest pressure, up to the largest at its
 * highest. Used to explain an out of reach target instead of quietly returning
 * a tip set that is a long way off rate.
 */
export function airblastCapacity({ seriesTips, positionCount, sides, mph, rowSpacingFeet }) {
  const psiFloor = Math.max(...seriesTips.map((tip) => tip.psiMin));
  const psiCeiling = Math.min(...seriesTips.map((tip) => tip.psiMax));
  const smallest = Math.min(...seriesTips.map((tip) => tip.gpm40));
  const largest = Math.max(...seriesTips.map((tip) => tip.gpm40));
  const multiplier = sides === 'both' ? 2 : 1;

  const minTotal = positionCount * flowAtPsi(smallest, psiFloor) * multiplier;
  const maxTotal = positionCount * flowAtPsi(largest, psiCeiling) * multiplier;

  return {
    psiFloor,
    psiCeiling,
    minTotalGpm: minTotal,
    maxTotalGpm: maxTotal,
    minGpa: airblastGpa({ gpm: minTotal, mph, rowSpacingFeet, sides }),
    maxGpa: airblastGpa({ gpm: maxTotal, mph, rowSpacingFeet, sides }),
  };
}

/*
 * The class to put on the headline when the positions are not all the same:
 * whichever class covers the most positions, with the coarsest winning a tie.
 * The range is reported alongside it so a mixed manifold is not hidden.
 */
function dominantDroplet(positions) {
  const counts = new Map();
  for (const position of positions) {
    counts.set(position.dropletClass, (counts.get(position.dropletClass) || 0) + 1);
  }
  let best = positions[0].dropletClass;
  for (const [droplet, count] of counts) {
    const bestCount = counts.get(best);
    if (count > bestCount || (count === bestCount && dropletIndex(droplet) > dropletIndex(best))) {
      best = droplet;
    }
  }
  const indexes = positions.map((position) => dropletIndex(position.dropletClass));
  const low = DROPLET_CLASSES[Math.min(...indexes)];
  const high = DROPLET_CLASSES[Math.max(...indexes)];
  return {
    droplet: best,
    fromPsi: positions.find((position) => position.dropletClass === best)?.dropletFromPsi ?? null,
    range: low === high ? null : { from: low, to: high },
  };
}

function airblastPressureSteps(seriesTips, input) {
  const min = Math.max(...seriesTips.map((tip) => tip.psiMin));
  const max = Math.min(...seriesTips.map((tip) => tip.psiMax));
  const limitLow = Number.isFinite(input.psiLimitMin) ? Math.max(min, input.psiLimitMin) : min;
  const limitHigh = Number.isFinite(input.psiLimitMax) ? Math.min(max, input.psiLimitMax) : max;
  const steps = [];
  for (let psi = Math.ceil(limitLow / 10) * 10; psi <= limitHigh; psi += 10) {
    steps.push(psi);
  }
  return steps;
}

function airblastWarnings({
  picks,
  positions,
  psi,
  input,
  application,
  rateError,
  deliveredTotal,
  sides,
}) {
  const warnings = [];

  if (Math.abs(rateError) > 0.02) {
    const trimSpeed = airblastTrimSpeed({
      gpm: deliveredTotal,
      gpa: input.gpa,
      rowSpacingFeet: input.rowSpacingFeet,
      sides,
    });
    warnings.push({
      level: Math.abs(rateError) > 0.05 ? 'warn' : 'info',
      text: `This set delivers ${Math.abs(rateError * 100).toFixed(1)}% ${rateError > 0 ? 'more' : 'less'} than the target rate, because tips only come in fixed sizes. Run ${trimSpeed.toFixed(1)} mph instead of ${input.mph} mph and you are exactly on rate.`,
    });
  }

  if (psi > 200) {
    warnings.push({
      level: 'warn',
      text: `${psi} PSI is near the top of what these tips are rated for. It works, but it makes the spray finer and wears tips and pump faster. Adding nozzle positions or fitting larger nozzles would let you carry the same rate at a far lower pressure.`,
    });
  }

  const anyAirInduction = picks.some((pick) => pick.tip.airInduction);
  if (anyAirInduction && psi < 60) {
    warnings.push({
      level: 'warn',
      text: 'Air induction cone tips need 60 PSI or more before the venturi pulls air. Below that the droplet spectrum is not what the chart says.',
    });
  }

  if (input.mph > 4) {
    warnings.push({
      level: 'info',
      text: `${input.mph} mph is fast for an air blast pass. Above about 3 to 4 mph the air stream stops replacing the air in the canopy and coverage on the far side drops off.`,
    });
  }

  const inexact = positions.find((position) => !position.dropletExact);
  if (inexact) {
    warnings.push({
      level: 'info',
      text: `TeeJet publishes droplet classes at set pressures. The classes shown are the published values at ${inexact.dropletFromPsi} PSI, the nearest charted step to ${psi} PSI.`,
    });
  }

  const classes = new Set(positions.map((position) => position.dropletClass));
  if (classes.size > 1) {
    warnings.push({
      level: 'info',
      text: `The positions do not all spray the same droplet size, because they carry different capacities at one common pressure. Per position classes are in the table.`,
    });
  }

  warnings.push({
    level: 'info',
    text: 'Shut off any nozzle spraying above or below the canopy. Those are the positions that cause most of the off target loss on an air blast machine.',
  });

  if (application.requiresLabelCheck) {
    warnings.push({
      level: 'critical',
      text: 'Confirm the tip and pressure against the current product label before you spray.',
    });
  }

  return warnings;
}

export function recommend(input) {
  return input.sprayerType === 'airblast' ? recommendAirblast(input) : recommendBoom(input);
}

export { DROPLET_CLASSES, flowAtPsi, psiForFlow, dropletAtPsi };

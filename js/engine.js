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

      const droplet = dropletAtPsi(picks[0].tip, psi);
      const fit = dropletFit(droplet.droplet, application);
      const ratePoints = Math.max(0, 30 - Math.abs(rateError) * 300);
      const driftPoints = driftScore(picks[0].tip, input.windMph);
      const seriesPoints = seriesScore(picks[0].tip, application);
      const score = fit.score + ratePoints + driftPoints + seriesPoints;

      options.push({
        seriesId,
        seriesName: picks[0].tip.seriesName,
        psi,
        positions: picks.map((pick, index) => ({
          position: index + 1,
          fromBottom: index + 1,
          share: weights[index],
          targetGpm: positionTargets[index],
          tip: pick.tip,
          gpm: pick.gpm,
          ozPerMin: ozPerMinute(pick.gpm),
        })),
        dropletClass: droplet.droplet,
        dropletFromPsi: droplet.fromPsi,
        dropletExact: droplet.exact,
        fit: fit.fit,
        score,
        requiredTotalGpm: totalGpm,
        requiredPerSideGpm: perSideGpm,
        deliveredPerSideGpm: deliveredPerSide,
        deliveredTotalGpm: deliveredTotal,
        rateErrorPercent: rateError * 100,
        actualGpa,
        warnings: airblastWarnings({ picks, psi, droplet, input, application, rateError }),
      });
    }
  }

  options.sort((a, b) => b.score - a.score);

  /* One option per series and pressure neighbourhood, so the list is not six
   * near identical pressures of the same tip set. */
  const seen = new Set();
  const results = [];
  for (const option of options) {
    const key = `${option.seriesId}:${Math.round(option.psi / 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(option);
    if (results.length >= 5) break;
  }

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
    noneIdeal: !options.some((option) => option.fit === 'ideal'),
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

function airblastWarnings({ picks, psi, droplet, input, application, rateError }) {
  const warnings = [];

  if (Math.abs(rateError) > 0.05) {
    warnings.push({
      level: 'warn',
      text: `This tip set delivers ${(rateError * 100).toFixed(1)}% ${rateError > 0 ? 'more' : 'less'} than the target rate. Adjust ground speed to trim the difference, or try a different pressure.`,
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

  if (!droplet.exact) {
    warnings.push({
      level: 'info',
      text: `Droplet class ${droplet.droplet} is the published value at ${droplet.fromPsi} PSI, the nearest step to ${psi} PSI.`,
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

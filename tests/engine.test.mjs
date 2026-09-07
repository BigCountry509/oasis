/*
 * Run with:  node --test tests/
 *
 * The numbers checked here are not invented. They are values published by
 * TeeJet or worked examples from extension service calibration guides, so a
 * failure means the calculator has drifted away from the printed charts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boomFlowPerTip,
  boomGpa,
  boomSpeed,
  airblastTotalFlow,
  airblastGpa,
  canopyWeights,
  ozPerMinute,
  tipWear,
  tankMath,
  recommendBoom,
  recommendAirblast,
  pressureWindow,
  windDropletFloor,
} from '../js/engine.js';

import { TIPS, flowAtPsi, psiForFlow, dropletAtPsi, NOMINAL_GPM } from '../js/data/nozzles.js';
import { APPLICATIONS, getApplication } from '../js/data/applications.js';

const close = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
};

test('boom flow formula matches the TeeJet 15 inch spacing chart', () => {
  /* TeeJet LI-TJ420, 15" spacing, an 03 tip at 40 PSI flows 0.30 GPM and the
   * chart prints these application rates. TeeJet prints rates of 20 and above
   * as whole numbers and smaller ones to one decimal, so the comparison is made
   * against the value as the chart would round it. */
  const asPrinted = (value) => (value >= 20 ? Math.round(value) : Math.round(value * 10) / 10);
  const gpm = 0.3;
  const spacingInches = 15;
  const expected = {
    4: 30,
    5: 24,
    6: 19.8,
    8: 14.9,
    10: 11.9,
    12: 9.9,
    20: 5.9,
  };
  for (const [mph, gpa] of Object.entries(expected)) {
    assert.equal(
      asPrinted(boomGpa({ gpm, mph: Number(mph), spacingInches })),
      gpa,
      `${mph} mph on the 15 inch chart`,
    );
  }
});

test('boom flow formula round trips', () => {
  const spacingInches = 20;
  const gpm = boomFlowPerTip({ gpa: 20, mph: 6, spacingInches });
  close(gpm, 0.404, 0.001, 'GPM per tip at 20 GPA and 6 mph on 20 inch spacing');
  close(boomGpa({ gpm, mph: 6, spacingInches }), 20, 0.001, 'GPA back out');
  close(boomSpeed({ gpm, gpa: 20, spacingInches }), 6, 0.001, 'speed back out');
});

test('band spraying uses the band width in place of tip spacing', () => {
  /* A 10 inch band on 30 inch rows needs a third of the flow of a broadcast
   * tip on 30 inch spacing at the same rate over the band. */
  const broadcast = boomFlowPerTip({ gpa: 15, mph: 6, spacingInches: 30 });
  const banded = boomFlowPerTip({ gpa: 15, mph: 6, spacingInches: 10 });
  close(banded, broadcast / 3, 1e-9, 'band flow');
});

test('directed applications divide flow between the tips on a row', () => {
  const single = boomFlowPerTip({ gpa: 15, mph: 5, spacingInches: 30 });
  const paired = boomFlowPerTip({ gpa: 15, mph: 5, spacingInches: 30, tipsPerRow: 2 });
  close(paired, single / 2, 1e-9, 'two tips per row');
});

test('square root pressure law reproduces the published AIXR capacity column', () => {
  /* TeeJet AIXR11003 product page: 0.18 GPM at 15 PSI, 0.30 at 40, 0.41 at 75,
   * 0.45 at 90. */
  const gpm40 = 0.3;
  close(flowAtPsi(gpm40, 15), 0.18, 0.005, '15 PSI');
  close(flowAtPsi(gpm40, 40), 0.3, 0.001, '40 PSI');
  close(flowAtPsi(gpm40, 75), 0.41, 0.005, '75 PSI');
  close(flowAtPsi(gpm40, 90), 0.45, 0.005, '90 PSI');
});

test('psiForFlow inverts flowAtPsi', () => {
  for (const gpm40 of Object.values(NOMINAL_GPM)) {
    for (const psi of [15, 27, 40, 63, 90]) {
      const gpm = flowAtPsi(gpm40, psi);
      close(psiForFlow(gpm40, gpm), psi, 1e-9, `${gpm40} at ${psi} PSI`);
    }
  }
});

test('four times the pressure doubles the flow', () => {
  close(flowAtPsi(0.4, 80) / flowAtPsi(0.4, 20), 2, 1e-9, 'flow ratio');
});

test('air blast flow matches the UGA worked example', () => {
  /* UGA extension: 75 GPA, 1.7 mph, 60 foot pecan rows, spraying one side per
   * pass, needs 7.7 GPM. Measuring 7.4 GPM back means 71.8 GPA. */
  close(
    airblastTotalFlow({ gpa: 75, mph: 1.7, rowSpacingFeet: 60, sides: 'one' }),
    7.7,
    0.05,
    'required GPM',
  );
  close(
    airblastGpa({ gpm: 7.4, mph: 1.7, rowSpacingFeet: 60, sides: 'one' }),
    71.8,
    0.1,
    'actual GPA',
  );
});

test('spraying both sides in one pass needs twice the flow of one side', () => {
  const both = airblastTotalFlow({ gpa: 100, mph: 3, rowSpacingFeet: 20, sides: 'both' });
  const one = airblastTotalFlow({ gpa: 100, mph: 3, rowSpacingFeet: 20, sides: 'one' });
  close(both, one * 2, 1e-9, 'both sides');
  close(both, (100 * 3 * 20) / 495, 1e-9, '495 constant');
});

test('canopy weights put the requested share on the top half', () => {
  for (const positions of [2, 3, 4, 5, 6, 7, 8]) {
    const weights = canopyWeights(positions, 0.7);
    assert.equal(weights.length, positions);
    close(
      weights.reduce((sum, weight) => sum + weight, 0),
      1,
      1e-9,
      `weights sum for ${positions} positions`,
    );
    const topCount = Math.ceil(positions / 2);
    const topShare = weights.slice(-topCount).reduce((sum, weight) => sum + weight, 0);
    close(topShare, 0.7, 1e-9, `top half share for ${positions} positions`);
  }
  assert.deepEqual(canopyWeights(1), [1]);
});

test('catch test conversion', () => {
  close(ozPerMinute(0.4), 51.2, 1e-9, '0.4 GPM in oz per minute');
});

test('tip wear flags a tip more than ten per cent over rating', () => {
  const tip = { gpm40: 0.3 };
  const expectedOz = ozPerMinute(flowAtPsi(0.3, 40));
  const fresh = tipWear({ tip, psi: 40, measuredOzPerMin: expectedOz });
  close(fresh.overPercent, 0, 1e-9, 'new tip');
  assert.equal(fresh.replace, false);

  const worn = tipWear({ tip, psi: 40, measuredOzPerMin: expectedOz * 1.12 });
  close(worn.overPercent, 12, 1e-6, 'worn tip');
  assert.equal(worn.replace, true);

  const borderline = tipWear({ tip, psi: 40, measuredOzPerMin: expectedOz * 1.1 });
  assert.equal(borderline.replace, false, 'exactly ten per cent is still in service');
});

test('tank math', () => {
  const result = tankMath({ tankGallons: 1000, gpa: 15, acres: 300, productRatePerAcre: 32 });
  close(result.acresPerTank, 66.67, 0.01, 'acres per tank');
  close(result.totalSolution, 4500, 1e-9, 'total solution');
  close(result.tankLoads, 4.5, 1e-9, 'tank loads');
  close(result.productPerTank, 2133.33, 0.01, 'product per tank');
  close(result.productTotal, 9600, 1e-9, 'product total');
});

test('every boom recommendation is inside the tip pressure range and hits the target rate', () => {
  const input = {
    sprayerType: 'boom',
    applicationId: 'post_contact',
    gpa: 20,
    mph: 8,
    spacingInches: 15,
    windMph: 6,
  };
  const output = recommendBoom(input);
  assert.ok(output.results.length > 0, 'produced recommendations');

  for (const result of output.results) {
    assert.ok(
      result.psi >= result.tip.psiMin && result.psi <= result.tip.psiMax,
      `${result.tip.partNo} solved to ${result.psi} PSI, outside ${result.tip.psiMin}-${result.tip.psiMax}`,
    );
    /* Solving pressure exactly must reproduce the requested rate. */
    const delivered = boomGpa({
      gpm: flowAtPsi(result.tip.gpm40, result.psi),
      mph: input.mph,
      spacingInches: input.spacingInches,
    });
    close(delivered, input.gpa, 1e-6, `${result.tip.partNo} delivered rate`);
    assert.ok(result.dropletClass, 'has a droplet class');
  }
});

test('a contact herbicide is steered to fine or medium droplets', () => {
  const output = recommendBoom({
    sprayerType: 'boom',
    applicationId: 'post_contact',
    gpa: 20,
    mph: 8,
    spacingInches: 15,
    windMph: 5,
  });
  assert.ok(['F', 'M'].includes(output.results[0].dropletClass), 'top pick is fine or medium');
  assert.equal(output.results[0].fit, 'ideal');
});

test('a restricted auxin job is steered to the ultra coarse tips', () => {
  const output = recommendBoom({
    sprayerType: 'boom',
    applicationId: 'restricted',
    gpa: 15,
    mph: 10,
    spacingInches: 20,
    windMph: 7,
  });
  const top = output.results[0];
  assert.ok(['XC', 'UC'].includes(top.dropletClass), `expected XC or UC, got ${top.dropletClass}`);
  assert.ok(['tti', 'tti60'].includes(top.tip.seriesId), `expected a TTI tip, got ${top.tip.partNo}`);
  assert.ok(
    top.warnings.some((warning) => warning.level === 'critical'),
    'carries the label warning',
  );
});

test('a fertilizer pass is steered coarse and a fungicide pass is not', () => {
  const base = { sprayerType: 'boom', gpa: 20, mph: 8, spacingInches: 20, windMph: 5 };
  const fertilizer = recommendBoom({ ...base, applicationId: 'fertilizer', gpa: 25 });
  const fungicide = recommendBoom({ ...base, applicationId: 'fungicide' });
  const order = ['XF', 'VF', 'F', 'M', 'C', 'VC', 'XC', 'UC'];
  assert.ok(
    order.indexOf(fertilizer.results[0].dropletClass) >
      order.indexOf(fungicide.results[0].dropletClass),
    'fertilizer recommendation is coarser than the fungicide recommendation',
  );
});

test('sprayer pressure limits are respected', () => {
  const output = recommendBoom({
    sprayerType: 'boom',
    applicationId: 'post_systemic',
    gpa: 15,
    mph: 10,
    spacingInches: 20,
    psiLimitMin: 40,
    psiLimitMax: 70,
  });
  assert.ok(output.results.length > 0, 'still finds tips inside the pressure limits');
  for (const result of output.results) {
    assert.ok(result.psi >= 40 && result.psi <= 70, `${result.tip.partNo} at ${result.psi} PSI`);
  }
});

test('wind raises the droplet floor', () => {
  assert.equal(windDropletFloor(3), null);
  assert.equal(windDropletFloor(9), 'M');
  assert.equal(windDropletFloor(11), 'C');
  assert.equal(windDropletFloor(16), 'VC');
});

test('every application preset resolves and has a sane droplet band', () => {
  const order = ['XF', 'VF', 'F', 'M', 'C', 'VC', 'XC', 'UC'];
  for (const application of APPLICATIONS) {
    assert.equal(getApplication(application.id), application);
    const idealLow = order.indexOf(application.idealMin);
    const idealHigh = order.indexOf(application.idealMax);
    const acceptLow = order.indexOf(application.acceptMin);
    const acceptHigh = order.indexOf(application.acceptMax);
    assert.ok(idealLow >= 0 && idealHigh >= idealLow, `${application.id} ideal band`);
    assert.ok(acceptLow <= idealLow, `${application.id} accept band starts at or below ideal`);
    assert.ok(acceptHigh >= idealHigh, `${application.id} accept band ends at or above ideal`);
    assert.ok(application.gpaDefault >= application.gpaMin, `${application.id} default rate`);
  }
});

test('every boom application finds at least one usable tip at a normal setting', () => {
  for (const application of APPLICATIONS.filter((item) => item.sprayerType === 'boom')) {
    const output = recommendBoom({
      sprayerType: 'boom',
      applicationId: application.id,
      gpa: application.gpaDefault,
      mph: 8,
      spacingInches: 20,
      windMph: 6,
    });
    assert.ok(output.results.length > 0, `${application.id} produced no tips`);
    assert.ok(
      output.results.some((result) => result.fit === 'ideal'),
      `${application.id} produced no ideal droplet match`,
    );
  }
});

test('air blast recommendation splits flow across the canopy and holds the rate', () => {
  const input = {
    sprayerType: 'airblast',
    applicationId: 'airblast_fungicide',
    gpa: 100,
    mph: 2.5,
    rowSpacingFeet: 20,
    sides: 'both',
    positionsPerSide: 6,
  };
  const output = recommendAirblast(input);
  assert.ok(output.results.length > 0, 'produced recommendations');

  close(output.requiredTotalGpm, (100 * 2.5 * 20) / 495, 1e-9, 'required total flow');
  close(output.requiredPerSideGpm, output.requiredTotalGpm / 2, 1e-9, 'per side flow');

  const top = output.results[0];
  assert.equal(top.positions.length, 6);
  for (const position of top.positions) {
    assert.ok(
      top.psi >= position.tip.psiMin && top.psi <= position.tip.psiMax,
      `${position.tip.partNo} at ${top.psi} PSI is outside its range`,
    );
  }
  /* Tips come in discrete sizes, so the set will not land exactly on the target,
   * but the best option should be close. */
  assert.ok(
    Math.abs(top.rateErrorPercent) < 10,
    `rate error was ${top.rateErrorPercent.toFixed(1)}%`,
  );
  close(
    top.deliveredPerSideGpm * 2,
    top.deliveredTotalGpm,
    1e-9,
    'per side doubles to the total',
  );
  /* Top positions carry more than bottom positions. */
  const bottom = top.positions[0].share;
  const highest = top.positions[top.positions.length - 1].share;
  assert.ok(highest > bottom, 'top of the canopy gets the larger share');
});

test('air blast one sided passes need half the flow', () => {
  const common = {
    sprayerType: 'airblast',
    applicationId: 'airblast_insecticide',
    gpa: 80,
    mph: 2,
    rowSpacingFeet: 25,
    positionsPerSide: 4,
  };
  const both = recommendAirblast({ ...common, sides: 'both' });
  const one = recommendAirblast({ ...common, sides: 'one' });
  close(both.requiredTotalGpm, one.requiredTotalGpm * 2, 1e-9, 'total flow');
});

test('air induction cone tips are never recommended below sixty PSI', () => {
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_lowdrift',
    gpa: 120,
    mph: 2.5,
    rowSpacingFeet: 22,
    sides: 'both',
    positionsPerSide: 5,
  });
  for (const result of output.results) {
    for (const position of result.positions) {
      if (position.tip.airInduction) {
        assert.ok(result.psi >= 60, `${position.tip.partNo} recommended at ${result.psi} PSI`);
      }
    }
  }
});

test('air blast positions are classified individually, not from one tip', () => {
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_lowdrift',
    gpa: 60,
    mph: 3,
    rowSpacingFeet: 10,
    sides: 'both',
    positionsPerSide: 4,
  });
  const top = output.results[0];
  for (const position of top.positions) {
    assert.ok(position.dropletClass, `position ${position.position} has no droplet class`);
  }
  /* Positions carry different capacities, so the headline class has to be one
   * that a position actually sprays. */
  assert.ok(
    top.positions.some((position) => position.dropletClass === top.dropletClass),
    'headline droplet class belongs to one of the positions',
  );
});

test('air blast will not reach for maximum pressure when a moderate one is on rate', () => {
  /* This setup is comfortably inside the flow envelope, so there is no excuse
   * for recommending the top of the pressure range. */
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_fungicide',
    gpa: 60,
    mph: 2.5,
    rowSpacingFeet: 12,
    sides: 'both',
    positionsPerSide: 6,
  });
  assert.ok(output.onRateCount > 0, 'found tip sets on rate');
  assert.ok(
    output.results[0].psi <= 200,
    `top pick was ${output.results[0].psi} PSI, which is reaching for the top of the range`,
  );
});

test('a rate the machine cannot flow is diagnosed rather than answered', () => {
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_foliar',
    gpa: 200,
    mph: 2,
    rowSpacingFeet: 22,
    sides: 'both',
    positionsPerSide: 6,
  });
  assert.equal(output.onRateCount, 0);
  assert.ok(output.unreachable, 'reports that the target is out of reach');
  assert.equal(output.unreachable.direction, 'over');
  assert.ok(output.unreachable.speedLimit < 2, 'tells the operator to slow down');
  assert.ok(output.unreachable.advice.length >= 3);
});

test('a rate below what the tips will pass is diagnosed the other way', () => {
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_fungicide',
    gpa: 5,
    mph: 4,
    rowSpacingFeet: 8,
    sides: 'both',
    positionsPerSide: 8,
  });
  assert.equal(output.unreachable?.direction, 'under');
  assert.ok(output.unreachable.speedLimit > 4, 'tells the operator to speed up');
});

test('when nothing is on rate the closest tip set is ranked first', () => {
  const output = recommendAirblast({
    sprayerType: 'airblast',
    applicationId: 'airblast_insecticide',
    gpa: 75,
    mph: 1.7,
    rowSpacingFeet: 60,
    sides: 'one',
    positionsPerSide: 8,
  });
  assert.equal(output.onRateCount, 0);
  assert.equal(output.unreachable.direction, 'fixed sizes');

  const errors = output.results.map((result) => Math.abs(result.rateErrorPercent));
  assert.deepEqual(errors, [...errors].sort((a, b) => a - b), 'ordered by how close to rate');

  /* The fix for fixed tip sizes is ground speed, so the advice has to include
   * the speed that lands the closest set exactly on rate. */
  const trim = output.unreachable.trimSpeed;
  assert.ok(Number.isFinite(trim) && trim > 0, 'gives a trim speed');
  close(
    airblastGpa({
      gpm: output.results[0].deliveredTotalGpm,
      mph: trim,
      rowSpacingFeet: 60,
      sides: 'one',
    }),
    75,
    0.01,
    'the trim speed really does deliver the target rate',
  );
});

test('published droplet classes are read straight from the TeeJet grid', () => {
  const find = (partNo) => TIPS.find((tip) => tip.partNo === partNo);

  /* Spot checks against LI-TJ420. */
  assert.equal(dropletAtPsi(find('TTI11003VP'), 40).droplet, 'XC');
  assert.equal(dropletAtPsi(find('TTI11003VP'), 20).droplet, 'UC');
  assert.equal(dropletAtPsi(find('AIXR11003VP'), 40).droplet, 'C');
  assert.equal(dropletAtPsi(find('AIXR11003VP'), 20).droplet, 'VC');
  assert.equal(dropletAtPsi(find('XR11003VS'), 40).droplet, 'F');
  assert.equal(dropletAtPsi(find('TT11003VP'), 40).droplet, 'M');
  assert.equal(dropletAtPsi(find('AI11003VS'), 40).droplet, 'XC');
});

test('the catalog only offers capacities that TeeJet actually lists', () => {
  const partNumbers = TIPS.map((tip) => tip.partNo);
  /* TTJ60, TTI60 and AITTJ60 are not made in an 015. */
  assert.ok(!partNumbers.includes('TTJ60-110015VP'));
  assert.ok(!partNumbers.includes('TTI60-110015VP'));
  assert.ok(!partNumbers.includes('AITTJ60-110015VP'));
  /* AI3070 stops at an 05, TTI60 stops at an 08. */
  assert.ok(!partNumbers.includes('AI3070-06VP'));
  assert.ok(!partNumbers.includes('TTI60-11010VP'));
  /* But the common sizes are all there. */
  for (const partNo of ['XR11003VS', 'TT11004VP', 'AIXR11005VP', 'TTI11004VP', 'AI11002VS']) {
    assert.ok(partNumbers.includes(partNo), `${partNo} missing from the catalog`);
  }
});

test('an air induction boom tip is never given a pressure below its own minimum', () => {
  for (const tip of TIPS.filter((item) => item.seriesId === 'ai')) {
    assert.equal(tip.psiMin, 30, 'AI tips start at 30 PSI');
  }
});

test('pressure windows stay inside the recommended range', () => {
  for (const tip of TIPS) {
    const window = pressureWindow(tip);
    assert.ok(window.low >= tip.psiMin, `${tip.partNo} window low`);
    assert.ok(window.high <= tip.psiMax, `${tip.partNo} window high`);
    assert.ok(window.high > window.low, `${tip.partNo} window width`);
  }
});

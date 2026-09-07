/*
 * TeeJet spray tip catalog.
 *
 * Data sources (all TeeJet published literature):
 *   - Droplet size grid for boom tips: TeeJet LI-TJ420, "Droplet Size Data Based on
 *     ISO 25358 Standard", 15" tip spacing tank sticker (2022).
 *   - Air blast / directed cone tips: TeeJet CAT52-US section 06, "Air Blast Nozzles".
 *   - Pressure ranges: the recommended pressure range published for each series.
 *
 * Two conventions that the whole calculator relies on:
 *   1. A TeeJet capacity number is the tip's flow in US GPM at 40 PSI. So an 11003
 *      flows 0.30 GPM at 40 PSI, and TXA8002 flows 0.20 GPM at 40 PSI.
 *   2. Flow scales with the square root of pressure, so flow at any pressure is
 *      derived rather than stored. Four times the pressure gives twice the flow.
 */

export const DROPLET_CLASSES = ['XF', 'VF', 'F', 'M', 'C', 'VC', 'XC', 'UC'];

export const DROPLET_NAMES = {
  XF: 'Extremely Fine',
  VF: 'Very Fine',
  F: 'Fine',
  M: 'Medium',
  C: 'Coarse',
  VC: 'Very Coarse',
  XC: 'Extremely Coarse',
  UC: 'Ultra Coarse',
};

/* ISO / ASABE colour code for each droplet class, used for the result badges. */
export const DROPLET_COLORS = {
  XF: '#9b5de5',
  VF: '#e5484d',
  F: '#f2820d',
  M: '#f5c000',
  C: '#3aa657',
  VC: '#2f7fd1',
  XC: '#8a6fd1',
  UC: '#7a5c3e',
};

export const NOMINAL_GPM = {
  '015': 0.15,
  '02': 0.2,
  '025': 0.25,
  '03': 0.3,
  '04': 0.4,
  '05': 0.5,
  '06': 0.6,
  '08': 0.8,
  '10': 1.0,
};

const BOOM_SIZES = ['015', '02', '025', '03', '04', '05', '06', '08', '10'];
const BOOM_PSI_STEPS = [20, 30, 40, 50, 60, 70, 80, 90];

/*
 * Column order of the LI-TJ420 droplet grid. A dash means TeeJet does not offer
 * that capacity in that series, or the pressure is outside the series range.
 */
const GRID_COLUMNS = ['xr', 'tt', 'ttj60', 'aixr', 'ai3070', 'aittj60', 'ai', 'tti60', 'tti'];

const DROPLET_GRID = {
  '015': {
    20: 'F  VC -  VC XC -  -  -  UC',
    30: 'F  C  -  C  VC -  XC -  UC',
    40: 'F  M  -  C  VC -  XC -  XC',
    50: 'F  M  -  M  C  -  VC -  XC',
    60: 'F  M  -  M  C  -  VC -  XC',
    70: '-  M  -  M  M  -  VC -  VC',
    80: '-  F  -  M  M  -  C  -  VC',
    90: '-  F  -  M  M  -  C  -  VC',
  },
  '02': {
    20: 'M  VC C  VC XC XC -  UC UC',
    30: 'F  C  C  VC VC VC XC XC UC',
    40: 'F  M  M  C  VC VC XC XC XC',
    50: 'F  M  M  M  C  C  VC VC XC',
    60: 'F  M  M  M  C  C  VC VC XC',
    70: '-  M  M  M  M  C  VC VC VC',
    80: '-  F  M  M  M  C  C  C  VC',
    90: '-  F  M  M  M  M  C  C  VC',
  },
  '025': {
    20: 'M  VC VC VC XC XC -  UC UC',
    30: 'M  C  C  VC VC VC XC XC UC',
    40: 'F  M  M  C  VC VC XC XC XC',
    50: 'F  M  M  M  C  VC VC VC XC',
    60: 'F  M  M  M  C  C  VC VC XC',
    70: '-  M  M  M  C  C  VC VC VC',
    80: '-  F  M  M  M  C  C  C  VC',
    90: '-  F  M  M  M  C  C  C  VC',
  },
  '03': {
    20: 'M  VC VC VC XC XC -  UC UC',
    30: 'M  C  C  VC VC XC XC XC UC',
    40: 'F  M  C  C  VC VC XC XC XC',
    50: 'F  M  M  C  VC VC VC XC XC',
    60: 'F  M  M  M  C  C  VC XC XC',
    70: '-  M  M  M  C  C  VC VC VC',
    80: '-  F  M  M  C  C  C  VC VC',
    90: '-  F  M  M  M  C  C  VC VC',
  },
  '04': {
    20: 'M  VC VC VC XC XC -  UC UC',
    30: 'M  C  C  VC XC XC XC UC UC',
    40: 'M  M  C  C  VC VC XC XC XC',
    50: 'F  M  M  C  VC VC VC XC XC',
    60: 'F  M  M  C  C  C  VC XC XC',
    70: '-  M  M  M  C  C  VC VC VC',
    80: '-  F  M  M  C  C  C  VC VC',
    90: '-  F  M  M  C  C  C  VC VC',
  },
  '05': {
    20: 'M  VC VC XC UC UC -  UC UC',
    30: 'M  C  C  VC XC XC XC UC UC',
    40: 'M  M  C  VC VC VC XC XC XC',
    50: 'F  M  M  C  VC VC VC XC XC',
    60: 'F  M  M  C  VC C  VC XC XC',
    70: '-  M  M  C  C  C  VC VC VC',
    80: '-  F  M  M  C  C  VC VC VC',
    90: '-  F  M  M  C  C  C  VC VC',
  },
  '06': {
    20: 'M  VC VC XC -  UC -  UC UC',
    30: 'M  C  C  VC -  XC XC UC UC',
    40: 'M  M  C  VC -  VC XC XC XC',
    50: 'M  M  M  VC -  VC VC XC XC',
    60: 'M  M  M  C  -  VC VC XC VC',
    70: '-  M  M  C  -  C  VC VC VC',
    80: '-  F  M  C  -  C  VC VC VC',
    90: '-  F  M  C  -  C  C  VC VC',
  },
  '08': {
    20: 'M  VC VC XC -  UC -  UC UC',
    30: 'M  VC C  XC -  XC XC UC UC',
    40: 'M  M  C  VC -  XC XC XC XC',
    50: 'M  M  M  VC -  XC XC XC XC',
    60: 'M  M  M  VC -  VC VC XC VC',
    70: '-  M  M  C  -  VC VC VC VC',
    80: '-  M  M  C  -  VC VC VC VC',
    90: '-  F  M  C  -  VC VC VC VC',
  },
  '10': {
    20: 'C  XC VC UC -  UC -  -  UC',
    30: 'C  VC C  XC -  XC UC -  UC',
    40: 'M  VC C  VC -  XC XC -  XC',
    50: 'M  C  C  VC -  XC XC -  XC',
    60: 'M  C  M  VC -  VC XC -  VC',
    70: '-  C  M  VC -  VC VC -  VC',
    80: '-  M  M  C  -  VC VC -  VC',
    90: '-  M  M  C  -  VC VC -  VC',
  },
};

/*
 * Series metadata. driftClass is a four step tier derived from whether the tip
 * uses air induction and a pre-orifice; it is only used to break ties once the
 * published droplet class has already been matched.
 */
const BOOM_SERIES_META = {
  xr: {
    name: 'XR TeeJet',
    partPattern: 'XR110{size}VS',
    psiMin: 15,
    psiMax: 60,
    driftClass: 'none',
    twinFan: false,
    airInduction: false,
    preOrifice: false,
    summary: 'Standard extended range flat fan. Finest droplets of the boom tips, so the best raw coverage and the least drift protection.',
  },
  tt: {
    name: 'TT TeeJet (Turbo TeeJet)',
    partPattern: 'TT110{size}VP',
    psiMin: 15,
    psiMax: 90,
    driftClass: 'moderate',
    twinFan: false,
    airInduction: false,
    preOrifice: true,
    summary: 'Pre-orifice turbo flat fan. Wide pressure range and a very forgiving pattern, medium to coarse through most of its range.',
  },
  ttj60: {
    name: 'TTJ60 TeeJet (Turbo TwinJet)',
    partPattern: 'TTJ60-110{size}VP',
    psiMin: 20,
    psiMax: 90,
    driftClass: 'moderate',
    twinFan: true,
    airInduction: false,
    preOrifice: true,
    summary: 'Twin forward and backward turbo fans. Hits the target from two angles, which is why it is a common fungicide and cereal tip.',
  },
  aixr: {
    name: 'AIXR TeeJet',
    partPattern: 'AIXR110{size}VP',
    psiMin: 15,
    psiMax: 90,
    psiOptMin: 45,
    psiOptMax: 60,
    driftClass: 'high',
    twinFan: false,
    airInduction: true,
    preOrifice: true,
    summary: 'Air induction extended range. The all-round workhorse: up to 90% drift reduction while still covering well. TeeJet publishes an optimum window of 45 to 60 PSI.',
  },
  ai3070: {
    name: 'AI3070 TeeJet',
    partPattern: 'AI3070-{size}VP',
    psiMin: 20,
    psiMax: 90,
    driftClass: 'high',
    twinFan: true,
    airInduction: true,
    preOrifice: true,
    summary: 'Air induction twin fan with 30 and 70 degree offsets. Built for canopy penetration and coverage while staying coarse.',
  },
  aittj60: {
    name: 'AITTJ60 TeeJet',
    partPattern: 'AITTJ60-110{size}VP',
    psiMin: 20,
    psiMax: 90,
    driftClass: 'high',
    twinFan: true,
    airInduction: true,
    preOrifice: true,
    summary: 'Air induction turbo twin fan. Twin pattern coverage with air induction drift control.',
  },
  ai: {
    name: 'AI / AIC TeeJet',
    partPattern: 'AI110{size}VS',
    psiMin: 30,
    psiMax: 115,
    driftClass: 'high',
    twinFan: false,
    airInduction: true,
    preOrifice: true,
    summary: 'Air induction flat fan. Needs at least 30 PSI to draw air properly and runs coarse to extremely coarse.',
  },
  tti60: {
    name: 'TTI60 TeeJet (Turbo TeeJet Induction twin)',
    partPattern: 'TTI60-110{size}VP',
    psiMin: 20,
    psiMax: 100,
    driftClass: 'max',
    twinFan: true,
    airInduction: true,
    preOrifice: true,
    summary: 'Ultra coarse twin fan. Maximum drift control with the coverage benefit of a twin pattern.',
  },
  tti: {
    name: 'TTI TeeJet (Turbo TeeJet Induction)',
    partPattern: 'TTI110{size}VP',
    psiMin: 15,
    psiMax: 100,
    driftClass: 'max',
    twinFan: false,
    airInduction: true,
    preOrifice: true,
    summary: 'The coarsest boom tip TeeJet builds and the usual reference tip on restricted auxin labels. Ultra coarse over most of its range.',
  },
};

/*
 * Air blast and directed cone tips, from CAT52-US section 06.
 * Flow is again nominal GPM at 40 PSI so the square root rule applies, but the
 * published droplet grids are keyed to their own pressure steps.
 */
const CONE_PSI_STEPS = [30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
const AI_CONE_PSI_STEPS = [60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];

const CONE_SERIES_META = {
  txa: {
    name: 'TXA / TXB ConeJet',
    partPattern: 'TXA80{size}VK',
    psiMin: 30,
    psiMax: 300,
    sprayAngle: '80 degrees at 100 PSI',
    driftClass: 'none',
    airInduction: false,
    summary: 'Ceramic hollow cone, the standard air blast tip. Finely atomized for thorough coverage of fungicides, insecticides and foliar feed.',
    sizes: {
      '0050': 0.05,
      '0067': 0.067,
      '01': 0.1,
      '015': 0.15,
      '02': 0.2,
      '03': 0.3,
      '04': 0.4,
    },
    /* TeeJet publishes VF across the tabulated range, with F at the 30 PSI floor
     * for the two largest capacities. */
    droplets: {
      '0050': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '0067': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '01': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '015': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '02': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '03': 'VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
      '04': 'F  VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF VF',
    },
    psiSteps: CONE_PSI_STEPS,
  },
  aitxa: {
    name: 'AITXA / AITXB ConeJet',
    partPattern: 'AITXA80{size}VK',
    psiMin: 60,
    psiMax: 300,
    sprayAngle: '80 degree hollow cone',
    driftClass: 'high',
    airInduction: true,
    summary: 'Air induction hollow cone. A venturi coarsens the spray compared with a plain TX cone, which cuts drift and pushes spray further into the canopy.',
    sizes: {
      '01': 0.1,
      '015': 0.15,
      '02': 0.2,
      '025': 0.25,
      '03': 0.3,
      '04': 0.4,
    },
    droplets: {
      '01': 'XC VC VC VC VC C  C  M  M  M  F  F  F  F  F',
      '015': 'XC VC VC VC VC C  C  M  M  M  F  F  F  F  F',
      '02': 'XC VC VC VC VC C  C  C  C  M  M  M  M  F  F',
      '025': 'XC XC XC XC VC VC VC VC C  M  M  M  M  F  F',
      '03': 'XC XC XC XC VC VC VC VC C  M  M  M  M  F  F',
      '04': 'UC UC XC XC VC VC VC VC C  C  M  M  M  M  M',
    },
    psiSteps: AI_CONE_PSI_STEPS,
  },
};

function parseRow(row) {
  return row.trim().split(/\s+/);
}

function buildBoomTips() {
  const tips = [];
  for (const [seriesId, meta] of Object.entries(BOOM_SERIES_META)) {
    const column = GRID_COLUMNS.indexOf(seriesId);
    for (const size of BOOM_SIZES) {
      const droplets = {};
      let offered = false;
      for (const psi of BOOM_PSI_STEPS) {
        const value = parseRow(DROPLET_GRID[size][psi])[column];
        if (value && value !== '-') {
          droplets[psi] = value;
          offered = true;
        }
      }
      if (!offered) continue;
      tips.push({
        id: `${seriesId}-${size}`,
        seriesId,
        seriesName: meta.name,
        sprayerType: 'boom',
        size,
        gpm40: NOMINAL_GPM[size],
        partNo: meta.partPattern.replace('{size}', size),
        psiMin: meta.psiMin,
        psiMax: meta.psiMax,
        psiOptMin: meta.psiOptMin,
        psiOptMax: meta.psiOptMax,
        driftClass: meta.driftClass,
        twinFan: meta.twinFan,
        airInduction: meta.airInduction,
        preOrifice: meta.preOrifice,
        summary: meta.summary,
        droplets,
        dropletPsiSteps: Object.keys(droplets).map(Number),
      });
    }
  }
  return tips;
}

function buildConeTips() {
  const tips = [];
  for (const [seriesId, meta] of Object.entries(CONE_SERIES_META)) {
    for (const [size, gpm40] of Object.entries(meta.sizes)) {
      const classes = parseRow(meta.droplets[size]);
      const droplets = {};
      meta.psiSteps.forEach((psi, index) => {
        const value = classes[index];
        if (value && value !== '-') droplets[psi] = value;
      });
      tips.push({
        id: `${seriesId}-${size}`,
        seriesId,
        seriesName: meta.name,
        sprayerType: 'airblast',
        size,
        gpm40,
        partNo: meta.partPattern.replace('{size}', size),
        psiMin: meta.psiMin,
        psiMax: meta.psiMax,
        driftClass: meta.driftClass,
        twinFan: false,
        airInduction: meta.airInduction,
        preOrifice: meta.airInduction,
        sprayAngle: meta.sprayAngle,
        summary: meta.summary,
        droplets,
        dropletPsiSteps: Object.keys(droplets).map(Number),
      });
    }
  }
  return tips;
}

export const TIPS = [...buildBoomTips(), ...buildConeTips()];

export const SERIES = { ...BOOM_SERIES_META, ...CONE_SERIES_META };

/* Flow in GPM at any pressure. Flow varies with the square root of pressure. */
export function flowAtPsi(gpm40, psi) {
  return gpm40 * Math.sqrt(psi / 40);
}

/* Pressure needed to make a tip deliver a given flow. Inverse of flowAtPsi. */
export function psiForFlow(gpm40, gpm) {
  return 40 * (gpm / gpm40) ** 2;
}

/*
 * Droplet class at an arbitrary pressure. TeeJet publishes classes at fixed
 * pressure steps, so the nearest published step is used and the caller is told
 * which step the answer actually came from.
 *
 * The charted steps are ten PSI or more apart, so landing within a few PSI of a
 * step is that step for practical purposes and is not worth qualifying. Only a
 * genuine gap between charted pressures gets flagged.
 */
const CHART_STEP_TOLERANCE = 3;

export function dropletAtPsi(tip, psi) {
  const steps = tip.dropletPsiSteps;
  if (!steps.length) return { droplet: null, fromPsi: null, exact: false };
  let best = steps[0];
  for (const step of steps) {
    if (Math.abs(step - psi) < Math.abs(best - psi)) best = step;
  }
  return {
    droplet: tip.droplets[best],
    fromPsi: best,
    exact: Math.abs(best - psi) <= CHART_STEP_TOLERANCE,
  };
}

export function dropletIndex(droplet) {
  return DROPLET_CLASSES.indexOf(droplet);
}

export function isCoarserOrEqual(droplet, floor) {
  return dropletIndex(droplet) >= dropletIndex(floor);
}

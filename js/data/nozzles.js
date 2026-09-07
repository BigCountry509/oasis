/*
 * TeeJet spray tip catalog.
 *
 * Data sources (all TeeJet published literature):
 *   - Droplet size grid for boom flat fans: TeeJet LI-TJ420, "Droplet Size Data
 *     Based on ISO 25358 Standard", 15" tip spacing tank sticker (2022).
 *   - DG TeeJet and Turbo FloodJet: the droplet size and application rate tables
 *     on their TeeJet product pages, also ISO 25358.
 *   - StreamJet SJ3 and SJ7A: TeeJet CAT52-US section 07, "Fertilizer Nozzles".
 *   - Air blast / directed cone tips and the disc-core reference tables:
 *     TeeJet CAT52-US section 06, "Air Blast Nozzles".
 *   - Pressure ranges: the recommended pressure range published for each series.
 *
 * Two conventions that the whole calculator relies on:
 *   1. A TeeJet capacity number is the tip's flow in US GPM at 40 PSI. So an 11003
 *      flows 0.30 GPM at 40 PSI, and TXA8002 flows 0.20 GPM at 40 PSI.
 *   2. Flow scales with the square root of pressure, so flow at any pressure is
 *      derived rather than stored. Four times the pressure gives twice the flow.
 *
 * The streamer bars are the exception to the second rule: TeeJet's published
 * capacities for them do not follow the square root law, so those tips carry
 * their printed flow table and are interpolated inside it instead.
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
 * Families that do not share the LI-TJ420 grid because they are charted at their
 * own pressures and their own capacity numbers.
 *
 * DG is a pre-orifice flat fan charted from 30 to 60 PSI; the classes below are
 * the 110 degree column. Turbo FloodJet is a wide angle flooding tip charted
 * from 10 to 40 PSI; the classes below are the VP polymer column, which reads a
 * step finer than the stainless one at the top of the range.
 *
 * A flooding tip's capacity number is its flow at 10 PSI in tenths of a GPM, not
 * at 40 PSI, so a TF-2 is 0.40 GPM at 40 PSI rather than 0.20.
 */
const FAN_SERIES_META = {
  dg: {
    name: 'DG TeeJet (Drift Guard)',
    partPattern: 'DG110{size}VS',
    pattern: 'fan',
    psiMin: 30,
    psiMax: 60,
    driftClass: 'moderate',
    airInduction: false,
    preOrifice: true,
    summary:
      'Pre-orifice flat fan with a tapered edge pattern. Coarse at 30 PSI and medium above 40, which suits soil applied and systemic products. Needs 30 PSI as a floor.',
    sizes: { '015': 0.15, '02': 0.2, '03': 0.3, '04': 0.4, '05': 0.5 },
    dropletSteps: [30, 35, 40, 50, 60],
    droplets: {
      '015': 'M  M  M  M  F',
      '02': 'C  C  M  M  M',
      '03': 'C  C  M  M  M',
      '04': 'C  C  M  M  M',
      '05': 'C  C  C  M  M',
    },
  },
  tf: {
    name: 'TF Turbo FloodJet',
    partPattern: 'TF-VP{size}',
    pattern: 'flood',
    psiMin: 10,
    psiMax: 40,
    driftClass: 'high',
    airInduction: false,
    preOrifice: true,
    sprayAngle: '130 degree wide angle flood',
    summary:
      'Wide angle flooding tip with a pre-orifice. The traditional fertilizer and soil applied herbicide tip: very coarse to ultra coarse, and a big round orifice that does not plug easily.',
    sizes: { '2': 0.4, '2.5': 0.5, '3': 0.6, '4': 0.8, '5': 1.0, '7.5': 1.5, '10': 2.0 },
    dropletSteps: [10, 20, 30, 40],
    droplets: {
      '2': 'UC XC VC C',
      '2.5': 'UC XC VC C',
      '3': 'UC XC VC VC',
      '4': 'UC UC XC VC',
      '5': 'UC UC XC VC',
      '7.5': 'UC UC XC VC',
      '10': 'UC UC XC VC',
    },
  },
};

/*
 * Streamer bars. These put out solid streams rather than a spray, so TeeJet
 * publishes no droplet classification for them at all: there is nothing to
 * classify, and drift is close to nil. They are the standard way to put liquid
 * fertilizer on without burning a standing crop.
 *
 * Their published capacities do not follow the square root law, so the printed
 * table is stored and interpolated rather than derived from the 40 PSI figure.
 */
const STREAM_PSI_STEPS = [20, 30, 40, 50, 60];

const STREAM_SERIES_META = {
  sj3: {
    name: 'StreamJet SJ3',
    partPattern: 'SJ3-{size}-VP',
    pattern: 'stream',
    streams: 3,
    psiMin: 20,
    psiMax: 60,
    driftClass: 'max',
    summary:
      'Three solid streams of equal capacity, aimed between the rows. Built for liquid fertilizer: almost no drift and far less leaf burn than a spray, because the liquid lands in bands instead of coating the plant.',
    flowSteps: STREAM_PSI_STEPS,
    flows: {
      '015': [0.11, 0.13, 0.15, 0.16, 0.17],
      '02': [0.14, 0.17, 0.2, 0.21, 0.22],
      '03': [0.24, 0.27, 0.3, 0.33, 0.35],
      '04': [0.3, 0.36, 0.4, 0.43, 0.47],
      '05': [0.36, 0.45, 0.5, 0.55, 0.59],
      '06': [0.42, 0.54, 0.6, 0.66, 0.7],
      '08': [0.56, 0.72, 0.8, 0.88, 0.94],
      '10': [0.65, 0.9, 1.0, 1.11, 1.19],
      '15': [0.99, 1.24, 1.5, 1.68, 1.83],
      '20': [1.41, 1.75, 2.0, 2.28, 2.49],
    },
  },
  sj7: {
    name: 'StreamJet SJ7A',
    partPattern: 'SJ7A-{size}-VP',
    pattern: 'stream',
    streams: 7,
    psiMin: 20,
    psiMax: 60,
    driftClass: 'max',
    summary:
      'Seven solid streams from one tip, spaced for broadcast rather than directed work. Same drift and burn advantage as the SJ3 with a more even spread across the boom.',
    flowSteps: STREAM_PSI_STEPS,
    flows: {
      '015': [0.1, 0.12, 0.15, 0.16, 0.18],
      '02': [0.14, 0.17, 0.2, 0.23, 0.25],
      '03': [0.22, 0.27, 0.3, 0.33, 0.35],
      '04': [0.3, 0.35, 0.4, 0.43, 0.46],
      '05': [0.38, 0.45, 0.5, 0.54, 0.58],
      '06': [0.45, 0.54, 0.6, 0.65, 0.7],
      '08': [0.57, 0.72, 0.8, 0.87, 0.93],
      '10': [0.71, 0.9, 1.0, 1.09, 1.16],
      '15': [1.03, 1.29, 1.5, 1.64, 1.76],
    },
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
        pattern: 'fan',
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

/*
 * Sizes are listed smallest first everywhere they are shown, and a size like
 * '10' would otherwise sort ahead of '015' because JavaScript reorders keys
 * that look like integers.
 */
function bySize(sizes, capacity) {
  return Object.entries(sizes).sort((a, b) => capacity(a[1]) - capacity(b[1]));
}

/* DG and Turbo FloodJet: own capacities, own charted pressures, still droplets. */
function buildFanSeriesTips() {
  const tips = [];
  for (const [seriesId, meta] of Object.entries(FAN_SERIES_META)) {
    for (const [size, gpm40] of bySize(meta.sizes, (value) => value)) {
      const classes = parseRow(meta.droplets[size]);
      const droplets = {};
      meta.dropletSteps.forEach((psi, index) => {
        const value = classes[index];
        if (value && value !== '-') droplets[psi] = value;
      });
      tips.push({
        id: `${seriesId}-${size}`,
        seriesId,
        seriesName: meta.name,
        sprayerType: 'boom',
        pattern: meta.pattern,
        size,
        gpm40,
        partNo: meta.partPattern.replace('{size}', size),
        psiMin: meta.psiMin,
        psiMax: meta.psiMax,
        driftClass: meta.driftClass,
        twinFan: false,
        airInduction: meta.airInduction,
        preOrifice: meta.preOrifice,
        sprayAngle: meta.sprayAngle,
        summary: meta.summary,
        droplets,
        dropletPsiSteps: Object.keys(droplets).map(Number),
      });
    }
  }
  return tips;
}

/* Streamer bars: a published flow table, no droplet classes. */
function buildStreamTips() {
  const tips = [];
  for (const [seriesId, meta] of Object.entries(STREAM_SERIES_META)) {
    const at40 = meta.flowSteps.indexOf(40);
    for (const [size, flows] of bySize(meta.flows, (value) => value[at40])) {
      const flowTable = { psi: meta.flowSteps, gpm: flows };
      tips.push({
        id: `${seriesId}-${size}`,
        seriesId,
        seriesName: meta.name,
        sprayerType: 'boom',
        pattern: 'stream',
        streams: meta.streams,
        size,
        gpm40: flows[meta.flowSteps.indexOf(40)],
        flowTable,
        partNo: meta.partPattern.replace('{size}', size),
        psiMin: meta.psiMin,
        psiMax: meta.psiMax,
        driftClass: meta.driftClass,
        twinFan: false,
        airInduction: false,
        preOrifice: false,
        summary: meta.summary,
        droplets: {},
        dropletPsiSteps: [],
      });
    }
  }
  return tips;
}

function buildConeTips() {
  const tips = [];
  for (const [seriesId, meta] of Object.entries(CONE_SERIES_META)) {
    for (const [size, gpm40] of bySize(meta.sizes, (value) => value)) {
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
        pattern: 'cone',
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

/*
 * Disc and core assemblies, CAT52-US section 06. These are the high volume
 * orchard nozzles: an orifice disc and a swirl core in one body, in far larger
 * capacities than the moulded cone tips, and rated to 300 PSI.
 *
 * TeeJet publishes no droplet classification for them, so they are held apart
 * from the tips the calculator recommends and offered as a lookup table instead.
 * Guessing a droplet class for them would be inventing data.
 */
const DISC_CORE_PSI_STEPS = [10, 20, 30, 40, 60, 80, 100, 150, 200, 300];

export const DISC_CORE_SETS = [
  {
    id: 'dc25',
    name: 'D disc with DC25 core',
    pattern: 'hollow cone',
    psiMin: 10,
    psiMax: 300,
    psiSteps: DISC_CORE_PSI_STEPS,
    note: 'Hollow cone. The common mid-range air blast combination.',
    rows: [
      ['D1-DC25', [null, null, 0.088, 0.101, 0.122, 0.138, 0.156, 0.185, 0.21, 0.255]],
      ['D1.5-DC25', [null, null, 0.118, 0.135, 0.162, 0.185, 0.205, 0.245, 0.28, 0.33]],
      ['D2-DC25', [null, 0.12, 0.14, 0.16, 0.19, 0.22, 0.25, 0.29, 0.34, 0.41]],
      ['D3-DC25', [0.1, 0.14, 0.17, 0.19, 0.23, 0.26, 0.29, 0.35, 0.4, 0.48]],
      ['D4-DC25', [0.15, 0.21, 0.25, 0.29, 0.35, 0.4, 0.45, 0.54, 0.62, 0.75]],
      ['D5-DC25', [0.18, 0.25, 0.3, 0.35, 0.42, 0.48, 0.54, 0.65, 0.75, 0.9]],
      ['D6-DC25', [0.23, 0.32, 0.39, 0.44, 0.54, 0.62, 0.7, 0.85, 0.97, 1.19]],
      ['D7-DC25', [0.26, 0.37, 0.45, 0.52, 0.63, 0.73, 0.81, 0.98, 1.18, 1.37]],
      ['D8-DC25', [0.31, 0.43, 0.53, 0.61, 0.75, 0.89, 0.97, 1.19, 1.36, 1.68]],
      ['D10-DC25', [0.38, 0.54, 0.65, 0.76, 0.93, 1.07, 1.21, 1.48, 1.71, 2.1]],
      ['D12-DC25', [0.46, 0.61, 0.8, 0.93, 1.15, 1.32, 1.47, 1.81, 2.09, 2.55]],
      ['D14-DC25', [0.51, 0.72, 0.88, 1.03, 1.26, 1.47, 1.65, 2.02, 2.34, 2.89]],
    ],
  },
  {
    id: 'dc45',
    name: 'D disc with DC45 core',
    pattern: 'hollow cone',
    psiMin: 10,
    psiMax: 300,
    psiSteps: DISC_CORE_PSI_STEPS,
    note: 'Hollow cone with a tighter angle and more capacity than the DC25 for the same disc.',
    rows: [
      ['D1-DC45', [null, null, null, 0.125, 0.148, 0.17, 0.19, 0.225, 0.257, 0.31]],
      ['D1.5-DC45', [null, null, 0.14, 0.16, 0.2, 0.23, 0.25, 0.31, 0.35, 0.43]],
      ['D2-DC45', [null, 0.14, 0.18, 0.2, 0.25, 0.28, 0.32, 0.38, 0.44, 0.53]],
      ['D3-DC45', [null, 0.17, 0.2, 0.23, 0.28, 0.33, 0.36, 0.44, 0.51, 0.62]],
      ['D4-DC45', [0.18, 0.25, 0.31, 0.36, 0.43, 0.5, 0.56, 0.68, 0.78, 0.95]],
      ['D5-DC45', [0.23, 0.32, 0.39, 0.45, 0.55, 0.64, 0.71, 0.86, 0.99, 1.22]],
      ['D6-DC45', [0.29, 0.41, 0.5, 0.58, 0.72, 0.83, 0.93, 1.15, 1.33, 1.64]],
      ['D7-DC45', [0.33, 0.48, 0.59, 0.68, 0.84, 0.97, 1.11, 1.35, 1.57, 1.94]],
      ['D8-DC45', [0.41, 0.59, 0.72, 0.84, 1.04, 1.21, 1.35, 1.68, 1.94, 2.4]],
      ['D10-DC45', [0.54, 0.77, 0.94, 1.1, 1.35, 1.57, 1.77, 2.18, 2.5, 3.1]],
      ['D12-DC45', [0.67, 0.95, 1.17, 1.36, 1.68, 1.95, 2.2, 2.69, 3.11, 3.8]],
      ['D14-DC45', [0.75, 1.07, 1.32, 1.53, 1.89, 2.19, 2.45, 3.0, 3.49, 4.3]],
      ['D16-DC45', [0.86, 1.25, 1.54, 1.79, 2.2, 2.57, 2.89, 3.54, 4.11, 5.2]],
    ],
  },
  {
    id: 'dc56',
    name: 'D disc with DC56 core',
    pattern: 'full cone',
    psiMin: 10,
    psiMax: 300,
    psiSteps: DISC_CORE_PSI_STEPS,
    note: 'Full cone. The largest capacities TeeJet lists for air blast work.',
    rows: [
      ['D2-DC56', [null, null, 0.21, 0.25, 0.3, 0.35, 0.39, 0.47, 0.55, 0.67]],
      ['D3-DC56', [null, null, 0.29, 0.34, 0.41, 0.48, 0.53, 0.65, 0.75, 0.92]],
      ['D4-DC56', [null, 0.39, 0.48, 0.55, 0.67, 0.78, 0.87, 1.06, 1.23, 1.51]],
      ['D5-DC56', [0.38, 0.54, 0.66, 0.76, 0.93, 1.08, 1.2, 1.47, 1.69, 2.08]],
      ['D6-DC56', [0.55, 0.78, 0.95, 1.1, 1.35, 1.55, 1.74, 2.13, 2.46, 3.02]],
      ['D7-DC56', [0.76, 1.07, 1.32, 1.52, 1.86, 2.15, 2.4, 2.94, 3.4, 4.16]],
      ['D8-DC56', [0.96, 1.36, 1.67, 1.93, 2.36, 2.73, 3.05, 3.73, 4.32, 5.28]],
      ['D10-DC56', [1.35, 1.91, 2.34, 2.7, 3.31, 3.82, 4.26, 5.22, 6.03, 7.39]],
    ],
  },
];

export const TIPS = [
  ...buildBoomTips(),
  ...buildFanSeriesTips(),
  ...buildStreamTips(),
  ...buildConeTips(),
];

export const SERIES = {
  ...BOOM_SERIES_META,
  ...FAN_SERIES_META,
  ...STREAM_SERIES_META,
  ...CONE_SERIES_META,
};

/* Flow in GPM at any pressure. Flow varies with the square root of pressure. */
export function flowAtPsi(gpm40, psi) {
  return gpm40 * Math.sqrt(psi / 40);
}

/* Pressure needed to make a tip deliver a given flow. Inverse of flowAtPsi. */
export function psiForFlow(gpm40, gpm) {
  return 40 * (gpm / gpm40) ** 2;
}

/*
 * A tip with a published flow table is read off that table instead, using a
 * power curve between the two charted pressures either side. Inside a segment
 * that is exact at both ends, which keeps the numbers the calculator shows
 * identical to the ones printed in the catalog.
 */
function segmentFor(value, list) {
  let index = 0;
  while (index < list.length - 2 && value > list[index + 1]) index += 1;
  return index;
}

function curveAt(x0, y0, x1, y1, x) {
  const exponent = Math.log(y1 / y0) / Math.log(x1 / x0);
  return y0 * (x / x0) ** exponent;
}

export function tipFlowAtPsi(tip, psi) {
  const table = tip.flowTable;
  if (!table) return flowAtPsi(tip.gpm40, psi);
  const index = segmentFor(psi, table.psi);
  return curveAt(table.psi[index], table.gpm[index], table.psi[index + 1], table.gpm[index + 1], psi);
}

export function tipPsiForFlow(tip, gpm) {
  const table = tip.flowTable;
  if (!table) return psiForFlow(tip.gpm40, gpm);
  const index = segmentFor(gpm, table.gpm);
  return curveAt(table.gpm[index], table.psi[index], table.gpm[index + 1], table.psi[index + 1], gpm);
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

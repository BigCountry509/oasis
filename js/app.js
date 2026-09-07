/*
 * UI wiring for the nozzle calculator.
 *
 * Everything numeric lives in engine.js and every published tip figure lives in
 * data/nozzles.js. This file only collects inputs, renders results, and hands
 * saved applications to store.js.
 */

import { APPLICATIONS, SPRAYER_TYPES, applicationsFor, getApplication } from './data/applications.js';
import { DROPLET_COLORS, DROPLET_NAMES, SERIES, TIPS, flowAtPsi } from './data/nozzles.js';
import {
  airblastGpa,
  boomTable,
  ozPerMinute,
  pressureWindow,
  recommend,
  tankMath,
  tipWear,
} from './engine.js';
import * as store from './store.js';

/* ---------------- small helpers ---------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return node;
}

const fmt = (value, decimals = 1) =>
  Number.isFinite(value) ? value.toFixed(decimals).replace(/\.0+$/, '') : '-';

const fmtFixed = (value, decimals = 2) => (Number.isFinite(value) ? value.toFixed(decimals) : '-');

function num(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : NaN;
}

const messageTimers = new WeakMap();

function message(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle('is-error', isError);
  clearTimeout(messageTimers.get(node));
  if (text) {
    messageTimers.set(
      node,
      setTimeout(() => {
        node.textContent = '';
        node.classList.remove('is-error');
      }, 8000),
    );
  }
}

/* ---------------- state ---------------- */

const state = {
  sprayerType: 'boom',
  applicationId: 'post_systemic',
  output: null,
  draft: null,
  records: [],
  recordFilter: '',
};

/* ---------------- step 1 and 2: choices ---------------- */

function renderSprayerChoices() {
  const container = $('#sprayer-choices');
  container.replaceChildren(
    ...Object.values(SPRAYER_TYPES).map((type) =>
      el(
        'button',
        {
          type: 'button',
          class: 'choice',
          role: 'radio',
          'aria-checked': String(state.sprayerType === type.id),
          onClick: () => selectSprayer(type.id),
        },
        el('span', { class: 'choice-title', text: type.name }),
        el('span', { class: 'choice-sub', text: type.description }),
      ),
    ),
  );
}

function renderJobChoices() {
  const container = $('#job-choices');
  const jobs = applicationsFor(state.sprayerType);
  if (!jobs.some((job) => job.id === state.applicationId)) {
    state.applicationId = jobs[0].id;
  }
  container.replaceChildren(
    ...jobs.map((job) =>
      el(
        'button',
        {
          type: 'button',
          class: 'choice',
          role: 'radio',
          'aria-checked': String(state.applicationId === job.id),
          onClick: () => selectJob(job.id),
        },
        el('span', { class: 'choice-title', text: job.name }),
        el('span', { class: 'choice-sub', text: job.blurb }),
        job.requiresLabelCheck ? el('span', { class: 'choice-flag', text: 'Label restricted' }) : null,
      ),
    ),
  );
  renderJobNotes();
}

function renderJobNotes() {
  const container = $('#job-notes');
  const job = getApplication(state.applicationId);
  if (!job) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.replaceChildren(
    el(
      'p',
      { class: 'muted', style: 'margin-bottom:.5rem' },
      `Target droplet size: ${dropletRangeText(job)}. Typical carrier volume ${job.gpaTypical[0]} to ${job.gpaTypical[1]} GPA.`,
    ),
    el('ul', {}, ...job.guidance.map((line) => el('li', { text: line }))),
    job.labelLinks
      ? el(
          'p',
          { class: 'label-links' },
          ...job.labelLinks.flatMap((link, index) => [
            index ? ' | ' : '',
            el('a', { href: link.url, target: '_blank', rel: 'noopener', text: link.label }),
          ]),
        )
      : null,
  );
}

function dropletRangeText(job) {
  const low = DROPLET_NAMES[job.idealMin];
  const high = DROPLET_NAMES[job.idealMax];
  return low === high ? low : `${low} to ${high}`;
}

function selectSprayer(id) {
  state.sprayerType = id;
  renderSprayerChoices();
  renderJobChoices();
  syncFormForSprayer();
  applyJobDefaults();
}

function selectJob(id) {
  state.applicationId = id;
  renderJobChoices();
  applyJobDefaults();
}

function applyJobDefaults() {
  const job = getApplication(state.applicationId);
  if (!job) return;
  const gpa = $('#gpa');
  if (!gpa.value || gpa.dataset.auto === 'true') {
    gpa.value = job.gpaDefault;
    gpa.dataset.auto = 'true';
  }
  $('#gpa-hint').textContent = `This job usually runs ${job.gpaTypical[0]} to ${job.gpaTypical[1]} GPA. Below ${job.gpaMin} GPA coverage starts to suffer.`;

  const mph = $('#mph');
  if (!mph.value) {
    mph.value = state.sprayerType === 'airblast' ? 2.5 : 10;
  }
  $('#mph-hint').textContent =
    state.sprayerType === 'airblast'
      ? 'Air blast passes are normally 2 to 3 mph. Faster than that and the air stream cannot clear the canopy.'
      : 'Field speed for this pass.';

  /* Band spraying meters over the band, not the tip spacing. */
  const isBand = job.id === 'band';
  $('#spacing-label').textContent = isBand ? 'Band width' : 'Tip spacing';
  $('#spacing-hint').textContent = isBand
    ? 'The width of the treated band under one tip. The rate you entered is applied over this band.'
    : '15 and 20 inch are the common boom spacings.';

  const spacing = $('#spacing');
  if (!spacing.value) spacing.value = isBand ? 10 : 20;

  const rowSpacing = $('#row-spacing');
  if (state.sprayerType === 'airblast' && !rowSpacing.value) rowSpacing.value = 20;
}

function syncFormForSprayer() {
  const isAirblast = state.sprayerType === 'airblast';
  $$('.boom-only').forEach((node) => {
    node.hidden = isAirblast;
  });
  $$('.airblast-only').forEach((node) => {
    node.hidden = !isAirblast;
  });
  renderSeriesFilter();
}

function renderSeriesFilter() {
  const container = $('#series-filter');
  const relevant = [
    ...new Set(TIPS.filter((tip) => tip.sprayerType === state.sprayerType).map((tip) => tip.seriesId)),
  ];
  const checked = new Set(
    $$('#series-filter input:checked').map((input) => input.value),
  );
  container.replaceChildren(
    ...relevant.map((seriesId) =>
      el(
        'label',
        { class: 'check' },
        el('input', { type: 'checkbox', value: seriesId, checked: checked.has(seriesId) }),
        el('span', { text: SERIES[seriesId].name }),
      ),
    ),
  );
}

/* ---------------- reading the form ---------------- */

function readForm() {
  const job = getApplication(state.applicationId);
  const seriesFilter = $$('#series-filter input:checked').map((input) => input.value);

  const input = {
    sprayerType: state.sprayerType,
    applicationId: state.applicationId,
    gpa: num($('#gpa')),
    mph: num($('#mph')),
    windMph: num($('#wind')),
    psiLimitMin: num($('#psi-min')),
    psiLimitMax: num($('#psi-max')),
    seriesFilter,
  };

  if (state.sprayerType === 'airblast') {
    input.rowSpacingFeet = num($('#row-spacing'));
    input.sides = $('#sides').value;
    input.positionsPerSide = num($('#positions')) || 5;
    input.topShare = (num($('#top-share')) || 70) / 100;
  } else {
    input.spacingInches = num($('#spacing'));
    input.tipsPerRow = num($('#tips-per-row')) || 1;
  }

  const problems = [];
  if (!Number.isFinite(input.gpa) || input.gpa <= 0) problems.push('Enter the target rate in gallons per acre.');
  if (!Number.isFinite(input.mph) || input.mph <= 0) problems.push('Enter your ground speed.');
  if (state.sprayerType === 'airblast') {
    if (!Number.isFinite(input.rowSpacingFeet) || input.rowSpacingFeet <= 0) {
      problems.push('Enter the row spacing in feet.');
    }
  } else if (!Number.isFinite(input.spacingInches) || input.spacingInches <= 0) {
    problems.push(job?.id === 'band' ? 'Enter the band width.' : 'Enter the tip spacing.');
  }

  return { input, problems };
}

/* ---------------- rendering results ---------------- */

function dropletBadge(dropletClass, exact = true, fromPsi = null) {
  const color = DROPLET_COLORS[dropletClass] || 'var(--line-strong)';
  return el(
    'span',
    {
      class: 'droplet-badge',
      style: `color:${color};border-color:${color};background:${color}1f`,
      title: exact
        ? `Published ISO 25358 droplet class`
        : `Published class at ${fromPsi} PSI, the nearest charted pressure`,
    },
    el('span', { class: 'droplet-dot', style: `background:${color}` }),
    `${DROPLET_NAMES[dropletClass] || dropletClass}${exact ? '' : '*'}`,
  );
}

function readout(items) {
  return el(
    'dl',
    { class: 'readout' },
    ...items.map(([label, value, sub]) =>
      el('div', {}, el('dt', { text: label }), el('dd', {}, value, sub ? el('small', { text: sub }) : null)),
    ),
  );
}

function pressureWindowBar(tip, psi) {
  const window = pressureWindow(tip);
  const span = tip.psiMax - tip.psiMin;
  const pct = (value) => `${Math.min(100, Math.max(0, ((value - tip.psiMin) / span) * 100))}%`;
  return el(
    'div',
    { class: 'window-bar' },
    el(
      'div',
      { class: 'window-track' },
      el('div', {
        class: 'window-good',
        style: `left:${pct(window.low)};width:calc(${pct(window.high)} - ${pct(window.low)})`,
      }),
      el('div', { class: 'window-mark', style: `left:${pct(psi)}` }),
    ),
    el(
      'div',
      { class: 'window-scale' },
      el('span', { text: `${tip.psiMin} PSI` }),
      el('span', {
        text: window.published
          ? `shaded: TeeJet optimum ${Math.round(window.low)}-${Math.round(window.high)}`
          : `shaded: middle of the range`,
      }),
      el('span', { text: `${tip.psiMax} PSI` }),
    ),
  );
}

function warningList(warnings) {
  if (!warnings?.length) return null;
  const icons = { info: 'i', warn: '!', critical: '!!' };
  return el(
    'div',
    { class: 'warnings' },
    ...warnings.map((warning) =>
      el(
        'div',
        { class: `warning is-${warning.level}` },
        el('span', { class: 'warning-icon', text: icons[warning.level] || 'i' }),
        el('span', { text: warning.text }),
      ),
    ),
  );
}

function renderResults(output) {
  state.output = output;
  const container = $('#results');
  container.hidden = false;

  const summary =
    output.mode === 'boom'
      ? `Each tip has to flow ${fmtFixed(output.requiredGpm, 3)} GPM (${fmt(output.requiredOzPerMin)} oz per minute in a catch test). ${output.allConsidered} tips in the catalog can hit that rate inside their own pressure range.`
      : `The machine has to put out ${fmtFixed(output.requiredTotalGpm, 2)} GPM in total, which is ${fmtFixed(output.requiredPerSideGpm, 2)} GPM per side across ${output.positionsPerSide} positions.`;
  $('#results-summary').textContent =
    output.mode === 'airblast' && output.unreachable
      ? `${summary} Nothing in the catalog lands within 10% of that, so what follows is the closest it can get.`
      : summary;

  const notices = [];
  if (output.unreachable) {
    notices.push({
      level: 'critical',
      text: output.unreachable.advice.join(' '),
    });
  }
  if (output.noneIdeal) {
    notices.push({
      level: 'warn',
      text: `Nothing in the catalog lands in the ideal droplet range for this job at these settings. The closest options are below. Changing rate or speed usually opens up better choices than changing tips.`,
    });
  }
  if (output.windFloor) {
    notices.push({
      level: 'info',
      text: `At this wind speed the recommendations were pushed toward ${DROPLET_NAMES[output.windFloor]} or coarser.`,
    });
  }
  $('#results-warnings').replaceChildren(warningList(notices) || document.createComment(''));

  const list = $('#results-list');
  list.replaceChildren(
    ...output.results.map((result, index) =>
      output.mode === 'boom'
        ? renderBoomResult(result, index, output)
        : renderAirblastResult(result, index, output),
    ),
  );

  if (!output.results.length) {
    list.replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('p', { text: 'No tip can deliver this rate at this speed inside its pressure range.' }),
        el('p', {
          class: 'muted',
          text: 'Try a different speed, a different rate, or widen the pressure limits under the advanced options.',
        }),
      ),
    );
  }

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rankLabel(index) {
  if (index === 0) return 'Best match';
  if (index === 1) return 'Second choice';
  if (index === 2) return 'Third choice';
  return 'Also works';
}

function renderBoomResult(result, index, output) {
  const { tip } = result;
  const table = boomTable({
    tip,
    spacingInches: state.lastInput?.spacingInches || 20,
    tipsPerRow: state.lastInput?.tipsPerRow || 1,
  });

  const speedWindow = `${fmt(result.range.speedMinAtRate)} to ${fmt(result.range.speedMaxAtRate)} mph`;
  const rateWindow = `${fmt(result.range.gpaMinAtSpeed)} to ${fmt(result.range.gpaMaxAtSpeed)} GPA`;

  return el(
    'article',
    { class: `result${index === 0 ? ' is-top' : ''}` },
    el(
      'div',
      { class: 'result-head' },
      el(
        'div',
        {},
        el('div', { class: 'result-rank', text: rankLabel(index) }),
        el('h3', { class: 'result-part', text: tip.partNo }),
        el('div', { class: 'result-series', text: tip.seriesName }),
      ),
      dropletBadge(result.dropletClass, result.dropletExact, result.dropletFromPsi),
    ),

    readout([
      ['Set pressure', `${result.setPsi} PSI`, `solved: ${fmt(result.psi)} PSI`],
      ['Flow per tip', `${fmtFixed(result.gpmAtSetPsi, 3)} GPM`, `${fmt(result.ozPerMinAtSetPsi)} oz/min in a jug`],
      ['Rate delivered', `${fmt(result.gpaAtSetPsi)} GPA`, `target ${fmt(state.lastInput?.gpa)} GPA`],
      ['Droplet class', result.dropletClass, DROPLET_NAMES[result.dropletClass]],
    ]),

    pressureWindowBar(tip, result.psi),

    el('p', { class: 'result-note', text: tip.summary }),
    el('p', {
      class: 'result-note',
      text: `Without changing tips this covers ${rateWindow} at ${fmt(state.lastInput?.mph)} mph, or ${speedWindow} while holding ${fmt(state.lastInput?.gpa)} GPA.`,
    }),

    warningList(result.warnings),

    el(
      'details',
      { class: 'more' },
      el('summary', { text: 'Rate table for this tip' }),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          {},
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'PSI' }),
              el('th', { text: 'GPM' }),
              el('th', { text: 'Droplet' }),
              ...table.speeds.map((mph) => el('th', { text: `${mph} mph` })),
            ),
          ),
          el(
            'tbody',
            {},
            ...table.rows.map((row) =>
              el(
                'tr',
                { class: Math.abs(row.psi - result.setPsi) <= 2 ? 'is-current' : '' },
                el('th', { text: String(row.psi) }),
                el('td', { text: fmtFixed(row.gpm, 3) }),
                el('td', { text: row.droplet }),
                ...row.gpa.map((gpa) => el('td', { text: fmt(gpa) })),
              ),
            ),
          ),
        ),
      ),
      el('p', { class: 'muted', text: 'GPA at each pressure and speed, on your tip spacing. The highlighted row is the setting recommended above.' }),
    ),

    el(
      'div',
      { class: 'result-actions' },
      el('button', {
        type: 'button',
        class: 'primary',
        text: 'Save this application to the log',
        onClick: () => openRecordDialog(buildDraftFromBoom(result)),
      }),
    ),
  );
}

function renderAirblastResult(option, index, output) {
  const totalGpm40 = option.positions.reduce((sum, position) => sum + position.tip.gpm40, 0);
  const sidesMultiplier = output.sides === 'both' ? 2 : 1;
  const speeds = [1.5, 2, 2.5, 3, 3.5, 4];
  const pressures = [60, 80, 100, 120, 150, 180, 200].filter(
    (psi) => psi >= option.positions[0].tip.psiMin && psi <= option.positions[0].tip.psiMax,
  );

  return el(
    'article',
    { class: `result${index === 0 ? ' is-top' : ''}` },
    el(
      'div',
      { class: 'result-head' },
      el(
        'div',
        {},
        el('div', { class: 'result-rank', text: rankLabel(index) }),
        el('h3', { class: 'result-part', text: `${option.seriesName} at ${option.psi} PSI` }),
        el('div', {
          class: 'result-series',
          text: `${option.positions.length} nozzles per side, ${output.sides === 'both' ? 'spraying both sides in one pass' : 'one side per pass'}`,
        }),
      ),
      el(
        'div',
        { style: 'text-align:right' },
        dropletBadge(option.dropletClass, option.dropletExact, option.dropletFromPsi),
        option.dropletRange
          ? el('div', {
              class: 'muted',
              style: 'font-size:.82rem;margin-top:.3rem',
              text: `${DROPLET_NAMES[option.dropletRange.from]} to ${DROPLET_NAMES[option.dropletRange.to]} across the manifold`,
            })
          : null,
      ),
    ),

    readout([
      ['System pressure', `${option.psi} PSI`],
      ['Total output', `${fmtFixed(option.deliveredTotalGpm, 2)} GPM`, `target ${fmtFixed(option.requiredTotalGpm, 2)} GPM`],
      ['Rate delivered', `${fmt(option.actualGpa)} GPA`, `${option.rateErrorPercent >= 0 ? '+' : ''}${fmt(option.rateErrorPercent)}% off target`],
      ['Per side', `${fmtFixed(option.deliveredPerSideGpm, 2)} GPM`],
    ]),

    el(
      'div',
      { class: 'table-scroll' },
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'Position' }),
            el('th', { text: 'Share' }),
            el('th', { text: 'Tip' }),
            el('th', { text: 'GPM' }),
            el('th', { text: 'oz/min' }),
            el('th', { text: 'Droplet' }),
          ),
        ),
        el(
          'tbody',
          {},
          ...[...option.positions].reverse().map((position) =>
            el(
              'tr',
              {},
              el('th', {
                text:
                  position.position === option.positions.length
                    ? `${position.position} (top)`
                    : position.position === 1
                      ? '1 (bottom)'
                      : String(position.position),
              }),
              el('td', { text: `${Math.round(position.share * 100)}%` }),
              el('td', { text: position.tip.partNo }),
              el('td', { text: fmtFixed(position.gpm, 3) }),
              el('td', { text: fmt(position.ozPerMin) }),
              el('td', { text: position.dropletClass }),
            ),
          ),
        ),
      ),
    ),
    el('p', {
      class: 'muted',
      text: 'Positions run from the bottom of the canopy up. Fit these tips on each side of the machine.',
    }),

    el('p', { class: 'result-note', text: option.positions[0].tip.summary }),

    warningList(option.warnings),

    el(
      'details',
      { class: 'more' },
      el('summary', { text: 'Rate table for this tip set' }),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          {},
          el(
            'thead',
            {},
            el('tr', {}, el('th', { text: 'PSI' }), ...speeds.map((mph) => el('th', { text: `${mph} mph` }))),
          ),
          el(
            'tbody',
            {},
            ...pressures.map((psi) => {
              const total = flowAtPsi(totalGpm40, psi) * sidesMultiplier;
              return el(
                'tr',
                { class: psi === option.psi ? 'is-current' : '' },
                el('th', { text: String(psi) }),
                ...speeds.map((mph) =>
                  el('td', {
                    text: fmt(
                      airblastGpa({
                        gpm: total,
                        mph,
                        rowSpacingFeet: state.lastInput?.rowSpacingFeet,
                        sides: output.sides,
                      }),
                    ),
                  }),
                ),
              );
            }),
          ),
        ),
      ),
      el('p', { class: 'muted', text: 'GPA delivered by this same tip set at other pressures and speeds.' }),
    ),

    el(
      'div',
      { class: 'result-actions' },
      el('button', {
        type: 'button',
        class: 'primary',
        text: 'Save this application to the log',
        onClick: () => openRecordDialog(buildDraftFromAirblast(option)),
      }),
    ),
  );
}

/* ---------------- building a log record from a result ---------------- */

function buildDraftFromBoom(result) {
  const job = getApplication(state.applicationId);
  return {
    ...store.emptyRecord(),
    name: '',
    applicationId: job.id,
    applicationName: job.name,
    sprayerType: 'boom',
    gpa: round(state.lastInput.gpa, 2),
    mph: round(state.lastInput.mph, 2),
    psi: result.setPsi,
    spacingInches: round(state.lastInput.spacingInches, 2),
    windMph: Number.isFinite(state.lastInput.windMph) ? state.lastInput.windMph : null,
    dropletClass: result.dropletClass,
    nozzles: [
      {
        partNo: result.tip.partNo,
        series: result.tip.seriesName,
        psi: result.setPsi,
        gpm: round(result.gpmAtSetPsi, 4),
        ozPerMin: round(result.ozPerMinAtSetPsi, 1),
        dropletClass: result.dropletClass,
      },
    ],
    calc: {
      mode: 'boom',
      requiredGpm: round(result.requiredGpm, 4),
      deliveredGpa: round(result.gpaAtSetPsi, 2),
      tipsPerRow: state.lastInput.tipsPerRow,
      solvedPsi: round(result.psi, 1),
      dropletFromPsi: result.dropletFromPsi,
    },
  };
}

function buildDraftFromAirblast(option) {
  const job = getApplication(state.applicationId);
  return {
    ...store.emptyRecord(),
    applicationId: job.id,
    applicationName: job.name,
    sprayerType: 'airblast',
    gpa: round(option.actualGpa, 2),
    mph: round(state.lastInput.mph, 2),
    psi: option.psi,
    rowSpacingFeet: round(state.lastInput.rowSpacingFeet, 2),
    windMph: Number.isFinite(state.lastInput.windMph) ? state.lastInput.windMph : null,
    dropletClass: option.dropletClass,
    nozzles: option.positions.map((position) => ({
      position: position.position,
      partNo: position.tip.partNo,
      series: position.tip.seriesName,
      psi: option.psi,
      gpm: round(position.gpm, 4),
      ozPerMin: round(position.ozPerMin, 1),
      sharePercent: Math.round(position.share * 100),
      dropletClass: position.dropletClass,
    })),
    calc: {
      mode: 'airblast',
      sides: state.lastInput.sides,
      positionsPerSide: option.positions.length,
      requiredTotalGpm: round(option.requiredTotalGpm, 3),
      deliveredTotalGpm: round(option.deliveredTotalGpm, 3),
      rateErrorPercent: round(option.rateErrorPercent, 2),
    },
  };
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/* ---------------- record dialog ---------------- */

function openRecordDialog(draft) {
  state.draft = draft;
  const dialog = $('#record-dialog');
  const form = $('#record-form');
  form.reset();

  $('#record-dialog-title').textContent = draft.id ? 'Edit this record' : 'Save this application';

  for (const [key, value] of Object.entries(draft)) {
    const field = form.elements[key];
    if (field && value !== null && value !== undefined && typeof value !== 'object') {
      field.value = value;
    }
  }
  if (!draft.appliedOn) form.elements.appliedOn.value = new Date().toISOString().slice(0, 10);
  if (!draft.name && draft.applicationName) {
    form.elements.name.placeholder = `${draft.applicationName} - ${form.elements.appliedOn.value}`;
  }

  $('#record-nozzle-summary').replaceChildren(
    el(
      'div',
      {},
      el('strong', { text: draft.applicationName || 'Application' }),
      draft.nozzles.length
        ? el(
            'ul',
            {},
            ...draft.nozzles.map((nozzle) =>
              el('li', {
                text: nozzle.position
                  ? `Position ${nozzle.position} (${nozzle.sharePercent}%): ${nozzle.partNo} at ${nozzle.psi} PSI, ${fmt(nozzle.ozPerMin)} oz/min`
                  : `${nozzle.partNo} at ${nozzle.psi} PSI, ${fmt(nozzle.ozPerMin)} oz/min per tip`,
              }),
            ),
          )
        : el('p', { class: 'muted', text: 'No nozzle attached to this record yet.' }),
      draft.dropletClass
        ? el('p', {
            class: 'muted',
            style: 'margin:.4rem 0 0',
            text: `Droplet class ${draft.dropletClass} (${DROPLET_NAMES[draft.dropletClass]})`,
          })
        : null,
    ),
  );

  renderProductRows(draft.products?.length ? draft.products : [{}]);
  message($('#record-message'), '');
  dialog.showModal();
}

function renderProductRows(products) {
  const container = $('#product-rows');
  container.replaceChildren(...products.map((product) => productRow(product)));
}

function productRow(product = {}) {
  const row = el(
    'div',
    { class: 'product-row' },
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'field-label', text: 'Product' }),
      el('input', { type: 'text', class: 'p-name', value: product.name || '', placeholder: 'Roundup PowerMax' }),
    ),
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'field-label', text: 'EPA reg. no.' }),
      el('input', { type: 'text', class: 'p-epa', value: product.epaRegNo || '', placeholder: '524-549' }),
    ),
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'field-label', text: 'Rate/ac' }),
      el('input', { type: 'text', class: 'p-rate', value: product.rate || '', inputmode: 'decimal', placeholder: '32' }),
    ),
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'field-label', text: 'Unit' }),
      el('input', { type: 'text', class: 'p-unit', value: product.unit || '', placeholder: 'oz' }),
    ),
    el('button', {
      type: 'button',
      class: 'remove',
      text: 'Remove',
      onClick: () => {
        row.remove();
        if (!$('#product-rows').children.length) renderProductRows([{}]);
      },
    }),
  );
  return row;
}

function collectProducts() {
  return $$('#product-rows .product-row')
    .map((row) => ({
      name: $('.p-name', row).value.trim(),
      epaRegNo: $('.p-epa', row).value.trim(),
      rate: $('.p-rate', row).value.trim(),
      unit: $('.p-unit', row).value.trim(),
    }))
    .filter((product) => product.name || product.rate);
}

async function submitRecord(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const numeric = ['acres', 'gpa', 'mph', 'psi', 'windMph', 'airTempF', 'humidity'];

  const record = {
    ...store.emptyRecord(),
    ...state.draft,
    ...data,
    products: collectProducts(),
  };
  for (const key of numeric) {
    const value = Number.parseFloat(record[key]);
    record[key] = Number.isFinite(value) ? value : null;
  }
  if (!record.name?.trim()) {
    record.name = form.elements.name.placeholder || 'Untitled application';
  }

  try {
    const { queued } = await store.saveRecord(record);
    $('#record-dialog').close();
    await refreshRecords();
    switchView('log');
    message(
      $('#log-message'),
      queued
        ? 'Saved on this device. It will sync to your account the next time you have signal.'
        : 'Saved to your spray log.',
    );
  } catch (error) {
    message($('#record-message'), error.message, true);
  }
}

/* ---------------- spray log view ---------------- */

async function refreshRecords() {
  try {
    state.records = await store.listRecords();
  } catch (error) {
    state.records = [];
    message($('#log-message'), `Could not load records: ${error.message}`, true);
  }
  renderRecords();
  renderScope();
}

function renderScope() {
  const session = store.getSession();
  const node = $('#log-scope');
  const queued = store.outboxCount();
  if (store.CLOUD_ENABLED) {
    node.textContent = session
      ? `Signed in as ${session.name}. Records sync to your account${queued ? `, ${queued} waiting to upload` : ''}.`
      : 'Sign in to keep your records with your account. Until then they are saved on this device only.';
  } else {
    node.textContent = session
      ? `${session.name}'s log, saved on this device.`
      : 'Saved on this device. Make an account to keep separate logs per operator.';
  }
}

function matchesFilter(record, filter) {
  if (!filter) return true;
  const haystack = [
    record.name,
    record.fieldName,
    record.crop,
    record.applicationName,
    record.notes,
    record.applicator,
    ...(record.nozzles || []).map((nozzle) => nozzle.partNo),
    ...(record.products || []).map((product) => product.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(filter.toLowerCase());
}

function renderRecords() {
  const container = $('#record-list');
  const visible = state.records.filter((record) => matchesFilter(record, state.recordFilter));

  if (!visible.length) {
    container.replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('p', {
          text: state.records.length
            ? 'No records match that search.'
            : 'No spray records yet.',
        }),
        el('p', {
          class: 'muted',
          text: state.records.length
            ? 'Clear the search to see the rest of the log.'
            : 'Run a nozzle recommendation and use "Save this application to the log", or add a record by hand.',
        }),
      ),
    );
    return;
  }

  container.replaceChildren(...visible.map((record) => renderRecord(record)));
}

function renderRecord(record) {
  const chips = [];
  if (record.gpa) chips.push(`${fmt(record.gpa)} GPA`);
  if (record.mph) chips.push(`${fmt(record.mph)} mph`);
  if (record.psi) chips.push(`${fmt(record.psi, 0)} PSI`);
  if (record.acres) chips.push(`${fmt(record.acres)} ac`);
  if (record.dropletClass) chips.push(DROPLET_NAMES[record.dropletClass] || record.dropletClass);

  const nozzleChips = (record.nozzles || []).map((nozzle) =>
    el('span', {
      class: 'chip is-nozzle',
      text: nozzle.position ? `Pos ${nozzle.position}: ${nozzle.partNo}` : nozzle.partNo,
    }),
  );

  const details = [];
  if (record.fieldName) details.push(['Field', record.fieldName]);
  if (record.crop) details.push(['Crop', record.crop]);
  if (record.applicationName) details.push(['Job type', record.applicationName]);
  if (record.spacingInches) details.push(['Tip spacing', `${fmt(record.spacingInches)} in`]);
  if (record.rowSpacingFeet) details.push(['Row spacing', `${fmt(record.rowSpacingFeet)} ft`]);
  if (record.products?.length) {
    details.push([
      'Products',
      record.products
        .map((product) =>
          [product.name, product.rate && `${product.rate} ${product.unit || ''}`.trim(), product.epaRegNo && `EPA ${product.epaRegNo}`]
            .filter(Boolean)
            .join(', '),
        )
        .join(' | '),
    ]);
  }
  const weather = [
    record.windMph !== null && record.windMph !== undefined && `${fmt(record.windMph)} mph`,
    record.windDirection,
    record.airTempF !== null && record.airTempF !== undefined && `${fmt(record.airTempF)} F`,
    record.humidity !== null && record.humidity !== undefined && `${fmt(record.humidity)}% RH`,
  ]
    .filter(Boolean)
    .join(', ');
  if (weather) details.push(['Conditions', weather]);
  if (record.applicator) {
    details.push(['Applicator', [record.applicator, record.licenseNo].filter(Boolean).join(', ')]);
  }
  if (record.notes) details.push(['Notes', record.notes]);

  return el(
    'article',
    { class: 'record' },
    el(
      'div',
      { class: 'record-head' },
      el('span', { class: 'record-name', text: record.name }),
      el('span', { class: 'record-date', text: record.appliedOn || '' }),
    ),
    el('div', { class: 'record-meta' }, ...chips.map((chip) => el('span', { class: 'chip', text: chip })), ...nozzleChips),
    details.length
      ? el(
          'div',
          { class: 'record-detail' },
          el('dl', {}, ...details.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })])),
        )
      : null,
    el(
      'div',
      { class: 'record-actions' },
      el('button', {
        type: 'button',
        class: 'ghost small',
        text: 'Edit',
        onClick: () => openRecordDialog({ ...store.emptyRecord(), ...record }),
      }),
      el('button', {
        type: 'button',
        class: 'ghost small danger',
        text: 'Delete',
        onClick: async () => {
          if (!confirm(`Delete "${record.name}" from the spray log?`)) return;
          try {
            await store.deleteRecord(record.id);
            await refreshRecords();
            message($('#log-message'), 'Record deleted.');
          } catch (error) {
            message($('#log-message'), error.message, true);
          }
        },
      }),
    ),
  );
}

function exportCsv() {
  if (!state.records.length) {
    message($('#log-message'), 'Nothing to export yet.', true);
    return;
  }
  const csv = store.recordsToCsv(state.records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: `spray-log-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  message($('#log-message'), `Exported ${state.records.length} records.`);
}

/* ---------------- accounts ---------------- */

function renderAccountButton() {
  const session = store.getSession();
  $('#account-label').textContent = session ? session.name : store.CLOUD_ENABLED ? 'Sign in' : 'Accounts';
}

function openAccountDialog() {
  renderAccountPanel();
  $('#account-dialog').showModal();
}

function renderAccountPanel(mode = 'signin') {
  const panel = $('#account-panel');
  const session = store.getSession();

  if (session) {
    panel.replaceChildren(
      el('h3', { text: session.name }),
      el('p', {
        class: 'muted',
        text: store.CLOUD_ENABLED
          ? `Signed in as ${session.email}. Your spray records sync to this account.`
          : 'Your spray records are saved in this browser on this device.',
      }),
      store.CLOUD_ENABLED && store.outboxCount()
        ? el('p', { class: 'muted', text: `${store.outboxCount()} record(s) waiting to upload.` })
        : null,
      el(
        'div',
        { class: 'form-actions' },
        el('button', {
          type: 'button',
          class: 'primary',
          text: 'Sign out',
          onClick: async () => {
            await store.signOut();
            renderAccountButton();
            renderAccountPanel();
            await refreshRecords();
          },
        }),
        !store.CLOUD_ENABLED
          ? el('button', {
              type: 'button',
              class: 'ghost danger',
              text: 'Delete this account',
              onClick: async () => {
                if (!confirm(`Delete ${session.name} and every record saved under it on this device?`)) return;
                await store.deleteLocalAccount(session.accountId);
                renderAccountButton();
                renderAccountPanel();
                await refreshRecords();
              },
            })
          : null,
      ),
    );
    return;
  }

  const tabs = el(
    'div',
    { class: 'auth-tabs' },
    el('button', {
      type: 'button',
      class: mode === 'signin' ? 'is-active' : '',
      text: store.CLOUD_ENABLED ? 'Sign in' : 'Use an account',
      onClick: () => renderAccountPanel('signin'),
    }),
    el('button', {
      type: 'button',
      class: mode === 'signup' ? 'is-active' : '',
      text: store.CLOUD_ENABLED ? 'Create account' : 'New account',
      onClick: () => renderAccountPanel('signup'),
    }),
  );

  panel.replaceChildren(
    el('h3', { text: store.CLOUD_ENABLED ? 'Your account' : 'Accounts on this device' }),
    el('p', {
      class: 'muted',
      text: store.CLOUD_ENABLED
        ? 'Sign in and your spray log follows you to any phone or computer.'
        : 'Accounts keep separate spray logs for each operator on this device. Nothing is uploaded anywhere.',
    }),
    tabs,
    mode === 'signin' ? signInForm() : signUpForm(),
  );
}

function signInForm() {
  const messageNode = el('p', { class: 'form-message' });

  if (store.CLOUD_ENABLED) {
    return el(
      'form',
      {
        onSubmit: async (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.target).entries());
          try {
            await store.signIn({ email: data.email, password: data.password });
            renderAccountButton();
            $('#account-dialog').close();
            await refreshRecords();
          } catch (error) {
            message(messageNode, error.message, true);
          }
        },
      },
      el(
        'label',
        { class: 'field' },
        el('span', { class: 'field-label', text: 'Email' }),
        el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' }),
      ),
      el(
        'label',
        { class: 'field', style: 'margin-top:.7rem' },
        el('span', { class: 'field-label', text: 'Password' }),
        el('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' }),
      ),
      messageNode,
      el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'primary', text: 'Sign in' })),
    );
  }

  const accounts = store.listLocalAccounts();
  if (!accounts.length) {
    return el('p', { class: 'muted', text: 'No accounts on this device yet. Use the New account tab to make one.' });
  }

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'account-list' },
      ...accounts.map((account) =>
        el(
          'form',
          {
            class: 'check',
            style: 'display:grid;gap:.5rem;grid-template-columns:1fr auto auto;align-items:center',
            onSubmit: async (event) => {
              event.preventDefault();
              const pin = $('input[type=password]', event.target)?.value || '';
              try {
                await store.signIn({ accountId: account.id, pin });
                renderAccountButton();
                $('#account-dialog').close();
                await refreshRecords();
              } catch (error) {
                message(messageNode, error.message, true);
              }
            },
          },
          el('span', { text: account.name, style: 'font-weight:600' }),
          el('input', { type: 'password', placeholder: 'PIN', inputmode: 'numeric', style: 'max-width:7rem' }),
          el('button', { type: 'submit', class: 'ghost small', text: 'Open' }),
        ),
      ),
    ),
    messageNode,
    el('p', { class: 'muted', text: 'Leave the PIN blank if the account was made without one.' }),
  );
}

function signUpForm() {
  const messageNode = el('p', { class: 'form-message' });

  return el(
    'form',
    {
      onSubmit: async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target).entries());
        try {
          const result = await store.signUp(data);
          renderAccountButton();
          if (result?.needsConfirmation) {
            message(messageNode, 'Check your email to confirm the account, then sign in.');
            return;
          }
          $('#account-dialog').close();
          await refreshRecords();
        } catch (error) {
          message(messageNode, error.message, true);
        }
      },
    },
    store.CLOUD_ENABLED
      ? el(
          'div',
          {},
          el(
            'label',
            { class: 'field' },
            el('span', { class: 'field-label', text: 'Your name' }),
            el('input', { type: 'text', name: 'name', autocomplete: 'name' }),
          ),
          el(
            'label',
            { class: 'field', style: 'margin-top:.7rem' },
            el('span', { class: 'field-label', text: 'Email' }),
            el('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' }),
          ),
          el(
            'label',
            { class: 'field', style: 'margin-top:.7rem' },
            el('span', { class: 'field-label', text: 'Password' }),
            el('input', {
              type: 'password',
              name: 'password',
              required: true,
              minLength: 8,
              autocomplete: 'new-password',
            }),
            el('span', { class: 'field-hint', text: 'At least 8 characters.' }),
          ),
        )
      : el(
          'div',
          {},
          el(
            'label',
            { class: 'field' },
            el('span', { class: 'field-label', text: 'Name' }),
            el('input', { type: 'text', name: 'name', required: true, placeholder: 'Dad, hired man, sprayer 2' }),
          ),
          el(
            'label',
            { class: 'field', style: 'margin-top:.7rem' },
            el('span', { class: 'field-label', text: 'PIN' }),
            el('input', { type: 'password', name: 'pin', inputmode: 'numeric', placeholder: 'optional' }),
            el('span', {
              class: 'field-hint',
              text: store.hasStrongHashing()
                ? 'Optional. It keeps other operators out of your log on a shared tablet, but anyone with this device could still read the browser storage, so do not reuse a PIN that matters.'
                : 'This page is not being served over https, so the PIN is only lightly scrambled. Treat it as a name tag, not a lock.',
            }),
          ),
        ),
    messageNode,
    el(
      'div',
      { class: 'form-actions' },
      el('button', { type: 'submit', class: 'primary', text: 'Create account' }),
    ),
  );
}

/* ---------------- tools ---------------- */

function runWearTool() {
  const gpm40 = num($('#wear-gpm40'));
  const psi = num($('#wear-psi'));
  const measured = num($('#wear-measured'));
  const output = $('#wear-output');

  if (!Number.isFinite(gpm40) || !Number.isFinite(psi)) {
    output.replaceChildren();
    return;
  }

  const expectedGpm = flowAtPsi(gpm40, psi);
  const items = [
    ['Should flow', `${fmtFixed(expectedGpm, 3)} GPM`, `at ${fmt(psi, 0)} PSI`],
    ['Catch target', `${fmt(ozPerMinute(expectedGpm))} oz`, 'in one minute'],
    ['15 second catch', `${fmt(ozPerMinute(expectedGpm) / 4)} oz`, 'if you time 15 seconds'],
  ];

  let verdict = null;
  if (Number.isFinite(measured) && measured > 0) {
    const wear = tipWear({ tip: { gpm40 }, psi, measuredOzPerMin: measured });
    items.push([
      'You caught',
      `${wear.overPercent >= 0 ? '+' : ''}${fmt(wear.overPercent)}%`,
      wear.overPercent >= 0 ? 'over rating' : 'under rating',
    ]);
    verdict = el(
      'div',
      { class: `warning is-${wear.replace ? 'warn' : 'info'}` },
      el('span', { class: 'warning-icon', text: wear.replace ? '!' : 'i' }),
      el('span', {
        text: wear.replace
          ? `This tip is ${fmt(wear.overPercent)}% over its rating, past the 10 per cent limit. Replace it, and check the rest of the boom while you are at it.`
          : wear.overPercent < -10
            ? `This tip is ${fmt(Math.abs(wear.overPercent))}% under its rating, which usually means a partial plug or a strainer restricting it. Clean it and test again.`
            : `Within 10 per cent of rating, so this tip is still good.`,
      }),
    );
  }

  output.replaceChildren(readout(items), verdict);
}

function runTankTool() {
  const result = tankMath({
    tankGallons: num($('#tank-gallons')),
    gpa: num($('#tank-gpa')),
    acres: num($('#tank-acres')),
    productRatePerAcre: num($('#tank-rate')),
  });
  const items = [];
  if (result.acresPerTank) items.push(['Acres per tank', fmt(result.acresPerTank), 'per full load']);
  if (result.tankLoads) items.push(['Tank loads', fmt(result.tankLoads), 'to finish the job']);
  if (result.totalSolution) items.push(['Total solution', `${fmt(result.totalSolution, 0)} gal`, 'water plus product']);
  if (result.productPerTank) items.push(['Product per tank', fmt(result.productPerTank), 'in the units you entered']);
  if (result.productTotal) items.push(['Product total', fmt(result.productTotal), 'for the whole job']);

  $('#tank-output').replaceChildren(items.length ? readout(items) : document.createComment(''));
}

/* ---------------- views, URL state, profile ---------------- */

function switchView(view) {
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  $$('.view').forEach((node) => node.classList.toggle('is-active', node.id === `view-${view}`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const URL_FIELDS = [
  ['gpa', '#gpa'],
  ['mph', '#mph'],
  ['spacing', '#spacing'],
  ['tips', '#tips-per-row'],
  ['row', '#row-spacing'],
  ['pos', '#positions'],
  ['top', '#top-share'],
  ['wind', '#wind'],
  ['psimin', '#psi-min'],
  ['psimax', '#psi-max'],
];

/*
 * A saved setup or a shared link can change which sprayer is selected, and that
 * changes which fields and which tip families are on screen. So state is read
 * first, the form is rendered once, and only then are the values filled in.
 */
function readUrlState(params) {
  const sprayer = params.get('sprayer');
  if (sprayer && SPRAYER_TYPES[sprayer]) state.sprayerType = sprayer;
  const job = params.get('job');
  if (job && getApplication(job)) state.applicationId = job;
}

function applyUrlValues(params) {
  if (!params.size) return false;

  for (const [key, selector] of URL_FIELDS) {
    const value = params.get(key);
    if (value !== null) {
      const node = $(selector);
      if (node) {
        node.value = value;
        node.dataset.auto = 'false';
      }
    }
  }
  const sides = params.get('sides');
  if (sides) $('#sides').value = sides;
  const series = params.get('series');
  if (series) {
    const wanted = new Set(series.split(','));
    $$('#series-filter input').forEach((input) => {
      input.checked = wanted.has(input.value);
    });
  }
  return true;
}

function buildShareUrl() {
  const params = new URLSearchParams();
  params.set('sprayer', state.sprayerType);
  params.set('job', state.applicationId);
  for (const [key, selector] of URL_FIELDS) {
    const node = $(selector);
    if (node && node.value !== '' && !node.closest('[hidden]')) params.set(key, node.value);
  }
  if (state.sprayerType === 'airblast') params.set('sides', $('#sides').value);
  const series = $$('#series-filter input:checked').map((input) => input.value);
  if (series.length) params.set('series', series.join(','));
  return `${location.origin}${location.pathname}?${params}`;
}

function saveSprayerProfile() {
  const profile = {
    sprayerType: state.sprayerType,
    spacing: $('#spacing').value,
    tipsPerRow: $('#tips-per-row').value,
    rowSpacing: $('#row-spacing').value,
    sides: $('#sides').value,
    positions: $('#positions').value,
    topShare: $('#top-share').value,
    psiMin: $('#psi-min').value,
    psiMax: $('#psi-max').value,
    mph: $('#mph').value,
    series: $$('#series-filter input:checked').map((input) => input.value),
  };
  store.saveProfile(profile);
  message($('#form-message'), 'Sprayer setup remembered on this device.');
}

function readProfileState(profile) {
  if (profile?.sprayerType && SPRAYER_TYPES[profile.sprayerType]) {
    state.sprayerType = profile.sprayerType;
  }
}

function applyProfileValues(profile) {
  if (!profile) return;
  const assign = (selector, value) => {
    if (value !== undefined && value !== null && value !== '') $(selector).value = value;
  };
  assign('#spacing', profile.spacing);
  assign('#tips-per-row', profile.tipsPerRow);
  assign('#row-spacing', profile.rowSpacing);
  assign('#sides', profile.sides);
  assign('#positions', profile.positions);
  assign('#top-share', profile.topShare);
  assign('#psi-min', profile.psiMin);
  assign('#psi-max', profile.psiMax);
  assign('#mph', profile.mph);
  if (profile.series?.length) {
    const wanted = new Set(profile.series);
    $$('#series-filter input').forEach((input) => {
      input.checked = wanted.has(input.value);
    });
  }
}

/* ---------------- wiring ---------------- */

function init() {
  const profile = store.loadProfile();
  const params = new URLSearchParams(location.search);
  readProfileState(profile);
  readUrlState(params);

  renderSprayerChoices();
  renderJobChoices();
  syncFormForSprayer();

  applyProfileValues(profile);
  const fromUrl = applyUrlValues(params);
  applyJobDefaults();

  $('#gpa').addEventListener('input', (event) => {
    event.target.dataset.auto = 'false';
  });

  $('#calc-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { input, problems } = readForm();
    if (problems.length) {
      message($('#form-message'), problems[0], true);
      return;
    }
    state.lastInput = input;
    try {
      renderResults(recommend(input));
      message($('#form-message'), '');
    } catch (error) {
      message($('#form-message'), error.message, true);
    }
  });

  $('#save-profile').addEventListener('click', saveSprayerProfile);

  $('#copy-link').addEventListener('click', async () => {
    const url = buildShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      message($('#form-message'), 'Link copied. Bookmark it and this setup comes back filled in.');
    } catch {
      history.replaceState(null, '', url);
      message($('#form-message'), 'Link is now in the address bar. Bookmark the page to save this setup.');
    }
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  $('#account-button').addEventListener('click', openAccountDialog);
  $('#record-form').addEventListener('submit', submitRecord);
  $('#record-cancel').addEventListener('click', () => $('#record-dialog').close());
  $('#add-product').addEventListener('click', () => $('#product-rows').append(productRow()));
  $('#new-record').addEventListener('click', () => openRecordDialog(store.emptyRecord()));
  $('#export-csv').addEventListener('click', exportCsv);
  $('#log-search').addEventListener('input', (event) => {
    state.recordFilter = event.target.value;
    renderRecords();
  });

  ['#wear-gpm40', '#wear-psi', '#wear-measured'].forEach((selector) => {
    $(selector).addEventListener('input', runWearTool);
  });
  ['#tank-gallons', '#tank-gpa', '#tank-acres', '#tank-rate'].forEach((selector) => {
    $(selector).addEventListener('input', runTankTool);
  });

  $('#storage-note').textContent = store.CLOUD_ENABLED
    ? 'Spray records are stored in your account. Records saved without signal are held on the device and uploaded next time.'
    : 'Spray records are stored in this browser on this device. Export a CSV now and then so you have a copy, or turn on account sync as described in the README.';

  renderAccountButton();
  refreshRecords();

  if (fromUrl) {
    const { input, problems } = readForm();
    if (!problems.length) {
      state.lastInput = input;
      renderResults(recommend(input));
    }
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline support is a bonus; the calculator works without it. */
    });
  }
}

init();

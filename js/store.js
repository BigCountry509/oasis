/*
 * Accounts, spray records and sprayer profiles.
 *
 * There are three interchangeable backends behind one interface:
 *
 *   local  - the default when MySQL is not configured. Accounts and records
 *            live in this browser. Creating an account needs a name, an email
 *            and a password.
 *
 *   mysql  - the intended setup on a host like Pterodactyl. Fill in
 *            api/config.php and run mysql/schema.sql. Accounts and spray
 *            records live in MySQL, so the same log is on every phone and
 *            computer. A device stays signed in for a year unless the
 *            password is reset, which signs every device out. Writes made
 *            with no signal go to an outbox and are pushed on the next load.
 *
 *   cloud  - optional Supabase fallback, switched on from js/config.js.
 *
 * The rest of the app only ever calls the exported functions, so it does not
 * care which backend is live.
 */

import { API_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export let BACKEND = 'local';
export let CLOUD_ENABLED = false;

const KEYS = {
  accounts: 'nozzlecalc.accounts',
  session: 'nozzlecalc.session',
  records: (accountId) => `nozzlecalc.records.${accountId}`,
  profile: (accountId) => `nozzlecalc.profile.${accountId}`,
  outbox: 'nozzlecalc.outbox',
};

const DEVICE_ACCOUNT = 'device';

function apiRoot() {
  return String(API_URL || '').replace(/\/$/, '');
}

export async function connectBackend() {
  if (apiRoot()) {
    try {
      const response = await fetch(`${apiRoot()}/index.php?action=health`);
      const payload = await response.json();
      if (payload?.ok) {
        BACKEND = 'mysql';
        CLOUD_ENABLED = false;
        return BACKEND;
      }
    } catch {
      /* MySQL is optional. Fall through. */
    }
  }
  /* A remembered MySQL login should keep talking to MySQL even if the health
   * check failed (out of signal, brief outage). Otherwise this device would
   * look signed in against an empty local log. */
  if (session?.mode === 'mysql' && apiRoot()) {
    BACKEND = 'mysql';
    CLOUD_ENABLED = false;
    return BACKEND;
  }
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    BACKEND = 'cloud';
    CLOUD_ENABLED = true;
    return BACKEND;
  }
  BACKEND = 'local';
  CLOUD_ENABLED = false;
  return BACKEND;
}

export function backendKind() {
  return BACKEND;
}

export function accountsAreShared() {
  return BACKEND === 'mysql' || BACKEND === 'cloud';
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- PIN hashing for local accounts ---------- */

const PBKDF2_ROUNDS = 150000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/*
 * A deliberately weak fallback for the case where SubtleCrypto is missing,
 * which happens when the page is opened straight off the file system instead of
 * being served. It still stops a casual tap-through, and hasStrongHashing()
 * lets the UI say so out loud.
 */
function weakHash(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `weak:${(hash >>> 0).toString(16)}`;
}

export function hasStrongHashing() {
  return Boolean(globalThis.crypto?.subtle);
}

async function hashPin(pin, saltHex) {
  if (!hasStrongHashing()) return weakHash(`${saltHex}:${pin}`);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(saltHex),
      iterations: PBKDF2_ROUNDS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return toHex(bits);
}

function randomSalt() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
  }
  return Math.random().toString(36).slice(2);
}

/* ---------- session ---------- */

let session = readJson(KEYS.session, null);

export function getSession() {
  return session;
}

function setSession(next) {
  session = next;
  if (next) writeJson(KEYS.session, next);
  else localStorage.removeItem(KEYS.session);
}

/* The account records are filed under. Signed out use gets a device drawer so
 * nothing is lost just because somebody never made an account. */
function activeAccountId() {
  return session?.accountId || DEVICE_ACCOUNT;
}

/* ---------- Supabase REST ---------- */

async function supabase(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(auth && session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.error_description || payload?.msg || payload?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function cloudSignUp({ email, password, name }) {
  const payload = await supabase('/auth/v1/signup', {
    method: 'POST',
    auth: false,
    body: { email, password, data: { name } },
  });
  if (payload?.access_token) {
    setSession({
      mode: 'cloud',
      accountId: payload.user.id,
      email: payload.user.email,
      name: name || payload.user.email,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
    });
    return { session, needsConfirmation: false };
  }
  /* Projects with email confirmation switched on return the user with no token. */
  return { session: null, needsConfirmation: true };
}

async function cloudSignIn({ email, password }) {
  const payload = await supabase('/auth/v1/token?grant_type=password', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  setSession({
    mode: 'cloud',
    accountId: payload.user.id,
    email: payload.user.email,
    name: payload.user.user_metadata?.name || payload.user.email,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  });
  return session;
}

async function cloudRefresh() {
  if (!session?.refreshToken) return null;
  try {
    const payload = await supabase('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      auth: false,
      body: { refresh_token: session.refreshToken },
    });
    setSession({
      ...session,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
    });
    return session;
  } catch {
    setSession(null);
    return null;
  }
}

/* One retry after a token refresh, so a stale token does not look like a
 * failure to the operator. */
async function withAuth(request) {
  try {
    return await request();
  } catch (error) {
    if (error.status === 401) {
      const refreshed = await cloudRefresh();
      if (refreshed) return request();
    }
    throw error;
  }
}

async function api(action, { method = 'POST', body, auth = true } = {}) {
  const payload = { ...(body || {}), action };
  const query = method === 'GET' ? `?action=${encodeURIComponent(action)}` : '';
  const response = await fetch(`${apiRoot()}/index.php${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = new Error(parsed?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function rememberMysqlSession(user, token) {
  setSession({
    mode: 'mysql',
    accountId: user.id,
    email: user.email,
    name: user.name,
    accessToken: token,
  });
  return session;
}

async function mysqlSignUp({ email, password, name }) {
  const payload = await api('signup', {
    auth: false,
    body: { email, password, name, origin: typeof location !== 'undefined' ? location.origin : '' },
  });
  return { session: rememberMysqlSession(payload.user, payload.token), needsConfirmation: false };
}

async function mysqlSignIn({ email, password }) {
  const payload = await api('signin', {
    auth: false,
    body: { email, password },
  });
  return rememberMysqlSession(payload.user, payload.token);
}

export async function restoreSession() {
  await connectBackend();
  if (BACKEND === 'mysql' && session?.accessToken && session.mode === 'mysql') {
    try {
      const payload = await api('me', { method: 'GET' });
      setSession({
        ...session,
        mode: 'mysql',
        accountId: payload.user.id,
        email: payload.user.email,
        name: payload.user.name,
      });
      await flushOutbox();
      return session;
    } catch (error) {
      /* 401 means the password was reset or this device was signed out. */
      if (error.status === 401) setSession(null);
      return session;
    }
  }
  if (BACKEND === 'cloud' && session?.mode === 'cloud') {
    await cloudRefresh();
    await flushOutbox();
  }
  return session;
}

/* ---------- accounts ---------- */

export function listLocalAccounts() {
  return readJson(KEYS.accounts, []).map(({ id, name, email, createdAt }) => ({
    id,
    name,
    email,
    createdAt,
  }));
}

function normalizeEmail(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Enter a working email. Password resets are sent there.');
  }
  return trimmed;
}

export async function signUp({ name, email, password, pin }) {
  const trimmedName = (name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const secret = (password || pin || '').trim();
  if (secret.length < 8) throw new Error('Password needs at least 8 characters.');
  if (BACKEND === 'mysql' && !trimmedName) throw new Error('Give the account a name.');

  if (BACKEND === 'mysql') return mysqlSignUp({ email: normalizedEmail, password: secret, name: trimmedName });
  if (BACKEND === 'cloud') return cloudSignUp({ email: normalizedEmail, password: secret, name: trimmedName });

  if (!trimmedName) throw new Error('Give the account a name.');
  const accounts = readJson(KEYS.accounts, []);
  if (accounts.some((account) => account.name.toLowerCase() === trimmedName.toLowerCase())) {
    throw new Error(`There is already an account called ${trimmedName} on this device.`);
  }
  if (accounts.some((account) => account.email && account.email === normalizedEmail)) {
    throw new Error('That email already has an account on this device.');
  }
  const salt = randomSalt();
  const account = {
    id: newId(),
    name: trimmedName,
    email: normalizedEmail,
    salt,
    hash: await hashPin(secret, salt),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  writeJson(KEYS.accounts, accounts);
  setSession({
    mode: 'local',
    accountId: account.id,
    name: account.name,
    email: account.email,
  });

  /*
   * Anything logged before there were accounts sits in the device drawer. The
   * first account to be created takes it over, so records do not appear to
   * vanish the moment somebody signs up.
   */
  if (accounts.length === 1) {
    const orphaned = readJson(KEYS.records(DEVICE_ACCOUNT), []);
    if (orphaned.length) {
      writeJson(KEYS.records(account.id), orphaned);
      localStorage.removeItem(KEYS.records(DEVICE_ACCOUNT));
    }
  }

  return { session, needsConfirmation: false, adopted: accounts.length === 1 };
}

export async function signIn({ accountId, email, password, pin }) {
  const secret = password || pin || '';
  if (BACKEND === 'mysql') return mysqlSignIn({ email: normalizeEmail(email), password: secret });
  if (BACKEND === 'cloud') return cloudSignIn({ email: normalizeEmail(email), password: secret });

  const accounts = readJson(KEYS.accounts, []);
  const account = accountId
    ? accounts.find((item) => item.id === accountId)
    : accounts.find((item) => item.email && item.email === String(email || '').trim().toLowerCase());
  if (!account) throw new Error('No account with that email on this device.');
  if (account.hash) {
    const attempt = await hashPin(secret, account.salt);
    if (attempt !== account.hash) throw new Error('That password does not match.');
  }
  setSession({
    mode: 'local',
    accountId: account.id,
    name: account.name,
    email: account.email || null,
  });
  return session;
}

export async function requestPasswordReset(email) {
  const normalized = normalizeEmail(email);
  if (BACKEND === 'mysql') {
    const origin =
      typeof location !== 'undefined'
        ? location.origin + String(location.pathname || '').replace(/\/index\.html$/i, '')
        : '';
    await api('reset-request', {
      auth: false,
      body: { email: normalized, origin },
    });
    return { sent: true };
  }
  if (BACKEND === 'cloud') {
    await supabase('/auth/v1/recover', {
      method: 'POST',
      auth: false,
      body: { email: normalized },
    });
    return { sent: true };
  }
  throw new Error(
    'Password reset emails need the MySQL backend turned on. Until then, delete the account on this device and make a new one.',
  );
}

export async function completePasswordReset({ token, password }) {
  if (BACKEND !== 'mysql') throw new Error('Password reset is not available.');
  const secret = String(password || '').trim();
  if (!token) throw new Error('That reset link is missing its token. Request a new one.');
  if (secret.length < 8) throw new Error('Password needs at least 8 characters.');
  await api('reset-confirm', { auth: false, body: { token, password: secret } });
  setSession(null);
  return { ok: true };
}

export async function signOut() {
  if (BACKEND === 'mysql' && session?.accessToken) {
    try {
      await api('signout', { body: {} });
    } catch {
      /* Signing out locally matters more than telling the server about it. */
    }
  }
  if (BACKEND === 'cloud' && session?.accessToken) {
    try {
      await supabase('/auth/v1/logout', { method: 'POST' });
    } catch {
      /* Signing out locally matters more than telling the server about it. */
    }
  }
  setSession(null);
}

export async function deleteLocalAccount(accountId) {
  if (BACKEND === 'mysql' || BACKEND === 'cloud') {
    throw new Error('Shared accounts are managed on the server, not deleted from this device.');
  }
  const accounts = readJson(KEYS.accounts, []).filter((account) => account.id !== accountId);
  writeJson(KEYS.accounts, accounts);
  localStorage.removeItem(KEYS.records(accountId));
  localStorage.removeItem(KEYS.profile(accountId));
  if (session?.accountId === accountId) setSession(null);
}

/* ---------- spray records ---------- */

/*
 * The stored fields cover what a pesticide application record is normally
 * expected to show: what was applied, where, when, how much, by whom, on what
 * equipment and in what weather.
 */
export function emptyRecord() {
  return {
    id: null,
    name: '',
    appliedOn: new Date().toISOString().slice(0, 10),
    fieldName: '',
    acres: null,
    crop: '',
    applicationId: '',
    applicationName: '',
    sprayerType: 'boom',
    gpa: null,
    mph: null,
    psi: null,
    spacingInches: null,
    rowSpacingFeet: null,
    nozzles: [],
    dropletClass: '',
    products: [],
    windMph: null,
    windDirection: '',
    airTempF: null,
    humidity: null,
    applicator: '',
    licenseNo: '',
    notes: '',
    calc: null,
  };
}

const RECORD_TO_ROW = {
  id: 'id',
  name: 'name',
  appliedOn: 'applied_on',
  fieldName: 'field_name',
  acres: 'acres',
  crop: 'crop',
  applicationId: 'application_id',
  applicationName: 'application_name',
  sprayerType: 'sprayer_type',
  gpa: 'gpa',
  mph: 'mph',
  psi: 'psi',
  spacingInches: 'spacing_inches',
  rowSpacingFeet: 'row_spacing_feet',
  nozzles: 'nozzles',
  dropletClass: 'droplet_class',
  products: 'products',
  windMph: 'wind_mph',
  windDirection: 'wind_direction',
  airTempF: 'air_temp_f',
  humidity: 'humidity',
  applicator: 'applicator',
  licenseNo: 'license_no',
  notes: 'notes',
  calc: 'calc',
  createdAt: 'created_at',
};

function toRow(record) {
  const row = {};
  for (const [key, column] of Object.entries(RECORD_TO_ROW)) {
    if (key === 'id' && !record.id) continue;
    if (key === 'createdAt') continue;
    if (record[key] !== undefined) row[column] = record[key] === '' ? null : record[key];
  }
  return row;
}

function fromRow(row) {
  const record = {};
  for (const [key, column] of Object.entries(RECORD_TO_ROW)) {
    record[key] = row[column] ?? null;
  }
  record.nozzles = row.nozzles || [];
  record.products = row.products || [];
  return record;
}

function localRecords() {
  return readJson(KEYS.records(activeAccountId()), []);
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const left = a.appliedOn || a.createdAt || '';
    const right = b.appliedOn || b.createdAt || '';
    if (left === right) return (b.createdAt || '').localeCompare(a.createdAt || '');
    return right.localeCompare(left);
  });
}

function mergeQueued(records) {
  const queued = readJson(KEYS.outbox, []);
  if (!queued.length) return records;
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const item of queued) {
    const { queuedAt, ...record } = item;
    if (record.id) byId.set(record.id, record);
  }
  return sortRecords([...byId.values()]);
}

export async function listRecords() {
  if (BACKEND === 'mysql' && session?.mode === 'mysql') {
    await flushOutbox();
    const payload = await api('records', { method: 'GET' });
    return mergeQueued(sortRecords((payload.records || []).map(fromRow)));
  }
  if (BACKEND === 'cloud' && session?.mode === 'cloud') {
    await flushOutbox();
    const rows = await withAuth(() =>
      supabase('/rest/v1/spray_records?select=*&order=applied_on.desc,created_at.desc'),
    );
    return mergeQueued(rows.map(fromRow));
  }
  return sortRecords(localRecords());
}

export async function saveRecord(record) {
  const stamped = {
    ...record,
    createdAt: record.createdAt || new Date().toISOString(),
  };

  if (BACKEND === 'mysql' && session?.mode === 'mysql') {
    if (!stamped.id) stamped.id = newId();
    try {
      const payload = await api('save-record', { body: { record: stamped } });
      return { record: fromRow(payload.record), queued: false };
    } catch (error) {
      if (isNetworkError(error)) {
        queueOutbox(stamped);
        return { record: stamped, queued: true };
      }
      throw error;
    }
  }

  if (BACKEND === 'cloud' && session?.mode === 'cloud') {
    try {
      const row = toRow(stamped);
      const rows = stamped.id
        ? await withAuth(() =>
            supabase(`/rest/v1/spray_records?id=eq.${stamped.id}`, {
              method: 'PATCH',
              body: row,
              headers: { Prefer: 'return=representation' },
            }),
          )
        : await withAuth(() =>
            supabase('/rest/v1/spray_records', {
              method: 'POST',
              body: row,
              headers: { Prefer: 'return=representation' },
            }),
          );
      return { record: fromRow(rows[0]), queued: false };
    } catch (error) {
      /* Out of signal in the field: hold it and push it later rather than
       * losing the record. */
      if (isNetworkError(error)) {
        queueOutbox(stamped);
        return { record: stamped, queued: true };
      }
      throw error;
    }
  }

  const records = localRecords();
  if (!stamped.id) stamped.id = newId();
  const index = records.findIndex((item) => item.id === stamped.id);
  if (index >= 0) records[index] = stamped;
  else records.push(stamped);
  writeJson(KEYS.records(activeAccountId()), records);
  return { record: stamped, queued: false };
}

export async function deleteRecord(id) {
  if (BACKEND === 'mysql' && session?.mode === 'mysql') {
    writeJson(
      KEYS.outbox,
      readJson(KEYS.outbox, []).filter((record) => record.id !== id),
    );
    await api('delete-record', { body: { id } });
    return;
  }
  if (BACKEND === 'cloud' && session?.mode === 'cloud') {
    await withAuth(() =>
      supabase(`/rest/v1/spray_records?id=eq.${id}`, { method: 'DELETE' }),
    );
    return;
  }
  const records = localRecords().filter((record) => record.id !== id);
  writeJson(KEYS.records(activeAccountId()), records);
}

function isNetworkError(error) {
  return error instanceof TypeError || error.message === 'Failed to fetch';
}

/* ---------- offline outbox for cloud mode ---------- */

function queueOutbox(record) {
  const outbox = readJson(KEYS.outbox, []);
  outbox.push({ ...record, queuedAt: new Date().toISOString() });
  writeJson(KEYS.outbox, outbox);
}

export function outboxCount() {
  return readJson(KEYS.outbox, []).length;
}

export async function flushOutbox() {
  if (!session) return 0;
  const outbox = readJson(KEYS.outbox, []);
  if (!outbox.length) return 0;

  if (BACKEND === 'mysql' && session.mode === 'mysql') {
    const remaining = [];
    let pushed = 0;
    for (const record of outbox) {
      try {
        const { queuedAt, ...rest } = record;
        await api('save-record', { body: { record: rest } });
        pushed += 1;
      } catch (error) {
        if (isNetworkError(error) || error.status >= 500) remaining.push(record);
      }
    }
    writeJson(KEYS.outbox, remaining);
    return pushed;
  }

  if (BACKEND !== 'cloud' || session.mode !== 'cloud') return 0;

  const remaining = [];
  let pushed = 0;
  for (const record of outbox) {
    try {
      const { queuedAt, ...rest } = record;
      await withAuth(() =>
        supabase('/rest/v1/spray_records', { method: 'POST', body: toRow(rest) }),
      );
      pushed += 1;
    } catch (error) {
      if (isNetworkError(error)) remaining.push(record);
      /* A record the server rejects outright is dropped rather than retried
       * forever; anything else stays queued. */
    }
  }
  writeJson(KEYS.outbox, remaining);
  return pushed;
}

/* ---------- sprayer profile ---------- */

export function loadProfile() {
  return readJson(KEYS.profile(activeAccountId()), null);
}

export function saveProfile(profile) {
  writeJson(KEYS.profile(activeAccountId()), profile);
}

/* ---------- CSV export ---------- */

const CSV_COLUMNS = [
  ['appliedOn', 'Date'],
  ['name', 'Application name'],
  ['fieldName', 'Field'],
  ['acres', 'Acres'],
  ['crop', 'Crop'],
  ['applicationName', 'Job type'],
  ['sprayerType', 'Sprayer'],
  ['gpa', 'GPA'],
  ['mph', 'MPH'],
  ['psi', 'PSI'],
  ['spacingInches', 'Tip spacing (in)'],
  ['rowSpacingFeet', 'Row spacing (ft)'],
  ['nozzleList', 'Nozzles'],
  ['dropletClass', 'Droplet class'],
  ['productList', 'Products'],
  ['windMph', 'Wind (mph)'],
  ['windDirection', 'Wind direction'],
  ['airTempF', 'Air temp (F)'],
  ['humidity', 'Humidity (%)'],
  ['applicator', 'Applicator'],
  ['licenseNo', 'License no'],
  ['notes', 'Notes'],
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsToCsv(records) {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const lines = records.map((record) => {
    const flat = {
      ...record,
      nozzleList: (record.nozzles || [])
        .map((nozzle) =>
          nozzle.position
            ? `pos ${nozzle.position}: ${nozzle.partNo} @ ${nozzle.psi} PSI`
            : `${nozzle.partNo} @ ${nozzle.psi} PSI`,
        )
        .join('; '),
      productList: (record.products || [])
        .map((product) =>
          [product.name, product.rate, product.unit, product.epaRegNo && `EPA ${product.epaRegNo}`]
            .filter(Boolean)
            .join(' '),
        )
        .join('; '),
    };
    return CSV_COLUMNS.map(([key]) => csvCell(flat[key])).join(',');
  });
  return [header, ...lines].join('\n');
}

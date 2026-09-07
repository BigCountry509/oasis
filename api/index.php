<?php
/*
 * Accounts, sessions and spray records for the nozzle calculator.
 *
 * The static site talks to this file. Call it as:
 *   GET  /api/index.php?action=health
 *   GET  /api/index.php?action=me            Authorization: Bearer <token>
 *   GET  /api/index.php?action=records       Authorization: Bearer <token>
 *   POST /api/index.php                      JSON { action, ... }
 *
 * A device is remembered by a session token that lasts a year. Resetting the
 * password revokes every session, so every other phone and tablet has to sign
 * in again.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

$configFile = __DIR__ . '/config.php';
$config = is_file($configFile) ? require $configFile : [];

function json_out($status, $payload) {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

function uuid() {
  $bytes = random_bytes(16);
  $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
  $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
  $hex = bin2hex($bytes);
  return sprintf(
    '%s-%s-%s-%s-%s',
    substr($hex, 0, 8),
    substr($hex, 8, 4),
    substr($hex, 12, 4),
    substr($hex, 16, 4),
    substr($hex, 20, 12)
  );
}

function read_json_body() {
  $raw = file_get_contents('php://input');
  if ($raw === false || $raw === '') return [];
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function bearer_token() {
  $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
  if (stripos($header, 'Bearer ') === 0) return trim(substr($header, 7));
  return '';
}

function token_hash($token) {
  return hash('sha256', $token);
}

function configured($config) {
  return !empty($config['db_name']) && !empty($config['db_user']);
}

function db($config) {
  static $pdo = null;
  if ($pdo) return $pdo;
  $host = $config['db_host'] ?? '127.0.0.1';
  $port = (int) ($config['db_port'] ?? 3306);
  $name = $config['db_name'];
  $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
  $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'] ?? '', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  return $pdo;
}

function normalize_email($email) {
  $email = strtolower(trim((string) $email));
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_out(400, ['message' => 'Enter a working email. Password resets are sent there.']);
  }
  return $email;
}

function public_user($row) {
  return [
    'id' => $row['id'],
    'name' => $row['name'],
    'email' => $row['email'],
  ];
}

function current_session($pdo) {
  $token = bearer_token();
  if ($token === '') json_out(401, ['message' => 'Sign in again.']);
  $stmt = $pdo->prepare(
    'SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.id, u.name, u.email, u.password_changed_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1'
  );
  $stmt->execute([token_hash($token)]);
  $row = $stmt->fetch();
  if (!$row) json_out(401, ['message' => 'Sign in again.']);
  if ($row['revoked_at']) json_out(401, ['message' => 'This device was signed out. Sign in again.']);
  if (strtotime($row['expires_at']) < time()) json_out(401, ['message' => 'Sign in again.']);
  $pdo->prepare('UPDATE sessions SET last_seen_at = NOW() WHERE id = ?')->execute([$row['session_id']]);
  return $row;
}

function mint_session($pdo, $userId) {
  $token = bin2hex(random_bytes(32));
  $id = uuid();
  $pdo->prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 400 DAY))'
  )->execute([$id, $userId, token_hash($token)]);
  return $token;
}

function revoke_all_sessions($pdo, $userId) {
  $pdo->prepare('UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL')->execute([$userId]);
}

function site_url($config, $body) {
  if (!empty($config['site_url'])) return rtrim($config['site_url'], '/');
  if (!empty($body['origin'])) return rtrim($body['origin'], '/');
  $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
  $scheme = $https ? 'https' : 'http';
  $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return $scheme . '://' . $host;
}

function decode_json_column($value) {
  if ($value === null || $value === '') return [];
  $decoded = json_decode($value, true);
  return is_array($decoded) ? $decoded : [];
}

function record_from_row($row) {
  return [
    'id' => $row['id'],
    'name' => $row['name'],
    'applied_on' => $row['applied_on'],
    'field_name' => $row['field_name'],
    'acres' => $row['acres'] !== null ? (float) $row['acres'] : null,
    'crop' => $row['crop'],
    'application_id' => $row['application_id'],
    'application_name' => $row['application_name'],
    'sprayer_type' => $row['sprayer_type'],
    'gpa' => $row['gpa'] !== null ? (float) $row['gpa'] : null,
    'mph' => $row['mph'] !== null ? (float) $row['mph'] : null,
    'psi' => $row['psi'] !== null ? (float) $row['psi'] : null,
    'spacing_inches' => $row['spacing_inches'] !== null ? (float) $row['spacing_inches'] : null,
    'row_spacing_feet' => $row['row_spacing_feet'] !== null ? (float) $row['row_spacing_feet'] : null,
    'nozzles' => decode_json_column($row['nozzles']),
    'droplet_class' => $row['droplet_class'],
    'products' => decode_json_column($row['products']),
    'wind_mph' => $row['wind_mph'] !== null ? (float) $row['wind_mph'] : null,
    'wind_direction' => $row['wind_direction'],
    'air_temp_f' => $row['air_temp_f'] !== null ? (float) $row['air_temp_f'] : null,
    'humidity' => $row['humidity'] !== null ? (float) $row['humidity'] : null,
    'applicator' => $row['applicator'],
    'license_no' => $row['license_no'],
    'notes' => $row['notes'],
    'calc' => $row['calc'] ? json_decode($row['calc'], true) : null,
    'created_at' => $row['created_at'],
  ];
}

$body = read_json_body();
$action = $_GET['action'] ?? $body['action'] ?? '';

try {
  if ($action === 'health') {
    if (!configured($config)) {
      json_out(200, ['ok' => false, 'reason' => 'not configured']);
    }
    db($config)->query('SELECT 1');
    json_out(200, ['ok' => true, 'backend' => 'mysql']);
  }

  if (!configured($config)) {
    json_out(503, ['message' => 'MySQL is not configured. Fill in api/config.php.']);
  }

  $pdo = db($config);

  if ($action === 'signup') {
    $name = trim((string) ($body['name'] ?? ''));
    $email = normalize_email($body['email'] ?? '');
    $password = (string) ($body['password'] ?? '');
    if ($name === '') json_out(400, ['message' => 'Give the account a name.']);
    if (strlen($password) < 8) json_out(400, ['message' => 'Password needs at least 8 characters.']);

    $exists = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $exists->execute([$email]);
    if ($exists->fetch()) json_out(409, ['message' => 'That email already has an account.']);

    $id = uuid();
    $pdo->prepare(
      'INSERT INTO users (id, name, email, password_hash, password_changed_at) VALUES (?, ?, ?, ?, NOW())'
    )->execute([$id, $name, $email, password_hash($password, PASSWORD_DEFAULT)]);

    $user = ['id' => $id, 'name' => $name, 'email' => $email];
    json_out(200, ['user' => $user, 'token' => mint_session($pdo, $id)]);
  }

  if ($action === 'signin') {
    $email = normalize_email($body['email'] ?? '');
    $password = (string) ($body['password'] ?? '');
    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if (!$user || !password_verify($password, $user['password_hash'])) {
      json_out(401, ['message' => 'That email or password does not match.']);
    }
    json_out(200, ['user' => public_user($user), 'token' => mint_session($pdo, $user['id'])]);
  }

  if ($action === 'signout') {
    $token = bearer_token();
    if ($token !== '') {
      $pdo->prepare('UPDATE sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL')
        ->execute([token_hash($token)]);
    }
    json_out(200, ['ok' => true]);
  }

  if ($action === 'me') {
    json_out(200, ['user' => public_user(current_session($pdo))]);
  }

  if ($action === 'reset-request') {
    $email = normalize_email($body['email'] ?? '');
    $stmt = $pdo->prepare('SELECT id, name, email FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    /* Always look successful so the form cannot be used to hunt for emails. */
    if ($user) {
      $token = bin2hex(random_bytes(32));
      $pdo->prepare(
        'INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 2 HOUR))'
      )->execute([uuid(), $user['id'], token_hash($token)]);
      $base = rtrim(site_url($config, $body), '/');
      $base = preg_replace('#/index\\.html$#i', '', $base);
      $link = $base . '/index.html?reset=' . urlencode($token);
      $from = $config['mail_from'] ?? 'noreply@localhost';
      $bodyText = "Reset the password for {$user['name']}'s nozzle calculator account:\n\n{$link}\n\nThis link lasts two hours. Using it signs every other device out.\n";
      @mail($user['email'], 'Reset your nozzle calculator password', $bodyText, 'From: ' . $from);
    }
    json_out(200, ['sent' => true]);
  }

  if ($action === 'reset-confirm') {
    $token = trim((string) ($body['token'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    if ($token === '' || strlen($password) < 8) {
      json_out(400, ['message' => 'Enter a new password of at least 8 characters.']);
    }
    $stmt = $pdo->prepare(
      'SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at
       FROM password_resets pr
       WHERE pr.token_hash = ?
       LIMIT 1'
    );
    $stmt->execute([token_hash($token)]);
    $reset = $stmt->fetch();
    if (!$reset || $reset['used_at'] || strtotime($reset['expires_at']) < time()) {
      json_out(400, ['message' => 'That reset link is expired or already used. Request a new one.']);
    }
    $pdo->beginTransaction();
    $pdo->prepare('UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?')
      ->execute([password_hash($password, PASSWORD_DEFAULT), $reset['user_id']]);
    $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?')->execute([$reset['id']]);
    revoke_all_sessions($pdo, $reset['user_id']);
    $pdo->commit();
    json_out(200, ['ok' => true]);
  }

  if ($action === 'records' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $user = current_session($pdo);
    $stmt = $pdo->prepare('SELECT * FROM spray_records WHERE user_id = ? ORDER BY applied_on DESC, created_at DESC');
    $stmt->execute([$user['id']]);
    json_out(200, ['records' => array_map('record_from_row', $stmt->fetchAll())]);
  }

  if ($action === 'save-record') {
    $user = current_session($pdo);
    $record = $body['record'] ?? [];
    if (!is_array($record)) json_out(400, ['message' => 'Missing record.']);
    $id = trim((string) ($record['id'] ?? ''));
    if ($id === '') $id = uuid();
    $name = trim((string) ($record['name'] ?? ''));
    if ($name === '') json_out(400, ['message' => 'Give the application a name.']);

    $fields = [
      'name' => $name,
      'applied_on' => $record['appliedOn'] ?? $record['applied_on'] ?? null,
      'field_name' => $record['fieldName'] ?? $record['field_name'] ?? null,
      'acres' => $record['acres'] ?? null,
      'crop' => $record['crop'] ?? null,
      'application_id' => $record['applicationId'] ?? $record['application_id'] ?? null,
      'application_name' => $record['applicationName'] ?? $record['application_name'] ?? null,
      'sprayer_type' => $record['sprayerType'] ?? $record['sprayer_type'] ?? null,
      'gpa' => $record['gpa'] ?? null,
      'mph' => $record['mph'] ?? null,
      'psi' => $record['psi'] ?? null,
      'spacing_inches' => $record['spacingInches'] ?? $record['spacing_inches'] ?? null,
      'row_spacing_feet' => $record['rowSpacingFeet'] ?? $record['row_spacing_feet'] ?? null,
      'nozzles' => json_encode($record['nozzles'] ?? []),
      'droplet_class' => $record['dropletClass'] ?? $record['droplet_class'] ?? null,
      'products' => json_encode($record['products'] ?? []),
      'wind_mph' => $record['windMph'] ?? $record['wind_mph'] ?? null,
      'wind_direction' => $record['windDirection'] ?? $record['wind_direction'] ?? null,
      'air_temp_f' => $record['airTempF'] ?? $record['air_temp_f'] ?? null,
      'humidity' => $record['humidity'] ?? null,
      'applicator' => $record['applicator'] ?? null,
      'license_no' => $record['licenseNo'] ?? $record['license_no'] ?? null,
      'notes' => $record['notes'] ?? null,
      'calc' => isset($record['calc']) ? json_encode($record['calc']) : null,
    ];

    $owned = $pdo->prepare('SELECT id FROM spray_records WHERE id = ? AND user_id = ?');
    $owned->execute([$id, $user['id']]);
    if ($owned->fetch()) {
      $pdo->prepare(
        'UPDATE spray_records SET
          name=?, applied_on=?, field_name=?, acres=?, crop=?, application_id=?, application_name=?,
          sprayer_type=?, gpa=?, mph=?, psi=?, spacing_inches=?, row_spacing_feet=?, nozzles=?,
          droplet_class=?, products=?, wind_mph=?, wind_direction=?, air_temp_f=?, humidity=?,
          applicator=?, license_no=?, notes=?, calc=?
         WHERE id=? AND user_id=?'
      )->execute(array_merge(array_values($fields), [$id, $user['id']]));
    } else {
      $pdo->prepare(
        'INSERT INTO spray_records (
          id, user_id, name, applied_on, field_name, acres, crop, application_id, application_name,
          sprayer_type, gpa, mph, psi, spacing_inches, row_spacing_feet, nozzles, droplet_class,
          products, wind_mph, wind_direction, air_temp_f, humidity, applicator, license_no, notes, calc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      )->execute(array_merge([$id, $user['id']], array_values($fields)));
    }
    $stmt = $pdo->prepare('SELECT * FROM spray_records WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $user['id']]);
    json_out(200, ['record' => record_from_row($stmt->fetch())]);
  }

  if ($action === 'delete-record') {
    $user = current_session($pdo);
    $id = trim((string) ($body['id'] ?? $_GET['id'] ?? ''));
    if ($id === '') json_out(400, ['message' => 'Missing record.']);
    $pdo->prepare('DELETE FROM spray_records WHERE id = ? AND user_id = ?')->execute([$id, $user['id']]);
    json_out(200, ['ok' => true]);
  }

  json_out(404, ['message' => 'Unknown action.']);
} catch (PDOException $error) {
  json_out(500, ['message' => 'Database error. Check api/config.php and that mysql/schema.sql has been run.']);
} catch (Throwable $error) {
  json_out(500, ['message' => 'The account service could not complete that.']);
}

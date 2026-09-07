-- Spray records and accounts for the nozzle calculator.
--
-- Run this once against the MySQL / MariaDB database you created for the site.
-- On Pterodactyl that is the database listed under the server's Databases tab.

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY sessions_token_unique (token_hash),
  KEY sessions_user_idx (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  UNIQUE KEY password_resets_token_unique (token_hash),
  KEY password_resets_user_idx (user_id),
  CONSTRAINT password_resets_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS spray_records (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  applied_on DATE NULL,
  field_id CHAR(36) NULL,
  field_name VARCHAR(200) NULL,
  acres DECIMAL(10,2) NULL,
  crop VARCHAR(120) NULL,
  application_id VARCHAR(64) NULL,
  application_name VARCHAR(160) NULL,
  sprayer_type VARCHAR(32) NULL,
  gpa DECIMAL(10,3) NULL,
  mph DECIMAL(10,3) NULL,
  psi DECIMAL(10,2) NULL,
  spacing_inches DECIMAL(10,2) NULL,
  row_spacing_feet DECIMAL(10,2) NULL,
  nozzles LONGTEXT NULL,
  droplet_class VARCHAR(16) NULL,
  products LONGTEXT NULL,
  wind_mph DECIMAL(10,2) NULL,
  wind_direction VARCHAR(40) NULL,
  air_temp_f DECIMAL(10,2) NULL,
  humidity DECIMAL(10,2) NULL,
  applicator VARCHAR(160) NULL,
  license_no VARCHAR(80) NULL,
  notes TEXT NULL,
  calc LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY spray_records_user_date_idx (user_id, applied_on),
  KEY spray_records_field_idx (field_id),
  CONSTRAINT spray_records_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fields (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  acres DECIMAL(10,2) NULL,
  crop VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY fields_user_idx (user_id),
  CONSTRAINT fields_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

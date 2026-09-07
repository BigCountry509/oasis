<?php
/*
 * Copy this file to config.php and fill in the MySQL database from the
 * Pterodactyl Databases tab (or any MySQL / MariaDB you are using).
 *
 * config.php is what the API actually reads. Keep it next to index.php.
 */

return [
  'db_host' => '127.0.0.1',
  'db_port' => 3306,
  'db_name' => 'nozzlecalc',
  'db_user' => 'nozzlecalc',
  'db_pass' => '',
  /* Used in password-reset emails. Leave blank and the API will use the
   * page that called it. */
  'site_url' => '',
  /* From address for reset emails. The server's mail() has to work for
   * those to leave the box. */
  'mail_from' => 'noreply@localhost',
];

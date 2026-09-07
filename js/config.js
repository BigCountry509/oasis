/*
 * Where accounts and spray records live.
 *
 * API_URL points at the PHP/MySQL backend that ships with this site. Leave it
 * as '/api' on a host that can run PHP (Pterodactyl, any nginx+php-fpm box).
 * Fill in api/config.php and run mysql/schema.sql and the same account works
 * on every phone and computer. A blank string skips the MySQL probe.
 *
 * SUPABASE_URL / SUPABASE_ANON_KEY are an optional fallback if you would
 * rather use a hosted Supabase project instead of your own MySQL. Leave them
 * blank unless you are using that path. Setup is in README.md.
 */

export const API_URL = '/api';
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

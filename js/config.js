/*
 * Optional cloud sync.
 *
 * Leave these blank and the site still works completely: accounts and spray
 * records are kept in the browser on the device you are using. That is enough
 * for one tablet in one cab, and it needs no signup and no internet.
 *
 * Fill both in with a free Supabase project and accounts become real accounts:
 * you sign in with an email and password, records sync, and the same log shows
 * up on the office computer and every phone. Setup is in README.md under
 * "Turning on real accounts", and the table it needs is in supabase/schema.sql.
 *
 * The anon key is designed to be public and safe to commit. Row level security
 * in schema.sql is what stops one account reading another's records.
 */

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

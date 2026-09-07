# Nozzle Calculator

A spray tip selection calculator and application log for farm sprayers. Pick the kind of
application, enter your rate, speed, spacing and pressure limits, and it tells you which TeeJet tip
to fit, what pressure to set it at, and what droplet size you will actually get. It keeps a log of
what you sprayed, with the nozzles you used, under an account.

It is a plain website. The calculator itself is static HTML, CSS and JavaScript with
no build step. Put the files on any web host and it runs. To share accounts and spray
records across phones and computers, host it on a box that can run PHP and MySQL
(Pterodactyl with the nginx + PHP-FPM egg is the intended setup) and fill in
`api/config.php`.

## What it does

**Nozzle recommendation.** Choose a boom sprayer or an air blast sprayer, then choose the job:
burndown and residual, contact herbicide, systemic herbicide, restricted auxins like dicamba and
2,4-D choline, fungicide, insecticide, liquid fertilizer broadcast or streamed, band spraying, PGRs and harvest aids, or
air blast fungicide, insecticide, drift sensitive and foliar passes. Each job carries its own target
droplet spectrum and carrier volume range, so the same rate and speed give different answers for a
contact herbicide than for a residual.

For every tip in the catalog the tool solves the exact pressure that delivers your rate, throws away
anything that lands outside the tip's published pressure range or outside your own sprayer's limits,
looks up the published droplet class at that pressure, and ranks what is left. You get the part
number, the pressure to set, the flow per tip in GPM and in ounces per minute for a catch test, the
rate it will actually deliver, and the droplet class, plus a rate table for that tip across
pressures and speeds.

**Air blast is calculated differently**, because it is a different machine. Flow comes from row
spacing in feet rather than tip spacing in inches, it is split between the two manifolds, and about
seventy per cent of the volume is put on the top half of the canopy. You get a nozzle for each
position rather than one tip for the whole machine. Orchard machines like a Rears Powerblast are
answered with disc-core nozzles named the way they are ordered: a D3 45 is a number 3 disc on a 45
core.

**Spray log.** Save any recommendation as a record: name, date, field, acres, crop, the nozzles and
pressure you ran, products with EPA registration numbers and rates, wind, temperature, humidity,
applicator and license number, and notes. Search it, edit it, and export the whole thing to CSV.

**Tools.** Catch test targets and a tip wear check that tells you when a tip is more than ten per
cent over its rating and needs replacing, tank and acreage math, and a browsable catalog of every
tip with its rating, pressure range and droplet class at each charted pressure.

If a rate and speed cannot be reached at all, the tool says so and says why, rather than showing an
empty list or a tip that is a long way off rate. It tells you whether you are asking for more flow
than the tips can pass or less than they will pass at minimum pressure, and gives the ground speed
that brings the rate back in reach.

It also installs to a phone home screen and works with no signal, which is where it gets used.

## Hosting it

### Pterodactyl (MySQL accounts, the intended setup)

Use an nginx egg that has PHP-FPM, such as tenten8401's nginx egg. Keep the egg's
`start.sh`, `nginx/` and `php-fpm/` files at the **server root**. Put this site in
**`webroot/`**, including the `api/` folder.

1. Copy the site into `webroot/` so you have `webroot/index.html`, `webroot/js/`,
   `webroot/api/`, `webroot/mysql/` and so on.
2. In the Pterodactyl **Databases** tab, create a MySQL database. Note the host,
   port, database name, username and password.
3. In a MySQL client (or `mysql` from the database tab), run the contents of
   [`mysql/schema.sql`](mysql/schema.sql). That creates `users`, `sessions`,
   `password_resets` and `spray_records`.
4. Edit [`api/config.php`](api/config.php) (on the server that is
   `webroot/api/config.php`) and fill in those database values. Leave
   `site_url` blank unless password-reset emails should use a specific public URL.
5. Reload the site. The footer should say records are stored in MySQL. Create an
   account with a name, email and password. That same login works on every device.

Do not commit a filled-in `config.php` with a real password. Keep secrets on the
server.

The PHP API lives at `/api/index.php`. The page probes `/api/index.php?action=health`
on load. Until `config.php` has a database name and user, the site keeps using
browser storage so a missing database does not break the calculator.

**Device remembering.** After you sign in, this browser keeps a session token for
about a year. You do not sign in again on that phone or computer unless you sign
out, clear the site data, or reset the password.

**Password reset.** Forgot password emails the address on the account (this uses
PHP `mail()`, which only works if the host can send mail). Opening the link and
setting a new password **revokes every session**, so every other device has to
sign in again. That is the point: a reset password is useless if the old devices
stay logged in.

### GitHub Pages, the free option

1. Push this repository to GitHub.
2. Go to **Settings > Pages**.
3. Under **Source** choose **Deploy from a branch**, pick the branch, choose the `/ (root)` folder,
   and save.
4. Wait a minute and the site is live at `https://<your-username>.github.io/<repository>/`.

Bookmark that on your phone and use **Add to Home Screen** so it opens like an app.

### Any other host

Copy the whole folder to any static host or web server: Netlify, Cloudflare Pages, Vercel, S3, or a
folder on your own web server. There is nothing to compile.

### Running it locally

Because it uses JavaScript modules, opening `index.html` straight off the disk will not work. Serve
it instead:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

To try the MySQL API on your own machine, serve with PHP so `/api/index.php` runs:

```bash
php -S localhost:8080
```

Fill in `api/config.php` against a local MySQL database first.

## Accounts and where your records go

The site picks a backend in this order:

1. **MySQL**, if `/api` answers healthy (fill in `api/config.php` and run
   `mysql/schema.sql`). Accounts, passwords and spray records live in your database.
   The same login and the same log work on every phone and computer. A device stays
   signed in until you sign out or the password is reset.
2. **Supabase**, if you fill in `js/config.js` instead and MySQL is not configured.
3. **This browser**, if neither of those is set up. Accounts and records stay on
   that one device. Creating an account still needs a name, an email and a password
   of at least eight characters.

Multiple local accounts on one device keep separate logs, which is useful for a
shared cab tablet. Export a CSV occasionally so you have a copy.

Password reset emails go out from the MySQL API (or from Supabase if you are on
that path). Until a shared backend is on, delete the account on the device and
make a new one.

### Optional: Supabase instead of MySQL

Fill in `js/config.js` with a free [Supabase](https://supabase.com) project and accounts become real
accounts with an email and password, records stored server side, and the same log on every phone and
the office computer.

1. Create a free Supabase project.
2. In the Supabase dashboard open **SQL Editor**, paste in the contents of
   [`supabase/schema.sql`](supabase/schema.sql) and run it. That creates the `spray_records` table
   and the row level security policies that stop any account reading another's records.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
4. Put both into [`js/config.js`](js/config.js):

   ```js
   export const SUPABASE_URL = 'https://yourproject.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

5. Commit and push. The site will now show email and password sign in.

The anon key is designed to be public and is safe to commit; row level security is what protects the
data. If you would rather not have people signing themselves up, turn off public signups under
**Authentication > Providers** in Supabase and create the accounts yourself.

Enable the email provider and confirm that **password reset** is on. The site's Forgot password
button calls Supabase's recover endpoint and sends the reset link to the email the account was
created with.

Records saved while out of signal are held on the device and pushed up the next time the app loads
with a connection.

## The math

Boom sprayer, per tip:

```
GPM = (GPA x MPH x tip spacing in inches) / 5940
```

For band spraying the band width replaces the tip spacing. For directed applications the flow is
divided by the number of tips on each row.

Air blast, whole machine:

```
GPM total = (GPA x MPH x row spacing in feet) / 495     both sides in one pass
GPM total = (GPA x MPH x row spacing in feet) / 990     one side per pass
```

Tip flow against pressure, which is what makes the tip selection solvable rather than a table
lookup:

```
flow at any pressure = rating x sqrt(pressure / 40)
```

Every TeeJet capacity number is the flow in US GPM at 40 PSI, so an 11003 is 0.30 GPM at 40 PSI.
Because flow follows the square root of pressure, four times the pressure only doubles the flow.
That is why pressure is for small trims and a tip change is for real changes.

Liquid fertilizer is heavier than water and the tip charts are printed for water, so a fertilizer
job asks for the solution weight and sizes the tip on the water equivalent flow:

```
water equivalent flow = flow you want x sqrt(lb per gallon / 8.34)
```

At 10.66 lb per gallon, 28 per cent UAN comes out about 13 per cent slower than water through the
same tip at the same pressure, which matches the conversion factor TeeJet tabulates. Skip that and
you under apply by that much all day.

## Where the data comes from

| Data | Source |
| --- | --- |
| Droplet size classes for boom flat fans | TeeJet LI-TJ420, droplet size data to the ISO 25358 standard, 15 inch tip spacing chart |
| DG TeeJet droplet classes and capacities | The droplet size and application rate tables on its TeeJet product page, also ISO 25358 |
| TF Turbo FloodJet and TK FloodJet | TeeJet catalog CAT52-US, capacities from the series pages and droplet classes from the classification appendix |
| StreamJet SJ3 and SJ7A capacities | TeeJet catalog CAT52-US, fertilizer nozzle section |
| Boom tip capacities and pressure ranges | TeeJet published capacity charts and recommended pressure ranges per series |
| Air blast cone tips and disc-core capacity tables | TeeJet catalog CAT52-US, air blast nozzle section |
| Air blast calibration constants and canopy volume split | University extension orchard and air blast sprayer calibration guidance |
| Liquid density correction | TeeJet catalog liquid density conversion factors |

Tip families included:

- **Boom flat fans:** XR/XRC, TT, TTJ60, AIXR, AI3070, AITTJ60, AI/AIC, TTI60, TTI, DG
- **Flooding:** TF Turbo FloodJet and TK FloodJet
- **Fertilizer streamer bars:** StreamJet SJ3 (three streams) and SJ7A (seven streams)
- **Air blast and directed cones:** TXA/TXB ConeJet, AITXA/AITXB air induction ConeJet
- **Air blast disc and core:** D disc with DC25, DC45 and DC56 cores, named the way they are ordered
  in the shop (a D3 disc on a 45 core is a **D3 45**). These are the nozzles a Rears Powerblast runs.

Droplet classifications are published at set pressures and against a specific standard, and TeeJet
revises them. The tool tells you when the droplet class it shows came from the nearest charted
pressure rather than your exact one.

Some families are handled as exceptions, all for the same reason: the tool only quotes numbers it
can cite.

- **A flooding tip is numbered for its flow at 10 PSI, not the usual 40.** A TF-VP4 is 0.4 GPM at
  10 PSI and 0.8 GPM at 40, so its rating is twice the number in the part code. Every other family
  in the catalog is numbered at 40 PSI. The tool stores the 40 PSI figure and says so on screen,
  because reading a flooding tip as though it were a flat fan puts you a size out.
- **The TK FloodJet only carries the sizes TeeJet charts droplets for**, which is TK-1 through
  TK-10. The .50, .75, 15, 20 and 30 sizes exist but have no published classification, and the
  ranking scores on that classification, so they are left out rather than guessed at.
- **Streamer bars have no droplet class**, because a solid stream has no droplet spectrum to
  classify. They are offered for fertilizer jobs only and never for anything that has to hit a leaf.
  Their published capacities also do not follow the square root law, so the printed table is stored
  and read directly instead of being derived from the 40 PSI figure.
- **Disc and core assemblies have no published droplet class**, so the pick is on flow rather than
  spectrum. They are the standard Rears Powerblast nozzle. People call them by the pair: a D3 45 is
  a number 3 disc on a 45 core. Their published capacities are stored as a table, the same way the
  streamer bars are, because a dash in TeeJet's chart means that disc and core are not rated at that
  pressure.

## Adding or changing tips

All tip data lives in [`js/data/nozzles.js`](js/data/nozzles.js). Boom flat fans are a droplet class
grid copied from the TeeJet chart, keyed by capacity and pressure, with the flow derived from the
capacity number. To add a flat fan series, add an entry to `BOOM_SERIES_META` with its published
pressure range and add its column to the droplet grid.

Families charted at their own pressures or with their own capacity numbers, such as DG and the
Turbo FloodJet, go in `FAN_SERIES_META` with their own droplet table. Streamer bars go in
`STREAM_SERIES_META` with their published flow table. Disc and core capacities live in
`DISC_CORE_SETS` and are built into the tip list the calculator searches, named as D3 45 rather
than D3-DC45.

Job presets, their target droplet ranges and their guidance text live in
[`js/data/applications.js`](js/data/applications.js).

If you change the data or the app files, bump `CACHE_VERSION` in [`sw.js`](sw.js) so installed phones
pick up the new version instead of serving the old one from cache.

## Tests

The calibration math is checked against published TeeJet chart values and worked extension service
examples, so a failure means the calculator has drifted from the printed charts.

```bash
npm test
```

No dependencies to install; it uses the Node built in test runner.

## The label is the law

This tool does arithmetic and reads published tip charts. It does not replace the pesticide label,
your state regulations, or a catch test.

- Restricted auxin products and other label restricted products carry an enforceable approved nozzle
  list with a required tip, pressure range and minimum carrier volume. Those lists change, and so do
  registrations. Confirm the current label for your exact product, crop and state before you buy
  tips or spray.
- Always confirm your actual output with a catch test. Tips wear, strainers plug, and a tip more than
  ten per cent over its rating is putting on more than you think.

# Nozzle Calculator

A spray tip selection calculator and application log for farm sprayers. Pick the kind of
application, enter your rate, speed, spacing and pressure limits, and it tells you which TeeJet tip
to fit, what pressure to set it at, and what droplet size you will actually get. It keeps a log of
what you sprayed, with the nozzles you used, under an account.

It is a plain static website. No build step, no server, no dependencies. Put the files on any web
host and it runs.

## What it does

**Nozzle recommendation.** Choose a boom sprayer or an air blast sprayer, then choose the job:
burndown and residual, contact herbicide, systemic herbicide, restricted auxins like dicamba and
2,4-D choline, fungicide, insecticide, liquid fertilizer, band spraying, PGRs and harvest aids, or
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
spacing in feet rather than tip spacing in inches, it is split between the two manifolds, and it is
then graded across the nozzle positions so about seventy per cent of the volume goes into the top
half of the canopy. You get a tip for each position rather than one tip for the whole machine.

**Spray log.** Save any recommendation as a record: name, date, field, acres, crop, the nozzles and
pressure you ran, products with EPA registration numbers and rates, wind, temperature, humidity,
applicator and license number, and notes. Search it, edit it, and export the whole thing to CSV.

**Tools.** Catch test targets and a tip wear check that tells you when a tip is more than ten per
cent over its rating and needs replacing, plus tank and acreage math.

It also installs to a phone home screen and works with no signal, which is where it gets used.

## Hosting it

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

## Accounts and where your records go

Out of the box, accounts and spray records are stored **in the browser on the device you are using**.
Nothing is uploaded and there is nothing to sign up for. Multiple accounts on one device keep
separate logs, which is useful for a shared cab tablet. The optional PIN is a divider between
operators, not real security: anyone with the device can read browser storage. Export a CSV
occasionally so you have a copy.

### Turning on real accounts

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

## Where the data comes from

| Data | Source |
| --- | --- |
| Droplet size classes for boom tips | TeeJet LI-TJ420, droplet size data to the ISO 25358 standard, 15 inch tip spacing chart |
| Boom tip capacities and pressure ranges | TeeJet published capacity charts and recommended pressure ranges per series |
| Air blast cone tips | TeeJet catalog CAT52-US, air blast nozzle section |
| Air blast calibration constants and canopy volume split | University extension orchard and air blast sprayer calibration guidance |

Tip families included:

- **Boom flat fans:** XR/XRC, TT, TTJ60, AIXR, AI3070, AITTJ60, AI/AIC, TTI60, TTI
- **Air blast and directed cones:** TXA/TXB ConeJet, AITXA/AITXB air induction ConeJet

Not included: disc and core combination nozzles, flooding tips and streamer bars. Those are on the
list rather than guessed at, because the published tables for them are laid out differently and this
tool only quotes numbers it can cite.

Droplet classifications are published at set pressures and against a specific standard, and TeeJet
revises them. The tool tells you when the droplet class it shows came from the nearest charted
pressure rather than your exact one.

## Adding or changing tips

All tip data lives in [`js/data/nozzles.js`](js/data/nozzles.js). Boom tips are a droplet class grid
copied from the TeeJet chart, keyed by capacity and pressure, with the flow derived from the
capacity number. To add a series, add an entry to `BOOM_SERIES_META` with its published pressure
range and add its column to the droplet grid.

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

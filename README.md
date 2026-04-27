# CME Crude Oil Scraper

Scrapes CME Crude Oil futures quotes from:

```text
https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html
```

## Run Locally

```bash
npm install
npm run install:browsers
npm run scrape:once
```

## Run Loop

```bash
npm start
```

Default loop interval is 5 minutes.

## Output

Each run writes timestamped files:

```text
data/raw/cme_crude_oil_quotes_YYYYMMDDTHHMMSSZ_raw.json
data/processed/cme_crude_oil_quotes_YYYYMMDDTHHMMSSZ.json
data/processed/cme_crude_oil_quotes_YYYYMMDDTHHMMSSZ.csv
```

CSV contains the main quote table columns:

```text
MONTH, OPTIONS, CHART, LAST, CHANGE, PRIOR SETTLE, OPEN, HIGH, LOW, VOLUME, UPDATED
```

JSON contains the same rows plus scrape metadata, source URL, API URL, schema version, delayed-data flag, and raw file path.

## Ubuntu Server

Run these commands from the scraper repo, not from `/root/bouncer`.

CME rejects normal raw HTTP requests and can reject headless browser bootstrap.
Use a headed browser under Xvfb on the bouncer-style Ubuntu servers:

```bash
cd /root/scraper
sudo apt update
sudo apt install --yes xvfb
npm install
npm run install:browsers:linux
xvfb-run -a node scraper.js --loop --headed
```

Bouncer-style background run:

```bash
cd /root/scraper
pkill -f "node scraper.js"
setsid xvfb-run -a node scraper.js --loop --headed &> scraper.logs &
```

If the repo is not on the server yet, put it next to bouncer:

```bash
cd /root
git clone https://github.com/inwenis/scraper scraper
cd scraper
```

Or copy the repo from your machine:

```powershell
scp -r C:\git\scraper root@prod-3.bounce.ovh:/root/scraper
```

## Useful Options

```bash
node scraper.js --once
node scraper.js --loop --interval-minutes=5
node scraper.js --loop --output-dir=/var/data/cme-crude-oil
node scraper.js --loop --browser-channel=chrome --headed
```

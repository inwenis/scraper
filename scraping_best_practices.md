# Good Practices for Writing Data Scrapers

## 1. Development & Local Testing

- **A scraper should always be runnable locally.**  
  → Runs on a developer machine without requiring the production framework

- **Avoid hard dependencies on external infrastructure.**  
  → When running locally, output data to a file instead of external systems (DB, queue)

- **Separate scraping from data processing.**  
  → Fetching data is independent from transforming or storing it

- **Allow the scraper to run for an arbitrary date.**  
  → Supports CLI parameters:
  - `--date=2026-02-01`
  - `--date=yesterday`
  - `--date=D-1`
  → Enables debugging, replay, backfills, and testing time logic


## 2. Reliability & Failure Handling

- **Always add timeouts to requests.**  
  → Prevents scrapers from hanging indefinitely

- **Implement retry logic.**  
  → Automatically retries failed requests

- **Use meaningful retry policies.**  
  → Prefer exponential backoff over immediate retries


## 3. Debugging & Observability

- **Log outgoing requests.**  
  → Makes failures traceable

- **Log request parameters (with care).**  
  → Enables reproduction of issues  
  - Obfuscate credentials and secrets

- **Wrap the HTTP client.**  
  → Centralized logging and behavior for all requests

- **Support HTTP interception tools.**  
  → Compatible with tools like Fiddler for traffic inspection


## 4. Data Correctness & Time Handling

- **Test around DST transitions.**  
  → US and EU have different DST switch dates

- **Avoid scraping a single day only.**  
  → Data is often delayed

- **Use overlapping time windows.**  
  → Example:
  - yesterday + today
  - today + tomorrow


## 5. Replayability, Backfills, and Idempotency

- **Ensure idempotent writes.**  
  → Same run does not duplicate or corrupt data  
  - Use stable keys (e.g. source + timestamp)

- **Support backfill mode.**  
  → Example:
  - `--from 2026-01-01 --to 2026-01-31`  
  → Same logic as daily runs

- **Ensure deterministic outputs.**  
  → Same input → same output  
  - Avoid hidden dependencies on "now"


## 6. Data Quality Controls

- **Validate data before publishing.**  
  → Check:
  - row counts
  - completeness (no missing intervals)
  - numeric bounds
  - expected patterns

- **Version your schema.**  
  → Treat output as a contract

- **Track freshness and completeness.**  
  → Include metadata:
  - source timestamp
  - scrape timestamp
  - coverage interval
  - completeness flags


## 7. Managing External Dependencies and Source Changes

- **Implement rate limiting.**  
  → Respect upstream limits  
  → Add jitter to reduce load spikes

- **Handle pagination robustly.**  
  → Retry per page or checkpoint progress

- **Detect upstream changes early.**  
  → Monitor:
  - parsing failures
  - empty responses
  - unexpected formats


## 8. Operational Excellence

- **Use structured logging.**  
  → Include:
  - run_id
  - source
  - date
  - request_id

- **Emit metrics.**  
  → Track:
  - success/failure counts
  - retries
  - durations
  - records processed

- **Use clear exit codes.**  
  → Distinguish:
  - no data expected
  - fetch failure
  - parsing error


## 9. Storage and Provenance

- **Store raw responses (temporarily).**  
  → Enables debugging without re-scraping

- **Use raw → processed pipeline.**  
  → Flow:
  1. store raw data
  2. parse to canonical format
  3. validate
  4. publish

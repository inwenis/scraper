const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { setTimeout: sleep } = require('node:timers/promises')
const { chromium } = require('playwright')

const SOURCE_NAME = 'cme_crude_oil_quotes'
const SOURCE_URL = 'https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html'
const API_URL_BASE = 'https://www.cmegroup.com/CmeWS/mvc/quotes/v2/425?isProtected'
const PRODUCT_ID = 425
const PRODUCT_CODE = 'CL'
const SCHEMA_VERSION = 1
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'data')
const DEFAULT_RETRIES = 3
const DEFAULT_TIMEOUT_MS = 60 * 1000
const TABLE_COLUMNS = [
  'MONTH',
  'OPTIONS',
  'CHART',
  'LAST',
  'CHANGE',
  'PRIOR SETTLE',
  'OPEN',
  'HIGH',
  'LOW',
  'VOLUME',
  'UPDATED'
]

function log(level, message, fields = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...fields
  }))
}

function parseArgs(argv) {
  const options = {
    loop: true,
    intervalMs: Number(process.env.SCRAPE_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    outputDir: process.env.OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    headless: parseBoolean(process.env.PLAYWRIGHT_HEADLESS, false),
    browserChannel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    navigationTimeoutMs: Number(process.env.NAVIGATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    apiTimeoutMs: Number(process.env.API_TIMEOUT_MS || 30 * 1000),
    retries: Number(process.env.SCRAPE_RETRIES || DEFAULT_RETRIES)
  }

  for (const arg of argv) {
    if (arg === '--once') options.loop = false
    else if (arg === '--loop') options.loop = true
    else if (arg === '--headless') options.headless = true
    else if (arg === '--headed') options.headless = false
    else if (arg.startsWith('--interval-ms=')) options.intervalMs = Number(arg.slice('--interval-ms='.length))
    else if (arg.startsWith('--interval-seconds=')) options.intervalMs = Number(arg.slice('--interval-seconds='.length)) * 1000
    else if (arg.startsWith('--interval-minutes=')) options.intervalMs = Number(arg.slice('--interval-minutes='.length)) * 60 * 1000
    else if (arg.startsWith('--output-dir=')) options.outputDir = path.resolve(arg.slice('--output-dir='.length))
    else if (arg.startsWith('--browser-channel=')) options.browserChannel = arg.slice('--browser-channel='.length) || undefined
    else if (arg.startsWith('--navigation-timeout-ms=')) options.navigationTimeoutMs = Number(arg.slice('--navigation-timeout-ms='.length))
    else if (arg.startsWith('--api-timeout-ms=')) options.apiTimeoutMs = Number(arg.slice('--api-timeout-ms='.length))
    else if (arg.startsWith('--retries=')) options.retries = Number(arg.slice('--retries='.length))
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error('--interval-ms must be positive')
  }
  if (!Number.isFinite(options.navigationTimeoutMs) || options.navigationTimeoutMs <= 0) {
    throw new Error('--navigation-timeout-ms must be positive')
  }
  if (!Number.isFinite(options.apiTimeoutMs) || options.apiTimeoutMs <= 0) {
    throw new Error('--api-timeout-ms must be positive')
  }
  if (!Number.isInteger(options.retries) || options.retries < 0) {
    throw new Error('--retries must be a non-negative integer')
  }

  return options
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false
  return fallback
}

function printHelp() {
  console.log(`
Usage:
  node scraper.js --loop
  node scraper.js --once

Options:
  --once                         Run one scrape and exit.
  --loop                         Run forever. Default.
  --interval-minutes=5           Loop delay. Default: 5.
  --interval-seconds=300         Alternative loop delay.
  --interval-ms=300000           Alternative loop delay.
  --output-dir=./data            Output root dir. Default: ./data.
  --headed                       Launch headed browser for CME session. Default.
  --headless                     Launch headless browser. CME may reject this.
  --browser-channel=chrome       Use installed Chrome or Edge channel.
  --navigation-timeout-ms=60000   Browser bootstrap timeout.
  --api-timeout-ms=30000          CME API timeout.
  --retries=3                    Retry count for browser/API work.
`)
}

async function withRetries(label, retries, fn) {
  let lastError
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      if (error.status === 401 || error.status === 403) break
      if (attempt > retries) break
      const delayMs = Math.min(30_000, 1_000 * (2 ** (attempt - 1)))
      log('warn', `${label} failed; retrying`, {
        attempt,
        retries,
        delayMs,
        error: error.message
      })
      await sleep(delayMs)
    }
  }
  throw lastError
}

async function createSession(options) {
  return await withRetries('browser_session', options.retries, async () => {
    let browser
    try {
      const launchOptions = {
        headless: options.headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      }

      if (options.browserChannel) {
        launchOptions.channel = options.browserChannel
      }

      log('info', 'opening CME page for protected session', {
        sourceUrl: SOURCE_URL,
        headless: options.headless,
        browserChannel: options.browserChannel || 'playwright-default'
      })

      browser = await chromium.launch(launchOptions)
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1200 },
        locale: 'en-US',
        timezoneId: 'America/Chicago'
      })
      const page = await context.newPage()

      await page.goto(SOURCE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: options.navigationTimeoutMs
      })
      await page.locator('table tbody tr').first().waitFor({
        timeout: options.navigationTimeoutMs
      })

      const cookies = await context.cookies('https://www.cmegroup.com')
      const userAgent = await page.evaluate(() => navigator.userAgent)
      const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')

      if (!cookieHeader) {
        throw new Error('CME session has no cookies')
      }

      log('info', 'CME session ready', {
        cookieCount: cookies.length,
        userAgent
      })

      return {
        cookieHeader,
        userAgent,
        createdAt: new Date().toISOString()
      }
    } catch (error) {
      if (!options.headless && /XServer|DISPLAY|headed browser/i.test(error.message)) {
        throw new Error(`${error.message} On Linux servers, run with xvfb-run -a node scraper.js --loop --headed`)
      }
      throw error
    } finally {
      if (browser) {
        await browser.close().catch(closeError => {
          log('warn', 'browser close failed', { error: closeError.message })
        })
      }
    }
  })
}

async function fetchQuotes(session, options) {
  return await withRetries('quotes_api', options.retries, async () => {
    const apiUrl = `${API_URL_BASE}&_t=${Date.now()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.apiTimeoutMs)

    log('info', 'requesting CME quotes API', {
      apiUrl,
      timeoutMs: options.apiTimeoutMs
    })

    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          accept: 'application/json, text/plain, */*',
          referer: SOURCE_URL,
          'user-agent': session.userAgent,
          cookie: session.cookieHeader
        }
      })

      const rawText = await response.text()
      if (!response.ok) {
        const error = new Error(`CME API returned HTTP ${response.status}`)
        error.status = response.status
        error.body = rawText.slice(0, 500)
        throw error
      }

      return {
        apiUrl,
        rawText,
        payload: JSON.parse(rawText)
      }
    } finally {
      clearTimeout(timeout)
    }
  })
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.quotes)) {
    throw new Error('CME payload missing quotes array')
  }
  if (payload.quotes.length === 0) {
    throw new Error('CME payload contains zero quotes')
  }
}

function valueOrDash(value) {
  if (value === undefined || value === null || value === '') return '-'
  return String(value)
}

function formatVolume(value) {
  if (value === undefined || value === null || value === '' || value === '-') return '-'
  const number = Number(String(value).replaceAll(',', ''))
  if (!Number.isFinite(number)) return String(value)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(number)
}

function formatUpdated(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).formatToParts(date)

  const get = (parts, type) => parts.find(part => part.type === type)?.value || ''
  const time = `${get(timeParts, 'hour')}:${get(timeParts, 'minute')}:${get(timeParts, 'second')}`
  const day = get(dateParts, 'day')
  const month = get(dateParts, 'month')
  const year = get(dateParts, 'year')
  return `${time} CT ${day} ${month} ${year}`
}

function formatChange(quote) {
  const change = valueOrDash(quote.change)
  const percentage = valueOrDash(quote.percentageChange)
  if (change === '-' || percentage === '-') return change
  return `${change} (${percentage})`
}

function tableRowFromQuote(quote) {
  return {
    MONTH: [quote.expirationMonth, quote.quoteCode || quote.code].filter(Boolean).join(' '),
    OPTIONS: quote.hasOption ? 'OPT' : '',
    CHART: quote.priceChart?.enabled ? 'available' : '',
    LAST: valueOrDash(quote.last),
    CHANGE: formatChange(quote),
    'PRIOR SETTLE': valueOrDash(quote.priorSettle),
    OPEN: valueOrDash(quote.open),
    HIGH: valueOrDash(quote.high),
    LOW: valueOrDash(quote.low),
    VOLUME: formatVolume(quote.volume),
    UPDATED: formatUpdated(quote.updated)
  }
}

function buildProcessedPayload(payload, apiUrl, rawFileName, scrapeTimestampUtc, runId) {
  const rows = payload.quotes.map(tableRowFromQuote)

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    scrapeTimestampUtc,
    source: {
      name: SOURCE_NAME,
      pageUrl: SOURCE_URL,
      apiUrl,
      productId: PRODUCT_ID,
      productCode: PRODUCT_CODE
    },
    marketData: {
      quoteDelayed: Boolean(payload.quoteDelayed),
      quoteDelay: payload.quoteDelay || null,
      tradeDate: payload.tradeDate || null
    },
    columns: TABLE_COLUMNS,
    rowCount: rows.length,
    rawFile: rawFileName,
    rows
  }
}

function csvEscape(value) {
  const stringValue = value === undefined || value === null ? '' : String(value)
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`
  }
  return stringValue
}

function rowsToCsv(rows) {
  const lines = [TABLE_COLUMNS.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(TABLE_COLUMNS.map(column => csvEscape(row[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function timestampForFile(date) {
  return date.toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
}

async function writeOutputs(fetchResult, options, runId) {
  const scrapeTimestamp = new Date()
  const scrapeTimestampUtc = scrapeTimestamp.toISOString()
  const stamp = timestampForFile(scrapeTimestamp)
  const baseName = `${SOURCE_NAME}_${stamp}`
  const rawDir = path.join(options.outputDir, 'raw')
  const processedDir = path.join(options.outputDir, 'processed')

  await fs.mkdir(rawDir, { recursive: true })
  await fs.mkdir(processedDir, { recursive: true })

  const rawPath = path.join(rawDir, `${baseName}_raw.json`)
  const jsonPath = path.join(processedDir, `${baseName}.json`)
  const csvPath = path.join(processedDir, `${baseName}.csv`)

  await fs.writeFile(rawPath, fetchResult.rawText, 'utf8')

  const processed = buildProcessedPayload(
    fetchResult.payload,
    fetchResult.apiUrl,
    path.relative(options.outputDir, rawPath).split(path.sep).join('/'),
    scrapeTimestampUtc,
    runId
  )

  await fs.writeFile(jsonPath, `${JSON.stringify(processed, null, 2)}\n`, 'utf8')
  await fs.writeFile(csvPath, rowsToCsv(processed.rows), 'utf8')

  return {
    rawPath,
    jsonPath,
    csvPath,
    rowCount: processed.rowCount,
    scrapeTimestampUtc
  }
}

class Scraper {
  constructor(options) {
    this.options = options
    this.session = null
  }

  async ensureSession() {
    if (!this.session) {
      this.session = await createSession(this.options)
    }
    return this.session
  }

  async refreshSession() {
    this.session = await createSession(this.options)
    return this.session
  }

  async scrapeOnce() {
    const runId = crypto.randomUUID()
    const startedAt = Date.now()

    try {
      const session = await this.ensureSession()
      let fetchResult

      try {
        fetchResult = await fetchQuotes(session, this.options)
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          log('warn', 'CME session rejected; refreshing browser session', {
            status: error.status,
            body: error.body
          })
          fetchResult = await fetchQuotes(await this.refreshSession(), this.options)
        } else {
          throw error
        }
      }

      validatePayload(fetchResult.payload)
      const outputs = await writeOutputs(fetchResult, this.options, runId)

      log('info', 'scrape complete', {
        runId,
        durationMs: Date.now() - startedAt,
        rowCount: outputs.rowCount,
        rawPath: outputs.rawPath,
        jsonPath: outputs.jsonPath,
        csvPath: outputs.csvPath
      })

      return outputs
    } catch (error) {
      log('error', 'scrape failed', {
        runId,
        durationMs: Date.now() - startedAt,
        error: error.message,
        stack: error.stack
      })
      throw error
    }
  }
}

async function runLoop(scraper, intervalMs) {
  log('info', 'starting scrape loop', { intervalMs })

  while (!shutdownRequested) {
    const startedAt = Date.now()
    try {
      await scraper.scrapeOnce()
    } catch {
      // Error already logged. Loop stays alive for next cycle.
    }

    const elapsedMs = Date.now() - startedAt
    const waitMs = Math.max(0, intervalMs - elapsedMs)
    log('info', 'waiting for next scrape', { waitMs })
    try {
      await sleep(waitMs, undefined, { signal: shutdownController.signal })
    } catch (error) {
      if (error.name !== 'AbortError') throw error
    }
  }
}

let shutdownRequested = false
const shutdownController = new AbortController()

process.on('SIGINT', () => {
  shutdownRequested = true
  shutdownController.abort()
  log('info', 'SIGINT received; stopping after current wait')
})

process.on('SIGTERM', () => {
  shutdownRequested = true
  shutdownController.abort()
  log('info', 'SIGTERM received; stopping after current wait')
})

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const scraper = new Scraper(options)

  log('info', 'scraper configured', {
    loop: options.loop,
    intervalMs: options.intervalMs,
    outputDir: options.outputDir,
    headless: options.headless,
    browserChannel: options.browserChannel || 'playwright-default'
  })

  if (options.loop) {
    await runLoop(scraper, options.intervalMs)
  } else {
    await scraper.scrapeOnce()
  }
}

main().catch(error => {
  log('error', 'fatal error', { error: error.message, stack: error.stack })
  process.exitCode = 1
})

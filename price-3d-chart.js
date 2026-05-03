const fs = require('node:fs/promises')
const path = require('node:path')

const SOURCE_NAME = 'cme_crude_oil_quotes'
const DEFAULT_INPUT_DIR = path.join(process.cwd(), 'data', 'processed')
const DEFAULT_OUTPUT_FILE = path.join(process.cwd(), 'data', 'price-3d-chart.html')
const DEFAULT_PRICE_COLUMN = 'LAST'
const MONTH_INDEX = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11
}

function parseArgs(argv) {
  const options = {
    inputDir: DEFAULT_INPUT_DIR,
    outputFile: DEFAULT_OUTPUT_FILE,
    priceColumn: DEFAULT_PRICE_COLUMN
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith('--input-dir=')) {
      options.inputDir = path.resolve(arg.slice('--input-dir='.length))
    } else if (arg.startsWith('--output=')) {
      options.outputFile = path.resolve(arg.slice('--output='.length))
    } else if (arg.startsWith('--price-column=')) {
      options.priceColumn = arg.slice('--price-column='.length) || DEFAULT_PRICE_COLUMN
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`
Usage:
  node price-3d-chart.js
  node price-3d-chart.js --input-dir=/root/scraper/data/processed --output=curve.html

Options:
  --input-dir=./data/processed   Directory containing processed JSON snapshots.
  --output=./data/price-3d-chart.html
  --price-column=LAST            Row column used as z-axis price.
`)
}

function parsePrice(value) {
  if (value === undefined || value === null) return null

  const match = String(value).replaceAll(',', '').match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null

  const price = Number(match[0])
  return Number.isFinite(price) ? price : null
}

function parseTimestampFromFileName(fileName) {
  const match = fileName.match(/_(\d{8}T\d{6}Z)\.json$/)
  if (!match) return null

  const stamp = match[1]
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
}

function tenorSortKey(label) {
  const parts = String(label).trim().split(/\s+/)
  const month = MONTH_INDEX[parts[0]?.toUpperCase()]
  const year = Number(parts[1])

  if (month === undefined || !Number.isFinite(year)) {
    return { value: Number.MAX_SAFE_INTEGER, label }
  }

  return { value: year * 12 + month, label }
}

function formatUtcLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

function formatUtcTickLabel(value, includeDate) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const iso = date.toISOString()
  const time = iso.slice(11, 16)
  if (!includeDate) return time

  return `${iso.slice(5, 10)} ${time}`
}

function pickTickValues(total, maxTicks) {
  if (total <= maxTicks) {
    return Array.from({ length: total }, (_, index) => index)
  }

  const step = Math.ceil(total / maxTicks)
  const values = []
  for (let index = 0; index < total; index += step) values.push(index)
  if (values.at(-1) !== total - 1) values.push(total - 1)
  return values
}

async function loadSnapshots(inputDir, priceColumn) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.startsWith(`${SOURCE_NAME}_`) && name.endsWith('.json'))
    .sort()

  const snapshots = []

  for (const fileName of files) {
    const filePath = path.join(inputDir, fileName)
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (!Array.isArray(payload.rows)) continue

    const timestamp = payload.scrapeTimestampUtc || parseTimestampFromFileName(fileName)
    if (!timestamp) continue

    const pricesByTenor = new Map()
    for (const row of payload.rows) {
      const tenor = row.MONTH
      const price = parsePrice(row[priceColumn])
      if (!tenor || price === null) continue
      pricesByTenor.set(String(tenor), price)
    }

    if (pricesByTenor.size === 0) continue

    snapshots.push({
      fileName,
      timestamp,
      pricesByTenor
    })
  }

  snapshots.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
  return snapshots
}

function buildChartData(snapshots) {
  const tenorSet = new Set()
  for (const snapshot of snapshots) {
    for (const tenor of snapshot.pricesByTenor.keys()) tenorSet.add(tenor)
  }

  const tenors = [...tenorSet].sort((left, right) => {
    const leftKey = tenorSortKey(left)
    const rightKey = tenorSortKey(right)
    return leftKey.value - rightKey.value || leftKey.label.localeCompare(rightKey.label)
  })

  const times = snapshots.map(snapshot => snapshot.timestamp)
  const z = tenors.map(tenor => snapshots.map(snapshot => snapshot.pricesByTenor.get(tenor) ?? null))
  const hoverText = tenors.map((tenor, tenorIndex) => snapshots.map((snapshot, timeIndex) => {
    const price = z[tenorIndex][timeIndex]
    if (price === null) return ''
    return [
      `Time: ${formatUtcLabel(snapshot.timestamp)}`,
      `Tenor: ${tenor}`,
      `Price: ${price}`
    ].join('<br>')
  }))

  return { times, tenors, z, hoverText }
}

function renderHtml(chartData, options, snapshots) {
  const timeTickValues = pickTickValues(chartData.times.length, 12)
  const tenorTickValues = pickTickValues(chartData.tenors.length, 24)
  const timeDates = new Set(chartData.times.map(value => new Date(value).toISOString().slice(0, 10)))
  const includeDateInTicks = timeDates.size > 1
  const title = `CME Crude Oil ${options.priceColumn} Price Surface`
  const generatedAt = new Date().toISOString()
  const sourceFiles = snapshots.map(snapshot => snapshot.fileName)

  const plotData = [{
    type: 'surface',
    x: chartData.times.map((_, index) => index),
    y: chartData.tenors.map((_, index) => index),
    z: chartData.z,
    text: chartData.hoverText,
    hovertemplate: '%{text}<extra></extra>',
    colorscale: 'Viridis',
    colorbar: {
      title: options.priceColumn
    },
    contours: {
      z: {
        show: true,
        usecolormap: true,
        highlightcolor: '#111827',
        project: { z: true }
      }
    }
  }]

  const layout = {
    title: {
      text: title,
      x: 0.03,
      xanchor: 'left'
    },
    margin: { l: 0, r: 0, t: 56, b: 0 },
    scene: {
      xaxis: {
        title: 'Time (UTC)',
        tickmode: 'array',
        tickvals: timeTickValues,
        ticktext: timeTickValues.map(index => formatUtcTickLabel(chartData.times[index], includeDateInTicks))
      },
      yaxis: {
        title: 'Tenor',
        tickmode: 'array',
        tickvals: tenorTickValues,
        ticktext: tenorTickValues.map(index => chartData.tenors[index])
      },
      zaxis: {
        title: `Price (${options.priceColumn})`
      },
      camera: {
        eye: { x: 1.75, y: 1.7, z: 0.9 }
      }
    },
    paper_bgcolor: '#f8fafc',
    font: {
      family: 'Arial, sans-serif',
      color: '#111827'
    }
  }

  const config = {
    responsive: true,
    displaylogo: false
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    html, body {
      height: 100%;
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family: Arial, sans-serif;
    }

    #chart {
      width: 100vw;
      height: calc(100vh - 48px);
    }

    .meta {
      box-sizing: border-box;
      height: 48px;
      padding: 8px 12px;
      border-top: 1px solid #d1d5db;
      background: #fff;
      color: #374151;
      font-size: 12px;
      line-height: 16px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <div id="chart"></div>
  <div class="meta" title="${escapeHtml(sourceFiles.join(', '))}">
    ${chartData.times.length} snapshots, ${chartData.tenors.length} tenors, generated ${escapeHtml(generatedAt)}
  </div>
  <script>
    const data = ${JSON.stringify(plotData)}
    const layout = ${JSON.stringify(layout)}
    const config = ${JSON.stringify(config)}

    Plotly.newPlot('chart', data, layout, config)
  </script>
</body>
</html>
`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const snapshots = await loadSnapshots(options.inputDir, options.priceColumn)
  if (snapshots.length === 0) {
    throw new Error(`No processed JSON snapshots with ${options.priceColumn} prices found in ${options.inputDir}`)
  }

  const chartData = buildChartData(snapshots)
  await fs.mkdir(path.dirname(options.outputFile), { recursive: true })
  await fs.writeFile(options.outputFile, renderHtml(chartData, options, snapshots), 'utf8')

  console.log(JSON.stringify({
    outputFile: options.outputFile,
    snapshots: snapshots.length,
    tenors: chartData.tenors.length,
    priceColumn: options.priceColumn
  }, null, 2))
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})

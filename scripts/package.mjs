/**
 * Builds the prebuilt, installable package.
 *
 *   node scripts/package.mjs
 *
 * Emits two artefacts under `dist/`:
 *   - `custom-skin-<version>/`  an unpacked bundle directory, which the plugin
 *                               manager installs directly from disk;
 *   - `custom-skin-<version>.zip` the same tree zipped for a GitHub release.
 *
 * Both are produced from the manifest's `files` list plus the built `client.js`,
 * so a release can never drift from what the app actually loads. The zip is
 * written by this script (deflate, no dependencies) and then read back and
 * CRC-verified, so a corrupt archive fails here instead of at the reviewer.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const folderName = `custom-skin-${pkg.version}`
const stageDir = join(distDir, folderName)
const zipPath = join(distDir, `${folderName}.zip`)

function fail(message) {
  console.error(`[package] ${message}`)
  process.exit(1)
}

function walk(target, out) {
  const stats = statSync(target)
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target).sort()) {
      if (entry === '.DS_Store' || entry === 'node_modules') continue
      walk(join(target, entry), out)
    }
    return
  }
  out.push(target)
}

/* --- collect the payload ------------------------------------------------- */

const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']
const declared = (pkg.files || []).slice()
for (const entry of required) {
  if (!declared.includes(entry)) fail(`package.json "files" is missing ${entry}`)
}

const payload = []
for (const entry of declared) {
  const abs = join(root, entry)
  if (!existsSync(abs)) {
    /* Directories such as assets/ and samples/ are optional: a fresh clone has no
     * sample media until `python scripts/make-samples.py` runs. */
    if (required.includes(entry)) fail(`"files" entry does not exist: ${entry}`)
    console.warn(`[package] skipping missing optional entry: ${entry}`)
    continue
  }
  walk(abs, payload)
}

const rel = (abs) => relative(root, abs).split(sep).join('/')
for (const entry of required) {
  if (!payload.some((abs) => rel(abs) === entry)) fail(`payload is missing ${entry}`)
}

/* --- stage the unpacked bundle ------------------------------------------- */

rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
let bytes = 0
for (const abs of payload) {
  const target = join(stageDir, rel(abs))
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(abs, target)
  bytes += statSync(target).size
}

/* --- zip (deflate, deterministic timestamps) ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

/* 1980-01-01 00:00:00, the DOS epoch: identical bytes on every machine. */
const DOS_TIME = 0
const DOS_DATE = 0x21

const localParts = []
const centralParts = []
let offset = 0

payload.forEach((abs, index) => {
  const name = `${folderName}/${rel(abs)}`
  const raw = readFileSync(abs)
  const deflated = deflateRawSync(raw, { level: 9 })
  const useDeflate = deflated.length < raw.length
  const body = useDeflate ? deflated : raw
  const method = useDeflate ? 8 : 0
  const crc = crc32(raw)
  const nameBytes = Buffer.from(name, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(offset, 42)

  localParts.push(local, nameBytes, body)
  centralParts.push(central, nameBytes)
  offset += local.length + nameBytes.length + body.length
})

const centralBuffer = Buffer.concat(centralParts)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(payload.length, 8)
eocd.writeUInt16LE(payload.length, 10)
eocd.writeUInt32LE(centralBuffer.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

const archive = Buffer.concat([...localParts, centralBuffer, eocd])
writeFileSync(zipPath, archive)

/* --- read the archive back and verify every entry ------------------------ */

const check = readFileSync(zipPath)
const eocdAt = check.length - 22
if (check.readUInt32LE(eocdAt) !== 0x06054b50) fail('archive has no end-of-central-directory record')
const total = check.readUInt16LE(eocdAt + 10)
if (total !== payload.length) fail(`archive holds ${total} entries, expected ${payload.length}`)
let cursor = check.readUInt32LE(eocdAt + 16)
const names = []
for (let i = 0; i < total; i += 1) {
  if (check.readUInt32LE(cursor) !== 0x02014b50) fail(`central directory entry ${i} is malformed`)
  const method = check.readUInt16LE(cursor + 10)
  const crc = check.readUInt32LE(cursor + 16)
  const compressedSize = check.readUInt32LE(cursor + 20)
  const size = check.readUInt32LE(cursor + 24)
  const nameLength = check.readUInt16LE(cursor + 28)
  const extraLength = check.readUInt16LE(cursor + 30)
  const commentLength = check.readUInt16LE(cursor + 32)
  const localOffset = check.readUInt32LE(cursor + 42)
  const name = check.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
  const localNameLength = check.readUInt16LE(localOffset + 26)
  const localExtraLength = check.readUInt16LE(localOffset + 28)
  const dataAt = localOffset + 30 + localNameLength + localExtraLength
  const data = check.subarray(dataAt, dataAt + compressedSize)
  const raw = method === 8 ? inflateRawSync(data) : data
  if (raw.length !== size) fail(`${name}: size mismatch`)
  if (crc32(raw) !== crc) fail(`${name}: CRC mismatch`)
  names.push(name)
  cursor += 46 + nameLength + extraLength + commentLength
}

if (!names.includes(`${folderName}/client.js`)) fail('archive is missing client.js')
if (!existsSync(join(stageDir, 'client.js'))) fail('staging directory is missing client.js')

const kib = (value) => `${(value / 1024).toFixed(1)} KiB`
console.log(`[package] staged ${payload.length} files (${kib(bytes)}) -> ${stageDir}`)
console.log(`[package] wrote ${zipPath} (${kib(archive.length)}), ${names.length} entries CRC-verified`)

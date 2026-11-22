#!/usr/bin/env node
/**
 * Self-test for the pure logic the settings panel depends on.
 *
 * `src/core.js` and `src/i18n.js` touch no DOM, so they run here under Node's
 * `vm` exactly as the build inlines them. `src/main.js` needs a browser (React,
 * IndexedDB, DOM) and is covered by the syntax check in `scripts/build.mjs` plus
 * the in-app verification described in README.md.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const core = await readFile(path.join(root, 'src', 'core.js'), 'utf8')
const i18n = await readFile(path.join(root, 'src', 'i18n.js'), 'utf8')

const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(core + '\n' + i18n + '\n', sandbox, { filename: 'custom-skin-core.js' })

const CS = sandbox.CS_CORE
const csTranslate = sandbox.csTranslate
const csLocaleKey = sandbox.csLocaleKey
const CS_DICT = sandbox.CS_DICT

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

function assertThrowsCode(fn, code) {
  try {
    fn()
  } catch (err) {
    assertEqual(err.code, code, 'error code')
    return
  }
  throw new Error('expected CsError(' + code + ')')
}

function bytes(values) {
  return new Uint8Array(values)
}

/* --------------------------------------------------------------- format gate */

check('identify: supported extension', () => {
  const info = CS.csIdentify('photo.PNG', 1024)
  assertEqual(info.ext, 'png')
  assertEqual(info.kind, 'image')
  assertEqual(info.mime, 'image/png')
})

check('identify: gif and video kinds', () => {
  assertEqual(CS.csIdentify('loop.gif', 10).kind, 'gif')
  assertEqual(CS.csIdentify('clip.mp4', 10).kind, 'video')
  assertEqual(CS.csIdentify('clip.webm', 10).kind, 'video')
  assertEqual(CS.csIdentify('clip.M4V', 10).kind, 'video')
})

check('identify: unknown extension', () => {
  assertThrowsCode(() => CS.csIdentify('notes.txt', 10), 'unsupported')
  assertThrowsCode(() => CS.csIdentify('no-extension', 10), 'unsupported')
  assertThrowsCode(() => CS.csIdentify('archive.png.zip', 10), 'unsupported')
})

check('identify: empty and oversized files', () => {
  assertThrowsCode(() => CS.csIdentify('empty.png', 0), 'empty')
  assertThrowsCode(() => CS.csIdentify('huge.mp4', CS.CS_MAX_BYTES + 1), 'tooLarge')
})

/* ---------------------------------------------------------------- magic bytes */

check('sniff: known containers', () => {
  assertEqual(CS.csSniff(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assertEqual(CS.csSniff(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'jpeg')
  assertEqual(CS.csSniff(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])), 'gif')
  assertEqual(CS.csSniff(bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])), 'webm')
  assertEqual(
    CS.csSniff(bytes([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])),
    'webp'
  )
  assertEqual(
    CS.csSniff(bytes([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])),
    'mp4'
  )
  assertEqual(CS.csSniff(bytes([1, 2, 3, 4])), '')
  assertEqual(CS.csSniff(new Uint8Array(0)), '')
})

check('sniff: extension must agree with the payload', () => {
  assert(CS.csSniffMatches('png', 'png'))
  assert(CS.csSniffMatches('jpg', 'jpeg'))
  assert(CS.csSniffMatches('m4v', 'mp4'))
  assert(!CS.csSniffMatches('png', 'jpeg'))
  assert(!CS.csSniffMatches('gif', ''))
  assert(!CS.csSniffMatches('unknownext', 'png'))
})

/* ------------------------------------------------------------------ formatting */

check('formatBytes', () => {
  assertEqual(CS.csFormatBytes(0), '0 B')
  assertEqual(CS.csFormatBytes(900), '900 B')
  assertEqual(CS.csFormatBytes(2048), '2.0 KB')
  assertEqual(CS.csFormatBytes(5 * 1024 * 1024), '5.0 MB')
})

/* -------------------------------------------------------------- config sanity */

check('defaultConfig is complete', () => {
  const cfg = CS.csDefaultConfig()
  assertEqual(Object.keys(cfg).length, 10)
  assertEqual(cfg.fit, 'cover')
  assertEqual(cfg.motion, true)
  assertEqual(cfg.panelBlur, 14)
  assertEqual(cfg.brightness, 1)
  assert(CS.csSameConfig(cfg, CS.csNormalizeConfig(cfg)), 'defaults must survive normalization')
})

check('normalizeConfig clamps and repairs', () => {
  const cfg = CS.csNormalizeConfig({
    fit: 'stretch',
    scale: 99,
    posX: -20,
    posY: 400,
    panelOpacity: 0,
    panelBlur: 999,
    brightness: 9,
    accent: 'red',
    motion: 'yes'
  })
  assertEqual(cfg.fit, 'cover')
  assertEqual(cfg.scale, CS.CS_MAX_SCALE)
  assertEqual(cfg.posX, 0)
  assertEqual(cfg.posY, 100)
  assertEqual(cfg.panelBlur, CS.CS_MAX_PANEL_BLUR)
  assertEqual(cfg.brightness, CS.CS_MAX_BRIGHTNESS)
  assertEqual(cfg.panelOpacity, CS.CS_MIN_PANEL_OPACITY)
  assertEqual(cfg.accent, '')
  assertEqual(cfg.motion, true)
})

check('normalizeConfig keeps valid accents only', () => {
  assertEqual(CS.csNormalizeConfig({ accent: '#AABBCC' }).accent, '#aabbcc')
  assertEqual(CS.csNormalizeConfig({ accent: '#abc' }).accent, '')
  assertEqual(CS.csNormalizeConfig({ accent: 'url(evil)' }).accent, '')
})

check('normalizeConfig survives junk input', () => {
  assert(CS.csSameConfig(CS.csNormalizeConfig(null), CS.csDefaultConfig()))
  assert(CS.csSameConfig(CS.csNormalizeConfig('nope'), CS.csDefaultConfig()))
  assertEqual(CS.csNormalizeConfig({ scale: 'abc' }).scale, 1)
  assertEqual(CS.csNormalizeConfig({ motion: false }).motion, false)
})

check('sameConfig detects differences', () => {
  const a = CS.csDefaultConfig()
  assertEqual(CS.csSameConfig(a, Object.assign({}, a)), true)
  assertEqual(CS.csSameConfig(a, Object.assign({}, a, { panelOpacity: 0.5 })), false)
})

/* --------------------------------------------------------------- CSS recipes */

check('mediaStyle covers the viewport', () => {
  const plain = CS.csMediaStyle(CS.csDefaultConfig())
  assertEqual(plain.objectFit, 'cover')
  assertEqual(plain.objectPosition, '50% 50%')
  assertEqual(plain.transform, undefined)
  assertEqual(plain.filter, undefined)

  const contained = CS.csMediaStyle({ fit: 'contain', posX: 0, posY: 100, scale: 2 })
  assertEqual(contained.objectFit, 'contain')
  assertEqual(contained.objectPosition, '0% 100%')
  assertEqual(contained.transform, 'scale(2.000)')

  const dimmed = CS.csMediaStyle({ brightness: 0.8 })
  assertEqual(dimmed.filter, 'brightness(0.80)')
})

check('scrim flips with the color scheme', () => {
  const dark = CS.csScrimStyle({ autoTone: false }, 'dark', 0.5).background
  const light = CS.csScrimStyle({ autoTone: false }, 'light', 0.5).background
  const alpha = CS.CS_SCRIM_BASE.toFixed(3)
  assert(dark.indexOf('rgba(0,0,0,' + alpha + ')') >= 0, 'dark scrim must be black at the base alpha: ' + dark)
  assert(light.indexOf('rgba(255,255,255,' + alpha + ')') >= 0, 'light scrim must be white at the base alpha: ' + light)
  assert(dark.indexOf('radial-gradient') === 0, 'the scrim must carry the vignette: ' + dark)
  const radial = dark.slice(0, dark.indexOf('),'))
  const stops = radial.match(/rgba\(0,0,0,([\d.]+)\)/g) || []
  const alphas = stops.map((stop) => Number(stop.replace(/^.*,([\d.]+)\)$/, '$1')))
  assert(alphas.length >= 2, 'radial scrim needs several stops: ' + radial)
  assert(alphas[alphas.length - 1] > alphas[0], 'the vignette edge must be denser than the centre: ' + radial)
})

check('auto tone follows the picture brightness', () => {
  /* Dark mode draws light text, so a pale picture needs more black under it and
   * a dark picture needs less. Light mode draws dark text, so it is the mirror. */
  const paleOnDark = CS.csEffectiveScrim({ autoTone: true }, 'dark', 0.95)
  const darkOnDark = CS.csEffectiveScrim({ autoTone: true }, 'dark', 0.05)
  assert(paleOnDark > CS.CS_SCRIM_BASE, 'a pale picture under light text needs more scrim: ' + paleOnDark)
  assert(darkOnDark < CS.CS_SCRIM_BASE, 'a dark picture under light text needs less scrim: ' + darkOnDark)
  assertEqual(CS.csEffectiveScrim({ autoTone: false }, 'dark', 0.05), CS.CS_SCRIM_BASE)
  assert(CS.csEffectiveScrim({ autoTone: true }, 'light', 0.05) > CS.CS_SCRIM_BASE, 'a dark picture under dark text needs more white')
})

check('frost filter follows the panel blur adjustment', () => {
  assertEqual(CS.csFrostFilter({ panelBlur: 0 }), '')
  assertEqual(CS.csFrostFilter({ panelBlur: 18 }), 'blur(18.0px) saturate(1.25)')
  assert(CS.csLumaOf(255, 255, 255) > 0.9, 'white must be near 1')
  assert(CS.csLumaOf(0, 0, 0) < 0.01, 'black must be near 0')
})

check('tokenOverrides pairs every token for both schemes', () => {
  const tokens = CS.csTokenOverrides({ panelOpacity: 0.6 })
  const names = Object.keys(tokens)
  assert(names.indexOf('--dsw-alias-bg-base') >= 0, 'bg-base override missing')
  assert(names.indexOf('--dsw-alias-bg-overlay') >= 0, 'bg-overlay override missing')
  assert(names.indexOf('--dsw-specific-sidebar-fill') >= 0, 'sidebar override missing')
  assertEqual(names.indexOf('--dsw-alias-brand-primary'), -1, 'accent override must stay opt-in')
  for (const name of names) {
    const pair = tokens[name]
    assert(typeof pair.light === 'string' && pair.light.indexOf('rgba(') === 0, name + ' light value')
    assert(typeof pair.dark === 'string' && pair.dark.indexOf('rgba(') === 0, name + ' dark value')
  }
  // Overlay surfaces stay more opaque than the base so menus and dialogs read.
  const alpha = (value) => Number(value.slice(value.lastIndexOf(',') + 1, -1))
  assert(alpha(tokens['--dsw-alias-bg-overlay'].dark) > alpha(tokens['--dsw-alias-bg-base'].dark), 'overlay must be denser than base')
  assert(alpha(tokens['--dsw-alias-bg-layer-2'].light) >= alpha(tokens['--dsw-alias-bg-base'].light), 'layer-2 must be at least as dense as base')
})

check('tokenOverrides honors a custom accent', () => {
  const tokens = CS.csTokenOverrides({ accent: '#2563eb' })
  assertEqual(tokens['--dsw-alias-brand-primary'].light, '#2563eb')
  assertEqual(tokens['--dsw-alias-brand-primary'].dark, CS.csLighten('#2563eb', 0.18))
  assertEqual(CS.csLighten('#000000', 1), '#ffffff')
  assertEqual(CS.csLighten('nope', 0.5), 'nope')
})

/* ------------------------------------------------------------------- i18n */

check('locale key resolution', () => {
  assertEqual(csLocaleKey('zh-CN'), 'zh')
  assertEqual(csLocaleKey('zh-Hans'), 'zh')
  assertEqual(csLocaleKey('ZH'), 'zh')
  assertEqual(csLocaleKey('en-US'), 'en')
  assertEqual(csLocaleKey(''), 'en')
})

check('dictionaries stay in sync', () => {
  const zhKeys = Object.keys(CS_DICT.zh).sort()
  const enKeys = Object.keys(CS_DICT.en).sort()
  assertEqual(zhKeys.join(','), enKeys.join(','))
  for (const key of zhKeys) {
    assert(typeof CS_DICT.zh[key] === 'string', key + ' zh value')
    assert(typeof CS_DICT.en[key] === 'string', key + ' en value')
  }
})

check('translate substitutes params and falls back', () => {
  assertEqual(csTranslate('zh-CN', 'btn.apply'), '应用')
  assertEqual(csTranslate('en-US', 'btn.apply'), 'Apply')
  assertEqual(csTranslate('zh-CN', 'err.tooLarge', { size: '70 MB' }), '文件过大（70 MB），单个素材上限为 64 MB。')
  assertEqual(csTranslate('en-US', 'err.tooLarge', { size: '70 MB' }), 'File is too large (70 MB); the limit is 64 MB per item.')
  assertEqual(csTranslate('fr-FR', 'btn.apply'), 'Apply')
  assertEqual(csTranslate('zh-CN', 'missing.key'), 'missing.key')
  assertEqual(csTranslate('zh-CN', 'err.tooLarge'), '文件过大（{size}），单个素材上限为 64 MB。')
})

check('every error code has a message', () => {
  for (const code of ['unsupported', 'tooLarge', 'empty', 'mismatch', 'decodeFailed', 'tooMany', 'storage', 'unknown', 'noMaterial', 'busy']) {
    const key = 'err.' + code
    assert(CS_DICT.zh[key], 'zh ' + key)
    assert(CS_DICT.en[key], 'en ' + key)
  }
})

/* -------------------------------------------------------------------- report */

if (failures.length) {
  console.error('[selftest] ' + failures.length + ' failure(s):')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log('[selftest] ' + passed + ' checks passed')

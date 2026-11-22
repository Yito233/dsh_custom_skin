/**
 * Pure helpers for the custom-skin plugin: format sniffing, limits, adjustment
 * normalization, and the theme-token recipe. This file touches no DOM and no
 * globals, so `scripts/selftest.mjs` can execute it directly under Node's `vm`
 * and the build inlines it verbatim into the Client module.
 */

/* ------------------------------------------------------------------ limits */

var CS_MAX_BYTES = 64 * 1024 * 1024 // 64 MiB per imported file
var CS_MAX_MATERIALS = 40 // material library size
var CS_MAX_SCALE = 3
var CS_MAX_PANEL_BLUR = 40
var CS_MIN_PANEL_OPACITY = 0.4
var CS_MAX_PANEL_OPACITY = 1
var CS_MIN_BRIGHTNESS = 0.4
var CS_MAX_BRIGHTNESS = 1.6
/* Fixed scrim strength: enough dimming for text, invisible enough to keep the
 * artwork readable. It is baked in because a slider for it only added decisions
 * without changing the result. */
var CS_SCRIM_BASE = 0.34
var CS_VIGNETTE = 0.22
var CS_ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/

/* ------------------------------------------------------------------ errors */

function CsError(code, params) {
  var err = new Error(code)
  err.name = 'CsError'
  err.code = code
  err.params = params || {}
  err.isCsError = true
  return err
}

/* -------------------------------------------------------------- format map */

var CS_FORMATS = {
  png: { kind: 'image', mime: 'image/png', label: 'PNG' },
  jpg: { kind: 'image', mime: 'image/jpeg', label: 'JPEG' },
  jpeg: { kind: 'image', mime: 'image/jpeg', label: 'JPEG' },
  webp: { kind: 'image', mime: 'image/webp', label: 'WebP' },
  gif: { kind: 'gif', mime: 'image/gif', label: 'GIF' },
  mp4: { kind: 'video', mime: 'video/mp4', label: 'MP4' },
  m4v: { kind: 'video', mime: 'video/mp4', label: 'MP4' },
  webm: { kind: 'video', mime: 'video/webm', label: 'WebM' }
}

var CS_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.m4v,.webm'

/** Lowercase extension without the dot, or '' when the name has none. */
function csExtOf(name) {
  var str = String(name || '')
  var dot = str.lastIndexOf('.')
  if (dot < 0 || dot === str.length - 1) return ''
  return str.slice(dot + 1).toLowerCase()
}

function csFormatOf(fileName) {
  var ext = csExtOf(fileName)
  return CS_FORMATS[ext] || null
}

/**
 * Identify one candidate file before decoding it.
 * Returns { ext, kind, mime, label } or throws a CsError with a stable code.
 */
function csIdentify(fileName, byteLength) {
  var format = csFormatOf(fileName)
  if (!format) throw CsError('unsupported')
  if (typeof byteLength === 'number' && byteLength > CS_MAX_BYTES) {
    throw CsError('tooLarge', { size: csFormatBytes(byteLength) })
  }
  if (typeof byteLength === 'number' && byteLength === 0) throw CsError('empty')
  return {
    ext: csExtOf(fileName),
    kind: format.kind,
    mime: format.mime,
    label: format.label
  }
}

/* ----------------------------------------------------------- magic bytes */

function csAscii(bytes, start, end) {
  var out = ''
  for (var i = start; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * Sniff the container from its leading bytes.
 * `bytes` is a Uint8Array holding at least the first 16 bytes of the file.
 * Returns 'png' | 'jpeg' | 'gif' | 'webp' | 'mp4' | 'webm' | ''.
 */
function csSniff(bytes) {
  if (!bytes || bytes.length < 4) return ''
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'mp4'
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  return ''
}

var CS_SNIFF_COMPAT = {
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  webp: ['webp'],
  gif: ['gif'],
  mp4: ['mp4'],
  m4v: ['mp4'],
  webm: ['webm']
}

/** True when an extension and its sniffed container describe the same format. */
function csSniffMatches(ext, sniffed) {
  if (!sniffed) return false
  var allowed = CS_SNIFF_COMPAT[ext]
  return !!allowed && allowed.indexOf(sniffed) >= 0
}

/* ------------------------------------------------------------- formatting */

function csFormatBytes(n) {
  var value = Number(n) || 0
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

/* -------------------------------------------------------------- defaults */

function csDefaultConfig() {
  return {
    fit: 'cover',
    scale: 1,
    posX: 50,
    posY: 50,
    panelOpacity: 0.86,
    panelBlur: 14,
    accent: '',
    motion: true,
    autoTone: true,
    brightness: 1
  }
}

function csClampNumber(value, fallback, min, max) {
  var num = typeof value === 'number' ? value : Number(value)
  if (!isFinite(num)) return fallback
  if (num < min) return min
  if (num > max) return max
  return num
}

/** Coerce any stored or user-supplied value into a complete, valid config. */
function csNormalizeConfig(input) {
  var base = csDefaultConfig()
  var src = input && typeof input === 'object' ? input : {}
  var out = {}
  out.fit = src.fit === 'contain' ? 'contain' : 'cover'
  out.scale = csClampNumber(src.scale, base.scale, 1, CS_MAX_SCALE)
  out.posX = csClampNumber(src.posX, base.posX, 0, 100)
  out.posY = csClampNumber(src.posY, base.posY, 0, 100)
  out.panelOpacity = csClampNumber(src.panelOpacity, base.panelOpacity, CS_MIN_PANEL_OPACITY, CS_MAX_PANEL_OPACITY)
  out.panelBlur = csClampNumber(src.panelBlur, base.panelBlur, 0, CS_MAX_PANEL_BLUR)
  out.accent = typeof src.accent === 'string' && CS_ACCENT_PATTERN.test(src.accent) ? src.accent.toLowerCase() : ''
  out.motion = src.motion === false ? false : true
  out.autoTone = src.autoTone === false ? false : true
  out.brightness = csClampNumber(src.brightness, base.brightness, CS_MIN_BRIGHTNESS, CS_MAX_BRIGHTNESS)
  return out
}

/** True when two configs describe the same appearance. */
function csSameConfig(a, b) {
  var keys = Object.keys(csDefaultConfig())
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    if ((a || {})[key] !== (b || {})[key]) return false
  }
  return true
}

/* ------------------------------------------------------------- CSS recipe */

/** Media element style for the current adjustments. */
function csMediaStyle(cfg) {
  var conf = csNormalizeConfig(cfg)
  var style = {
    objectFit: conf.fit,
    objectPosition: conf.posX + '% ' + conf.posY + '%'
  }
  if (conf.scale !== 1) style.transform = 'scale(' + conf.scale.toFixed(3) + ')'
  /* Brightness lives on the picture, not on a veil, so a photo that is already
   * too luminous can be tamed without washing the whole window grey. */
  if (conf.brightness !== 1) style.filter = 'brightness(' + conf.brightness.toFixed(2) + ')'
  return style
}

/**
 * Scrim painted between the media and the application surfaces.
 * Light mode lightens the picture, dark mode darkens it, so that body text and
 * menus keep their contrast in both color schemes. The effective alpha follows
 * the picture's own tone (see `csEffectiveScrim`), and the vignette pulls the
 * frame darker at the edges so the artwork reads as one surface instead of a
 * photo pasted behind a flat page.
 */
function csEffectiveScrim(cfg, scheme, luma) {
  var conf = csNormalizeConfig(cfg)
  var tone = typeof luma === 'number' && isFinite(luma) ? Math.max(0, Math.min(1, luma)) : 0.5
  if (!conf.autoTone) return CS_SCRIM_BASE
  /* Dark text needs a light bed, so a dark picture asks for more white on top of
   * it; light text needs the opposite. Half strength keeps the veil light-handed
   * instead of turning the artwork into a grey plate. */
  var adjust = scheme === 'dark' ? (tone - 0.5) * 0.5 : (0.5 - tone) * 0.5
  return Math.min(0.9, Math.max(0, CS_SCRIM_BASE + adjust))
}

function csScrimStyle(cfg, scheme, luma) {
  var alpha = csEffectiveScrim(cfg, scheme, luma)
  var rgb = scheme === 'dark' ? '0,0,0' : '255,255,255'
  var centre = Math.max(0, alpha * (1 - CS_VIGNETTE * 0.45))
  var edge = Math.min(1, alpha + CS_VIGNETTE * 0.62)
  var radial =
    'radial-gradient(130% 110% at 50% 38%, rgba(' + rgb + ',' + centre.toFixed(3) + ') 0%, rgba(' + rgb + ',' + alpha.toFixed(3) + ') 58%, rgba(' + rgb + ',' + edge.toFixed(3) + ') 100%)'
  var vertical = 'linear-gradient(180deg, rgba(' + rgb + ',' + (alpha * 0.9).toFixed(3) + ') 0%, rgba(' + rgb + ',' + alpha.toFixed(3) + ') 52%, rgba(' + rgb + ',' + Math.min(1, alpha * 1.08).toFixed(3) + ') 100%)'
  return { background: radial + ', ' + vertical }
}

/**
 * Specular sheen: a diagonal light band plus a soft top highlight, screened over
 * the picture. It is the "mirror/glass" pass that reads differently from blur,
 * because it adds direction and a light source instead of smearing detail.
 */
/** Backdrop filter for the app's own surfaces: frosted glass over the picture. */
function csFrostFilter(cfg) {
  var conf = csNormalizeConfig(cfg)
  if (conf.panelBlur <= 0) return ''
  return 'blur(' + conf.panelBlur.toFixed(1) + 'px) saturate(1.25)'
}

/** Relative luminance (0..1) of one 8-bit colour. */
function csLumaOf(r, g, b) {
  function channel(value) {
    var c = Math.min(255, Math.max(0, Number(value) || 0)) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function csRgba(scheme, alpha) {
  var a = Math.min(1, Math.max(0, alpha))
  var rgb = scheme === 'dark' ? '18,18,20' : '255,255,255'
  return 'rgba(' + rgb + ',' + a.toFixed(3) + ')'
}

/**
 * Theme token overrides handed to `ctx.theme.overrideTokens`.
 * Surfaces become translucent versions of the active palette so the background
 * picture shows through while panels, the composer, and menus stay readable.
 * Dark mode gets a touch more body than light mode: light text on a photo needs
 * a denser bed than dark text does, which is the usual dark-mode complaint.
 */
function csTokenOverrides(cfg, solid) {
  var conf = csNormalizeConfig(cfg)
  /* Inside the settings page the whole window is a form the user must read, so
   * surfaces go back to solid instead of staying translucent over the picture. */
  var base = solid ? 0.985 : conf.panelOpacity
  var tokens = {}
  var add = function (token, lightAlpha, darkAlpha) {
    tokens[token] = { light: csRgba('light', lightAlpha), dark: csRgba('dark', darkAlpha) }
  }
  add('--dsw-alias-bg-base', base - 0.04, base + 0.02)
  add('--dsw-alias-bg-layer-1', base + 0.02, base + 0.08)
  add('--dsw-alias-bg-layer-2', base + 0.1, base + 0.16)
  add('--dsw-alias-bg-overlay', base + 0.24, base + 0.3)
  add('--dsw-specific-sidebar-fill', base - 0.12, base - 0.06)
  if (conf.accent) {
    tokens['--dsw-alias-brand-primary'] = { light: conf.accent, dark: csLighten(conf.accent, 0.18) }
  }
  return tokens
}

/** Mix a hex color toward white by `amount` (0..1); used for dark-mode accents. */
function csLighten(hex, amount) {
  if (!CS_ACCENT_PATTERN.test(String(hex || ''))) return hex
  var value = String(hex).slice(1)
  var out = '#'
  for (var i = 0; i < 3; i++) {
    var channel = parseInt(value.slice(i * 2, i * 2 + 2), 16)
    var mixed = Math.round(channel + (255 - channel) * amount)
    out += ('0' + Math.min(255, Math.max(0, mixed)).toString(16)).slice(-2)
  }
  return out
}

/* --------------------------------------------------------------- exports */

/* The build inlines this file into the Client factory scope, where `main.js`
 * reads these names directly. `scripts/selftest.mjs` evaluates the same file
 * under `vm` and reads this map instead of reflecting on globals. */
var CS_CORE = {
  CS_MAX_BYTES: CS_MAX_BYTES,
  CS_MAX_MATERIALS: CS_MAX_MATERIALS,
  CS_MAX_SCALE: CS_MAX_SCALE,
  CS_SCRIM_BASE: CS_SCRIM_BASE,
  CS_VIGNETTE: CS_VIGNETTE,
  CS_MAX_PANEL_BLUR: CS_MAX_PANEL_BLUR,
  CS_MIN_PANEL_OPACITY: CS_MIN_PANEL_OPACITY,
  CS_MAX_PANEL_OPACITY: CS_MAX_PANEL_OPACITY,
  CS_MIN_BRIGHTNESS: CS_MIN_BRIGHTNESS,
  CS_MAX_BRIGHTNESS: CS_MAX_BRIGHTNESS,
  CS_ACCEPT: CS_ACCEPT,
  CS_FORMATS: CS_FORMATS,
  CsError: CsError,
  csExtOf: csExtOf,
  csFormatOf: csFormatOf,
  csIdentify: csIdentify,
  csSniff: csSniff,
  csSniffMatches: csSniffMatches,
  csFormatBytes: csFormatBytes,
  csDefaultConfig: csDefaultConfig,
  csNormalizeConfig: csNormalizeConfig,
  csSameConfig: csSameConfig,
  csMediaStyle: csMediaStyle,
  csScrimStyle: csScrimStyle,
  csEffectiveScrim: csEffectiveScrim,
  csFrostFilter: csFrostFilter,
  csLumaOf: csLumaOf,
  csTokenOverrides: csTokenOverrides,
  csLighten: csLighten
}

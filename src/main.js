/**
 * Engine and settings UI for the custom-skin plugin.
 *
 * This file is inlined into the Client factory that `client.js` registers, so
 * `require('react')` resolves from the host module table and every symbol from
 * `src/core.js` and `src/i18n.js` is in the same closure.
 *
 * Two halves:
 *   1. the engine owns persistence (IndexedDB), the background layer appended to
 *      `document.body`, and the theme-token overrides;
 *   2. the section component renders the settings page and never throws.
 */

var React = require('react')

var h = React.createElement
var useCallback = React.useCallback
var useEffect = React.useEffect
var useMemo = React.useMemo
var useRef = React.useRef
var useState = React.useState
var useSyncExternalStore = React.useSyncExternalStore

var CS_SLOT = 'settings.section'
var CS_ENTRY_ID = 'custom-skin'
var CS_SELF = '__custom-skin__'
var CS_LAYER_ID = 'dsh-cs-layer'
var CS_LAYER_STYLE_ID = 'dsh-cs-layer-style'
var CS_ROOT_CLASS = 'dsh-cs-active'
var CS_TOKEN_SOURCE = '@local/custom-skin'
var CS_DB_NAME = 'dsh-custom-skin'
var CS_DB_VERSION = 1
var CS_STORE_MATERIALS = 'materials'
var CS_STORE_STATE = 'state'
var CS_STATE_KEY = 'applied'
var CS_PREFS_KEY = 'prefs'
var CS_DECODE_TIMEOUT_MS = 20000

/* ------------------------------------------------------------------ storage */

var csDbPromise = null

function csOpenDb() {
  if (csDbPromise) return csDbPromise
  csDbPromise = new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(CsError('storage'))
      return
    }
    var request
    try {
      request = indexedDB.open(CS_DB_NAME, CS_DB_VERSION)
    } catch (err) {
      reject(CsError('storage'))
      return
    }
    request.onupgradeneeded = function () {
      var db = request.result
      if (!db.objectStoreNames.contains(CS_STORE_MATERIALS)) db.createObjectStore(CS_STORE_MATERIALS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CS_STORE_STATE)) db.createObjectStore(CS_STORE_STATE)
    }
    request.onsuccess = function () { resolve(request.result) }
    request.onerror = function () { reject(CsError('storage')) }
    request.onblocked = function () { reject(CsError('storage')) }
  })
  csDbPromise.catch(function () { csDbPromise = null })
  return csDbPromise
}

function csDbRun(storeName, mode, run) {
  return csOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, mode)
      var store = tx.objectStore(storeName)
      var result
      try {
        result = run(store)
      } catch (err) {
        reject(CsError('storage'))
        return
      }
      tx.oncomplete = function () { resolve(result && 'result' in result ? result.result : result) }
      tx.onerror = function () { reject(CsError('storage')) }
      tx.onabort = function () { reject(CsError('storage')) }
    })
  })
}

function csDbAll() {
  return csDbRun(CS_STORE_MATERIALS, 'readonly', function (store) { return store.getAll() })
}

function csDbPut(record) {
  return csDbRun(CS_STORE_MATERIALS, 'readwrite', function (store) { return store.put(record) })
}

function csDbDelete(id) {
  return csDbRun(CS_STORE_MATERIALS, 'readwrite', function (store) { return store.delete(id) })
}

function csDbReadState() {
  return csDbRun(CS_STORE_STATE, 'readonly', function (store) { return store.get(CS_STATE_KEY) })
}

function csDbWriteState(value) {
  return csDbRun(CS_STORE_STATE, 'readwrite', function (store) { return store.put(value, CS_STATE_KEY) })
}

function csDbReadPrefs() {
  return csDbRun(CS_STORE_STATE, 'readonly', function (store) { return store.get(CS_PREFS_KEY) })
}

function csDbWritePrefs(value) {
  return csDbRun(CS_STORE_STATE, 'readwrite', function (store) { return store.put(value, CS_PREFS_KEY) })
}

/* ------------------------------------------------------------- background DOM */

var CS_LAYER_CSS = [
  '#' + CS_LAYER_ID + '{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:#0b0b0c}',
  '#' + CS_LAYER_ID + '>img,#' + CS_LAYER_ID + '>video{position:absolute;inset:0;width:100%;height:100%;display:block;border:0;object-fit:cover}',
  '#' + CS_LAYER_ID + '>.dsh-cs-scrim{position:absolute;inset:0;pointer-events:none}',
  /* Frosted glass: the app's own surface layers blur the picture behind them, so
   * the wallpaper reads as colour and light rather than as a photo under text.
   * `--dsh-cs-frost` is `none` while the plugin is off, so nothing is left over. */
  'html.' + CS_ROOT_CLASS + ' body > :not(#' + CS_LAYER_ID + '){-webkit-backdrop-filter:var(--dsh-cs-frost,none);backdrop-filter:var(--dsh-cs-frost,none)}',
  'html.' + CS_ROOT_CLASS + ',html.' + CS_ROOT_CLASS + ' body{background-color:transparent!important}'
].join('\n')

function csApplyStyle(el, style) {
  if (!el) return
  el.style.cssText = ''
  var keys = Object.keys(style || {})
  for (var i = 0; i < keys.length; i++) el.style[keys[i]] = style[keys[i]]
}

function csErrorInfo(err) {
  if (err && err.isCsError) return { key: 'err.' + err.code, params: err.params || null }
  var message = err && err.message ? String(err.message) : String(err)
  return { key: 'err.unknown', params: { message: message } }
}

/* ------------------------------------------------------------------- engine */

function csCreateEngine(ctx) {
  var listeners = new Set()
  var urls = new Map()
  var posters = new Map()
  var themeDisposer = null
  var layer = null
  var mediaEl = null
  var scrimEl = null
  var mediaKey = ''
  var appliedTokenKey = ''
  var repairedTheme = false
  var motionQuery = null
  var flashTimer = null
  var disposed = false

  var state = {
    ready: false,
    storageOk: true,
    busy: false,
    lang: CS_DEFAULT_LANG,
    scheme: 'light',
    reducedMotion: false,
    uiMode: 'app',
    sectionOpen: false,
    panelOpen: false,
    canTheme: !!(ctx.theme && ctx.theme.overrideTokens),
    materials: [],
    applied: { materialId: null, cfg: csDefaultConfig() },
    draft: null,
    themePreference: 'system',
    flash: { key: '', params: null, seq: 0 },
    status: { key: '', params: null, tone: 'info' }
  }

  function translate(key, params) {
    /* The panel speaks Chinese by default and switches to English on request,
     * persisted locally: the app locale is the host's to choose, the skin's own
     * copy should not flip under the user when they change the app language. */
    return csTranslate(state.lang, key, params)
  }

  function emit() {
    listeners.forEach(function (fn) {
      try {
        fn()
      } catch (err) {
        /* a listener must never break the panel */
      }
    })
  }

  function set(patch) {
    state = Object.assign({}, state, patch)
    syncVisual()
    emit()
  }

  function setStatus(key, params, tone) {
    set({ status: { key: key, params: params || null, tone: tone || 'info' } })
  }

  /* Success is a moment, not a state: it belongs next to the button that caused
   * it and disappears on its own, while `status` keeps the things the user has
   * to read (a failure, a preview that is still uncommitted). */
  function flash(key, params) {
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
    set({ flash: { key: key, params: params || null, seq: state.flash.seq + 1 } })
    flashTimer = setTimeout(function () {
      flashTimer = null
      if (disposed) return
      set({ flash: { key: '', params: null, seq: state.flash.seq } })
    }, 4000)
  }

  function findMaterial(id) {
    if (!id) return null
    for (var i = 0; i < state.materials.length; i++) {
      if (state.materials[i].id === id) return state.materials[i]
    }
    return null
  }

  function effective() {
    return state.draft || state.applied
  }

  function urlFor(record) {
    var cached = urls.get(record.id)
    if (cached) return cached
    var url = URL.createObjectURL(record.blob)
    urls.set(record.id, url)
    return url
  }

  function releaseUrl(id) {
    var url = urls.get(id)
    if (url) {
      try {
        URL.revokeObjectURL(url)
      } catch (err) {
        /* ignore */
      }
      urls.delete(id)
    }
    posters.delete(id)
  }

  /* ----------------------------------------------------------- visual layer */

  function ensureLayer() {
    if (typeof document === 'undefined' || !document.body) return null
    if (layer && layer.isConnected) return layer
    var styleEl = document.getElementById(CS_LAYER_STYLE_ID)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = CS_LAYER_STYLE_ID
      styleEl.textContent = CS_LAYER_CSS
      document.head.appendChild(styleEl)
    }
    layer = document.createElement('div')
    layer.id = CS_LAYER_ID
    layer.setAttribute('aria-hidden', 'true')
    scrimEl = document.createElement('div')
    scrimEl.className = 'dsh-cs-scrim'
    layer.appendChild(scrimEl)
    /* First child of <body> so the application paints over the picture. */
    document.body.insertBefore(layer, document.body.firstChild)
    return layer
  }

  function shouldAnimate(material, cfg) {
    if (!material) return false
    /* The settings page is a form; a video decoding behind it costs frames and
     * buys nothing, so the still frame is the right picture there. */
    if (state.uiMode === 'settings') return false
    if (!cfg.motion || state.reducedMotion) return false
    return material.kind === 'gif' || material.kind === 'video'
  }

  function captureGifPoster(material) {
    return new Promise(function (resolve) {
      if (typeof Image === 'undefined') {
        resolve('')
        return
      }
      var img = new Image()
      img.onload = function () {
        try {
          var width = img.naturalWidth || 1
          var height = img.naturalHeight || 1
          var ratio = Math.min(1, 1920 / Math.max(width, height))
          var canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(width * ratio))
          canvas.height = Math.max(1, Math.round(height * ratio))
          var context = canvas.getContext('2d')
          context.drawImage(img, 0, 0, canvas.width, canvas.height)
          var data = canvas.toDataURL('image/png')
          posters.set(material.id, data)
          resolve(data)
        } catch (err) {
          resolve('')
        }
      }
      img.onerror = function () { resolve('') }
      img.src = urlFor(material)
    })
  }

  function buildMedia(material, animate) {
    var url = urlFor(material)
    var el
    if (material.kind === 'video') {
      var video = document.createElement('video')
      video.muted = true
      video.defaultMuted = true
      video.loop = animate
      video.autoplay = animate
      video.preload = 'auto'
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', '')
      video.setAttribute('aria-hidden', 'true')
      video.src = url
      if (animate) {
        var playing = video.play()
        if (playing && typeof playing.catch === 'function') playing.catch(function () {})
      } else {
        video.addEventListener(
          'loadeddata',
          function () {
            try {
              video.pause()
              video.currentTime = 0
            } catch (err) {
              /* first frame stays */
            }
          },
          { once: true }
        )
      }
      el = video
    } else {
      var img = document.createElement('img')
      img.alt = ''
      img.setAttribute('aria-hidden', 'true')
      if (material.kind === 'gif' && !animate) {
        var poster = posters.get(material.id)
        img.src = poster || url
        if (!poster) {
          captureGifPoster(material).then(function (data) {
            if (!data || disposed) return
            if (mediaEl === img) img.src = data
          })
        }
      } else {
        img.src = url
      }
      el = img
    }
    el.className = 'dsh-cs-media'
    return el
  }

  function disposeTokens() {
    if (!themeDisposer) return
    try {
      themeDisposer()
    } catch (err) {
      /* ignore */
    }
    themeDisposer = null
  }

  function clearVisual() {
    disposeTokens()
    if (mediaEl && mediaEl.parentNode) mediaEl.parentNode.removeChild(mediaEl)
    mediaEl = null
    mediaKey = ''
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer)
    layer = null
    scrimEl = null
    appliedTokenKey = ''
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(CS_ROOT_CLASS)
      document.documentElement.style.removeProperty('--dsh-cs-frost')
    }
  }

  function syncVisual() {
    if (disposed) return
    var eff = effective()
    var material = eff.materialId ? findMaterial(eff.materialId) : null
    if (!material) {
      clearVisual()
      return
    }
    var solid = state.uiMode === 'settings'
    var animate = shouldAnimate(material, eff.cfg)
    var root = ensureLayer()
    if (!root) return
    var key = material.id + '|' + (animate ? 'a' : 's')
    if (key !== mediaKey) {
      if (mediaEl && mediaEl.parentNode) mediaEl.parentNode.removeChild(mediaEl)
      mediaEl = buildMedia(material, animate)
      root.insertBefore(mediaEl, scrimEl)
      mediaKey = key
    }
    csApplyStyle(mediaEl, csMediaStyle(eff.cfg))
    csApplyStyle(scrimEl, csScrimStyle(eff.cfg, state.scheme, material.luma))
    /* Every settings page — not just this one — is a form the user reads while
     * typing, so the picture comes off entirely and the host's own opaque
     * palette takes over. That is also the cheap path: no backdrop blur and no
     * full-screen decode behind a page nobody is looking at. */
    if (root.style) root.style.display = solid ? 'none' : ''
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--dsh-cs-frost', solid ? 'none' : csFrostFilter(eff.cfg) || 'none')
      /* The transparent html/body rule only makes sense while the picture is
       * showing; drop it too, or a settings page would sit on a hole. */
      if (solid) document.documentElement.classList.remove(CS_ROOT_CLASS)
      else document.documentElement.classList.add(CS_ROOT_CLASS)
    }
    /* A solid page re-registers nothing: dropping our layer hands every surface
     * back to the theme's own colours instead of a hand-mixed near-black. */
    var tokenKey = solid ? 'solid' : String(eff.cfg.panelOpacity) + '|' + eff.cfg.accent
    if (tokenKey !== appliedTokenKey) {
      appliedTokenKey = tokenKey
      disposeTokens()
      if (!solid && state.canTheme && ctx.theme && ctx.theme.overrideTokens) {
        try {
          themeDisposer = ctx.theme.overrideTokens(CS_TOKEN_SOURCE, csTokenOverrides(eff.cfg, false))
        } catch (err) {
          themeDisposer = null
        }
      }
    }
    if (typeof document !== 'undefined') document.documentElement.classList.add(CS_ROOT_CLASS)
  }

  /* ------------------------------------------------------------ theme state */

  function refreshTheme() {
    var snapshot = null
    try {
      if (ctx.theme && ctx.theme.getTheme) snapshot = ctx.theme.getTheme()
    } catch (err) {
      snapshot = null
    }
    if (!snapshot) return
    var active = snapshot.active || { id: 'light', colorScheme: 'light' }
    var known = snapshot.themes || []
    /* A removed theme plugin can leave the host pointing at an id nobody
     * registers any more; repair that once instead of leaving a dead palette. */
    var broken = !!active.id && active.id !== 'light' && active.id !== 'dark' && !hasTheme(known, active.id)
    set({
      scheme: active.colorScheme === 'dark' ? 'dark' : 'light',
      themePreference: snapshot.preference || 'system',
      canTheme: !!(ctx.theme && ctx.theme.overrideTokens)
    })
    if (broken && !repairedTheme && ctx.theme && ctx.theme.setTheme) {
      repairedTheme = true
      try {
        ctx.theme.setTheme('system')
      } catch (err) {
        /* the host refuses the repair; the user can still pick a theme by hand */
      }
    }
  }

  function hasTheme(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return true
    }
    return false
  }

  /* ------------------------------------------------------------- persistence */

  function persistApplied(applied) {
    if (!state.storageOk) return Promise.resolve(false)
    return csDbWriteState({ materialId: applied.materialId, cfg: applied.cfg }).then(
      function () { return true },
      function () {
        set({ storageOk: false })
        setStatus('err.storage', null, 'warn')
        return false
      }
    )
  }

  function normalizeRecord(record) {
    return {
      id: String(record.id),
      name: String(record.name || record.id),
      ext: String(record.ext || ''),
      kind: record.kind === 'video' || record.kind === 'gif' ? record.kind : 'image',
      size: Number(record.size) || 0,
      width: Number(record.width) || 0,
      height: Number(record.height) || 0,
      luma: typeof record.luma === 'number' && isFinite(record.luma) ? record.luma : 0.5,
      addedAt: Number(record.addedAt) || Date.now(),
      blob: record.blob
    }
  }

  function loadLibrary() {
    var storedState = null
    var storedPrefs = null
    var records = []
    csDbAll()
      .then(function (all) {
        records = (all || []).filter(function (record) {
          return record && record.blob && record.id
        })
        return csDbReadState()
      })
      .then(function (value) {
        storedState = value
        return csDbReadPrefs()
      })
      .then(function (value) {
        storedPrefs = value
      })
      .then(
        function () {
          var materials = records.map(normalizeRecord).sort(function (a, b) { return a.addedAt - b.addedAt })
          var applied = { materialId: null, cfg: csDefaultConfig() }
          if (storedState && storedState.materialId && materials.some(function (m) { return m.id === storedState.materialId })) {
            applied = { materialId: String(storedState.materialId), cfg: csNormalizeConfig(storedState.cfg) }
          }
          set({
            ready: true,
            storageOk: true,
            lang: csNormalizeLang(storedPrefs && storedPrefs.lang),
            materials: materials,
            applied: applied,
            status: { key: '', params: null, tone: 'info' }
          })
        },
        function () {
          set({ ready: true, storageOk: false, materials: [], applied: { materialId: null, cfg: csDefaultConfig() } })
          setStatus('err.storage', null, 'warn')
        }
      )
  }

  function setLang(next) {
    var lang = csNormalizeLang(next)
    if (lang === state.lang) return
    set({ lang: lang })
    if (!state.storageOk) return
    csDbWritePrefs({ lang: lang }).catch(function () {
      set({ storageOk: false })
    })
  }

  /* ---------------------------------------------------------------- import */

  function sniffFile(file, ext) {
    if (typeof file.slice !== 'function' || typeof Uint8Array === 'undefined') return Promise.resolve(true)
    return file
      .slice(0, 16)
      .arrayBuffer()
      .then(function (buffer) {
        if (!csSniffMatches(ext, csSniff(new Uint8Array(buffer)))) throw CsError('mismatch')
        return true
      })
  }

  function decodeImage(url) {
    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = setTimeout(function () {
        finish(null)
      }, CS_DECODE_TIMEOUT_MS)
      function finish(result) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (result) resolve(result)
        else reject(CsError('decodeFailed'))
      }
      if (typeof Image === 'undefined') {
        finish(null)
        return
      }
      var img = new Image()
      img.onload = function () {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) finish({ width: img.naturalWidth, height: img.naturalHeight })
        else finish(null)
      }
      img.onerror = function () { finish(null) }
      try {
        img.src = url
      } catch (err) {
        finish(null)
      }
    })
  }

  function decodeVideo(url) {
    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = setTimeout(function () { finish(null) }, CS_DECODE_TIMEOUT_MS)
      var probe = null
      function finish(result) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (probe) {
          probe.removeAttribute('src')
          try {
            probe.load()
          } catch (err) {
            /* ignore */
          }
          probe = null
        }
        if (result) resolve(result)
        else reject(CsError('decodeFailed'))
      }
      if (typeof document === 'undefined' || !document.createElement) {
        finish(null)
        return
      }
      probe = document.createElement('video')
      probe.muted = true
      probe.preload = 'auto'
      probe.addEventListener('loadeddata', function () {
        if (probe && probe.videoWidth > 0) finish({ width: probe.videoWidth, height: probe.videoHeight })
        else finish(null)
      })
      probe.addEventListener('error', function () { finish(null) })
      try {
        probe.src = url
        probe.load()
      } catch (err) {
        finish(null)
      }
    })
  }

  /* Average tone of the picture, used to pick a scrim that fits it: a dark photo
   * under dark text needs a stronger light bed (and the mirror case), so the
   * default look is readable without the user first finding the scrim slider. */
  function readAverageTone(context) {
    try {
      var data = context.getImageData(0, 0, 24, 24).data
      var sum = 0
      var count = 0
      for (var i = 0; i < data.length; i += 4) {
        sum += csLumaOf(data[i], data[i + 1], data[i + 2])
        count++
      }
      return count ? sum / count : 0.5
    } catch (err) {
      return 0.5
    }
  }

  function measureTone(url, kind) {
    return new Promise(function (resolve) {
      var settled = false
      function settle(value) {
        if (settled) return
        settled = true
        resolve(typeof value === 'number' && isFinite(value) ? value : 0.5)
      }
      try {
        if (typeof document === 'undefined' || !document.createElement) {
          settle(0.5)
          return
        }
        var canvas = document.createElement('canvas')
        canvas.width = 24
        canvas.height = 24
        var context = canvas.getContext('2d')
        if (!context) {
          settle(0.5)
          return
        }
        var timer = setTimeout(function () { settle(0.5) }, CS_DECODE_TIMEOUT_MS)
        var finish = function (value) {
          clearTimeout(timer)
          settle(value)
        }
        if (kind === 'video') {
          var probe = document.createElement('video')
          probe.muted = true
          probe.preload = 'auto'
          probe.setAttribute('playsinline', '')
          probe.addEventListener('loadeddata', function () {
            try {
              context.drawImage(probe, 0, 0, 24, 24)
              finish(readAverageTone(context))
            } catch (err) {
              finish(0.5)
            }
            try {
              probe.removeAttribute('src')
              probe.load()
            } catch (err) {
              /* ignore */
            }
          })
          probe.addEventListener('error', function () { finish(0.5) })
          probe.src = url
          return
        }
        var img = new Image()
        img.onload = function () {
          try {
            context.drawImage(img, 0, 0, 24, 24)
            finish(readAverageTone(context))
          } catch (err) {
            finish(0.5)
          }
        }
        img.onerror = function () { finish(0.5) }
        img.src = url
      } catch (err) {
        settle(0.5)
      }
    })
  }

  function importOne(file) {
    var info = csIdentify(file && file.name, file && file.size)
    return sniffFile(file, info.ext).then(function () {
      var id = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
      var url = URL.createObjectURL(file)
      urls.set(id, url)
      var decode = info.kind === 'video' ? decodeVideo(url) : decodeImage(url)
      return decode.then(
        function (size) {
          return measureTone(url, info.kind).then(function (luma) {
            return {
              id: id,
              name: String(file.name || id),
              ext: info.ext,
              kind: info.kind,
              size: Number(file.size) || 0,
              width: size.width,
              height: size.height,
              luma: luma,
              addedAt: Date.now(),
              blob: file
            }
          })
        },
        function (err) {
          releaseUrl(id)
          throw err
        }
      )
    })
  }

  function importFiles(fileList) {
    if (state.busy) {
      setStatus('err.busy', null, 'warn')
      return Promise.resolve(false)
    }
    var files = Array.prototype.slice.call(fileList || []).filter(Boolean)
    if (!files.length) return Promise.resolve(false)
    var room = CS_MAX_MATERIALS - state.materials.length
    if (room <= 0) {
      setStatus('err.tooMany', null, 'error')
      return Promise.resolve(false)
    }
    set({ busy: true })
    var added = []
    var failure = null
    var chain = Promise.resolve()
    files.slice(0, room).forEach(function (file) {
      chain = chain.then(function () {
        /* `csIdentify` rejects oversized or unsupported files synchronously, so
         * the attempt is normalised into a failure instead of a rejected chain. */
        return Promise.resolve()
          .then(function () { return importOne(file) })
          .then(
            function (record) {
              added.push(record)
              return null
            },
            function (err) {
              if (!failure) failure = err
              return null
            }
          )
      })
    })
    return chain.then(function () {
      var materials = state.materials.concat(added)
      var patch = { busy: false, materials: materials }
      var cfg = csNormalizeConfig(effective().cfg)
      if (added.length) patch.draft = { materialId: added[added.length - 1].id, cfg: cfg }
      set(patch)
      if (state.storageOk) {
        added.forEach(function (record) {
          csDbPut(record).catch(function () {
            set({ storageOk: false })
            setStatus('err.storage', null, 'warn')
          })
        })
      }
      if (failure) {
        var info = csErrorInfo(failure)
        setStatus(info.key, info.params, 'error')
      } else {
        setStatus('status.imported', { count: added.length })
      }
      return added.length > 0
      },
      function (err) {
        /* Defensive: the picker must never surface an unhandled rejection. */
        set({ busy: false })
        var info = csErrorInfo(err)
        setStatus(info.key, info.params, 'error')
        return false
      }
    )
  }

  /* --------------------------------------------------------------- mutations */

  function selectMaterial(id) {
    var material = findMaterial(id)
    if (!material) return
    var cfg = csNormalizeConfig(effective().cfg)
    /* Once a skin is already on screen there is nothing to confirm: picking
     * another material switches to it immediately, and the user can still fine
     * tune afterwards because the draft holds the new picture. */
    if (state.applied.materialId) {
      var applied = { materialId: id, cfg: cfg }
      set({ applied: applied, draft: { materialId: id, cfg: cfg } })
      persistApplied(applied)
      setStatus('', null, 'info')
      flash('flash.switched', { name: material.name })
      return
    }
    set({ draft: { materialId: id, cfg: cfg } })
    setStatus('status.previewing', { name: material.name })
  }

  function updateCfg(patch) {
    var eff = effective()
    var cfg = csNormalizeConfig(Object.assign({}, eff.cfg, patch))
    set({ draft: { materialId: eff.materialId, cfg: cfg } })
  }

  function applyDraft() {
    var draft = state.draft
    if (!draft || !draft.materialId) {
      setStatus('err.noMaterial', null, 'warn')
      return
    }
    if (!findMaterial(draft.materialId)) {
      setStatus('err.noMaterial', null, 'warn')
      return
    }
    var applied = { materialId: draft.materialId, cfg: csNormalizeConfig(draft.cfg) }
    set({ applied: applied, draft: null })
    persistApplied(applied)
    setStatus('', null, 'info')
    flash('flash.applied')
  }

  function cancelDraft() {
    if (!state.draft) return
    set({ draft: null })
    setStatus('status.cancelled')
  }

  function restoreDefault() {
    var applied = { materialId: null, cfg: csDefaultConfig() }
    set({ applied: applied, draft: null })
    persistApplied(applied)
    setStatus('', null, 'info')
    flash('flash.reset')
  }

  function removeMaterial(id) {
    var material = findMaterial(id)
    if (!material) return
    var materials = state.materials.filter(function (record) { return record.id !== id })
    var applied = state.applied
    var draft = state.draft
    if (applied.materialId === id) applied = { materialId: null, cfg: csDefaultConfig() }
    if (draft && draft.materialId === id) draft = null
    releaseUrl(id)
    set({ materials: materials, applied: applied, draft: draft })
    if (state.storageOk) {
      csDbDelete(id).catch(function () {
        setStatus('err.storage', null, 'warn')
      })
      persistApplied(applied)
    }
    setStatus('status.removed')
  }

  /* The settings seat is one modal for every section, so "settings is open" is
   * a property of the panel, not of this page: switching to Plugins used to put
   * the photo back under a form. The panel is host chrome with no service to
   * ask, so it is detected from the DOM (a modal is in the tree) and re-checked
   * after any body change, click, or key press. */
  /* A dialog node only counts while it is actually painted: several plugins keep
   * a hidden modal in the tree, and treating that as "settings is open" would
   * leave the skin switched off forever. */
  function settingsPanelOpen() {
    if (typeof document === 'undefined' || !document.body) return false
    var found = null
    try {
      found = document.querySelectorAll('[aria-modal="true"],[role="dialog"],[role="alertdialog"],dialog[open]')
    } catch (err) {
      return false
    }
    if (!found) return false
    var list = typeof found.length === 'number' ? found : [found]
    for (var i = 0; i < list.length; i += 1) {
      var node = list[i]
      if (!node) continue
      var rects = node.getClientRects ? node.getClientRects() : null
      if (rects && typeof rects.length === 'number' && rects.length > 0) return true
      if (!rects && (node.offsetWidth || node.offsetHeight)) return true
    }
    return false
  }

  function watchSettingsPanel() {
    if (typeof document === 'undefined' || !document.body) return function () {}
    var scheduled = false
    function update() {
      scheduled = false
      if (disposed) return
      var open = settingsPanelOpen()
      if (state.panelOpen !== open) set({ panelOpen: open, uiMode: open || state.sectionOpen ? 'settings' : 'app' })
    }
    function schedule() {
      if (scheduled) return
      scheduled = true
      setTimeout(update, 0)
    }
    update()
    var observer = null
    if (typeof MutationObserver !== 'undefined') {
      try {
        observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true })
      } catch (err) {
        observer = null
      }
    }
    document.addEventListener('pointerdown', schedule, true)
    document.addEventListener('keydown', schedule, true)
    return function () {
      if (observer) {
        try {
          observer.disconnect()
        } catch (err) {
          /* ignore */
        }
      }
      document.removeEventListener('pointerdown', schedule, true)
      document.removeEventListener('keydown', schedule, true)
    }
  }

  /* This page being on screen is the second, certain signal: it only mounts
   * inside the settings panel. */
  function setUiMode(mode) {
    var sectionOpen = mode === 'settings'
    if (state.sectionOpen === sectionOpen) return
    set({ sectionOpen: sectionOpen, uiMode: sectionOpen || state.panelOpen ? 'settings' : 'app' })
  }

  /* ------------------------------------------------------------ lifecycle */

  function watchReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return
    try {
      motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    } catch (err) {
      motionQuery = null
      return
    }
    var onChange = function () {
      set({ reducedMotion: !!motionQuery.matches })
    }
    onChange()
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onChange)
    else if (motionQuery.addListener) motionQuery.addListener(onChange)
    motionQuery.__csOnChange = onChange
  }

  function attach() {
    refreshTheme()
    watchReducedMotion()
    loadLibrary()
    var stopPanelWatch = watchSettingsPanel()
    return function () {
      stopPanelWatch()
      if (motionQuery) {
        var onChange = motionQuery.__csOnChange
        if (onChange && motionQuery.removeEventListener) motionQuery.removeEventListener('change', onChange)
        else if (onChange && motionQuery.removeListener) motionQuery.removeListener(onChange)
        motionQuery = null
      }
    }
  }

  function dispose() {
    disposed = true
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
    clearVisual()
    var styleEl = typeof document !== 'undefined' ? document.getElementById(CS_LAYER_STYLE_ID) : null
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
    urls.forEach(function (url) {
      try {
        URL.revokeObjectURL(url)
      } catch (err) {
        /* ignore */
      }
    })
    urls.clear()
    posters.clear()
    listeners.clear()
  }

  return {
    subscribe: function (fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    },
    getState: function () { return state },
    translate: translate,
    attach: attach,
    dispose: dispose,
    refreshTheme: refreshTheme,
    importFiles: importFiles,
    removeMaterial: removeMaterial,
    selectMaterial: selectMaterial,
    updateCfg: updateCfg,
    applyDraft: applyDraft,
    cancelDraft: cancelDraft,
    restoreDefault: restoreDefault,
    setUiMode: setUiMode,
    setLang: setLang,
    urlFor: function (record) {
      try {
        return urlFor(record)
      } catch (err) {
        return ''
      }
    }
  }
}

/* ---------------------------------------------------------------------- UI */

var CS_PAGE_CSS = [
  '.dsh-cs-page{display:flex;flex-direction:column;gap:16px;padding:2px 2px 32px;container-type:inline-size;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
  '.dsh-cs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
  '.dsh-cs-title{margin:0;font-size:16px;font-weight:600}',
  '.dsh-cs-sub{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-cs-actions{display:flex;gap:8px;flex-wrap:wrap}',
  '.dsh-cs-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-cs-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
  '.dsh-cs-h3{margin:0;font-size:14px;font-weight:600;letter-spacing:.01em}',
  '.dsh-cs-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.dsh-cs-btn{appearance:none;font-family:inherit;font-size:12px;line-height:1.5;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color .12s ease}',
  '.dsh-cs-btn:hover:not(:disabled):not(.dsh-cs-btn--primary):not(.dsh-cs-btn--success){background:var(--dsw-alias-bg-overlay)}',
  '.dsh-cs-btn--primary:hover:not(:disabled),.dsh-cs-btn--success:hover:not(:disabled){filter:brightness(1.06)}',
  '.dsh-cs-btn:disabled{opacity:.45;cursor:default}',
  '.dsh-cs-btn--primary{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:600}',
  '.dsh-cs-btn--ghost{background:transparent}',
  '.dsh-cs-btn--danger{background:transparent;color:var(--dsw-alias-state-error-primary,#e5484d)}',
  '.dsh-cs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}',
  '.dsh-cs-item{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;font-family:inherit;text-align:left;cursor:pointer}',
  '.dsh-cs-item[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}',
  '.dsh-cs-thumb{position:relative;width:100%;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-overlay)}',
  '.dsh-cs-thumb img,.dsh-cs-thumb video{display:block;width:100%;height:100%;object-fit:cover}',
  '.dsh-cs-item-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-cs-item-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;min-width:0}',
  '.dsh-cs-badge{font-size:11px;line-height:1.6;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
  '.dsh-cs-badge--live{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}',
  '.dsh-cs-body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}',
  '.dsh-cs-side{display:flex;flex-direction:column;gap:12px;min-width:0}',
  '.dsh-cs-preview{position:relative;width:100%;aspect-ratio:16/10;border-radius:10px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-cs-preview img,.dsh-cs-preview video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
  '.dsh-cs-preview-scrim{position:absolute;inset:0;pointer-events:none}',
  '.dsh-cs-preview-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--dsw-alias-label-secondary);padding:12px;text-align:center}',
  /* A miniature of the app surfaces: the opacity and frost sliders only change
   * the main window, so this sample is the one place their effect is visible. */
  '.dsh-cs-controls{display:flex;flex-direction:column;gap:12px;min-width:0}',
  '.dsh-cs-switches{display:flex;flex-direction:column;padding:2px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
  '.dsh-cs-sample{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-direction:column;gap:5px;padding:9px;border-radius:9px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 32%,transparent)}',
  '.dsh-cs-sample-line{height:7px;border-radius:4px;background:currentColor;opacity:.85}',
  '.dsh-cs-sample-line--short{width:56%}',
  '.dsh-cs-field{display:flex;flex-direction:column;gap:2px;padding:9px 12px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);transition:border-color .15s ease,background-color .15s ease}',
  '.dsh-cs-field:hover{border-color:var(--dsw-alias-border-l2)}',
  '.dsh-cs-field:focus-within{border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-cs-field--off .dsh-cs-field-label{color:var(--dsw-alias-label-secondary)}',
  '.dsh-cs-field-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;line-height:1.4}',
  '.dsh-cs-field-label{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-cs-number{max-width:100%;width:58px;padding:2px 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;text-align:right;font-variant-numeric:tabular-nums;transition:color .15s ease,border-color .15s ease}',
  '.dsh-cs-number:hover{border-color:var(--dsw-alias-border-l2)}',
  '.dsh-cs-number:focus{border-color:var(--dsw-alias-brand-primary)}',
  '.dsh-cs-number::-webkit-inner-spin-button,.dsh-cs-number::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}',
  '.dsh-cs-range{-webkit-appearance:none;appearance:none;width:100%;height:18px;margin:1px 0 0;padding:0;background:transparent;cursor:pointer}',
  '.dsh-cs-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,var(--dsw-alias-brand-primary) var(--dsh-cs-fill,0%),color-mix(in srgb,var(--dsw-alias-label-secondary) 30%,transparent) var(--dsh-cs-fill,0%))}',
  '.dsh-cs-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;margin-top:-4.5px;border-radius:50%;background:var(--dsw-alias-bg-base);border:2px solid var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);transition:transform .12s ease,box-shadow .12s ease}',
  '.dsh-cs-range:hover::-webkit-slider-thumb{transform:scale(1.1)}',
  '.dsh-cs-range:active::-webkit-slider-thumb{transform:scale(1.18);box-shadow:0 0 0 4px rgba(120,120,140,.22)}',
  '.dsh-cs-range:disabled::-webkit-slider-runnable-track{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 18%,transparent)}',
  '.dsh-cs-range:disabled::-webkit-slider-thumb{border-color:var(--dsw-alias-label-secondary);box-shadow:none}',
  '.dsh-cs-range::-moz-range-track{height:6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 30%,transparent)}',
  '.dsh-cs-range::-moz-range-progress{height:6px;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
  '.dsh-cs-range::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-base);border:2px solid var(--dsw-alias-brand-primary)}',
  '.dsh-cs-seg{display:inline-flex;align-self:flex-start;gap:4px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2)}',
  '.dsh-cs-seg button{appearance:none;font-family:inherit;font-size:12px;padding:3px 10px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.dsh-cs-seg button[data-on="true"]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-weight:600}',
  '.dsh-cs-switch{display:flex;align-items:center;gap:9px;width:100%;padding:8px 0;border:0;background:transparent;font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}',
  '.dsh-cs-switch + .dsh-cs-switch{border-top:1px solid var(--dsw-alias-border-l1)}',
  '.dsh-cs-switch:disabled{color:var(--dsw-alias-label-secondary);cursor:default}',
  '.dsh-cs-switch:disabled .dsh-cs-knob{opacity:.5}',
  '.dsh-cs-knob{position:relative;flex:0 0 auto;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-label-secondary);padding:0;transition:background-color .14s ease,border-color .14s ease}',
  '.dsh-cs-knob::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);transition:transform .14s ease}',
  '.dsh-cs-knob[data-on="true"]{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}',
  '.dsh-cs-knob[data-on="true"]::after{transform:translateX(14px)}',
  '.dsh-cs-page :focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}',
  '.dsh-cs-status{font-size:12px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
  '.dsh-cs-status--warn{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5a524) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5a524) 14%,var(--dsw-alias-bg-layer-2))}',
  '.dsh-cs-status--error{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 14%,var(--dsw-alias-bg-layer-2))}',
  '.dsh-cs-code{margin:0;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}',
  '.dsh-cs-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:2px}',
  '.dsh-cs-foot-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}',
  /* A successful Apply answers where it happened: a green chip beside the
   * button, gone in a few seconds. Failures keep the left column. */
  '.dsh-cs-flash{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:1.5;padding:4px 9px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 60%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 16%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);font-weight:600;animation:dsh-cs-pop .16s ease-out}',
  '.dsh-cs-flash::before{content:"✓";font-size:11px;color:var(--dsw-alias-state-success-primary,#16a34a)}',
  '@keyframes dsh-cs-pop{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}',
  '.dsh-cs-badge--ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 20%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 55%,transparent)}',
  '.dsh-cs-btn--success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 20%,var(--dsw-alias-bg-layer-2));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 60%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}',
  '.dsh-cs-swatch{flex:0 0 auto;width:26px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;cursor:pointer}',
  '.dsh-cs-swatch::-webkit-color-swatch-wrapper{padding:0}',
  '.dsh-cs-swatch::-webkit-color-swatch{border:0;border-radius:6px}',
  '.dsh-cs-range:disabled,.dsh-cs-number:disabled{opacity:.5;cursor:default}',
  /* The settings seat can be a narrow pane on a small window. */
  '@media (max-width:600px){.dsh-cs-body{grid-template-columns:1fr}.dsh-cs-page{padding-bottom:24px}}',
  /* The media query follows the window; this one follows the pane. */
  '@container (max-width:600px){.dsh-cs-body{grid-template-columns:1fr}.dsh-cs-page{padding-bottom:24px}}'
].join('\n')

function csButton(props, label) {
  var variant = props.variant || 'default'
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-cs-btn' + (variant === 'default' ? '' : ' dsh-cs-btn--' + variant),
      onClick: props.onClick,
      disabled: !!props.disabled,
      title: props.title || undefined,
      'aria-label': props.label || undefined
    },
    label === undefined ? props.children : label
  )
}

function csField(props) {
  return h(
    'div',
    { className: 'dsh-cs-field' + (props.className ? ' ' + props.className : '') },
    h(
      'div',
      { className: 'dsh-cs-field-head' },
      h('span', { className: 'dsh-cs-field-label' }, props.label)
    ),
    props.children
  )
}

function csSlider(props) {
  var precision = props.precision === undefined ? 2 : props.precision
  /* Sliders whose stored value is fractional but whose meaning is a percentage
   * (opacity, brightness) show 0–100 in the box and keep 0–1 underneath. */
  var factor = props.factor ? Number(props.factor) : 1
  var boxRef = useRef(null)
  function format(value) {
    var num = Number(value) * factor
    if (!isFinite(num)) num = Number(props.min) * factor
    return precision === 0 ? String(Math.round(num)) : num.toFixed(precision)
  }
  /* Keep the box in step with the slider or a reset without remounting it,
   * which would drop the caret while the user is typing. */
  useEffect(function () {
    var box = boxRef.current
    if (!box || (typeof document !== 'undefined' && document.activeElement === box)) return
    var next = format(props.value)
    if (box.value !== next) box.value = next
  }, [props.value])
  function commit(event) {
    var raw = event.target.value
    var next = Number(raw)
    /* An empty or unparseable box restores the last committed value instead of
     * pushing NaN into the stored config. */
    if (raw === '' || !isFinite(next)) {
      event.target.value = format(props.value)
      return
    }
    props.onChange(next / factor)
  }
  /* The filled part of the track is drawn with a gradient stop at this
   * percentage, so the slider reads as a progress-like control instead of a
   * bare native range. */
  var span = Number(props.max) - Number(props.min)
  var ratio = span > 0 ? (Number(props.value) - Number(props.min)) / span : 0
  var fill = (Math.max(0, Math.min(1, isFinite(ratio) ? ratio : 0)) * 100).toFixed(1) + '%'
  return h(
    'div',
    { className: 'dsh-cs-field' + (props.disabled ? ' dsh-cs-field--off' : '') },
    h(
      'div',
      { className: 'dsh-cs-field-head' },
      h('span', { className: 'dsh-cs-field-label' }, props.label),
      h('input', {
        ref: boxRef,
        className: 'dsh-cs-number',
        type: 'number',
        min: props.min * factor,
        max: props.max * factor,
        step: props.step * factor,
        inputMode: 'decimal',
        disabled: !!props.disabled,
        defaultValue: format(props.value),
        'aria-label': props.label + (props.unit ? ' (' + props.unit + ')' : ''),
        onInput: commit,
        onBlur: function (event) {
          commit(event)
          event.target.value = format(props.value)
        },
        onKeyDown: function (event) {
          if (event.key === 'Enter') commit(event)
        }
      })
    ),
    h('input', {
      className: 'dsh-cs-range',
      type: 'range',
      min: props.min,
      max: props.max,
      step: props.step,
      value: props.value,
      disabled: !!props.disabled,
      style: { '--dsh-cs-fill': fill },
      'aria-label': props.label,
      'aria-valuetext': props.valueText,
      onChange: function (event) { props.onChange(Number(event.target.value)) }
    })
  )
}

/* One control, one hit target: the whole row is the switch, so the label is
 * clickable and the state is announced once. */
function csSwitch(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-cs-switch',
      role: 'switch',
      'aria-checked': props.checked ? 'true' : 'false',
      title: props.title || undefined,
      onClick: function () { props.onChange(!props.checked) },
      disabled: !!props.disabled
    },
    h('span', { className: 'dsh-cs-knob', 'data-on': props.checked ? 'true' : 'false', 'aria-hidden': 'true' }),
    h('span', null, props.label)
  )
}

function csThumb(engine, record) {
  var url = engine.urlFor(record)
  if (record.kind === 'video') {
    /* One decoder per grid cell is expensive and pointless for a 130px tile, so
     * the tile shows a still frame and only the preview box plays. */
    return h('video', {
      className: '',
      src: url + '#t=0.1',
      muted: true,
      loop: false,
      autoPlay: false,
      playsInline: true,
      preload: 'metadata',
      'aria-hidden': 'true',
      tabIndex: -1
    })
  }
  return h('img', { src: url, alt: '', loading: 'lazy' })
}

function csCreateSection(engine) {
  return function CustomSkinSection(props) {
    var owner = props || {}
    var state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState)
    var fileRef = useRef(null)
    var t = engine.translate
    var draftCfg = state.draft ? state.draft.cfg : state.applied.cfg
    var hasDraft = !!state.draft
    var selected = state.draft ? state.draft.materialId : state.applied.materialId
    var draftMaterial = state.draft && state.draft.materialId ? findIn(state.materials, state.draft.materialId) : null
    var activeMaterial = state.applied.materialId ? findIn(state.materials, state.applied.materialId) : null
    /* Before the first edit there is no draft yet, but a skin may already be
     * applied: show that one instead of an empty box that reads as broken. */
    var previewMaterial = draftMaterial || activeMaterial

    var onImport = useCallback(function () {
      if (fileRef.current) fileRef.current.click()
    }, [])

    var onPickFiles = useCallback(function (event) {
      var files = event.target && event.target.files
      if (files && files.length) engine.importFiles(files)
      if (event.target) event.target.value = ''
    }, [])

    /* While this page is open the app surfaces go solid: a translucent form on
     * top of a photo is hard to read, and the user came here to change values.
     * Leaving without applying also drops the preview, so the app never stays
     * on an untitled draft that has no marker in the UI. */
    useEffect(function () {
      engine.setUiMode('settings')
      return function () {
        engine.setUiMode('app')
        if (engine.getState().draft) engine.cancelDraft()
      }
    }, [])

    return h(
      'div',
      { className: 'dsh-cs-page' },
      h('style', null, CS_PAGE_CSS),
      h(
        'div',
        { className: 'dsh-cs-head' },
        h(
          'div',
          null,
          h('h2', { className: 'dsh-cs-title' }, t('page.title')),
          h('p', { className: 'dsh-cs-sub' }, t('page.subtitle'))
        ),
        h(
          'div',
          { className: 'dsh-cs-actions' },
          h(
            'div',
            { className: 'dsh-cs-seg', role: 'group', 'aria-label': t('lang.heading') },
            h(
              'button',
              {
                type: 'button',
                'data-on': state.lang === 'zh' ? 'true' : 'false',
                'aria-pressed': state.lang === 'zh' ? 'true' : 'false',
                onClick: function () { engine.setLang('zh') }
              },
              t('lang.zh')
            ),
            h(
              'button',
              {
                type: 'button',
                'data-on': state.lang === 'en' ? 'true' : 'false',
                'aria-pressed': state.lang === 'en' ? 'true' : 'false',
                onClick: function () { engine.setLang('en') }
              },
              t('lang.en')
            )
          ),
          csButton({ onClick: function () { engine.restoreDefault() }, variant: 'ghost' }, t('btn.reset'))
        )
      ),

      /* ---------------------------------------------------- media library */
      h(
        'section',
        { className: 'dsh-cs-card', 'aria-label': t('material.heading') },
        h(
          'div',
          { className: 'dsh-cs-card-head' },
          h('h3', { className: 'dsh-cs-h3' }, t('material.heading')),
          h(
            'div',
            { className: 'dsh-cs-actions' },
            h('span', { className: 'dsh-cs-badge' }, t('material.count', { count: state.materials.length })),
            csButton({ onClick: onImport, variant: 'primary', disabled: state.busy }, t('btn.import'))
          )
        ),
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: CS_ACCEPT,
          multiple: true,
          style: { display: 'none' },
          onChange: onPickFiles
        }),
        state.materials.length
          ? h(
              'div',
              { className: 'dsh-cs-grid' },
              state.materials.map(function (record) {
                return h(
                  'div',
                  {
                    key: record.id,
                    className: 'dsh-cs-item',
                    'data-selected': record.id === selected ? 'true' : 'false',
                    role: 'button',
                    tabIndex: 0,
                    onClick: function () { engine.selectMaterial(record.id) },
                    onKeyDown: function (event) {
                      /* Keys pressed inside the nested Delete button bubble here;
                       * preventDefault would swallow its activation. */
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        engine.selectMaterial(record.id)
                      }
                    }
                  },
                  h('div', { className: 'dsh-cs-thumb' }, csThumb(engine, record)),
                  h('div', { className: 'dsh-cs-item-name', title: record.name }, record.name),
                  h(
                    'div',
                    { className: 'dsh-cs-item-foot' },
                    h(
                      'span',
                      {
                        className:
                          'dsh-cs-badge' +
                          (state.draft && state.draft.materialId === record.id ? ' dsh-cs-badge--live' : '') +
                          (state.applied.materialId === record.id ? ' dsh-cs-badge--ok' : '')
                      },
                      state.draft && state.draft.materialId === record.id
                        ? t('material.draft')
                        : state.applied.materialId === record.id
                          ? t('material.inUse')
                          : t('material.' + record.kind)
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-cs-btn dsh-cs-btn--danger',
                        title: t('btn.delete'),
                        'aria-label': t('btn.delete'),
                        onClick: function (event) {
                          event.stopPropagation()
                          /* Deleting the applied background is destructive with no
                           * undo, so ask before dropping the current skin. */
                          var inUse = state.applied.materialId === record.id
                          var question = inUse
                            ? t('material.deleteApplied', { name: record.name })
                            : t('material.deleteConfirm', { name: record.name })
                          if (typeof window !== 'undefined' && window.confirm && !window.confirm(question)) return
                          engine.removeMaterial(record.id)
                        }
                      },
                      t('btn.delete')
                    )
                  )
                )
              })
            )
          : h(
              'div',
              null,
              h('p', { className: 'dsh-cs-note' }, t('material.empty')),
              h('p', { className: 'dsh-cs-note' }, t('material.emptyHint'))
            )
      ),

      /* ------------------------------------------------ preview + adjust */
      h(
        'section',
        { className: 'dsh-cs-card', 'aria-label': t('adjust.heading') },
        h(
          'div',
          { className: 'dsh-cs-card-head' },
          h('h3', { className: 'dsh-cs-h3' }, t('adjust.heading')),
          activeMaterial ? h('span', { className: 'dsh-cs-badge' }, activeMaterial.name) : null
        ),
        h(
          'div',
          { className: 'dsh-cs-body' },
          h(
            'div',
            { className: 'dsh-cs-side' },
            h(
              'div',
              { className: 'dsh-cs-preview' },
              previewMaterial
                ? [
                    previewMaterial.kind === 'video'
                      ? h('video', {
                          key: 'media',
                          'aria-hidden': 'true',
                          src: engine.urlFor(previewMaterial),
                          muted: true,
                          loop: true,
                          autoPlay: draftCfg.motion && !state.reducedMotion,
                          playsInline: true,
                          preload: 'metadata',
                          style: csMediaStyle(draftCfg)
                        })
                      : h('img', {
                          key: 'media',
                          src: engine.urlFor(previewMaterial),
                          alt: '',
                          style: csMediaStyle(draftCfg)
                        }),
                    h('div', {
                      key: 'scrim',
                      className: 'dsh-cs-preview-scrim',
                      style: csScrimStyle(draftCfg, state.scheme, previewMaterial.luma)
                    }),
                    /* The two surface sliders only change the main window, which is
                     * not visible here, so the preview carries a sample card that
                     * shows their effect on the picture itself. */
                    h(
                      'div',
                      {
                        key: 'sample',
                        className: 'dsh-cs-sample',
                        style: {
                          background: csRgba(state.scheme, draftCfg.panelOpacity),
                          backdropFilter: csFrostFilter(draftCfg) || 'none',
                          WebkitBackdropFilter: csFrostFilter(draftCfg) || 'none',
                          color: state.scheme === 'dark' ? '#f5f5f5' : '#101010'
                        }
                      },
                      h('span', { className: 'dsh-cs-sample-line' }),
                      h('span', { className: 'dsh-cs-sample-line dsh-cs-sample-line--short' })
                    )
                  ]
                : h('div', { className: 'dsh-cs-preview-empty' }, t('preview.empty'))
            ),
            h(
              'div',
              { className: 'dsh-cs-switches' },
              csSwitch({
                checked: draftCfg.motion,
                disabled: state.reducedMotion,
                title: state.reducedMotion ? t('adjust.motionReduced') : undefined,
                label: t('adjust.motion'),
                onChange: function (next) { engine.updateCfg({ motion: next }) }
              }),
              csSwitch({
                checked: draftCfg.autoTone,
                label: t('adjust.autoTone'),
                onChange: function (next) { engine.updateCfg({ autoTone: next }) }
              })
            ),
            state.canTheme
              ? csField({
                  label: t('adjust.accent'),
                  children: h(
                    'div',
                    { className: 'dsh-cs-actions' },
                    h('input', {
                      className: 'dsh-cs-swatch',
                      type: 'color',
                      value: draftCfg.accent || '#3B82F6',
                      'aria-label': t('adjust.accent'),
                      onChange: function (event) { engine.updateCfg({ accent: event.target.value }) }
                    }),
                    draftCfg.accent
                      ? csButton({ onClick: function () { engine.updateCfg({ accent: '' }) }, variant: 'ghost' }, t('adjust.accentFollow'))
                      : h('span', { className: 'dsh-cs-badge' }, t('adjust.accentFollow'))
                  )
                })
              : null
          ),
          h(
            'div',
            { className: 'dsh-cs-controls' },
            csField({
              label: t('adjust.fit'),
              children: h(
                'div',
                { className: 'dsh-cs-seg', role: 'group', 'aria-label': t('adjust.fit') },
                h(
                  'button',
                  {
                    type: 'button',
                    'data-on': draftCfg.fit === 'cover' ? 'true' : 'false',
                    'aria-pressed': draftCfg.fit === 'cover' ? 'true' : 'false',
                    onClick: function () { engine.updateCfg({ fit: 'cover' }) }
                  },
                  t('adjust.fitCover')
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-on': draftCfg.fit === 'contain' ? 'true' : 'false',
                    'aria-pressed': draftCfg.fit === 'contain' ? 'true' : 'false',
                    onClick: function () { engine.updateCfg({ fit: 'contain' }) }
                  },
                  t('adjust.fitContain')
                )
              )
            }),
            csSlider({
              label: t('adjust.scale'),
              min: 1,
              max: CS_MAX_SCALE,
              step: 0.05,
              value: draftCfg.scale,
              valueText: draftCfg.scale.toFixed(2) + 'x',
              onChange: function (value) { engine.updateCfg({ scale: value }) }
            }),
            csSlider({
              label: t('adjust.brightness'),
              min: CS_MIN_BRIGHTNESS,
              max: CS_MAX_BRIGHTNESS,
              step: 0.01,
              factor: 100,
              precision: 0,
              value: draftCfg.brightness,
              valueText: Math.round(draftCfg.brightness * 100) + '%',
              onChange: function (value) { engine.updateCfg({ brightness: value }) }
            }),
            csSlider({
              label: t('adjust.posX'),
              min: 0,
              max: 100,
              step: 1,
              precision: 0,
              value: draftCfg.posX,
              disabled: draftCfg.fit === 'contain',
              valueText: Math.round(draftCfg.posX) + '%',
              onChange: function (value) { engine.updateCfg({ posX: value }) }
            }),
            csSlider({
              label: t('adjust.posY'),
              min: 0,
              max: 100,
              step: 1,
              precision: 0,
              value: draftCfg.posY,
              disabled: draftCfg.fit === 'contain',
              valueText: Math.round(draftCfg.posY) + '%',
              onChange: function (value) { engine.updateCfg({ posY: value }) }
            }),
            csSlider({
              label: t('adjust.panel'),
              min: CS_MIN_PANEL_OPACITY,
              max: CS_MAX_PANEL_OPACITY,
              step: 0.01,
              factor: 100,
              precision: 0,
              value: draftCfg.panelOpacity,
              disabled: !state.canTheme,
              valueText: Math.round(draftCfg.panelOpacity * 100) + '%',
              onChange: function (value) { engine.updateCfg({ panelOpacity: value }) }
            }),
            csSlider({
              label: t('adjust.panelBlur'),
              min: 0,
              max: CS_MAX_PANEL_BLUR,
              step: 1,
              precision: 0,
              value: draftCfg.panelBlur,
              disabled: !state.canTheme,
              valueText: Math.round(draftCfg.panelBlur) + 'px',
              onChange: function (value) { engine.updateCfg({ panelBlur: value }) }
            })          )
        ),
        h(
          'div',
          { className: 'dsh-cs-foot' },
          state.status.key
            ? h(
                'span',
                { className: 'dsh-cs-status dsh-cs-status--' + state.status.tone, role: 'status' },
                t(state.status.key, state.status.params)
              )
            : null,
          h(
            'span',
            { className: 'dsh-cs-foot-actions' },
            state.flash.key ? h('span', { className: 'dsh-cs-flash', role: 'status' }, t(state.flash.key, state.flash.params)) : null,
            csButton({ onClick: function () { engine.cancelDraft() }, variant: 'ghost', disabled: !hasDraft }, t('btn.cancel')),
            csButton(
              {
                onClick: function () { engine.applyDraft() },
                variant: state.flash.key === 'flash.applied' ? 'success' : 'primary',
                disabled: !hasDraft || !state.draft.materialId
              },
              state.flash.key === 'flash.applied' ? t('flash.applied') : t('btn.apply')
            )
          )
        )
      )
    )
  }
}

function findIn(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

/* -------------------------------------------------------------- registration */

/* Mount diagnostics. A client half that dies before it registers leaves the
 * user hunting a settings page that simply is not there, so every mount step
 * records its own outcome and the panel reports the failure in place. */
var CS_DIAG = { stage: 'boot', error: '', trail: [] }

function csNote(stage, err) {
  if (err) {
    CS_DIAG.stage = stage
    CS_DIAG.error = err && err.stack ? String(err.stack) : String(err)
    CS_DIAG.trail.push(stage + ': ' + (err && err.message ? err.message : String(err)))
    try {
      console.error('[custom-skin] ' + stage + ' failed:', err)
    } catch (ignored) {
      /* console may be unavailable; the trail above is the fallback */
    }
    return
  }
  CS_DIAG.trail.push(stage)
}

var CS_PLUGIN = {
  name: 'custom-skin',
  inject: ['theme', 'slots'],
  apply: function csApply(ctx) {
    try {
      csMount(ctx)
    } catch (err) {
      /* A failure here must never take the rest of the app down. */
      csNote('mount', err)
      try {
        console.error('[custom-skin] mount failed, so the settings section is missing for this session:', err)
      } catch (ignored) {
        /* ignore */
      }
    }
  }
}

/* Last-resort panel: shown when the engine could not be built, so the user sees
 * the reason instead of an empty page. Never throws. */
function csCreateDiagnostic(fallbackTranslate) {
  return function CustomSkinDiagnostic(props) {
    var owner = props || {}
    var t = fallbackTranslate
    var trail = CS_DIAG.trail.join(' · ')
    return h(
      'div',
      { className: 'dsh-cs-page' },
      h('style', null, CS_PAGE_CSS),
      h(
        'div',
        { className: 'dsh-cs-head' },
        h(
          'div',
          null,
          h('h2', { className: 'dsh-cs-title' }, t('page.title')),
          h('p', { className: 'dsh-cs-sub' }, t('page.subtitle'))
        )
      ),
      h(
        'section',
        { className: 'dsh-cs-card', role: 'alert' },
        h('h3', { className: 'dsh-cs-h3' }, t('diag.heading')),
        h('p', { className: 'dsh-cs-note' }, t('diag.hint')),
        h('pre', { className: 'dsh-cs-code' }, CS_DIAG.stage + '\n' + CS_DIAG.error + '\n\n' + trail)
      )
    )
  }
}

function csMount(ctx) {
  var engine = null
  var t = function (key) {
    return CS_DICT.zh[key] || key
  }

  /* Dictionaries go through the Client locale service so other consumers of the
   * `custom-skin` namespace keep working; the panel itself answers from the
   * same tables through `csTranslate`, which cannot fail at render time. */
  csNote('locale')
  try {
    ctx.effect(function () {
      return ctx.locale.register(CS_NS, { zh: CS_DICT.zh, en: CS_DICT.en })
    }, 'custom-skin: dictionaries')
    csNote('locale:ok')
  } catch (err) {
    csNote('locale:register', err)
  }

  csNote('engine')
  try {
    engine = csCreateEngine(ctx)
    csNote('engine:ok')
  } catch (err) {
    csNote('engine:create', err)
  }

  if (engine) {
    t = engine.translate
  }

  var Section = engine ? csCreateSection(engine) : csCreateDiagnostic(t)

  /* The section registers before the appearance engine attaches: an entry the
   * user can open (and read) beats a picture that mounted but cannot be found. */
  csNote('slot')
  try {
    ctx.slots.inject(CS_SLOT, function () {
      return ctx.slots.register(
        {
          name: CS_SLOT,
          id: CS_ENTRY_ID,
          order: 5,
          label: function () { return engine ? engine.translate('nav.label') : t('nav.label') }
        },
        Section
      )
    })
    csNote('slot:ok')
  } catch (err) {
    csNote('slot:register', err)
    throw err
  }

  if (!engine) {
    /* The diagnostic panel is mounted; the engine steps below have nothing to
     * attach to, and the failure is already recorded for that panel. */
    return
  }

  csNote('attach')
  ctx.effect(function () {
    var offTheme = null
    var offAttach = null
    try {
      offTheme = ctx.on('theme/change', function () { engine.refreshTheme() })
    } catch (err) {
      offTheme = null
    }
    try {
      offAttach = engine.attach()
      csNote('attach:ok')
    } catch (err) {
      offAttach = null
      csNote('engine:attach', err)
    }
    return function () {
      if (offTheme) {
        try {
          offTheme()
        } catch (err) {
          /* ignore */
        }
      }
      if (offAttach) {
        try {
          offAttach()
        } catch (err) {
          /* ignore */
        }
      }
      engine.dispose()
    }
  }, 'custom-skin: appearance engine')
}


/**
 * Runtime harness for the custom-skin Client half.
 *
 * The desktop app cannot be driven from a shell (no CDP port, no window
 * automation), so this harness executes the same code the browser executes:
 *
 *   1. `client.js`  - the shipped artifact, loaded through a stubbed
 *      `window.__ModuleLoader__` exactly like the host module table does;
 *   2. `src/*.js`   - the same sources plus a footer that exposes the internals,
 *      driven through a stubbed DOM, IndexedDB and theme/locale/slots context.
 *
 * `build.mjs --check` keeps the artifact and the sources in sync, so (2) tests
 * the behaviour of the file that ships in (1).
 *
 * Run: node scripts/harness.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok   ${name}`)
  } catch (err) {
    failures.push({ name, message: err && err.message ? err.message : String(err) })
    console.log(`FAIL ${name}\n     ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n     ') : err}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function assertDeep(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message}: expected ${b}, got ${a}`)
}

/* ------------------------------------------------------------------ DOM stub */

class ClassList {
  constructor() {
    this.set = new Set()
  }
  add(name) {
    this.set.add(name)
  }
  remove(name) {
    this.set.delete(name)
  }
  contains(name) {
    return this.set.has(name)
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force
    if (on) this.set.add(name)
    else this.set.delete(name)
    return on
  }
}

class Element {
  constructor(tag, dom) {
    this.tagName = String(tag).toUpperCase()
    this.dom = dom
    this.children = []
    this.parentNode = null
    this.style = {
      _props: new Map(),
      setProperty(name, value) {
        this._props.set(name, value)
      },
      removeProperty(name) {
        this._props.delete(name)
      },
      getPropertyValue(name) {
        return this._props.get(name) || ''
      }
    }
    this.dataset = {}
    this.classList = new ClassList()
    this.attributes = {}
    this.listeners = new Map()
    this.id = ''
    this.className = ''
    this.textContent = ''
    this.width = 0
    this.height = 0
    this.muted = false
    this.defaultMuted = false
    this.loop = false
    this.autoplay = false
    this.preload = ''
    this.videoWidth = 0
    this.videoHeight = 0
  }

  get isConnected() {
    let node = this
    while (node.parentNode) node = node.parentNode
    return node === this.dom.documentElement
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, reference) {
    child.parentNode = this
    const index = reference ? this.children.indexOf(reference) : -1
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
  }

  /* Only a painted node has client rects; the plugin uses this to ignore the
   * hidden dialogs several plugins keep in the tree. */
  getClientRects() {
    const rects = this.rects || []
    return { length: rects.length }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'id') this.id = String(value)
    if (name === 'class') this.className = String(value)
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type)
    if (!list) return
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  dispatch(type) {
    const list = this.listeners.get(type) || []
    list.slice().forEach((listener) => listener({ type, target: this }))
  }

  get firstChild() {
    return this.children[0] || null
  }

  get childNodes() {
    return this.children.slice()
  }

  getContext() {
    return { drawImage() {}, clearRect() {} }
  }

  toDataURL() {
    return 'data:image/png;base64,POSTER'
  }

  querySelector() {
    return null
  }

  querySelectorAll() {
    return []
  }

  load() {
    const meta = this.dom.urlMeta.get(this.src)
    if (meta && meta.kind === 'video' && !meta.broken) {
      this.videoWidth = meta.width
      this.videoHeight = meta.height
      this.dispatch('loadeddata')
    } else {
      this.dispatch('error')
    }
  }

  play() {
    return Promise.resolve()
  }

  pause() {}
}

function createDom(options = {}) {
  const dom = { urlMeta: new Map(), urlCount: 0, reducedMotion: !!options.reducedMotion }
  const documentElement = new Element('html', dom)
  const head = new Element('head', dom)
  const body = new Element('body', dom)
  documentElement.appendChild(head)
  documentElement.appendChild(body)

  function walk(node, visitor) {
    visitor(node)
    node.children.forEach((child) => walk(child, visitor))
  }

  /* Enough of a selector engine for the one query the plugin makes: it asks
   * whether a modal dialog is on screen. Supports `tag`, `[attr]`,
   * `[attr="value"]`, `tag[attr]` and comma-separated alternatives. */
  function matchesSelector(node, selector) {
    return selector.split(',').some((part) => {
      const text = part.trim()
      const bracket = text.indexOf('[')
      const tag = bracket < 0 ? text : text.slice(0, bracket)
      if (tag && node.tagName !== tag.toLowerCase()) return false
      if (bracket < 0) return Boolean(tag)
      const body = text.slice(bracket + 1, text.lastIndexOf(']'))
      const eq = body.indexOf('=')
      const name = (eq < 0 ? body : body.slice(0, eq)).trim()
      if (eq < 0) return Object.prototype.hasOwnProperty.call(node.attributes, name)
      const value = body.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      return node.getAttribute(name) === value
    })
  }

  const documentListeners = new Map()

  const document = {
    documentElement,
    head,
    body,
    createElement(tag) {
      const element = new Element(tag, dom)
      element.ownerDocument = document
      return element
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) }
    },
    getElementById(id) {
      let found = null
      walk(documentElement, (node) => {
        if (!found && node.id === id) found = node
      })
      return found
    },
    querySelector(selector) {
      let found = null
      walk(documentElement, (node) => {
        if (!found && matchesSelector(node, selector)) found = node
      })
      return found
    },
    querySelectorAll(selector) {
      const hits = []
      walk(documentElement, (node) => {
        if (matchesSelector(node, selector)) hits.push(node)
      })
      return hits
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, [])
      documentListeners.get(type).push(listener)
    },
    removeEventListener(type, listener) {
      const list = documentListeners.get(type)
      const index = list ? list.indexOf(listener) : -1
      if (index >= 0) list.splice(index, 1)
    },
    dispatchEvent(event) {
      ;(documentListeners.get(event.type) || []).slice().forEach((listener) => listener(event))
      return true
    },
  }

  class FakeImage {
    constructor() {
      this.naturalWidth = 0
      this.naturalHeight = 0
      this.onload = null
      this.onerror = null
      this._src = ''
      this.alt = ''
      this.className = ''
      this.parentNode = null
      this.attributes = {}
      this.listeners = new Map()
    }
    set src(value) {
      this._src = String(value)
      queueMicrotask(() => {
        const meta = dom.urlMeta.get(this._src)
        if (meta && meta.kind === 'image' && !meta.broken) {
          this.naturalWidth = meta.width
          this.naturalHeight = meta.height
          if (this.onload) this.onload()
        } else if (this.onerror) this.onerror()
      })
    }
    get src() {
      return this._src
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type).push(listener)
    }
    removeEventListener() {}
  }

  const mediaQuery = {
    matches: dom.reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    listeners: new Set(),
    addEventListener(type, listener) {
      this.listeners.add(listener)
    },
    removeEventListener(type, listener) {
      this.listeners.delete(listener)
    },
    addListener(listener) {
      this.listeners.add(listener)
    },
    removeListener(listener) {
      this.listeners.delete(listener)
    },
  }

  const window = {
    document,
    matchMedia(query) {
      mediaQuery.media = String(query)
      mediaQuery.matches = dom.reducedMotion
      return mediaQuery
    },
    addEventListener() {},
    removeEventListener() {},
  }

  const url = {
    createObjectURL(blob) {
      dom.urlCount += 1
      const key = `blob:custom-skin/${dom.urlCount}`
      const type = String((blob && blob.type) || '')
      const name = String((blob && blob.name) || '')
      dom.urlMeta.set(key, {
        kind: type.indexOf('video/') === 0 ? 'video' : type.indexOf('image/') === 0 ? 'image' : 'unknown',
        broken: /broken/i.test(name),
        width: type.indexOf('video/') === 0 ? 1280 : 1920,
        height: type.indexOf('video/') === 0 ? 720 : 1080,
        blob,
      })
      return key
    },
    revokeObjectURL(key) {
      dom.urlMeta.delete(key)
    },
  }

  const stores = new Map()
  const databases = new Map()
  const indexedDB = {
    open(name) {
      const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
      const fresh = !databases.has(name)
      if (fresh) {
        const dbStores = new Map()
        databases.set(name, {
          objectStoreNames: { contains: (storeName) => dbStores.has(storeName) },
          createObjectStore(storeName, opts) {
            dbStores.set(storeName, { keyPath: opts && opts.keyPath, records: new Map() })
          },
          transaction(storeName) {
            const store = dbStores.get(storeName)
            if (!store) throw new Error(`no store ${storeName}`)
            const tx = { oncomplete: null, onerror: null, onabort: null }
            tx.objectStore = () => ({
              put(value, key) {
                const primary = key === undefined ? value[store.keyPath] : key
                store.records.set(String(primary), value)
                return { result: primary }
              },
              get(key) {
                return { result: store.records.get(String(key)) }
              },
              getAll() {
                return { result: Array.from(store.records.values()) }
              },
              delete(key) {
                store.records.delete(String(key))
                return { result: undefined }
              },
            })
            setTimeout(() => {
              if (tx.oncomplete) tx.oncomplete()
            }, 0)
            return tx
          },
        })
      }
      request.result = databases.get(name)
      setTimeout(() => {
        if (fresh && request.onupgradeneeded) request.onupgradeneeded()
        if (request.onsuccess) request.onsuccess()
      }, 0)
      return request
    },
  }

  dom.document = document
  dom.window = window
  dom.documentElement = documentElement
  dom.head = head
  dom.body = body
  dom.mediaQuery = mediaQuery
  dom.stores = stores
  dom.setReducedMotion = function setReducedMotion(value) {
    dom.reducedMotion = !!value
    mediaQuery.matches = !!value
    mediaQuery.listeners.forEach((listener) => listener({ matches: mediaQuery.matches }))
  }
  dom.globals = {
    window,
    document,
    indexedDB,
    URL: url,
    Image: FakeImage,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    console,
  }
  return dom
}

/* --------------------------------------------------------------- react stub */

function createReact() {
  let hooks = []
  let cursor = 0
  let rerender = null

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(4).filter((child) => child !== null && child !== undefined && child !== false) }
    },
    Fragment: 'Fragment',
    memo: (component) => component,
    forwardRef: (render) => render,
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        if (rerender) rerender()
      }]
    },
    useReducer(reducer, initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], () => {}]
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useRef(value) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: value }
      return hooks[index]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot()
    },
  }

  return {
    React,
    render(component, props) {
      cursor = 0
      return component(props)
    },
    reset() {
      hooks = []
      cursor = 0
      rerender = null
    },
  }
}

/* ------------------------------------------------------------------- context */

function createContext(options = {}) {
  const record = {
    dictionaries: null,
    registrations: [],
    injectedSlots: [],
    effects: [],
    events: new Map(),
    tokens: [],
    tokensDisposed: 0,
    setTheme: null,
    themeUsed: 0,
  }

  const snapshot = {
    preference: options.preference || 'system',
    fontSizes: {},
    fontFamilies: {},
    active: options.active || { id: 'dark', colorScheme: 'dark', tokens: {} },
    themes: options.themes || [
      { id: 'light', colorScheme: 'light', tokens: {} },
      { id: 'dark', colorScheme: 'dark', tokens: {} },
      { id: 'solar-dusk', colorScheme: 'dark', tokens: {} },
      { id: 'paper-ink', colorScheme: 'light', tokens: {} },
    ],
    revision: 1,
  }

  const ctx = {
    theme: {
      getTheme() {
        record.themeUsed += 1
        return snapshot
      },
      setTheme(id) {
        record.setTheme = id
      },
      overrideTokens(source, tokens) {
        record.tokens.push({ source, tokens })
        return () => {
          record.tokensDisposed += 1
        }
      },
    },
    locale: {
      getLocale() {
        return { active: options.locale || 'zh-CN', locales: ['zh-CN', 'en-US'], revision: 1 }
      },
      register(namespace, dictionaries) {
        record.dictionaries = { namespace, dictionaries }
        return () => {
          record.dictionaries = null
        }
      },
    },
    on(name, listener) {
      if (!record.events.has(name)) record.events.set(name, [])
      record.events.get(name).push(listener)
      return () => {}
    },
    effect(callback, label) {
      const dispose = callback()
      record.effects.push({ label, dispose })
      return dispose
    },
    slots: {
      inject(key, factory) {
        record.injectedSlots.push(key)
        return factory()
      },
      register(row, component) {
        const handle = { row, component }
        record.registrations.push(handle)
        return () => {}
      },
    },
    get(name) {
      return ctx[name]
    },
  }

  return { ctx, record, snapshot }
}

/* -------------------------------------------------------- artifact under test */

function loadArtifact() {
  const code = readSource('client.js')
  const dom = createDom()
  let captured = null
  dom.globals.window.__ModuleLoader__ = {
    load(definition) {
      captured = definition
    },
  }
  const context = vm.createContext(dom.globals)
  vm.runInContext(code, context, { filename: 'client.js' })
  return { definition: captured, dom }
}

function loadInternals() {
  const dom = createDom()
  const sources = ['src/core.js', 'src/i18n.js', 'src/main.js'].map(readSource).join('\n\n')
  const react = createReact()
  const context = vm.createContext({
    ...dom.globals,
    require(id) {
      if (id === 'react') return react.React
      throw new Error(`unexpected require('${id}')`)
    },
  })
  const footer = '\nthis.__CS_INTERNALS__ = { csCreateEngine: csCreateEngine, csCreateSection: csCreateSection, csMount: csMount, CS_PLUGIN: CS_PLUGIN }\n'
  vm.runInContext(sources + footer, context, { filename: 'custom-skin-sources.js' })
  return { internals: context.__CS_INTERNALS__, dom, react, context }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) await tick(1)
}

/* --------------------------------------------------------------------- files */

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const GIF_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const MP4_HEADER = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00])

function makeFile(name, bytes, type) {
  return new File([bytes], name, { type })
}

/* ------------------------------------------------------------------- checks 1 */

async function checkArtifact() {
  const { definition, dom } = loadArtifact()

  await check('artifact registers the @local/custom-skin factory', () => {
    assert(definition, 'window.__ModuleLoader__.load was never called')
    assertEqual(definition.id, '@local/custom-skin', 'module id')
    assertEqual(typeof definition.factory, 'function', 'factory type')
  })

  let plugin = null
  await check('factory returns a plugin with theme + slots dependencies', () => {
    plugin = definition.factory((id) => {
      if (id === 'react') return createReact().React
      throw new Error(`unexpected require('${id}')`)
    })
    assert(plugin && typeof plugin.apply === 'function', 'plugin.apply missing')
    assertDeep(plugin.inject, ['theme', 'slots'], 'hard dependencies')
  })

  const { ctx, record } = createContext()
  await check('apply() registers dictionaries, slot entry and mounts the engine', async () => {
    plugin.apply(ctx)
    await settle(6)
    assert(record.dictionaries, 'locale.register was not called')
    assertEqual(record.dictionaries.namespace, 'custom-skin', 'locale namespace')
    assert(record.dictionaries.dictionaries.zh && record.dictionaries.dictionaries.en, 'zh/en dictionaries missing')
    assertDeep(record.injectedSlots, ['settings.section'], 'slot inject keys')
    const registration = record.registrations.find((entry) => entry.row && entry.row.id === 'custom-skin')
    assert(registration, 'settings.section entry not registered')
    assertEqual(registration.row.name, 'settings.section', 'slot name')
    assertEqual(registration.row.order, 5, 'nav order (right under General)')
    assertEqual(registration.row.label(), '自定义皮肤', 'localized nav label')
  })

  await check('settings component renders without throwing', async () => {
    const registration = record.registrations.find((entry) => entry.row && entry.row.id === 'custom-skin')
    const react = createReact()
    const tree = react.render(registration.component, { close() {} })
    const texts = collectText(tree)
    assert(texts.includes('恢复默认'), `missing 恢复默认; got: ${texts.slice(0, 12).join(' | ')}`)
    assert(texts.includes('显示方式'), 'missing the fit control')
    assert(texts.includes('磨砂强度'), 'missing the frost slider')
    assert(texts.some((text) => text.indexOf('本地素材') >= 0), 'missing material card')
    assert(texts.some((text) => text.indexOf('预览') >= 0), 'missing preview card')
    let hasSample = false
    const visit = (node) => {
      if (node.props && node.props.className === 'dsh-cs-sample') hasSample = true
      ;(node.children || []).forEach(visit)
    }
    visit(tree)
    /* No material yet, so the preview shows its placeholder instead of a photo. */
    assert(!hasSample, 'the sample surface needs a picture to sit on')
    assert(texts.some((text) => text.indexOf('选择素材后可预览') >= 0), 'missing the empty preview hint')
    assert(
      !texts.some((text) => /\(\)$/.test(text.trim())),
      `a control label ends in empty parentheses: ${texts.filter((text) => /\(\)$/.test(text.trim())).join(' | ')}`
    )
    assert(texts.every((text) => text.indexOf('undefined') < 0), `undefined leaked into the UI: ${texts.filter((t) => t.indexOf('undefined') >= 0).join(' | ')}`)
  })

  await check('unmount removes every effect it installed', async () => {
    record.effects.forEach((effect) => {
      if (typeof effect.dispose === 'function') effect.dispose()
    })
    await settle(2)
    assert(!dom.document.getElementById('dsh-cs-layer'), 'background layer survived unmount')
    assert(!dom.document.getElementById('dsh-cs-layer-style'), 'layer stylesheet survived unmount')
    assert(!dom.documentElement.classList.contains('dsh-cs-active'), 'root class survived unmount')
  })
}

function collectText(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node).trim()
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out))
    return out
  }
  if (node.children) node.children.forEach((child) => collectText(child, out))
  if (node.props && node.props.children) collectText(node.props.children, out)
  return out
}

/* ------------------------------------------------------------------- checks 2 */

async function checkEngine() {
  const { internals, dom } = loadInternals()
  const { ctx, record } = createContext()
  const engine = internals.csCreateEngine(ctx)
  engine.attach()
  await settle(8)

  const layer = () => dom.document.getElementById('dsh-cs-layer')
  const media = () => (layer() ? layer().children.find((child) => child.className === 'dsh-cs-media') || null : null)
  const scrim = () => (layer() ? layer().children.find((child) => child.className === 'dsh-cs-scrim') || null : null)

  await check('engine loads the stored library and starts empty', () => {
    const state = engine.getState()
    assertEqual(state.ready, true, 'ready flag')
    assertEqual(state.storageOk, true, 'storage flag')
    assertDeep(state.materials, [], 'material list')
    assertEqual(state.uiMode, 'app', 'ui mode')
    assertEqual(state.canTheme, true, 'token override capability')
  })

  await check('importing a PNG previews it immediately on the background layer', async () => {
    const ok = await engine.importFiles([makeFile('sample-orbit.png', PNG_HEADER, 'image/png')])
    await settle(8)
    assertEqual(ok, true, 'importFiles result')
    const state = engine.getState()
    assertEqual(state.materials.length, 1, 'material count')
    const material = state.materials[0]
    assertEqual(material.kind, 'image', 'detected kind')
    assertEqual(material.width, 1920, 'decoded width')
    assertEqual(material.height, 1080, 'decoded height')
    assert(state.draft && state.draft.materialId === material.id, 'draft auto-selected for preview')
    assert(layer(), 'background layer missing after import')
    const element = media()
    assert(element, 'media element missing')
    assertEqual(element.tagName, 'IMG', 'image element')
    assert(String(element.src).indexOf('blob:custom-skin/') === 0, 'media bound to the blob URL')
    assert(scrim(), 'scrim element missing')
    assertEqual(engine.getState().status.key, 'status.imported', 'import status')
  })

  await check('adjustments reach the layer style', () => {
    engine.updateCfg({ fit: 'contain', scale: 1.5, posX: 20, posY: 80, brightness: 0.7 })
    const state = engine.getState()
    assertEqual(state.draft.cfg.fit, 'contain', 'fit')
    assertEqual(state.draft.cfg.scale, 1.5, 'scale')
    const element = media()
    assert(/1\.55|1\.5/.test(String(element.style.transform || '')), `transform not applied: ${element.style.transform}`)
    assert(/brightness\(0\.70\)/.test(String(element.style.filter || '')), `brightness not applied: ${element.style.filter}`)
    const overlay = scrim()
    assert(overlay.style.background, 'scrim background not set')
    assert(/radial-gradient/.test(String(overlay.style.background)), 'scrim must carry the vignette gradient')
    assert(/rgba\(0,0,0,/.test(String(overlay.style.background)), 'scrim must dim the picture')
  })

  await check('apply keeps the preview and writes the token overrides', async () => {
    engine.applyDraft()
    await settle(8)
    const state = engine.getState()
    assertEqual(state.draft, null, 'draft cleared after apply')
    assert(state.applied.materialId, 'applied material recorded')
    assertEqual(state.applied.cfg.fit, 'contain', 'applied adjustments')
    assertEqual(engine.getState().flash.key, 'flash.applied', 'applied feedback')
    assert(record.tokens.length > 0, 'theme.overrideTokens was never called')
    const last = record.tokens[record.tokens.length - 1]
    assertEqual(last.source, '@local/custom-skin', 'override source')
    assert(last.tokens['--dsw-alias-bg-base'], 'bg-base override missing')
    assert(last.tokens['--dsw-alias-bg-base'].light && last.tokens['--dsw-alias-bg-base'].dark, 'both schemes required')
    assert(dom.documentElement.classList.contains('dsh-cs-active'), 'root class not applied')
  })

  await check('the preview carries a sample of the panel tint and frost', async () => {
    /* The opacity and frost sliders only change the main window, so the preview
     * itself has to show what those two numbers do to the picture. */
    const Section = internals.csCreateSection(engine)
    const react = createReact()
    const tree = react.render(Section, { close() {} })
    let sample = null
    let sheen = null
    const visit = (node) => {
      if (node.props && node.props.className === 'dsh-cs-sample') sample = node
      if (node.props && String(node.props.className || '').indexOf('dsh-cs-sheen') >= 0) sheen = node
      ;(node.children || []).forEach(visit)
    }
    visit(tree)
    assert(sample, 'the preview must carry an opacity/frost sample')
    assert(String(sample.props.style.background).indexOf('rgba(') === 0, 'the sample uses the panel tint')
    assert(String(sample.props.style.backdropFilter).indexOf('blur') === 0, 'the sample uses the frost filter')
    assert(!sheen, 'the removed sheen layer must not come back')
  })

  await check('fractional values read as plain percentages in the boxes', async () => {
    /* A box saying 0.86 while the slider announces 86% is a contradiction. */
    const Section = internals.csCreateSection(engine)
    const react = createReact()
    const tree = react.render(Section, { close() {} })
    const boxes = []
    const visit = (node) => {
      if (node.props && node.props.className === 'dsh-cs-number') boxes.push(node.props)
      ;(node.children || []).forEach(visit)
    }
    visit(tree)
    assert(boxes.length >= 6, `expected six value boxes, found ${boxes.length}`)
    const shown = boxes.map((props) => String(props.defaultValue))
    assert(shown.indexOf('86') >= 0, `panel opacity should read 86, got ${shown.join(',')}`)
    assert(shown.indexOf('70') >= 0, `brightness should read its percent, got ${shown.join(',')}`)
    assert(
      !shown.some((value) => value.indexOf('0.') === 0),
      `no box may show a bare fraction: ${shown.join(',')}`
    )
  })

  await check('cancel restores the pre-preview appearance', async () => {
    const appliedBefore = JSON.stringify(engine.getState().applied)
    engine.updateCfg({ panelOpacity: 0.62 })
    await settle(4)
    assertEqual(engine.getState().draft.cfg.panelOpacity, 0.62, 'draft adjusted')
    engine.cancelDraft()
    await settle(6)
    const state = engine.getState()
    assertEqual(state.draft, null, 'draft cleared after cancel')
    assertEqual(JSON.stringify(state.applied), appliedBefore, 'applied appearance unchanged by cancel')
    assertEqual(state.status.key, 'status.cancelled', 'cancel status')
  })

  await check('a GIF previews animated, then falls back to a still frame', async () => {
    const ok = await engine.importFiles([makeFile('sample-pulse.gif', GIF_HEADER, 'image/gif')])
    await settle(10)
    assertEqual(ok, true, 'gif import')
    const material = engine.getState().materials[engine.getState().materials.length - 1]
    assertEqual(material.kind, 'gif', 'gif kind')
    assert(String(media().src).indexOf('blob:custom-skin/') === 0, 'animated GIF uses the blob URL')
    engine.updateCfg({ motion: false })
    await settle(10)
    assert(String(media().src).indexOf('data:image/png') === 0, `still frame expected, got ${media().src}`)
    engine.updateCfg({ motion: true })
    await settle(4)
    assert(String(media().src).indexOf('blob:custom-skin/') === 0, 'motion back on uses the blob URL')
  })

  await check('reduced motion wins over the per-skin switch', async () => {
    dom.setReducedMotion(true)
    await settle(6)
    const state = engine.getState()
    assertEqual(state.reducedMotion, true, 'reduced motion detected')
    assert(String(media().src).indexOf('data:image/png') === 0, 'still frame while reduced motion is on')
    dom.setReducedMotion(false)
    await settle(6)
    assert(String(media().src).indexOf('blob:custom-skin/') === 0, 'animation restored when the OS preference clears')
  })

  await check('a video becomes a muted looping layer', async () => {
    const ok = await engine.importFiles([makeFile('clip.mp4', MP4_HEADER, 'video/mp4')])
    await settle(10)
    assertEqual(ok, true, 'video import')
    const element = media()
    assertEqual(element.tagName, 'VIDEO', 'video element')
    assertEqual(element.muted, true, 'muted by default')
    assertEqual(element.loop, true, 'loops by default')
    const record = engine.getState().materials.filter((entry) => entry.kind === 'video').pop()
    assertEqual(record.width, 1280, 'probed video width')
    assertEqual(record.height, 720, 'probed video height')
    assertEqual(element.getAttribute('playsinline'), '', 'playsinline attribute')
  })

  await check('bad files are rejected in Chinese and keep the current skin', async () => {
    const before = JSON.stringify(engine.getState().applied)
    const ok = await engine.importFiles([makeFile('broken.gif', GIF_HEADER, 'image/gif')])
    await settle(10)
    assertEqual(ok, false, 'decode failure must not import')
    assertEqual(engine.getState().status.key, 'err.decodeFailed', 'decode failure status')

    const mismatch = await engine.importFiles([makeFile('renamed.jpg', PNG_HEADER, 'image/jpeg')])
    await settle(6)
    assertEqual(mismatch, false, 'extension mismatch must not import')
    assertEqual(engine.getState().status.key, 'err.mismatch', 'mismatch status')

    const huge = await engine.importFiles([{ name: 'huge.png', size: 64 * 1024 * 1024 + 1 }])
    await settle(4)
    assertEqual(huge, false, 'oversized file must not import')
    assertEqual(engine.getState().status.key, 'err.tooLarge', 'size status')

    const unsupported = await engine.importFiles([{ name: 'notes.pdf', size: 1024 }])
    await settle(4)
    assertEqual(unsupported, false, 'unsupported format must not import')
    assertEqual(engine.getState().status.key, 'err.unsupported', 'format status')
    assertEqual(JSON.stringify(engine.getState().applied), before, 'current skin kept through failures')
  })

  await check('every settings page drops the picture and the palette, cheaply', async () => {
    await engine.importFiles([makeFile('sample-orbit.png', PNG_HEADER, 'image/png')])
    await settle(8)
    engine.applyDraft()
    await settle(8)
    const before = record.tokens.length
    engine.setUiMode('settings')
    await settle(8)
    const layer = dom.document.getElementById('dsh-cs-layer')
    assert(layer, 'the layer exists before the settings page opens')
    assertEqual(String(layer.style.display), 'none', 'the picture is off while settings is open')
    assertEqual(record.tokens.length, before, 'no replacement palette is mixed for settings')
    assertEqual(dom.documentElement.style.getPropertyValue('--dsh-cs-frost'), 'none', 'frost paused on the settings page')

    engine.setUiMode('app')
    await settle(8)
    assertEqual(String(dom.document.getElementById('dsh-cs-layer').style.display), '', 'the picture is back')
    assert(
      dom.documentElement.style.getPropertyValue('--dsh-cs-frost').indexOf('blur') === 0,
      'frost restored on the app surfaces'
    )
    assert(record.tokens.length > before, 'the palette layer comes back with the picture')
  })

  await check('opening any other settings page also pauses the skin', async () => {
    /* The settings seat is one modal for every section, so the panel — not just
     * this page — decides. A dialog in the document stands in for it here. */
    const dialog = dom.document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.rects = [{}]
    dom.document.body.appendChild(dialog)
    dom.document.dispatchEvent({ type: 'pointerdown' })
    await settle(8)
    assertEqual(engine.getState().uiMode, 'settings', 'a dialog on screen means the settings panel is open')
    assertEqual(String(dom.document.getElementById('dsh-cs-layer').style.display), 'none', 'the picture steps aside')
    dom.document.body.removeChild(dialog)
    dom.document.dispatchEvent({ type: 'pointerdown' })
    await settle(8)
    assertEqual(engine.getState().uiMode, 'app', 'closing the panel brings the skin back')

    /* Several plugins keep a hidden modal mounted forever; that must not keep the
     * skin switched off. */
    const hidden = dom.document.createElement('div')
    hidden.setAttribute('role', 'dialog')
    dom.document.body.appendChild(hidden)
    dom.document.dispatchEvent({ type: 'pointerdown' })
    await settle(8)
    assertEqual(engine.getState().uiMode, 'app', 'a dialog nobody can see does not pause the skin')
    dom.document.body.removeChild(hidden)
  })

  await check('a second material switches straight away, without Apply', async () => {
    const before = engine.getState().applied.materialId
    assert(before, 'a skin must already be applied before this check')
    const other = engine.getState().materials.find((record) => record.id !== before)
    assert(other, 'need a second material to switch to')
    engine.selectMaterial(other.id)
    await settle(8)
    const state = engine.getState()
    assertEqual(state.applied.materialId, other.id, 'the picked material is applied immediately')
    assertEqual(state.flash.key, 'flash.switched', 'the switch answers next to the Apply button')
    assert(state.draft, 'the draft follows the new material so adjustments still work')
    await settle(4)
  })

  await check('a theme that vanished from the host is repaired once', async () => {
    const gone = createContext({
      active: { id: 'solar-dusk', colorScheme: 'dark', tokens: {} },
      themes: [
        { id: 'light', colorScheme: 'light', tokens: {} },
        { id: 'dark', colorScheme: 'dark', tokens: {} }
      ]
    })
    const orphan = internals.csCreateEngine(gone.ctx)
    const stop = orphan.attach()
    await settle(8)
    assertEqual(gone.record.setTheme, 'system', 'stuck third-party preference falls back to system')
    gone.record.setTheme = null
    orphan.refreshTheme()
    await settle(4)
    assertEqual(gone.record.setTheme, null, 'the repair runs only once')
    stop()
    orphan.dispose()
  })

  await check('restore default clears the effect and the stored state', async () => {
    await engine.importFiles([makeFile('sample-orbit.png', PNG_HEADER, 'image/png')])
    await settle(8)
    engine.applyDraft()
    await settle(8)
    assert(layer(), 'layer expected before reset')
    const disposedBefore = record.tokensDisposed
    engine.restoreDefault()
    await settle(8)
    assertEqual(engine.getState().applied.materialId, null, 'applied cleared')
    assertEqual(engine.getState().flash.key, 'flash.reset', 'reset feedback')
    assertEqual(layer(), null, 'layer removed by reset')
    assert(record.tokensDisposed > disposedBefore, 'token layer not disposed by reset')
  })

  await check('removing a material that is in use clears it first', async () => {
    await engine.importFiles([makeFile('sample-orbit.png', PNG_HEADER, 'image/png')])
    await settle(8)
    engine.applyDraft()
    await settle(6)
    const id = engine.getState().applied.materialId
    assert(id, 'material applied')
    engine.removeMaterial(id)
    await settle(6)
    assertEqual(engine.getState().applied.materialId, null, 'applied cleared with the removed material')
    assertEqual(engine.getState().materials.some((material) => material.id === id), false, 'material removed')
    assertEqual(layer(), null, 'layer removed')
  })

  await check('the panel speaks Chinese by default and switches to English', async () => {
    assertEqual(engine.getState().lang, 'zh', 'default language is Chinese')
    assertEqual(engine.translate('nav.label'), '自定义皮肤', 'Chinese nav label')
    engine.setLang('en')
    await settle(4)
    assertEqual(engine.getState().lang, 'en', 'language switched to English')
    assertEqual(engine.translate('nav.label'), 'Custom skin', 'English nav label')
    assertEqual(engine.translate('btn.apply'), 'Apply', 'English button copy')
    await settle(6)
    const reloaded = internals.csCreateEngine(ctx)
    reloaded.attach()
    await settle(10)
    assertEqual(reloaded.getState().lang, 'en', 'language preference restored after a reload')
    reloaded.setLang('zh')
    reloaded.dispose()
    await settle(4)
    engine.setLang('zh')
    await settle(4)
    assertEqual(engine.getState().lang, 'zh', 'language switched back to Chinese')
  })

  await check('dispose cleans body, stylesheet and object URLs', async () => {
    await engine.importFiles([makeFile('sample-orbit.png', PNG_HEADER, 'image/png')])
    await settle(8)
    engine.applyDraft()
    await settle(6)
    assert(layer(), 'layer expected before dispose')
    engine.dispose()
    await settle(2)
    assertEqual(layer(), null, 'layer removed')
    assert(!dom.document.getElementById('dsh-cs-layer-style'), 'stylesheet removed')
    assert(!dom.documentElement.classList.contains('dsh-cs-active'), 'root class removed')
  })
}

/* ---------------------------------------------------------------------- main */

async function main() {
  console.log('custom-skin harness: artifact')
  await checkArtifact()
  console.log('custom-skin harness: engine and settings UI')
  await checkEngine()
  console.log('')
  if (failures.length) {
    console.log(`${failures.length} failed, ${passed} passed`)
    failures.forEach((failure) => console.log(` - ${failure.name}: ${failure.message}`))
    process.exit(1)
  }
  console.log(`${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Dictionaries and lookup for every string the plugin shows.
 * The same tables are registered into the Client locale service, so other
 * consumers of the namespace share them; the panel itself looks up from the
 * table for its own language preference, with Chinese as the default so the
 * copy does not depend on the host's app language.
 */

var CS_NS = 'custom-skin'
var CS_LANGS = ['zh', 'en']
var CS_DEFAULT_LANG = 'zh'

var CS_DICT = {
  zh: {
    'nav.label': '自定义皮肤',
    'page.title': '自定义皮肤',
    'page.subtitle': '把本地图片、GIF 或视频设为应用背景，并在下方微调效果。',
    'lang.heading': '语言',
    'lang.zh': '中文',
    'lang.en': 'English',
    'btn.reset': '恢复默认',
    'btn.apply': '应用',
    'btn.cancel': '取消',
    'btn.import': '导入本地素材',
    'btn.delete': '删除',
    'material.heading': '素材库',
    'material.empty': '还没有素材',
    'material.emptyHint': '支持 PNG、JPG、WebP、GIF、MP4，WebM 在桌面端解码通过后也可使用。单个文件不超过 64 MB。',
    'material.count': '共 {count} 个素材',
    'material.draft': '预览中',
    'material.video': '视频',
    'material.gif': '动图',
    'material.image': '图片',
    'material.inUse': '使用中',
    'material.deleteConfirm': '确定删除「{name}」吗？',
    'material.deleteApplied': '「{name}」正在用作背景，删除后会恢复默认外观。仍然删除吗？',
    'adjust.heading': '预览与调整',
    'adjust.fit': '显示方式',
    'adjust.fitCover': '填充',
    'adjust.fitContain': '完整显示',
    'adjust.scale': '缩放',
    'adjust.posX': '水平位置',
    'adjust.posY': '垂直位置',
    'adjust.brightness': '画面亮度',
    'adjust.panelBlur': '磨砂强度',
    'adjust.autoTone': '自动适配图片明暗',
    'adjust.panel': '面板透明度',
    'adjust.accent': '强调色',
    'adjust.accentFollow': '跟随主题',
    'adjust.motion': '动态效果',
    'adjust.motionReduced': '系统已开启「减少动态效果」，动效已暂停。',
    'preview.empty': '选择素材后可预览并调整。',
    'status.imported': '已导入 {count} 个素材',
    'status.removed': '已删除素材',
    'status.cancelled': '已取消，恢复为预览前的效果',
    'status.previewing': '预览中：{name}',
    'flash.applied': '已应用',
    'flash.switched': '已切换为「{name}」',
    'flash.reset': '已恢复默认外观',
    'err.unsupported': '不支持的格式。请选择 PNG、JPG、WebP、GIF、MP4 或 WebM 文件。',
    'err.tooLarge': '文件过大（{size}），单个素材上限为 64 MB。',
    'err.empty': '文件是空的，请换一个文件。',
    'err.mismatch': '文件内容与扩展名不符，可能已损坏或被改名。',
    'err.decodeFailed': '无法解码这个文件，请确认它可以正常播放或打开。',
    'err.tooMany': '素材库最多保留 40 个素材，请先删除不用的素材。',
    'err.storage': '本机存储不可用，改动只在本次会话内有效。',
    'err.unknown': '操作失败：{message}',
    'err.noMaterial': '请先导入并选择一个素材。',
    'err.busy': '正在处理上一个素材，请稍候。',
    'diag.heading': '插件未能完成加载',
    'diag.hint': '下面是本次加载中止的位置，截图反馈即可定位问题；当前皮肤没有生效，也不会影响其他设置。'
  },
  en: {
    'nav.label': 'Custom skin',
    'page.title': 'Custom skin',
    'page.subtitle': 'Set a local image, GIF, or video as the app background and fine-tune it below.',
    'lang.heading': 'Language',
    'lang.zh': '中文',
    'lang.en': 'English',
    'btn.reset': 'Restore default',
    'btn.apply': 'Apply',
    'btn.cancel': 'Cancel',
    'btn.import': 'Import',
    'btn.delete': 'Delete',
    'material.heading': 'Media library',
    'material.empty': 'No media yet',
    'material.emptyHint': 'PNG, JPG, WebP, GIF, and MP4 are supported; WebM works once the desktop app decodes it. One file may be up to 64 MB.',
    'material.count': '{count} item(s)',
    'material.draft': 'Previewing',
    'material.video': 'Video',
    'material.gif': 'Animation',
    'material.image': 'Image',
    'material.inUse': 'In use',
    'material.deleteConfirm': 'Delete “{name}”?',
    'material.deleteApplied': '“{name}” is the current background. Deleting it restores the default look. Delete anyway?',
    'adjust.heading': 'Preview and adjustments',
    'adjust.fit': 'Sizing',
    'adjust.fitCover': 'Fill',
    'adjust.fitContain': 'Fit',
    'adjust.scale': 'Scale',
    'adjust.posX': 'Horizontal position',
    'adjust.posY': 'Vertical position',
    'adjust.brightness': 'Picture brightness',
    'adjust.panelBlur': 'Frost strength',
    'adjust.autoTone': 'Adapt to picture brightness',
    'adjust.panel': 'Panel opacity',
    'adjust.accent': 'Accent color',
    'adjust.accentFollow': 'Follow theme',
    'adjust.motion': 'Motion',
    'adjust.motionReduced': 'Reduced motion is on in your system settings, so motion is paused.',
    'preview.empty': 'Pick a media item to preview and adjust it.',
    'status.imported': 'Imported {count} item(s)',
    'status.removed': 'Media deleted',
    'status.cancelled': 'Cancelled; the previous look is back',
    'status.previewing': 'Previewing: {name}',
    'flash.applied': 'Applied',
    'flash.switched': 'Switched to “{name}”',
    'flash.reset': 'Default look restored',
    'err.unsupported': 'Unsupported format. Choose PNG, JPG, WebP, GIF, MP4, or WebM.',
    'err.tooLarge': 'File is too large ({size}); the limit is 64 MB per item.',
    'err.empty': 'That file is empty.',
    'err.mismatch': 'The file content does not match its extension; it may be damaged or renamed.',
    'err.decodeFailed': 'This file could not be decoded. Check that it opens or plays normally.',
    'err.tooMany': 'The library holds at most 40 items. Delete one first.',
    'err.storage': 'Local storage is unavailable, so changes last only for this session.',
    'err.unknown': 'Something went wrong: {message}',
    'err.noMaterial': 'Import and select a media item first.',
    'err.busy': 'Still processing the previous file.',
    'diag.heading': 'The plugin did not finish loading',
    'diag.hint': 'The stage where loading stopped is below; a screenshot is enough to locate the cause. No theme is applied and your other settings are untouched.'
  }
}

/** 'zh-CN' / 'zh-Hans' / 'zh' → 'zh'; anything else → 'en'. */
function csLocaleKey(active) {
  return String(active || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
}

/** Accepts the stored preference in any casing; Chinese is the fallback. */
function csNormalizeLang(value) {
  var key = String(value || '').toLowerCase()
  if (key === 'en' || key === 'en-us' || key === 'en-gb') return 'en'
  return CS_DEFAULT_LANG
}

/** Translate one key with `{name}` substitution, preferring the active locale. */
function csTranslate(active, key, params) {
  var table = CS_DICT[csLocaleKey(active)] || CS_DICT.en
  var text = table[key]
  if (text === undefined) text = CS_DICT.en[key]
  if (text === undefined) return key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  })
}

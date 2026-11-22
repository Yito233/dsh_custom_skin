/**
 * Host theme fixture for verifying "installed skins" inside the custom-skin
 * plugin. It registers one third-party theme through the Client theme service;
 * it paints nothing itself, so it is a fair stand-in for any real theme bundle.
 *
 * Uninstall it from Settings → Plugins when the check is done.
 */

window.__ModuleLoader__.load({
  id: '@local/skin-sample-theme',
  factory: function (require) {
    'use strict'

    var THEME = {
      id: 'solar-dusk',
      colorScheme: 'dark',
      tokens: {
        '--dsw-alias-bg-base': '#1a1410',
        '--dsw-alias-bg-layer-1': '#241b15',
        '--dsw-alias-bg-layer-2': '#2e2119',
        '--dsw-alias-bg-overlay': '#3a2a20',
        '--dsw-alias-border-l1': '#4a3628',
        '--dsw-alias-border-l2': '#63493a',
        '--dsw-alias-brand-primary': '#f0913c',
        '--dsw-alias-label-primary': '#f6ead9',
        '--dsw-alias-label-secondary': '#c9b29c',
        '--dsw-alias-state-error-primary': '#ff7a6b',
        '--dsw-alias-state-idle-primary': '#8d7a68',
        '--dsw-alias-state-success-primary': '#7fc98a',
        '--dsw-alias-state-warn-primary': '#f3c04f',
        '--dsw-specific-sidebar-fill': '#1f1712'
      }
    }

    return {
      name: 'skin-sample-theme',
      inject: ['theme'],
      apply: function (ctx) {
        try {
          ctx.effect(function () {
            return ctx.theme.register(THEME)
          }, 'sample-theme: registration')
        } catch (err) {
          try {
            console.error('[sample-theme] registration failed:', err)
          } catch (ignored) {
            /* ignore */
          }
        }
      }
    }
  }
})

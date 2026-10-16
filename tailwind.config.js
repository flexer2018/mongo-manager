/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // 工作台分层背景（CSS 变量驱动，暗/亮主题切换）
        base: 'rgb(var(--c-base) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
        hover: 'rgb(var(--c-hover) / <alpha-value>)',
        active: 'rgb(var(--c-active) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--c-line-strong) / <alpha-value>)',
        // MongoDB 绿主色（双主题共用色相）
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          bright: 'rgb(var(--c-accent-bright) / <alpha-value>)',
          dim: 'rgb(var(--c-accent-dim) / <alpha-value>)',
          subtle: 'rgb(var(--c-accent) / 0.14)'
        },
        text: {
          primary: 'rgb(var(--c-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-text-faint) / <alpha-value>)'
        },
        // BSON 类型着色（变量在 index.css 按主题覆盖）
        bson: {
          string: 'rgb(var(--c-bson-string) / <alpha-value>)',
          number: 'rgb(var(--c-bson-number) / <alpha-value>)',
          boolean: 'rgb(var(--c-bson-boolean) / <alpha-value>)',
          date: 'rgb(var(--c-bson-date) / <alpha-value>)',
          null: 'rgb(var(--c-bson-null) / <alpha-value>)',
          objectid: 'rgb(var(--c-bson-objectid) / <alpha-value>)',
          array: 'rgb(var(--c-bson-array) / <alpha-value>)',
          object: 'rgb(var(--c-bson-object) / <alpha-value>)',
          binary: 'rgb(var(--c-bson-binary) / <alpha-value>)',
          regex: 'rgb(var(--c-bson-regex) / <alpha-value>)',
          int: 'rgb(var(--c-bson-number) / <alpha-value>)',
          long: 'rgb(var(--c-bson-long) / <alpha-value>)',
          double: 'rgb(var(--c-bson-double) / <alpha-value>)',
          decimal: 'rgb(var(--c-bson-decimal) / <alpha-value>)',
          timestamp: 'rgb(var(--c-bson-date) / <alpha-value>)',
          minkey: 'rgb(var(--c-bson-object) / <alpha-value>)',
          maxkey: 'rgb(var(--c-bson-object) / <alpha-value>)'
        },
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      },
      transitionDuration: {
        fast: '150ms'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}

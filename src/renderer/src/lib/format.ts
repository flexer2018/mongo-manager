/** 展示用的通用格式化助手 */

/** 字节数 → 可读大小（B / KB / MB / GB / TB / PB） */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${power === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[power]}`
}

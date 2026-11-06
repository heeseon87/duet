import { describe, expect, it } from 'vitest'
import { nextTheme, themeAttr, themeFrom } from '../web/src/theme.ts'

describe('themes', () => {
  it('puts crayon on the page as its own theme, whatever the OS prefers', () => {
    expect(themeAttr('crayon', true)).toBe('crayon')
    expect(themeAttr('crayon', false)).toBe('crayon')
    expect(themeAttr('system', true)).toBe('dark')
    expect(themeAttr('system', false)).toBe('light')
    expect(themeAttr('light', true)).toBe('light')
  })
  it('reads an unknown or missing value as system', () => {
    expect(themeFrom('crayon')).toBe('crayon')
    expect(themeFrom(null)).toBe('system')
    expect(themeFrom('sepia')).toBe('system')
  })
  it('goes round system, light, dark, crayon', () => {
    expect(['system', 'light', 'dark', 'crayon'].map(t => nextTheme(themeFrom(t)))).toEqual(['light', 'dark', 'crayon', 'system'])
  })
})

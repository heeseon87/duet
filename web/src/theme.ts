// The screen themes, in the order the theme menu and the palette's "테마 바꾸기" go through them.
// index.html's first-paint script repeats `themeAttr`, since it runs before any module loads.

export type Theme = 'system' | 'light' | 'dark' | 'crayon'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark', 'crayon']

/** `<html data-theme>`: crayon is a light paper theme of its own; system follows the OS between light and dark. */
export function themeAttr(theme: Theme, prefersDark: boolean): 'light' | 'dark' | 'crayon' {
  if (theme === 'crayon' || theme === 'light' || theme === 'dark') return theme
  return prefersDark ? 'dark' : 'light'
}

/** A remembered value, or system when there is none or it is not a theme. */
export const themeFrom = (stored: string | null): Theme => (THEMES as readonly string[]).includes(stored ?? '') ? (stored as Theme) : 'system'

export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]

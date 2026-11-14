// System-Aware Light / Dark Mode Theme Manager
// Automatically follows macOS System Appearance (prefers-color-scheme) when set to 'system'

export class ThemeManager {
  constructor(initialPreference = 'system') {
    const saved =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('cadence_theme_pref')
        : null;
    this.preference = saved || initialPreference;
    this.mediaQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    if (this.mediaQuery) {
      this.mediaQuery.addEventListener('change', () => {
        if (this.preference === 'system') {
          this.applyTheme('system');
        }
      });
    }
  }

  getResolvedTheme(pref = this.preference) {
    if (pref === 'light' || pref === 'dark') return pref;
    const isSystemDark = this.mediaQuery ? this.mediaQuery.matches : false;
    return isSystemDark ? 'dark' : 'light';
  }

  applyTheme(pref = this.preference) {
    this.preference = pref;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('cadence_theme_pref', pref);
    }
    const resolved = this.getResolvedTheme(pref);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolved);
      document.documentElement.setAttribute('data-theme-pref', pref);
    }
    return resolved;
  }
}

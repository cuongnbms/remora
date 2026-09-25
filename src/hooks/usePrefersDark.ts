import { useEffect, useState } from 'react';
import { isDark } from '../lib/settings';
import { useStore } from '../store';

const QUERY = '(prefers-color-scheme: dark)';

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** Whether the app is currently dark: the theme setting, or the OS appearance in "system" mode. */
export function useIsDark(): boolean {
  const theme = useStore((s) => s.config.settings.theme);
  return isDark(theme, usePrefersDark());
}

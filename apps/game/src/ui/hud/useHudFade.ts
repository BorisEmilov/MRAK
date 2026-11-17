import { useEffect, useState } from 'react';

export const HUD_FADE_AFTER_MS = 6000;

/**
 * HUD fading: any change of `key` (values, phase, notices) wakes the HUD; it fades after
 * HUD_FADE_AFTER_MS of calm unless `keepVisible`. `wake` is for hover, focus and the show-HUD key.
 */
export function useHudFade(
  key: string,
  keepVisible: boolean,
): { faded: boolean; wake: () => void } {
  const [lastKey, setLastKey] = useState(key);
  const [faded, setFaded] = useState(false);
  const [wakeCount, setWakeCount] = useState(0);
  if (lastKey !== key) {
    setLastKey(key);
    setFaded(false);
  }

  useEffect(() => {
    if (keepVisible) return undefined;
    const timer = window.setTimeout(() => {
      setFaded(true);
    }, HUD_FADE_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, keepVisible, wakeCount]);

  return {
    faded: faded && !keepVisible,
    wake: () => {
      setFaded(false);
      setWakeCount((n) => n + 1);
    },
  };
}

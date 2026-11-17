/**
 * Whispers at low Sanity (docs/systems/sanity.md → Implementation): the tier's whisper lines
 * arrive as captions, so they are readable and never only audio.
 */
import { useEffect } from 'react';
import { useApp, useUi } from '../state/hooks';

export const WHISPER_EVERY_MS = 24_000;

export function Whispers() {
  const { host, bus } = useApp();
  const paused = useUi((s) => s.paused);
  useEffect(() => {
    if (paused) return;
    let turn = 0;
    const id = window.setInterval(() => {
      const keys = host.perception()?.whisperKeys ?? [];
      const key = keys[turn % Math.max(1, keys.length)];
      turn += 1;
      if (key) bus.emit('audio:caption', { kind: 'speech', textKey: key, durationMs: 4000 });
    }, WHISPER_EVERY_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [host, bus, paused]);
  return null;
}

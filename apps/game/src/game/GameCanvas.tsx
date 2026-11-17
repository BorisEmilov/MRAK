import * as Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { AssetService } from '../assets/AssetService';
import type { AppServices } from '../state/context';
import { useApp } from '../state/hooks';
import { createGameConfig } from './config';

/** Publishes the canvas rectangle as CSS variables so React layers can align to the game view. */
function publishCanvasRect(canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  const style = document.documentElement.style;
  style.setProperty('--game-left', `${String(r.left)}px`);
  style.setProperty('--game-top', `${String(r.top)}px`);
  style.setProperty('--game-width', `${String(r.width)}px`);
  style.setProperty('--game-height', `${String(r.height)}px`);
}

const THUMB_WIDTH = 192;
const THUMB_HEIGHT = 108;

/** Captures the rendered game view as a small JPEG data URL for the load screen. */
function captureThumbnail(game: Phaser.Game): Promise<string | null> {
  return new Promise((resolve) => {
    game.renderer.snapshot((image) => {
      if (!(image instanceof HTMLImageElement)) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_WIDTH;
      canvas.height = THUMB_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      // Cover-fit: crop the source to 16:9 around its centre.
      const scale = Math.max(THUMB_WIDTH / image.width, THUMB_HEIGHT / image.height);
      const w = THUMB_WIDTH / scale;
      const h = THUMB_HEIGHT / scale;
      ctx.drawImage(
        image,
        (image.width - w) / 2,
        (image.height - h) / 2,
        w,
        h,
        0,
        0,
        THUMB_WIDTH,
        THUMB_HEIGHT,
      );
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    }, 'image/png');
  });
}

/** Creates the Phaser game and wires it to the app. Returns the teardown. */
function mountPhaser(parent: HTMLElement, { host, bus, store }: AppServices): () => void {
  {
    const assets = new AssetService(`${import.meta.env.BASE_URL}assets/`);
    let game: Phaser.Game;
    try {
      game = new Phaser.Game(createGameConfig(parent, { host, bus, assets, store }));
    } catch (err) {
      store.setState({ screen: 'error', error: { kind: 'webgl', detail: String(err) } });
      return () => undefined;
    }

    // Development only: lets the debug tools step frames by hand (performance checks in a
    // background tab, where the browser throttles requestAnimationFrame). Dropped from builds.
    if (import.meta.env.DEV) Reflect.set(window, '__mrakGame', game);

    // Fixed-step simulation driven by Phaser's loop.
    let fpsTimer = 0;
    const onStep = (_time: number, delta: number): void => {
      host.update(delta);
      fpsTimer += delta;
      if (fpsTimer >= 500) {
        fpsTimer = 0;
        if (store.getState().debugOpen) store.setState({ fps: Math.round(game.loop.actualFps) });
      }
    };
    game.events.on(Phaser.Core.Events.STEP, onStep);

    // Pause when the tab loses focus; the player resumes from the pause overlay.
    const onBlur = (): void => {
      if (store.getState().options.pauseOnBlur && host.running) host.setPaused('focus', true);
    };
    game.events.on(Phaser.Core.Events.BLUR, onBlur);
    game.events.on(Phaser.Core.Events.HIDDEN, onBlur);

    // Audio unlocks with the first gesture (Phaser listens for it); reflect it in the UI.
    const onReady = (): void => {
      store.setState({ audioLocked: game.sound.locked });
      game.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        store.setState({ audioLocked: false });
      });
      const canvas = game.canvas;
      publishCanvasRect(canvas);
      host.setThumbnailSource(() => captureThumbnail(game));
    };
    game.events.once(Phaser.Core.Events.READY, onReady);

    // Integer zoom follows the window; React aligns to the canvas.
    const onResize = (): void => {
      game.scale.setMaxZoom();
      requestAnimationFrame(() => {
        publishCanvasRect(game.canvas);
      });
    };
    window.addEventListener('resize', onResize);

    const offLoadError = bus.on('load:error', ({ file }) => {
      store.setState({ screen: 'error', error: { kind: 'load', detail: file } });
    });

    // Options → audio (master volume; per-channel mixing arrives with the audio system).
    const applyVolume = (): void => {
      game.sound.volume = store.getState().options.masterVolume;
    };
    game.events.once(Phaser.Core.Events.READY, applyVolume);
    const offOptions = store.subscribe((s, prev) => {
      if (s.options !== prev.options && game.isBooted) applyVolume();
    });

    return () => {
      host.setThumbnailSource(null);
      offOptions();
      offLoadError();
      window.removeEventListener('resize', onResize);
      game.events.off(Phaser.Core.Events.STEP, onStep);
      // A Game destroyed before it has booted is never cleaned up (destroy runs on the next
      // loop step), so wait for READY in that case.
      if (game.isBooted) {
        game.destroy(true);
      } else {
        game.events.once(Phaser.Core.Events.READY, () => {
          game.destroy(true);
        });
      }
    };
  }
}

/**
 * Mounts Phaser once. React never re-renders the world: Phaser drives GameHost.update() from its
 * own loop, and React reads the throttled store.
 *
 * React StrictMode mounts, unmounts and remounts effects in development. Destroying and recreating
 * Phaser there leaves a second AudioContext behind, so teardown is deferred by one task and
 * cancelled if the component remounts immediately.
 */
export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const app = useApp();
  const teardownRef = useRef<(() => void) | null>(null);
  const pendingDestroy = useRef<number | null>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (pendingDestroy.current !== null) {
      window.clearTimeout(pendingDestroy.current);
      pendingDestroy.current = null;
    } else if (parent && !teardownRef.current) {
      teardownRef.current = mountPhaser(parent, app);
    }
    return () => {
      pendingDestroy.current = window.setTimeout(() => {
        pendingDestroy.current = null;
        teardownRef.current?.();
        teardownRef.current = null;
      }, 0);
    };
  }, [app]);

  return <div ref={containerRef} className="game-canvas" />;
}

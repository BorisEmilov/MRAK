import * as Phaser from 'phaser';
import { BASE_HEIGHT, BASE_WIDTH } from './constants';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { WorldScene } from './scenes/WorldScene';
import { provideServices, type Services } from './services';

export { BASE_HEIGHT, BASE_WIDTH };

export function createGameConfig(parent: HTMLElement, svc: Services): Phaser.Types.Core.GameConfig {
  return {
    // WebGL is required (lighting, shaders). Its absence is detected before Phaser starts.
    type: Phaser.WEBGL,
    parent,
    backgroundColor: '#07070a',
    pixelArt: true, // antialias off + roundPixels on
    banner: false,
    // Lights per camera (docs/systems/light.md); the village at night has ~20.
    maxLights: 32,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    input: { gamepad: false },
    scale: {
      // NONE + MAX_ZOOM = largest integer zoom that fits; never fractional scaling.
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      zoom: Phaser.Scale.MAX_ZOOM,
    },
    // Focus handling is done by the app (pause + overlay), not by muting on blur.
    audio: { disableWebAudio: false },
    callbacks: {
      preBoot: (game) => {
        provideServices(game, svc);
      },
    },
    scene: [BootScene, PreloadScene, WorldScene],
  };
}

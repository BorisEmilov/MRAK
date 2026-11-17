import * as Phaser from 'phaser';
import { BASE_GROUPS } from '../../assets/manifest';
import { BASE_HEIGHT, BASE_WIDTH } from '../constants';
import { services } from '../services';

/**
 * Preload: loads the base asset groups behind an atmospheric backdrop (fog and a candle), then
 * stays as the backdrop of the React main menu until a game starts.
 */
export class PreloadScene extends Phaser.Scene {
  static readonly KEY = 'Preload';
  private fog: Phaser.GameObjects.Image[] = [];
  private candleGlow: Phaser.GameObjects.Image | null = null;
  private offStarted: (() => void) | null = null;

  constructor() {
    super(PreloadScene.KEY);
  }

  preload(): void {
    const { assets, bus } = services(this);
    this.cameras.main.setBackgroundColor('#07070a');
    this.load.on('progress', (progress: number) => {
      bus.emit('load:progress', { progress });
    });
    this.load.once('loaderror', (file: Phaser.Loader.File) => {
      bus.emit('load:error', { file: file.key });
    });
    assets.queue(this, BASE_GROUPS);
  }

  create(): void {
    const { assets, bus, host } = services(this);
    assets.markLoaded(BASE_GROUPS);
    this.buildBackdrop();

    if (assets.hasAudio('ambience-wind')) {
      const wind = this.sound.add('ambience-wind', { loop: true, volume: 0 });
      const start = (): void => {
        wind.play();
        this.tweens.add({ targets: wind, volume: 0.5, duration: 3000 });
      };
      if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, start);
      else start();
    }

    this.offStarted = bus.on('host:gameStarted', ({ zone }) => {
      this.scene.start('World', { zone });
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offStarted?.();
      this.offStarted = null;
    });

    bus.emit('load:complete', {});
    bus.emit('scene:ready', { sceneKey: PreloadScene.KEY });
    // A game may already be running (e.g. returning from World is handled by World itself).
    if (host.running)
      this.scene.start('World', { zone: host.snapshot()?.currentZone ?? 'village' });
  }

  override update(time: number, delta: number): void {
    for (const [i, cloud] of this.fog.entries()) {
      cloud.x += (delta / 1000) * (6 + i * 1.5);
      if (cloud.x > BASE_WIDTH + 80) cloud.x = -80;
    }
    if (this.candleGlow) {
      this.candleGlow.setAlpha(0.55 + 0.25 * Math.sin(time / 130) * Math.sin(time / 57));
    }
  }

  private buildBackdrop(): void {
    const ground = this.add.graphics();
    ground.fillStyle(0x0d0d12, 1).fillRect(0, BASE_HEIGHT * 0.72, BASE_WIDTH, BASE_HEIGHT * 0.28);
    this.fog = Array.from({ length: 9 }, (_, i) =>
      this.add
        .image((i * 83) % BASE_WIDTH, BASE_HEIGHT * 0.55 + ((i * 37) % 90), 'common', 'fog')
        .setScale(3 + (i % 3))
        .setAlpha(0.35),
    );
    const x = BASE_WIDTH * 0.5;
    const y = BASE_HEIGHT * 0.72;
    this.candleGlow = this.add
      .image(x, y - 14, 'common', 'light-glow')
      .setScale(4)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.add.image(x, y - 8, 'common', 'candle').setScale(2);
  }
}

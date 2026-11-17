import * as Phaser from 'phaser';
import { MANIFEST_KEY } from '../../assets/AssetService';
import { services } from '../services';

/** Boot: fetches the asset manifest (tiny, uncached) and hands over to Preload. */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'Boot';

  constructor() {
    super(BootScene.KEY);
  }

  preload(): void {
    const { assets, bus } = services(this);
    this.load.json(MANIFEST_KEY, assets.manifestUrl);
    this.load.once('loaderror', (file: Phaser.Loader.File) => {
      bus.emit('load:error', { file: file.key });
    });
  }

  create(): void {
    const { assets, bus } = services(this);
    try {
      assets.setManifest(this.cache.json.get(MANIFEST_KEY));
    } catch {
      bus.emit('load:error', { file: MANIFEST_KEY });
      return;
    }
    this.scene.start('Preload');
  }
}

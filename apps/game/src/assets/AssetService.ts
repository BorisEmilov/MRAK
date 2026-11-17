/**
 * Lazy asset loading by group/zone through the Phaser loader, driven by the hashed manifest.
 */
import type * as Phaser from 'phaser';
import { AssetManifestSchema, groupsForZone, type AssetManifest } from './manifest';

export const MANIFEST_KEY = 'asset-manifest';

export class AssetService {
  private manifest: AssetManifest | null = null;
  private readonly loaded = new Set<string>();
  private readonly loadedMaps = new Set<string>();

  /** `baseUrl` is where public/assets is served (Vite BASE_URL + "assets/"). */
  constructor(readonly baseUrl: string) {}

  get manifestUrl(): string {
    return `${this.baseUrl}manifest.json`;
  }

  setManifest(json: unknown): void {
    this.manifest = AssetManifestSchema.parse(json);
  }

  requireManifest(): AssetManifest {
    if (!this.manifest) throw new Error('asset manifest not loaded');
    return this.manifest;
  }

  isLoaded(group: string): boolean {
    return this.loaded.has(group);
  }

  hasAudio(key: string): boolean {
    return Object.values(this.requireManifest().groups).some((g) =>
      g.audio.some((a) => a.key === key),
    );
  }

  /** Queues the files of groups not loaded yet. Returns how many files were queued. */
  queue(scene: Phaser.Scene, groups: readonly string[]): number {
    const manifest = this.requireManifest();
    let queued = 0;
    for (const name of groups) {
      const group = manifest.groups[name];
      if (!group || this.loaded.has(name)) continue;
      for (const atlas of group.atlases) {
        // With its normal map (lighting, docs/systems/light.md).
        scene.load.atlas({
          key: atlas.key,
          textureURL: this.baseUrl + atlas.image.url,
          atlasURL: this.baseUrl + atlas.data.url,
          ...(atlas.normal ? { normalMap: this.baseUrl + atlas.normal.url } : {}),
        });
        queued += atlas.normal ? 3 : 2;
      }
      for (const sound of group.audio) {
        // Ogg Vorbis first; Safari falls back to AAC.
        scene.load.audio(sound.key, [this.baseUrl + sound.ogg.url, this.baseUrl + sound.m4a.url]);
        queued += 1;
      }
    }
    return queued;
  }

  markLoaded(groups: readonly string[]): void {
    for (const g of groups) this.loaded.add(g);
  }

  /** Loads groups outside `preload()` (e.g. entering a zone). */
  load(scene: Phaser.Scene, groups: readonly string[]): Promise<void> {
    if (this.queue(scene, groups) === 0) {
      this.markLoaded(groups);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onError = (file: Phaser.Loader.File): void => {
        scene.load.off('complete', onComplete);
        reject(new Error(`failed to load ${file.key}`));
      };
      const onComplete = (): void => {
        scene.load.off('loaderror', onError);
        this.markLoaded(groups);
        resolve();
      };
      scene.load.once('complete', onComplete);
      scene.load.once('loaderror', onError);
      scene.load.start();
    });
  }

  loadZone(scene: Phaser.Scene, zone: string): Promise<void> {
    return this.load(scene, groupsForZone(this.requireManifest(), zone));
  }

  /** Cache key of a zone map (Tiled JSON). */
  static mapKey(path: string): string {
    return `map:${path}`;
  }

  /** Texture key of a tileset. */
  static tilesetKey(name: string): string {
    return `tiles:${name}`;
  }

  /** Loads a zone map and its tilesets (with normal maps), if not loaded yet. */
  loadMap(scene: Phaser.Scene, path: string): Promise<void> {
    const entry = this.requireManifest().maps[path];
    if (!entry) return Promise.reject(new Error(`map ${path} is not in the asset manifest`));
    if (this.loadedMaps.has(path)) return Promise.resolve();
    scene.load.tilemapTiledJSON(AssetService.mapKey(path), this.baseUrl + entry.data.url);
    for (const [name, ts] of Object.entries(entry.tilesets))
      if (!scene.textures.exists(AssetService.tilesetKey(name)))
        scene.load.image({
          key: AssetService.tilesetKey(name),
          url: this.baseUrl + ts.image.url,
          normalMap: this.baseUrl + ts.normal.url,
        });
    return new Promise((resolve, reject) => {
      const onError = (file: Phaser.Loader.File): void => {
        scene.load.off('complete', onComplete);
        reject(new Error(`failed to load ${file.key}`));
      };
      const onComplete = (): void => {
        scene.load.off('loaderror', onError);
        this.loadedMaps.add(path);
        resolve();
      };
      scene.load.once('complete', onComplete);
      scene.load.once('loaderror', onError);
      scene.load.start();
    });
  }

  /**
   * Frees what only other zones use (docs/systems/night-exploration.md → transitions): atlases
   * of groups not in `keepGroups`, maps not in `keepMaps` and their tilesets.
   */
  unloadExcept(
    scene: Phaser.Scene,
    keepGroups: readonly string[],
    keepMaps: readonly string[],
  ): void {
    const manifest = this.requireManifest();
    for (const name of [...this.loaded]) {
      if (keepGroups.includes(name)) continue;
      for (const atlas of manifest.groups[name]?.atlases ?? [])
        if (scene.textures.exists(atlas.key)) scene.textures.remove(atlas.key);
      this.loaded.delete(name);
    }
    const keepTilesets = new Set(
      keepMaps.flatMap((m) => Object.keys(manifest.maps[m]?.tilesets ?? {})),
    );
    for (const path of [...this.loadedMaps]) {
      if (keepMaps.includes(path)) continue;
      scene.cache.tilemap.remove(AssetService.mapKey(path));
      for (const name of Object.keys(manifest.maps[path]?.tilesets ?? {}))
        if (!keepTilesets.has(name) && scene.textures.exists(AssetService.tilesetKey(name)))
          scene.textures.remove(AssetService.tilesetKey(name));
      this.loadedMaps.delete(path);
    }
  }
}

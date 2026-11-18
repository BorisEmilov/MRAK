/**
 * World: one zone of the valley (docs/systems/night-exploration.md, light.md, maps.md). Renders
 * the zone's Tiled map for its current variant with Phaser 4 lighting and filters, moves the
 * guardian, and reports what happens to core through commands. Rules stay in core; this scene
 * only measures (positions, light circles) and draws.
 */
import { TiledMap, TILE_SIZE, type Poi, type Zone } from '@mrak/content-schema';
import {
  cellsInDisc,
  DAY_REVEAL_TILES,
  itemRules,
  decodeBase64,
  EXPLORE_CELL_TILES,
  corruptionAspect,
  inDarkness,
  isRevealed,
  jdnToJulian,
  NIGHT_REVEAL_TILES,
  seasonOf,
  villageRules,
  type Ambient,
  type CoreEvent,
  type GatherStatus,
  type Snapshot,
} from '@mrak/core';
import * as Phaser from 'phaser';
import { AssetService } from '../../assets/AssetService';
import { groupsForZone } from '../../assets/manifest';
import { resolveBindings } from '../../input/bindings';
import { panelOpen } from '../../state/ui-store';
import { ScreenFx } from '../fx';
import { services } from '../services';
import { Controls } from '../world/controls';
import { grade } from '../world/grading';
import { ZoneLighting, type LightingFrame } from '../world/lighting';
import {
  combine,
  keysVector,
  NOISE_RUN,
  NOISE_WALK,
  speedOf,
  towards,
  type Vec,
} from '../world/movement';
import { ScreenFilters } from '../world/screen-filters';
import { NightCreatures } from '../night/NightCreatures';
import { directionTo } from '../night/alerts';
import {
  corruptionTint,
  perceptionFrame,
  STEADY_FRAME,
  type PerceptionFrame,
} from '../world/perception';
import { GatherPlants } from '../world/plants';
import { nearestTarget, photoSubject, type Target } from '../world/targets';
import { reasonKey } from '../../ui/items/items-ui';
import { VillageNpcs } from '../villagers/VillageNpcs';
import { t } from '../../i18n/t';
import type { LocaleKey } from '@mrak/content';
import { ICON_NAMES, type IconName } from '@mrak/ui-kit';
import {
  overlaps,
  tilesIn,
  ZoneMap,
  type ExitDef,
  type LightDef,
  type Rect,
} from '../world/zone-map';

interface WorldData {
  zone: string;
  /** Spawn point name in the zone's map (default: "default"). */
  spawn?: string;
  /** Exact position (px) instead of a spawn point: reloading the zone for a new variant. */
  at?: { x: number; y: number };
}

/** The guardian's house door: opens the belongings at the house store (inventory.md). */
const HOUSE_POI = 'guardian-house';
/** How close (px) the guardian must be to a POI to interact. */
const REACH = TILE_SIZE * 1.5;
/** Seconds between noise reports while moving. */
const NOISE_EVERY_MS = 500;
const SENSE_EVERY_MS = 250;
/** How often a prop may shift out of view at very low Sanity. */
const SHIFT_EVERY_MS = 9000;
const PATHS_EVERY_MS = 500;
const DEPTH = { ground: 0, blockers: 5, guardian: 10, overhead: 20, fog: 30 } as const;

interface PlacedPoi {
  def: Poi;
  x: number;
  y: number;
}

interface PathEdge {
  areas: (Rect & { blocker: string | null })[];
  gid: number;
  open: boolean;
  /** Fading alpha of its blocker tiles. */
  alpha: { value: number };
  tiles: { x: number; y: number }[];
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'World';
  private zoneId = 'village';
  private spawnName = 'default';
  private spawnAt: { x: number; y: number } | null = null;
  private variantId = '';
  private built = false;
  private leaving = false;

  private zone!: Zone;
  private zoneMap!: ZoneMap;
  private guardian!: Phaser.Physics.Arcade.Sprite;
  private controls: Controls | null = null;
  private lighting: ZoneLighting | null = null;
  private filters: ScreenFilters | null = null;
  private perceived: PerceptionFrame = STEADY_FRAME;
  private lastShift = 0;
  private shiftTurn = 0;
  private fx!: ScreenFx;
  private blockers: Phaser.Tilemaps.TilemapLayer | null = null;
  private fog: Phaser.GameObjects.TileSprite[] = [];
  private npcs: VillageNpcs | null = null;
  private exits: ExitDef[] = [];
  private pois: PlacedPoi[] = [];
  private paths = new Map<string, PathEdge>();
  private pendingClose = new Set<string>();

  private facing = Math.PI / 2;
  private pointerTarget: Vec | null = null;
  private pointerAim: Vec | null = null;
  private near: Target | null = null;
  private plants: GatherPlants | null = null;
  private creatures: NightCreatures | null = null;
  private gathering: Readonly<Record<string, GatherStatus>> = {};
  /** Movement multiplier from the pack's weight (1, or slower when encumbered). */
  private loadSpeed = 1;
  private lastNoise = 0;
  private lastSense = 0;
  private lastPaths = 0;
  private lastGrade = 0;
  private ambient: Ambient | null = null;
  private cleanups: (() => void)[] = [];

  constructor() {
    super(WorldScene.KEY);
  }

  init(data: WorldData): void {
    const { host } = services(this);
    this.zoneId = host.content.has('zones', data.zone) ? data.zone : 'village';
    this.spawnName = data.spawn ?? 'default';
    this.spawnAt = data.at ?? null;
    this.built = false;
    this.leaving = false;
    this.paths = new Map();
    this.pendingClose = new Set();
    this.pois = [];
    this.fog = [];
    this.npcs = null;
    this.near = null;
    this.plants = null;
    this.gathering = {};
    this.loadSpeed = 1;
    this.pointerTarget = null;
    this.pointerAim = null;
    this.cleanups = [];
  }

  create(): void {
    const { assets, bus, host } = services(this);
    this.cameras.main.setBackgroundColor('#07070a');
    const offEnded = bus.on('host:gameEnded', () => {
      this.scene.start('Preload');
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offEnded();
      this.teardown();
    });

    this.zone = host.content.get('zones', this.zoneId);
    const variant = host.zoneVariant(this.zoneId) ?? this.zone.defaultVariant;
    const mapPath = this.zone.variants.find((v) => v.id === variant)?.map ?? this.zone.map;

    bus.emit('world:zoneLoading', { zone: this.zoneId, loading: true });
    host.setPaused('loading', true);
    Promise.all([assets.loadZone(this, this.zoneId), assets.loadMap(this, mapPath)])
      .then(() => {
        if (!this.sys.isActive()) return;
        this.build(mapPath, variant);
        // Lazy unloading: keep only what this zone uses (and the base groups).
        assets.unloadExcept(
          this,
          ['common', ...groupsForZone(assets.requireManifest(), this.zoneId)],
          [mapPath],
        );
        host.setPaused('loading', false);
        bus.emit('world:zoneLoading', { zone: this.zoneId, loading: false });
        bus.emit('scene:ready', { sceneKey: WorldScene.KEY });
      })
      .catch((err: unknown) => {
        bus.emit('load:error', { file: err instanceof Error ? err.message : this.zoneId });
      });
  }

  // ------------------------------------------------------------------ build

  private build(mapPath: string, variant: string): void {
    const { host, store, bus } = services(this);
    const key = AssetService.mapKey(mapPath);
    const cached = this.cache.tilemap.get(key) as { data: unknown } | undefined;
    const parsed = TiledMap.parse(cached?.data);
    this.zoneMap = new ZoneMap(this.zoneId, parsed, variant);
    this.variantId = variant;

    const map = this.make.tilemap({ key });
    const tsName = parsed.tilesets[0]?.name ?? '';
    const tileset = map.addTilesetImage(tsName, AssetService.tilesetKey(tsName));
    if (!tileset) throw new Error(`tileset ${tsName} missing`);
    const width = map.widthInPixels;
    const height = map.heightInPixels;

    this.zoneMap.visibleTileLayers().forEach((name, i) => {
      const layer = map.createLayer(name, tileset);
      layer.setLighting(true);
      layer.setDepth((ZoneMap.isOverhead(name) ? DEPTH.overhead : DEPTH.ground) + i * 0.01);
    });
    const colliders = this.zoneMap.collisionLayers().flatMap((name) => {
      const layer = map.createLayer(name, tileset);
      layer.setVisible(false);
      layer.setCollisionByExclusion([-1]);
      return [layer];
    });
    this.blockers = map.createBlankLayer('blockers', tileset);
    this.blockers?.setLighting(true).setDepth(DEPTH.blockers);

    // Guardian.
    if (!this.anims.exists('guardian-walk')) {
      this.anims.create({
        key: 'guardian-walk',
        frames: [
          { key: 'common', frame: 'guardian-1' },
          { key: 'common', frame: 'guardian-2' },
        ],
        frameRate: 7,
        repeat: -1,
      });
    }
    const spawn = this.spawnAt ?? this.zoneMap.spawn(this.spawnName);
    this.guardian = this.physics.add.sprite(spawn.x, spawn.y, 'common', 'guardian-0');
    // Origin = the frame pivot (feet, art-slots.json); the feet hitbox follows the frame size.
    this.guardian.setDepth(DEPTH.guardian).setLighting(true);
    const { width: fw, height: fh } = this.guardian.frame;
    this.guardian.body?.setSize(8, 6).setOffset((fw - 8) / 2, fh - 7);
    this.guardian.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, width, height);
    for (const layer of colliders) this.physics.add.collider(this.guardian, layer);
    if (this.blockers) this.physics.add.collider(this.guardian, this.blockers);

    // Fog: two drifting, lit layers (visible only in light; denser at night).
    this.fog = [0, 1].map((i) =>
      this.add
        .tileSprite(0, 0, width, height, 'common', 'fog')
        .setOrigin(0)
        .setTileScale(5 + i * 3)
        .setAlpha(0)
        .setLighting(true)
        .setDepth(DEPTH.fog + i),
    );

    // Camera: smoothed follow, bounded, whole pixels.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, width, height);
    cam.startFollow(this.guardian, true, 0.1, 0.1);
    cam.setDeadzone(24, 16);
    cam.fadeIn(300, 0, 0, 0);

    this.lighting = new ZoneLighting(this, this.zoneMap.lights());
    this.filters = new ScreenFilters(this, cam);
    this.fx = new ScreenFx(() => store.getState().options);
    this.controls = new Controls(() => resolveBindings(store.getState().options.keyBindings));

    this.exits = this.zoneMap.exits();
    const defs = new Map(this.zone.pois.map((p) => [p.id, p]));
    this.pois = this.zoneMap.pois().flatMap((p) => {
      const def = defs.get(p.id);
      return def ? [{ def, x: p.x, y: p.y }] : [];
    });
    for (const [id, areas] of this.zoneMap.pathAreas()) {
      const gid = this.zoneMap.blockerGid(areas[0]?.blocker ?? null);
      if (gid === null) continue;
      const tiles = areas
        .flatMap((a) => tilesIn(a))
        .filter(({ x, y }) => !colliders.some((l) => l.hasTileAt(x, y)));
      this.paths.set(id, { areas, gid, open: true, alpha: { value: 0 }, tiles });
    }
    this.blockers?.setCollision([...new Set([...this.paths.values()].map((p) => p.gid))]);
    this.syncPaths(true);
    this.spawnVillagers();
    this.creatures = new NightCreatures(
      this,
      host,
      this.zoneId,
      this.pois.map((p) => ({ id: p.def.id, x: p.x, y: p.y })),
    );
    this.plants = new GatherPlants(
      this,
      this.pois.flatMap((p) =>
        p.def.gather ? [{ id: p.def.id, x: p.x, y: p.y, tint: p.def.gather.tint }] : [],
      ),
    );
    this.gathering = host.gathering(this.zoneId);
    this.plants.update(this.gathering);

    store.setState({ mapSketch: this.zoneMap.sketch() });
    this.wirePointer();
    this.cleanups.push(
      host.subscribeEvents((events) => {
        this.onCoreEvents(events);
      }),
      bus.on('ui:photograph', () => {
        this.photograph();
      }),
      store.subscribe((s, prev) => {
        if (s.debugLights !== prev.debugLights && s.debugLights > 0)
          this.addDebugLights(s.debugLights);
        // A conversation may change the zone (a flag selects another variant): reload in place.
        if (prev.dialogue && !s.dialogue && !this.leaving) {
          const now = host.zoneVariant(this.zoneId) ?? this.zone.defaultVariant;
          if (now !== this.variantId)
            this.scene.restart({
              zone: this.zoneId,
              at: { x: this.guardian.x, y: this.guardian.y },
            } satisfies WorldData);
        }
      }),
    );
    bus.emit('world:interaction', null);
    this.built = true;
  }

  private wirePointer(): void {
    const toWorld = (p: Phaser.Input.Pointer): Vec => ({ x: p.worldX, y: p.worldY });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      const at = toWorld(p);
      const near = this.near;
      const pos = near?.kind === 'poi' ? near.poi : near?.villager;
      if (near && pos && Math.hypot(pos.x - at.x, pos.y - at.y) < TILE_SIZE) {
        this.interact(near);
        return;
      }
      this.pointerTarget = at;
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      this.pointerAim = toWorld(p);
      if (p.isDown && this.pointerTarget) this.pointerTarget = toWorld(p);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.pointerTarget = null;
    });
    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pointerTarget = null;
    });
  }

  /** Villagers live in the village zone (docs/systems/villagers.md → Presentation). */
  private spawnVillagers(): void {
    const { host, bus } = services(this);
    const rules = villageRules(host.content);
    if (!rules || rules.zone !== this.zoneId) return;
    const icons = new Set<string>(ICON_NAMES);
    this.npcs = new VillageNpcs(
      this,
      host.content.all('villagers'),
      rules,
      {
        cols: this.zoneMap.cols,
        rows: this.zoneMap.rows,
        solid: this.zoneMap.solidGrid(),
        pois: this.zoneMap.pois(),
      },
      (x, y) => this.blockers?.hasTileAt(x, y) ?? false,
      host,
      {
        onTouched: (villager) => {
          bus.emit('audio:caption', {
            kind: 'sound',
            textKey: 'caption.returned-touch',
            direction: 'center',
          });
          bus.emit('world:notice', {
            key: 'notice.returned-touch',
            icon: 'villager-state.returned',
            tone: 'bad',
            params: { name: t(villager.nameKey as LocaleKey) },
          });
          this.fx.shake(this.cameras.main, 250, 0.004);
        },
      },
      (task) => {
        const icon = host.content.find('tasks', task)?.icon;
        return icon && icons.has(icon) ? (icon as IconName) : null;
      },
    );
  }

  private teardown(): void {
    this.npcs?.destroy();
    this.npcs = null;
    this.plants?.destroy();
    this.plants = null;
    this.creatures?.destroy();
    this.creatures = null;
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.controls?.destroy();
    this.controls = null;
    this.lighting?.destroy();
    this.lighting = null;
    this.filters = null;
    this.input.removeAllListeners();
  }

  // ------------------------------------------------------------------ frame

  override update(time: number, delta: number): void {
    if (!this.built || this.leaving) return;
    const { host, store } = services(this);
    const controls = this.controls;
    const snapshot = host.snapshot();
    if (!controls || !snapshot) return;
    controls.poll();
    const ui = store.getState();
    const blocked = ui.paused || panelOpen(ui) || ui.glossary.open;
    const dt = Math.min(delta, 100) / 1000;

    const panel = panelOpen(ui);
    if (controls.pressed('map') && (!panel || ui.mapOpen)) store.setState({ mapOpen: !ui.mapOpen });
    if (controls.pressed('village') && (!panel || ui.villageOpen))
      store.setState({ villageOpen: !ui.villageOpen });
    if (controls.pressed('inventory') && (!panel || ui.belongings !== null))
      store.setState({ belongings: ui.belongings === 'pack' ? null : 'pack' });
    if (controls.pressed('journal') && (!panel || ui.journal !== null))
      store.setState({ journal: ui.journal === null ? 'clues' : null });
    if (controls.pressed('character') && (!panel || ui.character !== null))
      store.setState({ character: ui.character === null ? 'sheet' : null });
    if (blocked) {
      controls.release();
      this.guardian.setVelocity(0, 0);
      this.pointerTarget = null;
      this.animate({ x: 0, y: 0 });
    } else {
      this.move(controls, time);
      if (controls.pressed('lantern')) this.toggleLantern(snapshot);
      if (controls.pressed('interact') && this.near) this.interact(this.near);
      if (controls.pressed('photograph')) this.photograph();
    }
    controls.endFrame();

    this.ambient = host.ambient();
    const ambient = this.ambient;
    if (!ambient) return;
    const frame: LightingFrame = {
      ambient,
      lit: snapshot.light.lit,
      radiusTiles: host.lanternRadius(),
      x: this.guardian.x,
      y: this.guardian.y,
      facing: this.aimAngle(),
      dt,
      time,
    };
    this.lighting?.update(frame);
    this.filters?.update(time);
    this.npcs?.update(time, dt, {
      x: this.guardian.x,
      y: this.guardian.y,
      lanternPx: snapshot.light.lit ? frame.radiusTiles * TILE_SIZE : 0,
      noise: snapshot.explorer.noise,
      reduceMotion: this.reduceMotion(),
      staring: this.perceived.staring,
    });
    this.creatures?.update(
      time,
      dt,
      { x: this.guardian.x, y: this.guardian.y },
      snapshot.light.lit ? frame.radiusTiles : 0,
      snapshot.explorer.noise,
    );
    this.updateFog(dt, ambient);

    if (time - this.lastSense >= SENSE_EVERY_MS) {
      this.lastSense = time;
      this.sense(snapshot, frame);
      this.perceive(time);
    }
    if (time - this.lastPaths >= PATHS_EVERY_MS) {
      this.lastPaths = time;
      this.syncPaths(false);
    }
    if (time - this.lastGrade >= 250) {
      this.lastGrade = time;
      this.applyGrade(snapshot, ambient);
    }
    this.fadeBlockers(dt);
    this.checkExits();
  }

  private move(controls: Controls, time: number): void {
    const keys = keysVector({
      up: controls.isDown('move-up'),
      down: controls.isDown('move-down'),
      left: controls.isDown('move-left'),
      right: controls.isDown('move-right'),
    });
    const pointer = this.pointerTarget
      ? towards(this.guardian, this.pointerTarget)
      : { x: 0, y: 0 };
    const dir = combine(keys, controls.stickVector(), pointer);
    const moving = dir.x !== 0 || dir.y !== 0;
    // An encumbered guardian walks slowly and cannot run (inventory.md rule 2).
    const running = moving && controls.isDown('run') && this.loadSpeed >= 1;
    const speed = speedOf(running) * this.loadSpeed;
    this.guardian.setVelocity(dir.x * speed, dir.y * speed);
    if (moving) {
      this.facing = Math.atan2(dir.y, dir.x);
      if (keys.x !== 0 || keys.y !== 0 || controls.padActive()) this.pointerAim = null;
    }
    this.animate(dir, running);
    if (moving && time - this.lastNoise >= NOISE_EVERY_MS) {
      this.lastNoise = time;
      services(this).host.dispatch({ type: 'makeNoise', level: running ? NOISE_RUN : NOISE_WALK });
    }
  }

  private animate(dir: Vec, running = false): void {
    if (dir.x !== 0) this.guardian.setFlipX(dir.x < 0);
    if (dir.x !== 0 || dir.y !== 0) {
      this.guardian.anims.play('guardian-walk', true);
      this.guardian.anims.timeScale = running ? 1.6 : 1;
    } else {
      this.guardian.anims.stop();
      this.guardian.setFrame('guardian-0');
    }
  }

  /** Lantern direction: towards the mouse when it is the active pointer, else the facing. */
  private aimAngle(): number {
    const aim = this.pointerAim;
    if (aim && Math.hypot(aim.x - this.guardian.x, aim.y - this.guardian.y) > 8)
      return Math.atan2(aim.y - this.guardian.y, aim.x - this.guardian.x);
    return this.facing;
  }

  // ------------------------------------------------------------------ actions

  private toggleLantern(snapshot: Snapshot): void {
    const { host, bus } = services(this);
    const result = host.dispatch({ type: 'setLanternLit', lit: !snapshot.light.lit });
    if (result.ok) return;
    bus.emit('world:notice', {
      key: result.reason === 'no oil' ? 'notice.no-oil' : 'notice.no-lantern',
      icon: 'resource.light',
      tone: 'bad',
    });
  }

  private interact(target: Target): void {
    if (target.kind === 'villager') {
      this.talkTo(target.villager.id, target.villager.nameKey);
      return;
    }
    const poi = target.poi;
    const { host, bus, store } = services(this);
    const rules = villageRules(host.content);
    if (rules && rules.zone === this.zoneId && poi.def.id === rules.death.grave) {
      // At the graves: the guardian buries (or lays to rest) the first who needs it.
      const unquiet = host
        .villagers()
        .find((v) => v.death && (v.status === 'returned' || v.death.burial !== 'proper'));
      if (unquiet) {
        const result = host.dispatch({ type: 'buryVillager', villager: unquiet.id });
        if (!result.ok)
          bus.emit('world:notice', {
            key: result.reason.startsWith('missing')
              ? 'notice.burial-missing'
              : result.reason === 'not at night'
                ? 'notice.burial-night'
                : 'notice.burial-refused',
            icon: 'villager-state.dead',
            tone: 'bad',
            params: { name: t(host.content.get('villagers', unquiet.id).nameKey as LocaleKey) },
          });
      }
    }
    // A place of pacts at its hour offers the pact instead (progression.md D6).
    if (poi.def.pact && host.pactStatus(poi.def.pact) === 'ok') {
      store.setState({ pact: poi.def.pact });
      return;
    }
    const result = host.dispatch({ type: 'interactPoi', zone: this.zoneId, poi: poi.def.id });
    // A place with a story speaks it (the forest spirit at the old oak).
    if (poi.def.dialogue) store.setState({ dialogue: { story: poi.def.dialogue, villager: null } });
    if (!result.ok && result.reason === 'not regrown')
      bus.emit('world:notice', {
        key: 'notice.regrowing',
        icon: 'poi.herbs',
        tone: 'neutral',
        params: { place: t(poi.def.nameKey as LocaleKey) },
      });
    if (poi.def.id === HOUSE_POI) store.setState({ belongings: 'store' });
    if (poi.def.gather) this.refreshGathering();
  }

  /** Talking opens the tone choice when the guardian exists (progression.md V1–V5). */
  private talkTo(villager: string, nameKey: string): void {
    const { host, bus, store } = services(this);
    // A villager with a story speaks it; the daily talk (affinity, tales, practice) still counts.
    const story = host.content.find('villagers', villager)?.dialogue;
    if (story) {
      host.dispatch({ type: 'talkTo', villager });
      store.setState({ dialogue: { story, villager } });
      return;
    }
    if (host.snapshot()?.guardian.callingId) {
      store.setState({ talking: villager });
      return;
    }
    const result = host.dispatch({ type: 'talkTo', villager });
    if (!result.ok)
      bus.emit('world:notice', {
        key: 'notice.talk-refused',
        icon: 'action.talk',
        tone: 'neutral',
        params: { name: t(nameKey as LocaleKey) },
      });
  }

  /** Takes a photograph of the nearest villager, else the nearest place, else the zone. */
  private photograph(): void {
    if (!this.built || this.leaving) return;
    const { host, bus, store } = services(this);
    const rules = itemRules(host.content);
    if (!rules) return;
    const subject = photoSubject(
      { x: this.guardian.x, y: this.guardian.y },
      this.zoneId,
      this.pois,
      this.npcs?.standing(true) ?? [],
      rules.photography.rangeTiles * TILE_SIZE,
    );
    const result = host.dispatch({ type: 'takePhotograph', subject });
    if (!result.ok) {
      bus.emit('world:notice', {
        key: 'notice.photo-refused',
        icon: 'action.photograph',
        tone: 'bad',
        params: { reason: t(reasonKey(result.reason).key) },
      });
      return;
    }
    store.setState({ belongings: null });
    // The shutter: a white flash (a soft fade with reduced motion).
    const cam = this.cameras.main;
    if (this.reduceMotion()) cam.fadeIn(400, 255, 255, 255);
    else cam.flash(350, 255, 250, 235);
  }

  private refreshGathering(): void {
    this.gathering = services(this).host.gathering(this.zoneId);
    this.plants?.update(this.gathering);
  }

  /** Low-Sanity perception: staring villagers, props that shift while unseen. */
  private perceive(time: number): void {
    const was = this.perceived.movingObjects;
    const { host } = services(this);
    this.perceived = perceptionFrame(host.perception());
    // The mark of Corruption on the guardian's sprite (docs/systems/corruption.md).
    const snapshot = host.snapshot();
    if (snapshot) this.creatures?.sync(snapshot);
    if (snapshot) this.guardian.setTint(corruptionTint(corruptionAspect(snapshot, host.content)));
    if (was && !this.perceived.movingObjects) this.plants?.restore();
    if (this.perceived.movingObjects && time - this.lastShift >= SHIFT_EVERY_MS) {
      this.lastShift = time;
      this.plants?.shiftUnseen(this.cameras.main.worldView, this.shiftTurn++);
    }
  }

  private reduceMotion(): boolean {
    const options = services(this).store.getState().options;
    return (
      options.reduceMotion === 'on' ||
      (options.reduceMotion === 'system' &&
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches)
    );
  }

  private onCoreEvents(events: readonly CoreEvent[]): void {
    const { bus } = services(this);
    for (const e of events) {
      if (e.type === 'light/lanternOut') {
        bus.emit('audio:caption', {
          kind: 'sound',
          textKey: 'caption.lantern-out',
          direction: 'center',
        });
        this.fx.shake(this.cameras.main, 200, 0.002);
      } else if (e.type === 'night/flashed') {
        this.creatures?.flashed();
      } else if (e.type === 'village/alert') {
        // The bell from Mrak: heard from the side where the road home is.
        const exit = this.exits.find((x) => x.to === 'village');
        bus.emit('audio:caption', {
          kind: 'sound',
          textKey: 'caption.village-alert',
          direction: directionTo(exit ? exit.rect.x + exit.rect.width / 2 : null, this.guardian.x),
        });
      }
    }
  }

  // ------------------------------------------------------------------ senses

  /** Darkness, exploration, POI discovery and the interaction prompt. */
  private sense(snapshot: Snapshot, frame: LightingFrame): void {
    const { host, bus } = services(this);
    const lighting = this.lighting;
    if (!lighting) return;
    const at = { x: this.guardian.x, y: this.guardian.y };

    const dark = inDarkness(at, lighting.safeCircles(frame), frame.ambient.level);
    if (dark !== snapshot.light.inDarkness) host.dispatch({ type: 'setInDarkness', dark });

    // Reveal the player map around the guardian.
    const zoneState = snapshot.zones[this.zoneId];
    const revealTiles =
      frame.ambient.level >= 0.5
        ? DAY_REVEAL_TILES
        : Math.max(NIGHT_REVEAL_TILES, frame.lit ? frame.radiusTiles : 0);
    const cell = EXPLORE_CELL_TILES * TILE_SIZE;
    const cols = Math.ceil(this.zoneMap.cols / EXPLORE_CELL_TILES);
    const rows = Math.ceil(this.zoneMap.rows / EXPLORE_CELL_TILES);
    const bits = decodeBase64(zoneState?.explored ?? '');
    const fresh = cellsInDisc(
      at.x / cell,
      at.y / cell,
      revealTiles / EXPLORE_CELL_TILES,
      cols,
      rows,
    )
      .filter((c) => !isRevealed(bits, c))
      .slice(0, 1024);
    if (fresh.length > 0) host.dispatch({ type: 'revealCells', zone: this.zoneId, cells: fresh });
    const known = new Set(zoneState?.pois ?? []);
    for (const poi of this.pois)
      if (
        !known.has(poi.def.id) &&
        Math.hypot(poi.x - at.x, poi.y - at.y) <= revealTiles * TILE_SIZE
      )
        host.dispatch({ type: 'discoverPoi', zone: this.zoneId, poi: poi.def.id });

    // Plants come and go with seasons, moons and regrowth; the pack's weight slows the walk.
    this.refreshGathering();
    this.loadSpeed = host.packLoad()?.speed ?? 1;

    // Contextual interaction: the nearest villager or POI within reach.
    const best = nearestTarget(at, this.pois, this.npcs?.standing() ?? [], this.gathering, REACH);
    const same =
      best === this.near ||
      (best?.kind === 'poi' && this.near?.kind === 'poi' && best.poi === this.near.poi) ||
      (best?.kind === 'villager' &&
        this.near?.kind === 'villager' &&
        best.villager.id === this.near.villager.id);
    this.near = best;
    if (!same)
      bus.emit(
        'world:interaction',
        best === null
          ? null
          : best.kind === 'villager'
            ? { action: 'talk', targetKey: best.villager.nameKey }
            : {
                action: best.poi.def.id === HOUSE_POI ? 'house' : best.poi.def.action,
                targetKey: best.poi.def.nameKey,
              },
      );

    const { store } = services(this);
    if (store.getState().mapOpen)
      store.setState({ mapGuardian: { x: at.x / TILE_SIZE, y: at.y / TILE_SIZE } });
  }

  private applyGrade(snapshot: Snapshot, ambient: Ambient): void {
    const { host } = services(this);
    const max = snapshot.stats['sanity-max'] ?? host.content.statDecl('sanity-max').default;
    const sanity = snapshot.stats['sanity'] ?? host.content.statDecl('sanity').default;
    const reduceMotion = this.reduceMotion();
    this.filters?.apply(
      grade({
        season: seasonOf(jdnToJulian(snapshot.clock.day).month),
        sanity: max > 0 ? sanity / max : 1,
        darkness: 1 - ambient.level,
        pulledDown: snapshot.flags['moon-pulled-down'] === true,
        reduceMotion,
        reduceDistortion: services(this).store.getState().options.reduceDistortion,
      }),
    );
  }

  private updateFog(dt: number, ambient: Ambient): void {
    const night = 1 - ambient.level;
    this.fog.forEach((f, i) => {
      f.tilePositionX += dt * (5 + i * 3);
      f.tilePositionY += dt * (1.5 - i);
      f.setAlpha(this.zone.fog * night * (0.45 - i * 0.15));
    });
  }

  // ------------------------------------------------------------------ paths

  /** Applies the open/closed state of path edges; `initial` skips fades and announcements. */
  private syncPaths(initial: boolean): void {
    const { host, bus } = services(this);
    const open = host.openPaths(this.zoneId);
    const body = this.guardian.getBounds();
    let changed = false;
    for (const [id, edge] of this.paths) {
      const shouldOpen = open.has(id);
      if (shouldOpen === edge.open && !this.pendingClose.has(id)) continue;
      if (!shouldOpen) {
        // Never close a path on top of the guardian: wait until they step out.
        if (edge.areas.some((a) => overlaps(a, body))) {
          this.pendingClose.add(id);
          continue;
        }
        this.pendingClose.delete(id);
        for (const { x, y } of edge.tiles) this.blockers?.putTileAt(edge.gid, x, y);
        edge.alpha.value = initial ? 1 : 0;
      } else {
        this.pendingClose.delete(id);
        for (const { x, y } of edge.tiles) this.blockers?.removeTileAt(x, y);
      }
      if (edge.open !== shouldOpen) changed = true;
      edge.open = shouldOpen;
    }
    this.fadeBlockers(0);
    if (changed && !initial) {
      bus.emit('audio:caption', {
        kind: 'sound',
        textKey: 'caption.paths-shift',
        direction: 'center',
      });
      this.fx.shake(this.cameras.main, 350, 0.003);
    }
  }

  private fadeBlockers(dt: number): void {
    for (const edge of this.paths.values()) {
      if (edge.open || edge.alpha.value >= 1) continue;
      edge.alpha.value = Math.min(1, edge.alpha.value + dt / 0.8);
      for (const { x, y } of edge.tiles) {
        const tile = this.blockers?.getTileAt(x, y);
        if (tile) tile.alpha = edge.alpha.value;
      }
    }
  }

  // ------------------------------------------------------------------ exits

  private checkExits(): void {
    const body = this.guardian.body;
    if (!body) return;
    const rect = { x: body.x, y: body.y, width: body.width, height: body.height };
    const exit = this.exits.find((e) => overlaps(e.rect, rect));
    if (exit) this.leave(exit);
  }

  private leave(exit: ExitDef): void {
    const { host, bus } = services(this);
    this.leaving = true;
    this.guardian.setVelocity(0, 0);
    const result = host.dispatch({ type: 'enterZone', zone: exit.to });
    if (!result.ok) {
      this.leaving = false;
      return;
    }
    bus.emit('world:interaction', null);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ zone: exit.to, spawn: exit.spawn } satisfies WorldData);
    });
  }

  // ------------------------------------------------------------------ debug

  /** Debug console: adds lights around the guardian (60 fps budget check, light.md). */
  private addDebugLights(count: number): void {
    const defs: LightDef[] = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      const r = 48 + (i % 4) * 28;
      return {
        x: this.guardian.x + Math.cos(a) * r,
        y: this.guardian.y + Math.sin(a) * r,
        kind: i % 3 === 0 ? 'bonfire' : 'candle',
        radius: 64,
        color: i % 2 ? 0xffb060 : 0x9fd8ff,
        intensity: 1.2,
        night: false,
      };
    });
    this.lighting?.addDebugLights(defs);
  }
}

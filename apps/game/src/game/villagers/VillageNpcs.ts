/**
 * Villagers in the world scene (docs/systems/villagers.md → Presentation). Core decides where
 * each villager is and what they do; this class only walks their sprites there along A* paths,
 * picks animations, shows status bubbles, and plays the returned dead at night. It never changes
 * game state except by reporting a returned dead's touch (`encounterReturned`).
 */
import type { LocaleKey } from '@mrak/content';
import { TILE_SIZE, type Villager, type VillageRules } from '@mrak/content-schema';
import type { VillagerActivity, VillagerView } from '@mrak/core';
import spriteSvg from '@mrak/ui-kit/icons/sprite.svg?raw';
import type { IconName } from '@mrak/ui-kit';
import type * as Phaser from 'phaser';
import { t } from '../../i18n/t';
import { findPath, gridOf, nearestFree, simplify, type Grid, type Tile } from './pathfinding';
import { FRAME, FRAMES, stripPixels, type ArtVariant } from './villager-art';
import { bubbleIcon, INDOORS, slotOffsets } from './npc-logic';

export interface NpcHost {
  villagerActivities(): Record<string, VillagerActivity>;
  villagers(): VillagerView[];
  dispatch(command: { type: 'encounterReturned'; villager: string }): { ok: boolean };
}

export interface GuardianFrame {
  x: number;
  y: number;
  /** Lantern lit and its radius in pixels. */
  lanternPx: number;
  noise: number;
  reduceMotion: boolean;
  /** Low Sanity: idle villagers turn to face the guardian (docs/systems/sanity.md). */
  staring?: boolean;
}

export interface NpcCallbacks {
  /** A returned dead touched the guardian (after core accepted it). */
  onTouched(villager: Villager): void;
}

const WALK = 26;
const SICK_WALK = 16;
const RETURNED_WALK = 22;
const RETURNED_CHASE = 44;
const DEPTH = { npc: 9.9, bubble: 25, label: 26 } as const;
const SENSE_MS = 250;
/** Off-camera villagers: margin (px) and coarse step (ms) of the far simulation. */
const FAR_MARGIN = 64;
const FAR_STEP_MS = 250;
const CHASE_MS = 500;
const TOUCH_COOLDOWN_MS = 3000;

interface Npc {
  /** Time accumulated while off camera (far simulation). */
  farDt?: number;
  def: Villager;
  variant: ArtVariant;
  sprite: Phaser.GameObjects.Sprite;
  bubble: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  path: Tile[];
  /** Tile the villager is heading for (and where they stand when there). */
  goal: Tile | null;
  /** Goes inside when the goal is reached. */
  enters: boolean;
  inside: boolean;
  activity: VillagerActivity | null;
  view: VillagerView | null;
  iconName: IconName | null;
  lastChase: number;
  lastTouch: number;
  fleeUntil: number;
  wander: number;
  /** What a returned dead is doing (fleeing ends as soon as the light and the fright do). */
  mode: 'wander' | 'chase' | 'flee';
}

function iconSvg(name: IconName, color: string): string | null {
  const id = `mrak-${name.replace('.', '--')}`;
  // eslint-disable-next-line security/detect-non-literal-regexp -- id built from a typed IconName constant
  const match = new RegExp(`<symbol id="${id}" viewBox="([^"]+)">([\\s\\S]*?)</symbol>`).exec(
    spriteSvg,
  );
  if (!match) return null;
  const body = (match[2] ?? '').replaceAll('currentColor', color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${match[1] ?? '0 0 512 512'}" width="48" height="48">${body}</svg>`;
}

export class VillageNpcs {
  private readonly npcs = new Map<string, Npc>();
  private readonly places = new Map<string, Tile>();
  private readonly grid: Grid;
  private lastSense = -Infinity;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    villagers: readonly Villager[],
    private readonly rules: VillageRules,
    map: {
      cols: number;
      rows: number;
      solid: Uint8Array;
      pois: readonly { id: string; x: number; y: number }[];
    },
    closed: (x: number, y: number) => boolean,
    private readonly host: NpcHost,
    private readonly callbacks: NpcCallbacks,
    private readonly taskIcon: (task: string) => IconName | null,
  ) {
    this.grid = gridOf(map.cols, map.rows, map.solid, closed);
    for (const p of map.pois)
      this.places.set(p.id, { x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) });
    for (const v of villagers) this.makeTextures(v);
    for (const v of villagers) this.npcs.set(v.id, this.makeNpc(v));
    this.sense(0, null, true);
  }

  /**
   * Villagers standing outside (visible), with their position: whom the guardian can talk to or
   * photograph. `returned` includes the walking dead (the camera sees them; talk does not).
   */
  standing(returned = false): { id: string; nameKey: string; x: number; y: number }[] {
    const out: { id: string; nameKey: string; x: number; y: number }[] = [];
    for (const npc of this.npcs.values())
      if (!npc.inside && npc.sprite.visible && (returned || npc.variant === 'living'))
        out.push({ id: npc.def.id, nameKey: npc.def.nameKey, x: npc.sprite.x, y: npc.sprite.y });
    return out;
  }

  destroy(): void {
    this.destroyed = true;
    for (const npc of this.npcs.values()) {
      npc.sprite.destroy();
      npc.bubble.destroy();
      npc.label.destroy();
    }
    this.npcs.clear();
  }

  // ------------------------------------------------------------------ setup

  private textureKey(id: string, variant: ArtVariant): string {
    return `villager:${id}:${variant}`;
  }

  private makeTextures(v: Villager): void {
    for (const variant of ['living', 'returned'] as const) {
      const key = this.textureKey(v.id, variant);
      if (!this.scene.textures.exists(key)) {
        const strip = stripPixels(v.look, variant);
        const tex = this.scene.textures.createCanvas(key, strip.width, strip.height);
        if (!tex) continue;
        tex.context.putImageData(new ImageData(strip.data, strip.width, strip.height), 0, 0);
        tex.refresh();
        FRAMES.forEach((f, i) => tex.add(f, 0, i * FRAME, 0, FRAME, FRAME));
      }
      for (const [anim, frames, rate] of [
        ['walk', ['walk-1', 'walk-2'], 6],
        ['work', ['work-1', 'work-2'], 3],
      ] as const) {
        const animKey = `${key}:${anim}`;
        if (!this.scene.anims.exists(animKey))
          this.scene.anims.create({
            key: animKey,
            frames: frames.map((frame) => ({ key, frame })),
            frameRate: rate,
            repeat: -1,
          });
      }
    }
  }

  private iconTexture(name: IconName): string | null {
    const key = `icon:${name}`;
    if (this.scene.textures.exists(key)) return key;
    const svg = iconSvg(name, '#2a1d14');
    if (!svg) return null;
    const img = new Image();
    img.onload = () => {
      if (!this.destroyed && !this.scene.textures.exists(key))
        this.scene.textures.addImage(key, img);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return null;
  }

  private makeNpc(def: Villager): Npc {
    const scene = this.scene;
    const sprite = scene.add
      .sprite(0, 0, this.textureKey(def.id, 'living'), 'idle')
      .setOrigin(0.5, 0.85)
      .setDepth(DEPTH.npc)
      .setLighting(true)
      .setVisible(false);
    const bg = scene.add.graphics();
    bg.fillStyle(0xe8dcc0, 1).lineStyle(1, 0x2a1d14, 1);
    bg.fillRoundedRect(-7, -7, 14, 13, 3).strokeRoundedRect(-7, -7, 14, 13, 3);
    bg.fillTriangle(-2, 6, 2, 6, 0, 9);
    const icon = scene.add.image(0, -0.5, '__DEFAULT').setDisplaySize(10, 10);
    const bubble = scene.add.container(0, 0, [bg, icon]).setDepth(DEPTH.bubble).setVisible(false);
    const label = scene.add
      .text(0, 0, t(def.nameKey as LocaleKey), {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '8px',
        color: '#f3e9d2',
        stroke: '#120c08',
        strokeThickness: 2,
        resolution: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.label)
      .setVisible(false);
    return {
      def,
      variant: 'living',
      sprite,
      bubble,
      icon,
      label,
      path: [],
      goal: null,
      enters: false,
      inside: false,
      activity: null,
      view: null,
      iconName: null,
      lastChase: -Infinity,
      lastTouch: -Infinity,
      fleeUntil: -Infinity,
      wander: 0,
      mode: 'wander',
    };
  }

  // ------------------------------------------------------------------ frame

  update(time: number, dt: number, guardian: GuardianFrame): void {
    if (time - this.lastSense >= SENSE_MS) this.sense(time, guardian, false);
    // Far simulation (performance.md): off-camera villagers walk in coarse steps, unanimated.
    const view = this.scene.cameras.main.worldView;
    for (const npc of this.npcs.values()) {
      if (npc.variant === 'returned' && npc.sprite.visible) this.haunt(npc, time, guardian);
      const near =
        npc.sprite.x > view.x - FAR_MARGIN &&
        npc.sprite.x < view.right + FAR_MARGIN &&
        npc.sprite.y > view.y - FAR_MARGIN &&
        npc.sprite.y < view.bottom + FAR_MARGIN;
      if (near || npc.variant === 'returned') {
        npc.farDt = 0;
        this.walk(npc, dt);
        this.animate(npc, time, guardian);
        continue;
      }
      npc.farDt = (npc.farDt ?? 0) + dt;
      if (npc.farDt >= FAR_STEP_MS) {
        this.walk(npc, npc.farDt);
        npc.farDt = 0;
      }
    }
  }

  private tileOf(x: number, y: number): Tile {
    return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
  }

  private centre(t: Tile): { x: number; y: number } {
    return { x: t.x * TILE_SIZE + TILE_SIZE / 2, y: t.y * TILE_SIZE + TILE_SIZE / 2 + 4 };
  }

  /** Reads core: who is where, doing what; sets goals and paths. `snap` places them at once. */
  private sense(time: number, guardian: GuardianFrame | null, snap: boolean): void {
    this.lastSense = time;
    const activities = this.host.villagerActivities();
    const views = new Map(this.host.villagers().map((v) => [v.id, v]));
    const taken = new Set<string>();
    const order = [...this.npcs.values()].sort((a, b) => (a.def.id < b.def.id ? -1 : 1));
    for (const npc of order) {
      const activity = activities[npc.def.id] ?? null;
      npc.activity = activity;
      npc.view = views.get(npc.def.id) ?? null;
      const returned = activity?.activity === 'haunt';
      if (returned !== (npc.variant === 'returned'))
        this.setVariant(npc, returned ? 'returned' : 'living');
      if (!activity || activity.place === null) {
        this.vanish(npc);
        continue;
      }
      if (returned) {
        if (!npc.sprite.visible) this.appearAt(npc, this.places.get(activity.place) ?? null);
        continue;
      }
      const place = this.places.get(activity.place);
      if (!place) continue;
      const enters = INDOORS.has(activity.activity) && activity.place === npc.def.home;
      const goal = enters ? place : this.slotFor(place, taken);
      taken.add(`${String(goal.x)},${String(goal.y)}`);
      const changed = !npc.goal || npc.goal.x !== goal.x || npc.goal.y !== goal.y;
      npc.enters = enters;
      if (snap) {
        npc.goal = goal;
        this.appearAt(npc, goal);
        if (enters) this.goInside(npc);
        continue;
      }
      if (!changed) continue;
      npc.goal = goal;
      if (npc.inside) {
        // Steps out of the door and walks from there.
        if (enters) continue;
        this.appearAt(npc, this.places.get(npc.def.home) ?? goal);
      }
      if (!npc.sprite.visible) this.appearAt(npc, goal);
      this.route(npc, goal);
    }
    if (guardian) this.updateBubbles(guardian);
  }

  private slotFor(place: Tile, taken: ReadonlySet<string>): Tile {
    for (const [dx, dy] of slotOffsets) {
      const t = { x: place.x + dx, y: place.y + dy };
      if (!this.grid.blocked(t.x, t.y) && !taken.has(`${String(t.x)},${String(t.y)}`)) return t;
    }
    return nearestFree(this.grid, place) ?? place;
  }

  private route(npc: Npc, goal: Tile): void {
    const from = this.tileOf(npc.sprite.x, npc.sprite.y - 4);
    const path = findPath(this.grid, from, goal);
    npc.path = path ? simplify(path).slice(1) : [goal];
  }

  private appearAt(npc: Npc, tile: Tile | null): void {
    if (!tile) return;
    const free = nearestFree(this.grid, tile) ?? tile;
    const c = this.centre(free);
    npc.sprite.setPosition(c.x, c.y).setVisible(true);
    npc.inside = false;
    npc.path = [];
  }

  private goInside(npc: Npc): void {
    npc.inside = true;
    npc.sprite.setVisible(false);
    npc.bubble.setVisible(false);
    npc.label.setVisible(false);
    npc.path = [];
  }

  private vanish(npc: Npc): void {
    npc.goal = null;
    npc.path = [];
    npc.sprite.setVisible(false);
    npc.bubble.setVisible(false);
    npc.label.setVisible(false);
  }

  private setVariant(npc: Npc, variant: ArtVariant): void {
    npc.variant = variant;
    npc.sprite.setTexture(this.textureKey(npc.def.id, variant), 'idle');
    npc.sprite.setAlpha(variant === 'returned' ? 0.92 : 1);
    npc.label.setColor(variant === 'returned' ? '#e06a5a' : '#f3e9d2');
    npc.sprite.setVisible(false);
    npc.goal = null;
    npc.path = [];
  }

  private walk(npc: Npc, dt: number): void {
    if (!npc.sprite.visible) return;
    const next = npc.path[0];
    if (!next) {
      if (npc.enters && npc.goal && !npc.inside && npc.variant === 'living') this.goInside(npc);
      return;
    }
    const target = this.centre(next);
    const dx = target.x - npc.sprite.x;
    const dy = target.y - npc.sprite.y;
    const d = Math.hypot(dx, dy);
    const speed =
      npc.variant === 'returned'
        ? npc.lastChase > 0
          ? RETURNED_CHASE
          : RETURNED_WALK
        : npc.view?.status === 'sick'
          ? SICK_WALK
          : npc.activity?.activity === 'sleepwalk'
            ? SICK_WALK
            : WALK;
    const step = speed * dt;
    if (d <= step) {
      npc.sprite.setPosition(target.x, target.y);
      npc.path.shift();
    } else {
      npc.sprite.setPosition(npc.sprite.x + (dx / d) * step, npc.sprite.y + (dy / d) * step);
    }
    if (Math.abs(dx) > 0.5) npc.sprite.setFlipX(dx < 0);
  }

  private animate(npc: Npc, time: number, guardian: GuardianFrame): void {
    const s = npc.sprite;
    if (!s.visible) return;
    const key = this.textureKey(npc.def.id, npc.variant);
    const moving = npc.path.length > 0;
    const act = npc.activity?.activity;
    const terrified = npc.view?.status === 'terrified';
    if (moving) s.anims.play(`${key}:walk`, true);
    else if (act === 'task' || act === 'work' || act === 'chores')
      s.anims.play(`${key}:work`, true);
    else {
      s.anims.stop();
      s.setFrame(terrified ? 'cower' : 'idle');
      if (guardian.staring === true && npc.variant === 'living') s.setFlipX(guardian.x < s.x);
    }
    s.setTint(npc.view?.status === 'sick' ? 0xc8dcb0 : 0xffffff);
    // The terrified tremble (not with reduced motion).
    const jitter = terrified && !moving && !guardian.reduceMotion ? Math.sin(time / 30) * 0.6 : 0;
    s.setDisplayOrigin(FRAME / 2 + jitter, FRAME * 0.85);
    npc.bubble.setPosition(Math.round(s.x), Math.round(s.y - 20));
    npc.label.setPosition(Math.round(s.x), Math.round(s.y - (npc.bubble.visible ? 29 : 16)));
  }

  private updateBubbles(guardian: GuardianFrame): void {
    for (const npc of this.npcs.values()) {
      const visible = npc.sprite.visible;
      const d = Math.hypot(npc.sprite.x - guardian.x, npc.sprite.y - guardian.y) / TILE_SIZE;
      const name =
        npc.view && npc.activity ? bubbleIcon(npc.view, npc.activity, d, this.taskIcon) : null;
      const tex = name ? this.iconTexture(name) : null;
      if (tex && name !== npc.iconName) {
        npc.icon.setTexture(tex).setDisplaySize(10, 10);
        npc.iconName = name;
      }
      npc.bubble.setVisible(visible && tex !== null && npc.variant === 'living');
      npc.label.setVisible(visible && d <= (npc.variant === 'returned' ? 5 : 2.5));
    }
  }

  // ------------------------------------------------------------------ the returned

  /** A returned dead: wanders by its grave, follows noise, shies from the lantern, touches. */
  private haunt(npc: Npc, time: number, g: GuardianFrame): void {
    const s = npc.sprite;
    const d = Math.hypot(s.x - g.x, s.y - g.y);
    const grave = this.places.get(this.rules.death.grave);
    if (d < TILE_SIZE && time - npc.lastTouch > TOUCH_COOLDOWN_MS) {
      npc.lastTouch = time;
      npc.fleeUntil = time + TOUCH_COOLDOWN_MS;
      if (this.host.dispatch({ type: 'encounterReturned', villager: npc.def.id }).ok)
        this.callbacks.onTouched(npc.def);
    }
    const lit = g.lanternPx > 0 && d < g.lanternPx * 0.9;
    if (time < npc.fleeUntil || lit) {
      // Fire and the lantern keep it at bay (bestiary: vampir fears fire): it backs off to just
      // beyond the light and lingers there.
      if (npc.mode !== 'flee' || npc.path.length === 0) {
        npc.mode = 'flee';
        npc.lastChase = 0;
        const keep = Math.max(g.lanternPx, 3 * TILE_SIZE) + 2 * TILE_SIZE;
        const ux = d > 0 ? (s.x - g.x) / d : 1;
        const uy = d > 0 ? (s.y - g.y) / d : 0;
        const away = this.tileOf(g.x + ux * keep, g.y + uy * keep);
        npc.path = [away].flatMap((t) => nearestFree(this.grid, t) ?? []);
      }
      return;
    }
    if (npc.mode === 'flee') {
      npc.mode = 'wander';
      npc.path = [];
    }
    const hunts = d < 7 * TILE_SIZE && (g.noise >= 2 || d < 4 * TILE_SIZE);
    if (hunts && time - npc.lastChase > CHASE_MS) {
      npc.mode = 'chase';
      npc.lastChase = time;
      const path = findPath(this.grid, this.tileOf(s.x, s.y - 4), this.tileOf(g.x, g.y), 1500);
      npc.path = path ? simplify(path).slice(1) : [];
      return;
    }
    if (!hunts && npc.mode === 'chase') {
      npc.mode = 'wander';
      npc.path = [];
    }
    if (!hunts && npc.path.length === 0 && grave) {
      npc.lastChase = 0;
      npc.wander = (npc.wander + 1) % slotOffsets.length;
      const [dx, dy] = slotOffsets[npc.wander] ?? [0, 0];
      const goal = { x: grave.x + dx * 2, y: grave.y + dy * 2 };
      const path = findPath(this.grid, this.tileOf(s.x, s.y - 4), goal, 800);
      npc.path = path ? simplify(path).slice(1) : [];
    }
  }
}

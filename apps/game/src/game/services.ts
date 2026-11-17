/**
 * Per-game services handed to scenes through the Phaser registry (instance-scoped, not global).
 */
import type * as Phaser from 'phaser';
import type { AssetService } from '../assets/AssetService';
import type { TypedEventBus } from '../events/EventBus';
import type { GameHost } from '../host/GameHost';
import type { UiStore } from '../state/ui-store';

export interface Services {
  host: GameHost;
  bus: TypedEventBus;
  assets: AssetService;
  store: UiStore;
}

const KEY = 'services';

export function provideServices(game: Phaser.Game, services: Services): void {
  game.registry.set(KEY, services);
}

export function services(scene: Phaser.Scene): Services {
  const value = scene.registry.get(KEY) as Services | undefined;
  if (!value) throw new Error('services missing from the registry');
  return value;
}

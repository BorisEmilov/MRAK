import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from './EventBus';

describe('TypedEventBus', () => {
  it('delivers payloads to subscribers', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    bus.on('load:progress', handler);
    bus.emit('load:progress', { progress: 0.5 });
    expect(handler).toHaveBeenCalledWith({ progress: 0.5 });
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    const off = bus.on('load:progress', handler);
    off();
    bus.emit('load:progress', { progress: 0.5 });
    expect(handler).not.toHaveBeenCalled();
  });
});

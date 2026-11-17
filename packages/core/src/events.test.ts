import { describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from './events';

describe('EventBus', () => {
  it('delivers typed payloads to subscribers of that type only', () => {
    const bus = new EventBus<CoreEventMap>();
    const onFlag = vi.fn();
    const onStat = vi.fn();
    bus.on('state/flagSet', onFlag);
    bus.on('state/statChanged', onStat);
    bus.emit('state/flagSet', { flag: 'a' });
    expect(onFlag).toHaveBeenCalledWith({ flag: 'a' });
    expect(onStat).not.toHaveBeenCalled();
  });

  it('supports unsubscribe and catch-all listeners', () => {
    const bus = new EventBus<CoreEventMap>();
    const handler = vi.fn();
    const any = vi.fn();
    const off = bus.on('time/midnight', handler);
    bus.onAny(any);
    off();
    bus.emit('time/midnight', { day: 1, minute: 0 });
    expect(handler).not.toHaveBeenCalled();
    expect(any).toHaveBeenCalledWith({ type: 'time/midnight', payload: { day: 1, minute: 0 } });
  });

  it('is an instance, not a global: two buses do not share listeners', () => {
    const a = new EventBus<CoreEventMap>();
    const b = new EventBus<CoreEventMap>();
    const handler = vi.fn();
    a.on('state/flagSet', handler);
    b.emit('state/flagSet', { flag: 'x' });
    expect(handler).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { DbClient } from './client';
import { closeDbClient, createLazyDbClient } from './client';

describe('lazy database client', () => {
  it('does not open the database until a query surface is accessed', () => {
    const factory = vi.fn<() => DbClient>(() => {
      throw new Error('unable to open /private/app.db');
    });

    const client = createLazyDbClient(factory);

    expect(factory).not.toHaveBeenCalled();
    expect(() => client.all('SELECT 1')).toThrow('unable to open');
    expect(factory).toHaveBeenCalledOnce();
  });

  it('closes an initialized lazy database without opening an unused one', () => {
    const close = vi.fn();
    const first = createLazyDbClient(() => ({ $client: { close } }) as unknown as DbClient);
    closeDbClient(first);
    expect(close).not.toHaveBeenCalled();

    void (first as unknown as { $client: unknown }).$client;
    closeDbClient(first);
    expect(close).toHaveBeenCalledOnce();
  });
});

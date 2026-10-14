import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGatewayBackendPath } from './gateway-paths';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getGatewayBackendPath', () => {
  it('mounts the backend under /backend by default', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', undefined);
    expect(getGatewayBackendPath()).toBe('/backend');
  });

  it('normalizes a configured prefix like the other mounts', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', 'sync');
    expect(getGatewayBackendPath()).toBe('/sync');
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', '/sync/');
    expect(getGatewayBackendPath()).toBe('/sync');
  });

  it('keeps the root as the root', () => {
    vi.stubEnv('NEXT_PUBLIC_GATEWAY_BACKEND_PATH', '/');
    expect(getGatewayBackendPath()).toBe('/');
  });
});

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { mswServer } from './msw/server';
import { resetBridgeRequestLog } from './msw/handlers';

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  mswServer.resetHandlers();
  resetBridgeRequestLog();
});

afterAll(() => {
  mswServer.close();
});


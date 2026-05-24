import { setupServer } from 'msw/node';
import { bridgeHandlers } from './handlers';

export const mswServer = setupServer(...bridgeHandlers);


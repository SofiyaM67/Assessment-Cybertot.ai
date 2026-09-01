import { Store } from '../store.js';
import { RewardBankService } from '../service.js';
import { addMinutes } from '../utils.js';

export function createTestContext(initialBalance = 0) {
  const store = new Store();
  const service = new RewardBankService(store);
  const parent = store.createParent('Test Parent');
  const child = store.createChild(parent.id, 'Test Child', initialBalance);
  return { store, service, parent, child };
}

export function isoAt(base: string, offsetMinutes: number): string {
  return addMinutes(base, offsetMinutes);
}

export const BASE_TIME = '2026-09-01T08:00:00.000Z';

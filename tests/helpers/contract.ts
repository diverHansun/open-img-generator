import { createTestDb } from './db';

export function setupContractTest() {
  const { db } = createTestDb();
  return { db };
}

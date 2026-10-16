import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = (name) => readFileSync(path.join(root, 'test', 'fixtures', name), 'utf8');

export const A = { id: '200000001', name: 'Test Climber A' };
export const B = { id: '200000002', name: 'Test Climber B' };

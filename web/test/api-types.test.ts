import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const body = (url: URL): string => readFileSync(url, 'utf8').replace(/\r\n/g, '\n').split('\n').slice(1).join('\n');

test('web/src/app/api-types.ts is the same as server/src/types.ts (except the first comment line)', () => {
  assert.equal(
    body(new URL('../src/app/api-types.ts', import.meta.url)),
    body(new URL('../../server/src/types.ts', import.meta.url)),
  );
});

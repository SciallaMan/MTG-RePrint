import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gathererSetCode, scryfallSetCode } from '../src/setcodes.ts';

test('set codes: Scryfall <-> Gatherer for the old sets, unchanged for the others', () => {
  assert.equal(gathererSetCode('inv'), 'IN');
  assert.equal(gathererSetCode('lea'), '1E');
  assert.equal(gathererSetCode('neo'), 'NEO');
  assert.equal(scryfallSetCode('IN'), 'inv');
  assert.equal(scryfallSetCode('2u'), '2ed');
  assert.equal(scryfallSetCode('INV'), 'inv');
  assert.equal(scryfallSetCode('NEO'), 'neo');
});

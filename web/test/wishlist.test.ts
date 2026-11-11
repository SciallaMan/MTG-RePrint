import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addEntries, pinsOf, toDecklist } from '../src/app/wishlist.ts';

const ID1 = '11111111-1111-1111-1111-111111111111';
const ID2 = '22222222-2222-2222-2222-222222222222';

test('a saved list becomes decklist text; quantity 0 lines are left out', () => {
  assert.equal(
    toDecklist([
      { qty: 2, name: 'Fable of the Mirror-Breaker', setCode: 'neo', number: '141' },
      { qty: 1, name: 'Eluge, the Shoreless Sea', setCode: null, number: '49' },
      { qty: 1, name: 'Ponder', setCode: 'm12', number: null },
      { qty: 0, name: 'Island', setCode: null, number: null },
      { qty: 4, name: 'Lightning Bolt', setCode: null, number: null, printId: ID1 },
      { qty: 2, name: 'Cayth, Famed Mechanist', setCode: 'm3c', number: '6', printId: 'gatherer:M3C/it-it/6/cayth-famed-mechanist' },
    ]),
    '2 Fable of the Mirror-Breaker (NEO) 141\n1 Eluge, the Shoreless Sea #49\n1 Ponder (M12)\n4 Lightning Bolt\n' +
      '2 https://gatherer.wizards.com/M3C/it-it/6/cayth-famed-mechanist',
  );
});

test('pins are keyed by lower-case name; the first print of a name wins', () => {
  assert.deepEqual(
    pinsOf([
      { qty: 1, name: 'Lightning Bolt', setCode: null, number: null, printId: ID1 },
      { qty: 1, name: 'lightning bolt', setCode: null, number: null, printId: ID2 },
      { qty: 1, name: 'Ponder', setCode: null, number: null },
    ]),
    { 'lightning bolt': ID1 },
  );
});

test('added cards go at the top, in their order; the same card again raises its quantity', () => {
  const result = addEntries(
    [
      { qty: 2, name: 'Lightning Bolt', setCode: null, number: null, printId: ID1 },
      { qty: 1, name: 'Ponder', setCode: 'm12', number: null },
    ],
    [
      { qty: 3, name: 'lightning bolt', setCode: null, number: null },
      { qty: 1, name: 'Ponder', setCode: null, number: null },
      { qty: 1, name: 'Counterspell', setCode: 'mh2', number: '267' },
      { qty: 98, name: 'Ponder', setCode: 'M12', number: null },
      { qty: 2, name: 'ponder', setCode: null, number: null },
    ],
  );
  assert.deepEqual(result, {
    added: [
      { qty: 3, name: 'Ponder', setCode: null, number: null },
      { qty: 1, name: 'Counterspell', setCode: 'mh2', number: '267' },
    ],
    entries: [
      { qty: 5, name: 'Lightning Bolt', setCode: null, number: null, printId: ID1 },
      { qty: 99, name: 'Ponder', setCode: 'm12', number: null },
    ],
    target: [-1, 0, 1, -1, -1],
  });
});

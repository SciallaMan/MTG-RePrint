import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDecklist } from '../src/decklist.ts';

test('quantities, sets, numbers and comments', () => {
  const entries = parseDecklist(
    [
      '﻿4 Lightning Bolt',
      '2x Counterspell',
      '1 Fable of the Mirror-Breaker (NEO) 141',
      '1 Counterspell (MH2)',
      '1 Eluge, the Shoreless Sea #49',
      '// a comment',
      'Sideboard',
      'SB: 2 Negate',
      'Island',
    ].join('\r\n'),
  );
  assert.deepEqual(entries, [
    { qty: 4, name: 'Lightning Bolt', setCode: null, number: null },
    { qty: 2, name: 'Counterspell', setCode: null, number: null },
    { qty: 1, name: 'Fable of the Mirror-Breaker', setCode: 'neo', number: '141' },
    { qty: 1, name: 'Counterspell', setCode: 'mh2', number: null },
    { qty: 1, name: 'Eluge, the Shoreless Sea', setCode: null, number: '49' },
    { qty: 2, name: 'Negate', setCode: null, number: null },
    { qty: 1, name: 'Island', setCode: null, number: null },
  ]);
});

test('foil markers are ignored', () => {
  assert.deepEqual(parseDecklist('1 Sol Ring (C21) 263 *F*'), [
    { qty: 1, name: 'Sol Ring', setCode: 'c21', number: '263' },
  ]);
});

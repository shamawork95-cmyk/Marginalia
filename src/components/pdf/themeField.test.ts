/**
 * Run with: npx tsx --test src/components/pdf/themeField.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitOpenThemeField, registerThemeField } from './themeField';

test('no field open: nothing is created', () => {
  assert.equal(commitOpenThemeField(), null);
});

test('an open field with a name creates its theme once it is committed', () => {
  let name = 'Light';
  const made: string[] = [];
  const close = registerThemeField(() => {
    if (!name.trim()) return null;
    made.push(name);
    return { id: 't-light', color: '#e06d53' };
  });
  assert.deepEqual(commitOpenThemeField(), { id: 't-light', color: '#e06d53' });
  name = '';
  assert.equal(commitOpenThemeField(), null);
  assert.deepEqual(made, ['Light']);
  close();
  assert.equal(commitOpenThemeField(), null);
});

test('closing an old field never unregisters a newer one', () => {
  const closeOld = registerThemeField(() => ({ id: 'old', color: '#000000' }));
  const closeNew = registerThemeField(() => ({ id: 'new', color: '#ffffff' }));
  closeOld();
  assert.equal(commitOpenThemeField()?.id, 'new');
  closeNew();
});

import {
  pluralise,
  setPluralForm,
  setPluralForms,
  toCamelCase,
  toPascalCase,
  config,
  clone,
  deepCopy,
  datetimeToString,
  dateToString,
  timeToString
} from '../src/utils';

test('pluralise', () => {
  expect(pluralise('category')).toBe('categories');
  expect(pluralise('hierarchy')).toBe('hierarchies');
  expect(pluralise('property')).toBe('properties');
  expect(pluralise('guy')).toBe('guys');
  expect(pluralise('child')).toBe('children');
  expect(pluralise('equipmentChild')).toBe('equipmentChildren');
  expect(pluralise('class')).toBe('classes');
  expect(pluralise('property')).toBe('properties');
});

test.each([clone, deepCopy])('copies dates without converting them to strings', copy => {
  const source = {
    createdAt: new Date('2024-01-02T03:04:05.000Z'),
    nested: [{ value: 1 }],
  };
  const result = copy(source);

  expect(result).not.toBe(source);
  expect(result.createdAt).toBeInstanceOf(Date);
  expect(result.createdAt).not.toBe(source.createdAt);
  expect(result.createdAt.getTime()).toBe(source.createdAt.getTime());
  expect(result.nested).not.toBe(source.nested);
});

test('customise plural forms', () => {
  expect(pluralise('foot')).toBe('foots');
  setPluralForm('foot', 'feet');
  expect(pluralise('totalFoot')).toBe('totalFeet');
  expect(pluralise('special_equipment')).toBe('special_equipments');
  setPluralForms({ tooth: 'teeth', equipment: 'equipment' });
  expect(pluralise('blueTooth')).toBe('blueTeeth');
  expect(pluralise('special_equipment')).toBe('special_equipment');
});

test('pluralise - java', () => {
  config.style = 'java';
  config.plural['foo'] = 'fooSet';
  expect(pluralise('foo')).toBe('fooSet');
  expect(pluralise('bar')).toBe('barList');
});

test('camel/pascal cases', () => {
  expect(toCamelCase('special_equipment')).toBe('specialEquipment');
  expect(toPascalCase('special_equipment')).toBe('SpecialEquipment');
});

test('date/time to strings', () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Australia/Adelaide') {
    const d = new Date('2022-07-09T02:17:09.175Z');
    expect(datetimeToString(d)).toBe('2022-07-09T11:47:09.175+09:30');
    expect(datetimeToString(d, true)).toBe('2022-07-09T02:17:09.175+00:00');
    expect(dateToString(d)).toBe('2022-07-09');
    expect(timeToString(d)).toBe('11:47:09.175+09:30');
    expect(timeToString(d, true)).toBe('02:17:09.175+00:00');
  }
});

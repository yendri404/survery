import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, parseSurveyInput, toCsv, validateAnswers } from '../src/surveys.js';

const form = (pairs) => new URLSearchParams(pairs);

test('parseSurveyInput normalizes fields and keeps valid ids', () => {
  const { value, errors } = parseSurveyInput({
    title: '  Team survey ',
    description: '',
    fieldsJson: JSON.stringify([
      { id: 'abcd1234', label: ' Name ', type: 'text', required: true },
      { label: 'Area', type: 'radio', options: ['IT', ' HR ', 'IT', ''] },
    ]),
  });
  assert.deepEqual(errors, []);
  assert.equal(value.title, 'Team survey');
  assert.equal(value.fields[0].id, 'abcd1234');
  assert.equal(value.fields[0].label, 'Name');
  assert.equal(value.fields[0].required, true);
  assert.deepEqual(value.fields[1].options, ['IT', 'HR']);
  assert.match(value.fields[1].id, /^[a-z0-9]{12}$/);
});

test('parseSurveyInput reports missing title, no fields, bad types and empty options', () => {
  assert.deepEqual(parseSurveyInput({ title: '', fieldsJson: '[]' }).errors, ['Title is required.', 'Add at least one field.']);
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson: 'not json' }).errors, ['Fields data is invalid.']);
  const { errors } = parseSurveyInput({
    title: 'x',
    fieldsJson: JSON.stringify([{ label: '', type: 'nope' }, { label: 'Pick', type: 'select', options: [] }]),
  });
  assert.deepEqual(errors, [
    'Field 1: question text is required.',
    'Field 1: unknown field type.',
    'Field 2: add at least one option.',
  ]);
});

test('parseSurveyInput regenerates duplicate ids', () => {
  const { value } = parseSurveyInput({
    title: 'x',
    fieldsJson: JSON.stringify([{ id: 'aaaa1111', label: 'A', type: 'text' }, { id: 'aaaa1111', label: 'B', type: 'text' }]),
  });
  assert.notEqual(value.fields[0].id, value.fields[1].id);
});

const fields = [
  { id: 'name0001', label: 'Name', type: 'text', required: true, options: [] },
  { id: 'age00001', label: 'Age', type: 'number', required: false, options: [] },
  { id: 'mail0001', label: 'Email', type: 'email', required: false, options: [] },
  { id: 'date0001', label: 'Date', type: 'date', required: false, options: [] },
  { id: 'area0001', label: 'Area', type: 'radio', required: true, options: ['IT', 'HR'] },
  { id: 'tool0001', label: 'Tools', type: 'checkbox', required: true, options: ['A', 'B', 'C'] },
];

test('validateAnswers accepts a valid submission and orders checkbox values', () => {
  const { answers, errors } = validateAnswers(fields, form([
    ['f_name0001', ' Ana '], ['f_age00001', '30'], ['f_mail0001', 'ana@corp.local'],
    ['f_date0001', '2026-02-28'], ['f_area0001', 'IT'], ['f_tool0001', 'C'], ['f_tool0001', 'A'],
  ]));
  assert.deepEqual(errors, {});
  assert.deepEqual(answers, {
    name0001: 'Ana', age00001: '30', mail0001: 'ana@corp.local', date0001: '2026-02-28', area0001: 'IT', tool0001: ['A', 'C'],
  });
});

test('validateAnswers rejects missing required and invalid values', () => {
  const { errors } = validateAnswers(fields, form([
    ['f_age00001', 'abc'], ['f_mail0001', 'nope'], ['f_date0001', '2026-02-30'], ['f_area0001', 'Sales'], ['f_tool0001', 'Z'],
  ]));
  assert.deepEqual(errors, {
    name0001: 'This field is required.',
    age00001: 'Enter a valid number.',
    mail0001: 'Enter a valid email address.',
    date0001: 'Enter a valid date (YYYY-MM-DD).',
    area0001: 'Invalid option selected.',
    tool0001: 'Invalid option selected.',
  });
});

test('csvCell escapes delimiters/quotes and neutralizes formulas but not negative numbers', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('-5'), '-5');
  assert.equal(csvCell(['x', 'y']), '"x, y"');
  assert.equal(csvCell('a;b', ';'), '"a;b"');
});

test('toCsv writes header and rows in submission order', () => {
  const csv = toCsv(fields.slice(0, 1), [
    { id: 2, submittedAt: '2026-01-02 00:00:00', answers: { name0001: 'Bo' } },
    { id: 1, submittedAt: '2026-01-01 00:00:00', answers: { name0001: 'Ana' } },
  ]);
  assert.equal(csv, 'Response ID,Submitted at (UTC),Name\r\n1,2026-01-01 00:00:00,Ana\r\n2,2026-01-02 00:00:00,Bo\r\n');
});

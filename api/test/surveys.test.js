import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createI18n } from '../src/i18n.js';
import {
  FIELD_TYPE_IDS, addDays, csvCell, localDateString, parseSurveyInput, summarize, surveyStatus, toCsv, validateAnswers,
} from '../src/surveys.js';

const form = (pairs) => new URLSearchParams(pairs);

test('parseSurveyInput normalizes fields and keeps valid ids', () => {
  const { value, errors } = parseSurveyInput({
    title: '  Team survey ',
    description: '',
    fieldsJson: JSON.stringify([
      { id: 'abcd1234', label: ' Name ', type: 'text', required: true },
      { label: 'Area', type: 'radio', options: ['IT', ' HR ', ''] },
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

test('parseSurveyInput rejects repeated options and repeated questions, ignoring case and spaces', () => {
  const { errors } = parseSurveyInput({
    title: 'x',
    fieldsJson: JSON.stringify([
      { label: 'Area', type: 'radio', options: ['IT', ' HR ', 'it', '', 'Ops'] },
      { label: 'Tools', type: 'checkbox', options: 'Mail\nChat\n MAIL \nchat' },
      { label: ' area ', type: 'text' },
      { label: 'Other', type: 'select', options: ['A', 'B'] },
    ]),
  });
  assert.deepEqual(errors, [
    'Field 1: the option "IT" is repeated. Each option must be different.',
    'Field 2: the option "Mail" is repeated. Each option must be different.',
    'Field 2: the option "Chat" is repeated. Each option must be different.',
    'Fields 1 and 3 ask the same question. Each question must be different.',
  ]);
  // Blank lines are still ignored without an error.
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson: JSON.stringify([{ label: 'Q', type: 'radio', options: ['A', '', ' ', 'B'] }]) }).errors, []);
});

test('parseSurveyInput defaults the closing date to 10 days from today and validates it', () => {
  const fieldsJson = JSON.stringify([{ label: 'Q', type: 'text' }]);
  const today = '2026-11-16';
  assert.equal(parseSurveyInput({ title: 'x', fieldsJson }, { today }).value.closesOn, '2026-11-26');
  assert.equal(parseSurveyInput({ title: 'x', fieldsJson, closesOn: '' }, { today }).value.closesOn, '2026-11-26');
  assert.equal(parseSurveyInput({ title: 'x', fieldsJson, closesOn: '2026-12-31' }, { today }).value.closesOn, '2026-12-31');
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson, closesOn: today }, { today }).errors, []);
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson, closesOn: '2026-02-30' }, { today }).errors, ['Choose a valid closing date.']);
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson, closesOn: '2026-11-15' }, { today }).errors, ['The closing date cannot be in the past.']);
  // Editing an expired survey without touching its date is allowed.
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson, closesOn: '2026-11-15' }, { today, currentClosesOn: '2026-11-15' }).errors, []);
});

test('surveyStatus combines the manual switch and the closing date', () => {
  assert.equal(surveyStatus({ isOpen: true, closesOn: '2026-11-16' }, '2026-11-16'), 'open');
  assert.equal(surveyStatus({ isOpen: true, closesOn: '2026-11-15' }, '2026-11-16'), 'expired');
  assert.equal(surveyStatus({ isOpen: false, closesOn: '2026-11-30' }, '2026-11-16'), 'closed');
  assert.equal(surveyStatus({ isOpen: false, closesOn: '2026-11-01' }, '2026-11-16'), 'closed');
});

test('addDays and localDateString work on calendar dates', () => {
  assert.equal(addDays('2026-12-28', 10), '2027-01-07');
  assert.equal(addDays('2028-02-25', 10), '2028-03-06');
  assert.equal(localDateString(new Date(2026, 10, 16, 23, 59)), '2026-11-16');
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

test('toCsv writes header and rows in submission order, numbered per survey', () => {
  // ids are app-wide; the first column is the per-survey number.
  const csv = toCsv(fields.slice(0, 1), [
    { id: 12, number: 2, submittedAt: '2026-01-02 00:00:00', respondentName: 'Bo B.', answers: { name0001: 'Bo' } },
    { id: 11, number: 1, submittedAt: '2026-01-01 00:00:00', respondentName: null, answers: { name0001: 'Ana' } },
  ]);
  assert.equal(csv, 'Response ID,Submitted at (UTC),Name,Name\r\n1,2026-01-01 00:00:00,,Ana\r\n2,2026-01-02 00:00:00,Bo B.,Bo\r\n');
});

test('yes/no questions need no options and accept only yes or no', () => {
  assert.ok(FIELD_TYPE_IDS.includes('yesno'));
  const { value, errors } = parseSurveyInput({
    title: 'x',
    fieldsJson: JSON.stringify([{ label: 'Remote?', type: 'yesno', required: true, options: ['Maybe'] }]),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.fields[0].options, []);

  const yesno = [{ id: 'yn000001', label: 'Remote?', type: 'yesno', required: true, options: [] }];
  assert.deepEqual(validateAnswers(yesno, form([['f_yn000001', 'yes']])), { answers: { yn000001: 'yes' }, errors: {} });
  assert.deepEqual(validateAnswers(yesno, form([['f_yn000001', 'no']])).errors, {});
  assert.deepEqual(validateAnswers(yesno, form([['f_yn000001', 'Yes']])).errors, { yn000001: 'Invalid option selected.' });
  assert.deepEqual(validateAnswers(yesno, form([])).errors, { yn000001: 'This field is required.' });
  assert.deepEqual(validateAnswers([{ ...yesno[0], required: false }], form([])).errors, {});
});

test('yes/no answers are counted as two options and exported in the creator language', () => {
  const yesno = [{ id: 'yn000001', label: 'Remote?', type: 'yesno', required: false, options: [] }];
  const responses = [
    { id: 1, number: 1, submittedAt: '2026-01-01 00:00:00', respondentName: null, answers: { yn000001: 'yes' } },
    { id: 2, number: 2, submittedAt: '2026-01-02 00:00:00', respondentName: null, answers: { yn000001: 'no' } },
    { id: 3, number: 3, submittedAt: '2026-01-03 00:00:00', respondentName: null, answers: { yn000001: 'yes' } },
  ];
  const [summary] = summarize(yesno, responses, { t: createI18n('es').t });
  assert.equal(summary.answered, 3);
  assert.deepEqual(summary.counts, [{ option: 'yes', label: 'Sí', count: 2 }, { option: 'no', label: 'No', count: 1 }]);
  assert.match(toCsv(yesno, responses), /\r\n1,2026-01-01 00:00:00,,Yes\r\n2,2026-01-02 00:00:00,,No\r\n/);
  assert.match(toCsv(yesno, responses, ',', { t: createI18n('es').t }), /\r\n1,2026-01-01 00:00:00,,Sí\r\n/);
});

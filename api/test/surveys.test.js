import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createI18n } from '../src/i18n.js';
import {
  FIELD_TYPE_IDS, SCALE, addDays, csvCell, localDateString, parseSurveyInput, summarize, surveyStatus, toCsv, validateAnswers,
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
  assert.equal(csv, 'Response #,Submitted at (UTC),Name,Name\r\n1,2026-01-01 00:00:00,,Ana\r\n2,2026-01-02 00:00:00,Bo B.,Bo\r\n');
});

test('toCsv shows submission times in a time zone when given one', () => {
  const rows = [{ id: 1, number: 1, submittedAt: '2026-01-01 00:00:00', respondentName: null, answers: { name0001: 'Ana' } }];
  // Stored times are UTC; Caracas is UTC-4 (the day before), Kolkata UTC+5:30.
  assert.equal(toCsv(fields.slice(0, 1), rows, ',', { timeZone: 'America/Caracas' }),
    'Response #,Submitted at (America/Caracas),Name,Name\r\n1,2025-12-31 20:00:00,,Ana\r\n');
  assert.match(toCsv(fields.slice(0, 1), rows, ',', { timeZone: 'Asia/Kolkata' }), /\r\n1,2026-01-01 05:30:00,,Ana\r\n$/);
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

const scaleInput = (fields) => parseSurveyInput({ title: 'x', fieldsJson: JSON.stringify(fields) });

test('scale questions default to 1-10, keep integer limits and other types carry no min/max', () => {
  assert.ok(FIELD_TYPE_IDS.includes('scale'));
  assert.deepEqual(SCALE, { defaultMin: 1, defaultMax: 10, lowest: -1000, highest: 1000, maxSteps: 100 });
  const { value, errors } = scaleInput([
    { label: 'Default', type: 'scale', options: ['x'] },
    { label: 'Mood', type: 'scale', min: 1, max: 5 },
    { label: 'Text limits', type: 'scale', min: '-3', max: ' 3 ' },
    { label: 'Name', type: 'text', min: 1, max: 5 },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(value.fields.map(({ type, min, max, options }) => ({ type, min, max, options })), [
    { type: 'scale', min: 1, max: 10, options: [] },
    { type: 'scale', min: 1, max: 5, options: [] },
    { type: 'scale', min: -3, max: 3, options: [] },
    { type: 'text', min: undefined, max: undefined, options: [] },
  ]);
  assert.ok(!('min' in value.fields[3]) && !('max' in value.fields[3]));
});

test('scale limits must be whole numbers in bounds, ordered, and at most 100 steps apart', () => {
  const codes = (fields) => parseSurveyInput({ title: 'x', fieldsJson: JSON.stringify(fields) }, { t: (key, params) => [key, params] }).errors;
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: 1.5, max: 5 }]), [['validation.scaleBoundInvalid', { n: 1, lowest: -1000, highest: 1000 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: 1, max: 'ten' }]), [['validation.scaleBoundInvalid', { n: 1, lowest: -1000, highest: 1000 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: -1001, max: 0 }]), [['validation.scaleBoundInvalid', { n: 1, lowest: -1000, highest: 1000 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: 5, max: 5 }]), [['validation.scaleOrder', { n: 1 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: 10, max: 1 }]), [['validation.scaleOrder', { n: 1 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: 0, max: 101 }]), [['validation.scaleTooWide', { n: 1, maxSteps: 100 }]]);
  assert.deepEqual(codes([{ label: 'A', type: 'scale', min: -50, max: 50 }]), []);
  assert.deepEqual(parseSurveyInput({ title: 'x', fieldsJson: JSON.stringify([{ label: 'A', type: 'scale', min: 3, max: 2 }]) }).errors,
    ['Field 1: the scale must start at a lower number than it ends.']);
});

const scaleFields = [
  { id: 'scal0001', label: 'Mood', type: 'scale', required: true, options: [], min: 1, max: 5 },
  { id: 'scal0002', label: 'Score', type: 'scale', required: false, options: [], min: -2, max: 2 },
];

test('scale answers are whole numbers within the range, stored as text like number answers', () => {
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', ' 04 '], ['f_scal0002', '-2']])), { answers: { scal0001: '4', scal0002: '-2' }, errors: {} });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', '5']])), { answers: { scal0001: '5', scal0002: '' }, errors: {} }, 'empty optional');
  const rangeError = 'Choose a whole number from 1 to 5.';
  assert.deepEqual(validateAnswers(scaleFields, form([])).errors, { scal0001: 'This field is required.' });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', '6']])).errors, { scal0001: rangeError });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', '0']])).errors, { scal0001: rangeError });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', '2.5']])).errors, { scal0001: rangeError });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', 'abc']])).errors, { scal0001: rangeError });
  assert.deepEqual(validateAnswers(scaleFields, form([['f_scal0001', '3'], ['f_scal0002', '3']])).errors, { scal0002: 'Choose a whole number from -2 to 2.' });
});

test('scale summaries count every value of the range and give the average and median', () => {
  const responses = ['1', '5', '5', '2', '', '9'].map((v, i) => ({ id: i + 1, number: i + 1, submittedAt: '2026-01-01 00:00:00', respondentName: null, answers: { scal0001: v } }));
  const [summary] = summarize(scaleFields.slice(0, 1), responses);
  assert.equal(summary.answered, 5);
  assert.deepEqual(summary.counts.map(({ option, label, count }) => [option, label, count]), [['1', '1', 1], ['2', '2', 1], ['3', '3', 0], ['4', '4', 0], ['5', '5', 2]]);
  assert.deepEqual(summary.scale, { min: 1, max: 5, average: 4.4, median: 5, outOfRange: 1 });
  const even = summarize(scaleFields.slice(0, 1), responses.slice(0, 4))[0].scale;
  assert.deepEqual([even.average, even.median], [3.3, 3.5]);
  assert.deepEqual(summarize(scaleFields.slice(0, 1), [])[0].scale, { min: 1, max: 5, average: null, median: null, outOfRange: 0 });
  assert.match(toCsv(scaleFields, responses.slice(0, 1)), /,1,\r\n$/);
});

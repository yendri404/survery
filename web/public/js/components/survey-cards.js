import { h } from '../dom.js';
import { icon } from './icons.js';
import { closingText, emptyState, statusBadge } from './layout.js';

/** Presentational: the creator's surveys as cards, or the empty state. */
export function surveyCards(surveys, i18n) {
  const { t, tn } = i18n;
  if (!surveys.length) {
    return emptyState(t('list.empty'), h('a', { class: 'button big', href: '/surveys/new' }, icon('plus'), ` ${t('list.createFirst')}`));
  }
  return h('ul', { class: 'cards' }, surveys.map((survey) => h('li', {},
    h('a', { class: 'card card-link', href: `/surveys/${survey.id}` },
      h('span', { class: 'card-title' }, survey.title),
      statusBadge(survey.status, t),
      h('span', { class: 'muted' }, `${tn('list.responses', survey.responseCount)} · ${closingText(survey.closesOn, survey.status, i18n)}`)))));
}

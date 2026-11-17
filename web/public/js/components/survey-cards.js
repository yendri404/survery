import { h } from '../dom.js';
import { icon } from './icons.js';
import { closingText, emptyState, statusBadge } from './layout.js';

/**
 * Presentational: the creator's surveys as cards, or the empty state. Each card opens the survey and
 * has Edit (a link to its editor), Close or Reopen (`onToggle(survey)`) and Delete (`onDelete(survey)`;
 * the container confirms and deletes).
 */
export function surveyCards(surveys, i18n, { onToggle, onDelete } = {}) {
  const { t, tn } = i18n;
  if (!surveys.length) {
    return emptyState(t('list.empty'), h('a', { class: 'button big', href: '/surveys/new' }, icon('plus'), ` ${t('list.createFirst')}`));
  }
  return h('ul', { class: 'cards' }, surveys.map((survey) => h('li', {},
    h('div', { class: 'card card-link survey-card' },
      h('a', { class: 'card-main', href: `/surveys/${survey.id}` },
        h('span', { class: 'card-title' }, survey.title),
        statusBadge(survey.status, t),
        h('span', { class: 'muted' }, `${tn('list.responses', survey.responseCount)} · ${closingText(survey.closesOn, survey.status, i18n)}`)),
      h('div', { class: 'card-actions' },
        h('a', { class: 'button secondary', href: `/surveys/${survey.id}/edit`, 'aria-label': t('list.editSurvey', { title: survey.title }) },
          icon('edit'), ` ${t('list.edit')}`),
        survey.isOpen
          ? h('button', { type: 'button', class: 'secondary', 'aria-label': t('list.closeSurvey', { title: survey.title }), onclick: () => onToggle?.(survey) },
            icon('lock'), ` ${t('list.close')}`)
          : h('button', { type: 'button', class: 'secondary', 'aria-label': t('list.reopenSurvey', { title: survey.title }), onclick: () => onToggle?.(survey) },
            icon('unlock'), ` ${t('list.reopen')}`),
        h('button', { type: 'button', class: 'danger', 'aria-label': t('list.deleteSurvey', { title: survey.title }), onclick: () => onDelete?.(survey) },
          icon('trash'), ` ${t('list.delete')}`))))));
}

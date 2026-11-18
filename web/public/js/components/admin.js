import { h } from '../dom.js';
import { icon } from './icons.js';
import { closingText, emptyState, statusBadge } from './layout.js';

/** Text key of the panel login's line: the playful one only when the API says FUN is on. */
export const adminLoginIntroKey = (status) => (status?.fun === true ? 'admin.loginFun' : 'admin.loginIntro');

/** The admin page's address, optionally with a user selected (`?user=<id>`). */
export const adminHref = (userId) => (userId ? `/..command/?user=${userId}` : '/..command/');

/**
 * Presentational: every user as a square card. The card opens that user's surveys in the second
 * column (`?user=<id>`, marked with aria-current); below it, Delete (`onDelete(user)`, the container
 * confirms) and a small form to set a new password (`onSetPassword(user, password, form)`).
 */
export function adminUserCards(users, i18n, { selectedId, onDelete, onSetPassword } = {}) {
  const { t, tn } = i18n;
  if (!users.length) return emptyState(t('admin.noUsers'));
  return h('ul', { class: 'admin-users' }, users.map((user) => {
    const password = h('input', { type: 'password', name: 'password', required: true, minlength: 8, maxlength: 200, autocomplete: 'new-password', 'aria-label': t('admin.newPasswordFor', { name: user.name }) });
    const passwordForm = h('form', {
      class: 'admin-password',
      onsubmit: (event) => {
        event.preventDefault();
        onSetPassword?.(user, password.value, event.currentTarget);
      },
    }, password, h('button', { type: 'submit', class: 'secondary' }, t('admin.setPassword')));
    const changeLabel = t('admin.changePasswordOf', { name: user.name });
    const deleteLabel = t('admin.deleteUser', { name: user.name });
    // Icon buttons keep the square small; their names are in aria-label and in the tooltip.
    return h('li', {},
      h('div', { class: `card admin-user${user.id === selectedId ? ' is-selected' : ''}` },
        h('a', { class: 'card-main', href: adminHref(user.id), 'aria-current': user.id === selectedId ? 'true' : undefined },
          h('span', { class: 'card-title' }, user.name),
          h('span', { class: 'admin-email' }, user.email),
          h('span', { class: 'muted' }, user.surveyCount ? tn('admin.surveys', user.surveyCount) : t('admin.noSurveysShort'))),
        h('div', { class: 'admin-user-actions' },
          h('details', { class: 'admin-user-tools' },
            h('summary', { class: 'button icon-button', 'aria-label': changeLabel, title: changeLabel }, icon('key')),
            passwordForm),
          h('button', { type: 'button', class: 'icon-button danger', 'aria-label': deleteLabel, title: deleteLabel, onclick: () => onDelete?.(user) },
            icon('trash')))));
  }));
}

/**
 * Presentational: one user's surveys, with Edit (the admin editor), Open form (new tab), Close or
 * Reopen (`onToggle(survey)`) and Delete (`onDelete(survey)`; the container confirms).
 */
export function adminSurveyCards(surveys, i18n, { onToggle, onDelete } = {}) {
  const { t, tn } = i18n;
  if (!surveys.length) return emptyState(t('admin.noSurveys'));
  return h('ul', { class: 'cards' }, surveys.map((survey) => h('li', {},
    h('div', { class: `card survey-card${survey.status === 'open' ? ' tone-open' : ''}` },
      h('div', { class: 'card-main' },
        h('span', { class: 'card-title' }, survey.title),
        statusBadge(survey.status, t),
        h('span', { class: 'muted' }, `${tn('list.responses', survey.responseCount)} · ${closingText(survey.closesOn, survey.status, i18n)}`)),
      h('div', { class: 'card-actions' },
        h('a', { class: 'button secondary', href: `/..command/surveys/${survey.id}/edit`, 'aria-label': t('list.editSurvey', { title: survey.title }) },
          icon('edit'), ` ${t('list.edit')}`),
        h('a', { class: 'button secondary', href: survey.shareUrl, target: '_blank', rel: 'noopener', 'aria-label': t('admin.openFormOf', { title: survey.title }) },
          icon('open'), ` ${t('admin.openForm')}`),
        h('button', {
          type: 'button',
          class: 'secondary',
          'aria-label': t(survey.isOpen ? 'list.closeSurvey' : 'list.reopenSurvey', { title: survey.title }),
          onclick: () => onToggle?.(survey),
        }, icon(survey.isOpen ? 'lock' : 'unlock'), ` ${t(survey.isOpen ? 'list.close' : 'list.reopen')}`),
        h('button', { type: 'button', class: 'danger', 'aria-label': t('list.deleteSurvey', { title: survey.title }), onclick: () => onDelete?.(survey) },
          icon('trash'), ` ${t('list.delete')}`))))));
}

import type { Translation } from './en.js'

/**
 * Ukrainian locale.
 *
 * Typed as `Translation`, so a missing or renamed key fails the type check
 * instead of silently falling back to English at runtime.
 */
export const uk: Translation = {
  app: {
    name: 'maestro'
  },

  sidebar: {
    projects: 'Проєкти',
    empty: 'Поки порожньо. Додайте репозиторій кнопкою «+».',
    addProject: 'Додати репозиторій',
    removeProject: 'Прибрати проєкт'
  },

  panel: {
    changes: 'Зміни',
    terminal: 'Термінал',
    collapse: 'Згорнути панель',
    expand: 'Показати панель',
    changesPlaceholder: 'Зміни воркспейсу відносно базової гілки проєкту.',
    terminalPlaceholder: 'Термінал у теці воркспейсу.'
  },

  center: {
    noProjectsTitle: 'Почніть з репозиторію',
    noProjectsBody:
      'Додайте проєкт у лівій панелі. Усередині нього створюються воркспейси — кожен з власною гілкою, текою й сесією агента.',
    noSelectionTitle: 'Виберіть проєкт',
    noSelectionBody: 'Оберіть зі списку ліворуч.',
    projectBody: 'Базова гілка {{branch}}. Чат з агентом з’явиться тут, щойно будуть воркспейси.'
  },

  errors: {
    notARepository: '{{path}} не є git-репозиторієм.',
    emptyRepository:
      'У {{path}} ще немає жодного коміту. Зробіть перший — без нього worktree створити неможливо.',
    noBaseBranch:
      'Не вдалося визначити базову гілку в {{path}}. Перейдіть на потрібну гілку й спробуйте ще раз.',
    duplicateProject: 'Цей репозиторій уже доданий як проєкт «{{name}}».',
    unknown: 'Щось пішло не так: {{message}}'
  }
}

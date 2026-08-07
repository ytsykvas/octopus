import type { Translation } from './en.js'

/**
 * Ukrainian locale.
 *
 * Typed as `Translation`, so a missing or renamed key fails the type check
 * instead of silently falling back to English at runtime.
 */
export const uk: Translation = {
  app: {
    name: 'octopus'
  },

  sidebar: {
    projects: 'Проєкти',
    empty: 'Поки порожньо. Додайте репозиторій кнопкою «+».',
    addProject: 'Додати репозиторій',
    removeProject: 'Прибрати проєкт',
    settings: 'Налаштування'
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

  settings: {
    title: 'Налаштування',
    close: 'Закрити',
    saved: 'Збережено',

    sectionGeneral: 'Загальні',
    sectionGit: 'Git',
    sectionAgent: 'Агент',
    sectionAccounts: 'Акаунти',
    sectionAbout: 'Про застосунок',

    appearance: 'Оформлення',
    theme: 'Тема',
    themeSystem: 'Як у системі',
    themeLight: 'Світла',
    themeDark: 'Темна',

    language: 'Мова',
    languageHint: 'Англійська — типова. Перезапуск не потрібен.',

    git: 'Git',
    branchPrefix: 'Префікс гілок',
    branchPrefixHint:
      'Гілки воркспейсів називаються <префікс>/<воркспейс>. Зазвичай беруть GitHub-username.',
    branchPrefixEmpty: 'Префікс не може бути порожнім.',

    agent: 'Агент',
    settingSources: 'Джерела інструкцій',
    settingSourcesHint:
      'Визначає, що агент підтягує додатково до того, що надсилає застосунок. «Нічого» лишає контекст повністю під вашим контролем.',
    settingSourcesNone: 'Нічого',
    settingSourcesNoneHint: 'Агент отримує лише те, що octopus передає явно.',
    settingSourcesProject: 'Лише проєкт',
    settingSourcesProjectHint: 'Підтягує CLAUDE.md і налаштування самого репозиторію.',
    settingSourcesAll: 'Усе',
    settingSourcesAllHint:
      'Підтягує користувацькі, проєктні й локальні налаштування — як звичайний CLI.',

    accounts: 'Акаунти',
    accountsHint:
      'octopus не зберігає жодних облікових даних. Обидва інструменти тримають їх у системному сховищі ключів; цей екран лише показує те, що вони повідомляють.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'На цьому акаунті працює агент.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Потрібен для pull request і перевірок.',
    connected: 'Підключено',
    notConnected: 'Не підключено',
    signIn: 'Увійти',
    signOut: 'Вийти',
    recheck: 'Оновити',
    opensTerminal:
      'Вхід відбувається в Terminal — обидва інструменти ставлять запитання, для яких потрібен справжній термінал. Після завершення поверніться й натисніть «Оновити».',
    plan: 'Підписка',
    organisation: 'Організація',
    cliMissing: 'Команду не знайдено. Спершу встановіть інструмент.',

    about: 'Про застосунок',
    deviceId: 'Ідентифікатор пристрою',
    installedAt: 'Перший запуск'
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

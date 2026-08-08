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
    addFromDisk: 'З диска…',
    addFromDiskHint: 'Репозиторій, який уже є на цьому комп’ютері',
    addFromGitHubHint: 'Клонувати з вашого акаунта GitHub',
    addFromGitHub: 'З GitHub…',
    removeProject: 'Прибрати проєкт',
    editProject: 'Редагувати…',
    projectActions: 'Ще',
    renameHint: 'Enter — зберегти, Escape — скасувати',
    removeTitle: 'Прибрати проєкт?',
    removeMessage: 'Прибрати «{{name}}» зі списку?',
    removeDetail: 'Репозиторій лишається на диску там, де він є.',
    removeDetailWorkspaces_one:
      'Його воркспейс буде видалено разом з гілкою. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_few:
      'Його {{count}} воркспейси буде видалено разом з гілками. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_many:
      'Його {{count}} воркспейсів буде видалено разом з гілками. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_other:
      'Його {{count}} воркспейсів буде видалено разом з гілками. Сам репозиторій лишається на диску.',
    removeConfirm: 'Прибрати',
    removeCancel: 'Скасувати',
    settings: 'Налаштування'
  },

  repositories: {
    title: 'Додати з GitHub',
    search: 'Пошук репозиторіїв',
    empty: 'Репозиторіїв не знайдено.',
    noMatch: 'Нічого не знайдено за «{{query}}».',
    loading: 'Завантаження…',
    private: 'Приватний',
    cancel: 'Скасувати',
    add: 'Додати',
    cloning: 'Клонуємо {{name}}…',
    cloneInto: 'Клонуємо в',
    cloneIntoUnset: 'Спитаємо, куди клонувати.'
  },

  workspaces: {
    create: 'Новий воркспейс',
    emptyForProject: 'Поки жодного воркспейсу. Створіть його кнопкою + вище.',
    rename: 'Перейменувати',
    remove: 'Видалити воркспейс',
    missing: 'Теки немає',
    missingHint: 'Прибрано повз застосунок. Запис можна безпечно видалити.',
    changedFiles_one: '{{count}} файл',
    changedFiles_few: '{{count}} файли',
    changedFiles_many: '{{count}} файлів',
    changedFiles_other: '{{count}} файлів',

    removeTitle: 'Видалити воркспейс?',
    removeMessage: 'Видалити «{{name}}»?',
    removeDetail: 'Теку worktree буде видалено. Закомічена робота лишається в гілці.',
    removeDirty: 'У цьому воркспейсі є незакомічені зміни. Вони зникнуть — більше їх ніде немає.',
    removeBranch: 'Видалити також гілку {{branch}}',
    removeConfirm: 'Видалити',
    removeCancel: 'Скасувати'
  },

  project: {
    title: 'Налаштування проєкту',
    done: 'Готово',
    name: 'Назва',
    nameHint: 'Показується в сайдбарі. Репозиторій і його теку не змінює.',
    baseBranch: 'Базова гілка',
    baseBranchHint: 'Нові воркспейси відгалужуються звідси. Наявні лишаються на своїх гілках.',
    branchSearch: 'Пошук гілок',
    branchNone: 'Немає відповідної гілки',
    branchFailed:
      'Не вдалося встановити цю гілку. Можливо, її видалили після того, як список було прочитано.',
    color: 'Колір',
    colorHint: 'Позначає проєкт у смузі табів і тонує сайдбар.',
    repository: 'Репозиторій',
    dangerZone: 'Небезпечна зона',
    removeHint: 'Прибирає проєкт з Octopus. Репозиторій лишається на диску.'
  },

  combobox: {
    search: 'Пошук',
    empty: 'Нічого не знайдено'
  },

  panel: {
    changes: 'Зміни',
    terminal: 'Термінал',
    collapse: 'Згорнути панель',
    expand: 'Показати панель',
    changesPlaceholder: 'Зміни воркспейсу відносно базової гілки проєкту.',
    terminalPlaceholder: 'Виберіть воркспейс, щоб відкрити термінал у його теці.',
    resize: 'Змінити ширину панелі'
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
    sectionGeneral: 'Загальні',
    sectionGit: 'Git',
    sectionAgent: 'Агент',
    sectionAccounts: 'Claude',
    sectionAbout: 'Про застосунок',

    theme: 'Тема',
    themeSystem: 'Як у системі',
    themeLight: 'Світла',
    themeDark: 'Темна',

    language: 'Мова',
    languageHint: 'Англійська — типова. Перезапуск не потрібен.',

    branchPrefix: 'Префікс гілок',
    branchPrefixHint:
      'Гілки воркспейсів називаються <префікс>/<воркспейс>. Зазвичай беруть GitHub-username.',
    branchPrefixEmpty: 'Префікс не може бути порожнім.',

    cloneDirectory: 'Тека для клонування',
    cloneDirectoryHint:
      'Репозиторії, додані з GitHub, клонуються сюди. Кожен отримує власну теку з назвою репозиторію.',
    cloneDirectoryUnset: 'Не задано — спитаємо при першому клонуванні.',
    change: 'Змінити…',

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

    accountsHint:
      'octopus не зберігає облікових даних. Їх тримає CLI у системному сховищі ключів; цей екран лише показує те, що він повідомляє.',
    gitHint:
      'GitHub потрібен для pull request і перевірок. Облікові дані лишаються в gh CLI, у системному сховищі ключів.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'На цьому акаунті працює агент.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Потрібен для pull request і перевірок.',
    connected: 'Підключено',
    notConnected: 'Не підключено',
    signIn: 'Увійти',
    signOut: 'Вийти',
    recheck: 'Оновити',
    signInRunning: 'Вхід у {{service}}',
    signingOut: 'Виходимо…',
    signOutFailed: 'Не вдалося вийти з {{service}}.',
    signInDone: 'Завершено. Закрийте, щоб повернутися до списку акаунтів.',
    signInKilled: 'Команду перервано до завершення.',
    signInFailed: 'Команда завершилася з кодом {{code}}.',
    closeTerminal: 'Готово',
    opensTerminal:
      'Вхід відкриває термінал просто тут — обидва інструменти ставлять запитання інтерактивно. Список акаунтів оновиться після завершення.',
    plan: 'Підписка',
    organisation: 'Організація',
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
    notConnected: 'Не вдалося звернутися до GitHub. Перевірте акаунт у налаштуваннях.',
    listFailed: 'GitHub повернув щось неочікуване.',
    cloneFailed: 'Не вдалося клонувати {{repository}}.',
    alreadyExists: '{{path}} уже існує. Додайте його з диска.',
    branchExists: 'Гілка {{branch}} уже існує.',
    pathExists: '{{path}} уже існує.',
    uncommittedChanges: 'У {{name}} є незакомічені зміни.',
    nameEmpty: 'Назва не може бути порожньою.',
    worktreeMissing: 'Цього воркспейсу вже немає.',
    unknown: 'Щось пішло не так: {{message}}'
  }
}

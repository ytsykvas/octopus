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
    collapse: 'Сховати воркспейси',
    expand: 'Показати воркспейси',
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
    cloneIntoUnset: 'Спитаємо, куди клонувати.',
    connect: 'Підключити GitHub…'
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
    sectionGeneral: 'Загальні',
    sectionGit: 'Git',
    sectionScripts: 'Скрипти',
    sectionInstructions: 'Інструкції',
    sectionDanger: 'Небезпечна зона',
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
    icon: 'Іконка',
    iconHint: 'Стоїть на табі проєкту замість ініціалів.',
    iconNone: 'Ініціали',
    setupScript: 'Скрипт збірки',
    setupScriptHint:
      'Виконується в новому воркспейсі: скопіювати .env, поставити залежності, усе потрібне чистій копії. Зберігається як setup.sh.',
    runScript: 'Скрипт сервера',
    runScriptHint:
      'Запускає dev-сервер. $OCTOPUS_PORT — власний порт воркспейсу, тож кілька можуть працювати одночасно. Зберігається як run.sh.',
    pullRequestInstruction: 'Опис pull request',
    pullRequestInstructionHint:
      'Передається агенту, коли він писатиме pull request для цього проєкту. Поки не використовується — pull request ще попереду.',
    repository: 'Репозиторій',
    dangerZone: 'Небезпечна зона',
    removeHint: 'Прибирає проєкт з Octopus. Репозиторій лишається на диску.'
  },

  combobox: {
    search: 'Пошук',
    empty: 'Нічого не знайдено'
  },

  modal: {
    close: 'Закрити'
  },

  scripts: {
    build: 'Білд',
    server: 'Сервер',
    run: 'Запустити',
    runAgain: 'Запустити знову',
    restart: 'Перезапустити',
    stop: 'Зупинити',
    edit: 'Написати скрипт',
    noWorkspace: 'Виберіть воркспейс, щоб запустити тут.',
    noSetup:
      'Скрипта збірки ще немає. Він виконується в новому воркспейсі — скопіювати .env, поставити залежності, усе, що потрібно чистій копії перед роботою.',
    noRun:
      'Скрипта сервера ще немає. Він запускає dev-сервер і отримує власний порт, тож кілька воркспейсів можуть працювати одночасно.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Виконує setup.sh у цьому воркспейсі.',
    runIdle: 'Запускає dev-сервер для цього воркспейсу.'
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

  chat: {
    placeholder: 'Попросіть агента щось зробити в цьому воркспейсі…',
    send: 'Надіслати',
    stop: 'Спинити',
    working: 'Працює…',
    thinking: 'Міркує',
    memoryReset: 'Звідси агент починає пам’ятати розмову спочатку',

    emptyTitle: 'Почніть розмову',
    emptyBody: 'Перше повідомлення запускає сесію агента в цьому робочому дереві. Гілка вже існує.',

    context: 'Контекст',
    contextTitle: 'Вікно контексту — {{used}} з {{total}}',
    windowFiveHour: '5 год',
    windowFiveHourTitle: 'П’ятигодинне вікно',
    windowWeek: 'Тиждень',
    windowWeekTitle: 'Тижневе вікно',

    model: 'Модель',
    modelDefault: 'Модель за замовчуванням',
    modelDefaultNote: 'за замовчуванням',

    effort: 'Зусилля',
    effortLow: 'Низьке',
    effortMedium: 'Середнє',
    effortHigh: 'Високе',
    effortXhigh: 'Дуже високе',
    effortMax: 'Максимальне',
    effortUnsupported: 'Ця модель не приймає налаштування зусилля.',

    modeToggle: 'Дозволи: {{mode}}',
    modeDefault: 'Питати',
    modeAcceptEdits: 'Auto mode',
    modeAfterPlan: 'Що агент робитиме, коли план буде схвалено.',
    planMode: 'План',
    planModeHint: 'Спершу продумати підхід. Доки ви його не схвалите, агент нічого не виконує.',

    toolSteps_one: '{{count}} дія',
    toolSteps_few: '{{count}} дії',
    toolSteps_many: '{{count}} дій',
    toolSteps_other: '{{count}} дій',

    plan: 'План',
    executePlan: 'Виконати',
    executePlanMessage: 'Виконай план «{{title}}».',
    copy: 'Копіювати',
    copied: 'Скопійовано',
    copyFailed: 'Не вдалося',
    planReady: 'План готовий',
    planExecute: 'Виконати',
    planFeedback: 'Щось іще треба уточнити?',
    planFeedbackPlaceholder: 'Напишіть, і агент доопрацює план',
    questionTitle: 'Агент запитує',
    questionOther: 'Інше',
    questionOtherPlaceholder: 'Напишіть свою відповідь',
    questionSend: 'Відповісти',
    questionSkip: 'Пропустити',
    questionAnswered: 'Відповідь надано.',
    questionUnanswered: 'Лишилось без відповіді.',

    permissionTitle: 'Агент хоче скористатися {{tool}}',
    permissionAnswered: 'Відповідь уже дано.',
    allow: 'Дозволити',
    always: 'Завжди дозволяти',
    deny: 'Відхилити',

    duration: '{{seconds}} с',
    tokens_one: '{{tokens}} токен',
    tokens_few: '{{tokens}} токени',
    tokens_many: '{{tokens}} токенів',
    tokens_other: '{{tokens}} токенів',

    endedInterrupted: 'спинено',
    endedLimit: 'уперлось у ліміт',
    endedTooLong: 'розмова завелика',
    endedBlocked: 'зупинив хук',
    endedFailed: 'завершилось помилкою',

    usageResets: 'скинеться через {{time}}',
    usageReached: 'ліміт вичерпано',
    hours: 'г',
    minutes: 'хв',
    soon: 'ось-ось'
  },

  center: {
    noProjectsTitle: 'Почніть з репозиторію',
    noProjectsBody:
      'Додайте його з цього комп’ютера або клонуйте з GitHub. Усередині нього створюються воркспейси — кожен з власною гілкою, текою й сесією агента.',
    noSelectionTitle: 'Виберіть проєкт',
    noSelectionBody: 'Оберіть зі списку ліворуч або додайте ще один репозиторій.',
    firstWorkspaceTitle: 'Створіть перший воркспейс',
    firstWorkspaceBody:
      'Воркспейс — це копія проєкту на власній гілці, з власною текою та власною сесією агента. Те, що ви робите в одному, не зачіпає інші.',
    noWorkspaceTitle: 'Оберіть воркспейс',
    noWorkspaceBody:
      'Кожна розмова належить одному воркспейсу. Агент працює з його власною копією проєкту, а все, що він змінить, лягає на його гілку.',
    addFromDisk: 'Додати з диска…',
    addFromGitHub: 'Додати з GitHub…',
    checkingGitHub: 'Перевіряємо GitHub…'
  },

  settings: {
    title: 'Налаштування',
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

    effort: 'Зусилля за замовчуванням',
    effortHint:
      'Скільки міркувань просить нова розмова. Кожну потім можна змінити окремо, просто в композері.',

    permissionMode: 'Що дозволено новому чату',
    permissionModeHint:
      'Початковий стан для кожного воркспейсу, щоб питання не поставало на кожній новій гілці. Окремий чат усе одно можна перемкнути.',
    permissionAsk: 'Питати',
    permissionAskHint:
      'Читання відбувається мовчки; запис файлу чи запуск команди чекає на відповідь.',
    permissionAcceptEdits: 'Правки без питань',
    permissionAcceptEditsHint:
      'Зміни у файлах проходять без запиту. Команди все одно чекають — вони виходять за межі робочого дерева.',

    alwaysAllowed: 'Відповідь «завжди»',
    alwaysAllowedHint:
      'Інструменти, які ви пропустили назавжди. Про них більше не питають у жодному воркспейсі, доки не приберете їх тут.',
    alwaysAllowedEmpty: 'Поки що порожньо.',
    alwaysAllowedRemove: 'Питати знову',

    accountsHint:
      'octopus не зберігає облікових даних. Їх тримає CLI у системному сховищі ключів; цей екран лише показує те, що він повідомляє.',
    gitHint:
      'Підключіть GitHub, щоб додавати проєкти клонуванням ваших репозиторіїв, а також відкривати pull request і читати перевірки. Облікові дані лишаються в gh CLI, у системному сховищі ключів.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'На цьому акаунті працює агент.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Додавання проєктів з GitHub, pull request і перевірки.',
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
    branchUnmerged:
      '{{branch}} має коміти, яких немає в базовій гілці. Зніміть прапорець видалення гілки або спершу злийте її.',
    branchExists: 'Гілка {{branch}} уже існує.',
    pathExists: '{{path}} уже існує.',
    uncommittedChanges: 'У {{name}} є незакомічені зміни.',
    nameEmpty: 'Назва не може бути порожньою.',
    worktreeMissing: 'Цього воркспейсу вже немає.',
    unknown: 'Щось пішло не так: {{message}}'
  }
}

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
    statusRunning: 'Агент тут працює',
    statusWaiting: 'Чекає на твою відповідь',
    statusError: 'Останній хід завершився помилкою',
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
    sectionFiles: 'Файли',
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
      'Виконується в новому воркспейсі: поставити залежності, зібрати що треба, усе потрібне чистій копії. Зберігається як setup.sh.',
    files: 'Файли, які їдуть у воркспейс',
    filesHint:
      'По одному шляху в рядку, відносно репозиторію. У worktree лежить тільки те, що відстежує git, тож gitignored-файли — .env, config/master.key — треба привезти. Копіюються при створенні й ще раз перед запуском; наявний файл ніколи не перезаписується.',
    archiveScript: 'Скрипт прибирання',
    archiveScriptHint:
      'Виконується при видаленні воркспейсу, у його теці, доки вона ще є. Щоб забрати назад те, що видав скрипт збірки, — базу чи контейнер, названі за воркспейсом. Ніщо в ньому не може завадити видаленню. Зберігається як archive.sh.',
    runScript: 'Скрипт сервера',
    runScriptHint:
      'Запускає dev-сервер. $OCTOPUS_PORT — власний порт воркспейсу, тож кілька можуть працювати одночасно. Зберігається як run.sh.',
    pullRequestInstruction: 'Опис pull request',
    pullRequestInstructionHint:
      'Надсилається агенту, коли ви просите його описати зміну для pull request у цьому проєкті. Використовується замість тієї, що в Налаштуваннях; порожня означає, що проєкт нічого не додає.',
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
    serverRestart: 'Перезапустити',
    stop: 'Стоп',
    openInBrowser: 'Відкрити localhost:{{port}}',
    busy: 'працює…',
    foldBuild: 'Згорнути білд',
    unfoldBuild: 'Показати білд',
    edit: 'Написати скрипт',
    editFiles: 'Редагувати файли',
    runAll: 'Запустити',
    running: 'Збирається\u2026',
    runHint: 'Збирає цей воркспейс, потім запускає його сервер.',
    runBuilding: 'Збирається. Сервер запуститься, коли це завершиться.',
    runServing: 'Сервер працює.',
    buildFailed: 'Збірка впала, тож сервер не запускався.',
    portSilent: 'Працює, але на {{port}} ніхто не слухає. Чи використовує скрипт $OCTOPUS_PORT?',
    noWorkspace: 'Виберіть воркспейс, щоб запустити тут.',
    noSetup:
      'Скрипта збірки ще немає. Він виконується в новому воркспейсі — поставити залежності, усе, що потрібно чистій копії перед роботою.',
    noRun:
      'Скрипта сервера ще немає. Він запускає dev-сервер і отримує власний порт, тож кілька воркспейсів можуть працювати одночасно.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Виконує setup.sh у цьому воркспейсі.',
    runIdle: 'Запускає dev-сервер для цього воркспейсу.'
  },

  panel: {
    changes: 'Зміни',
    terminal: 'Термінал',
    scripts: 'Скрипти',
    pullRequest: 'Pull request',
    collapse: 'Згорнути панель',
    expand: 'Показати панель',
    terminalPlaceholder: 'Виберіть воркспейс, щоб відкрити термінал у його теці.',
    resize: 'Змінити ширину панелі'
  },

  pullRequest: {
    noWorkspace: 'Виберіть воркспейс, щоб відкрити для нього pull request.',
    loading: 'Питаю GitHub про цю гілку…',
    editInstructions: 'Інструкції для нового PR',
    ask: 'Попросити агента описати',
    noConversation: 'Спершу відкрийте розмову в цьому воркспейсі.',
    noInstruction: 'Цей проєкт нічого не додає до опису. Спершу напишіть інструкцію.',
    branch: 'Гілка',
    nothingToOpen:
      'Поки нічого відкривати. У цій гілці немає комітів, яких немає в {{base}}, — зробіть спершу коміт.',
    willPush: 'Цієї гілки ще немає на GitHub. Відкриття запушить її.',
    dirty: 'Тут є незакомічені зміни. Pull request несе коміти, тож вони лишаться поза ним.',
    title: 'Заголовок',
    titlePlaceholder: 'Що робить ця зміна',
    body: 'Опис',
    bodyPlaceholder: 'Усе, що варто знати рев’юеру',
    draft: 'Відкрити як чернетку',
    create: 'Відкрити pull request',
    creating: 'Відкриваю…',
    open: 'Відкрити на GitHub',
    stateOpen: 'Pull request #{{number}} відкритий.',
    stateMerged: 'Pull request #{{number}} влитий.',
    stateClosed: 'Pull request #{{number}} закрито без злиття.'
  },

  diff: {
    noWorkspace: 'Виберіть воркспейс, щоб побачити його зміни.',
    clean: 'У цьому воркспейсі поки нічого не змінилося.',
    loading: 'Читаю зміни…',
    against: 'відносно {{branch}}',
    fileCount_one: '{{count}} файл',
    fileCount_few: '{{count}} файли',
    fileCount_many: '{{count}} файлів',
    fileCount_other: '{{count}} файлів',
    refresh: 'Перечитати зміни',
    expandAll: 'Розгорнути всі файли',
    collapseAll: 'Згорнути всі файли',
    unified: 'Однією колонкою',
    split: 'Поруч',
    splitTooNarrow: 'Панель завузька для двох колонок — розтягніть її ширше.',
    renamedFrom: 'перенесено з {{path}}',
    binary: 'Двійковий файл — показувати нічого.',
    tooLarge: 'Завеликий, щоб малювати тут. Відкрийте файл, щоб прочитати.',
    invisibleCharacters:
      'У цьому файлі є символи, які малюються не собою, — рядок може читатися інакше, ніж виконується.',
    omittedFiles_one: '{{count}} файл завеликий, щоб його намалювати',
    omittedFiles_few: '{{count}} файли завеликі, щоб їх намалювати',
    omittedFiles_many: '{{count}} файлів завеликі, щоб їх намалювати',
    omittedFiles_other: '{{count}} файлів завеликі, щоб їх намалювати',
    copyPath: 'Скопіювати шлях',
    copied: 'Шлях скопійовано',
    copyFailed: 'Не вдалося скопіювати',
    openFile: 'Відкрити файл',
    fileActions: 'Дії для {{path}}',
    // Позначки в заголовку файла — перша літера слова поруч, тож переклад
    // змінює або обидва разом, або жодного.
    statusAdded: 'Д',
    statusModified: 'З',
    statusDeleted: 'В',
    statusRenamed: 'П',
    statusCopied: 'К',
    statusTypeChanged: 'Т',
    statusUntracked: 'Н',
    statusAddedLabel: 'Додано',
    statusModifiedLabel: 'Змінено',
    statusDeletedLabel: 'Видалено',
    statusRenamedLabel: 'Перейменовано',
    statusCopiedLabel: 'Копія',
    statusTypeChangedLabel: 'Тип змінено',
    statusUntrackedLabel: 'Не відстежується',
    comment: 'Коментар до рядка {{line}}',
    askSelection: 'Запитати про виділений код',
    commentOld: 'Коментар до рядка {{line}} у файлі, яким він був',
    commentPlaceholder: 'Що агент має тут змінити?',
    commentSave: 'Додати',
    commentCancel: 'Скасувати',
    commentRemove: 'Прибрати цю нотатку',
    commentIntro: 'Зауваження до змін:'
  },

  chat: {
    tabs: 'Розмови',
    tab: '{{agent}} {{number}}',
    tabStatus: '{{name}}: {{state}}',
    tabStatusIdle: 'ще нічого не написано',
    tabStatusDone: 'завершено',
    newTab: 'Нова розмова',
    renameTab: 'Перейменувати…',
    forkTab: 'Продовжити в новій розмові',
    forkTabHint: 'Агент збереже те, що пам’ятає з цієї.',
    closeTab: 'Закрити розмову',
    closeTabTitle: 'Закрити цю розмову?',
    closeTabMessage: '{{name}} і все сказане в ній.',
    closeTabDetail: 'Пам’ять агента про неї зникне теж, і повернути її не вийде.',
    closeTabConfirm: 'Закрити',
    closeTabCancel: 'Скасувати',

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
    contextCompactNote: 'Агент лишає собі стислий переказ розмови й працює далі.',
    contextClearNote: 'Агент забуває цю розмову, а її запис видаляється.',
    clearTitle: 'Очистити цю розмову?',
    clearMessage: 'Агент почне спочатку, не пам’ятаючи нічого зі сказаного тут.',
    clearDetail: 'Запис розмови видаляється разом із нею, і повернути його не вийде.',
    clearConfirm: 'Очистити',
    clearCancel: 'Скасувати',
    windowFiveHour: '5 год',
    windowFiveHourTitle: 'П’ятигодинне вікно',
    windowWeek: 'Тиждень',
    windowWeekTitle: 'Тижневе вікно',

    model: 'Модель',
    modelDefault: 'Модель за замовчуванням',
    modelDefaultNote: 'за замовчуванням',
    modelsTitle: 'Моделі цієї розмови',
    modelsPlan: 'План і дослідження',
    modelsCode: 'Написання коду',
    modelsSame: 'Та сама, що й для коду',

    effort: 'Зусилля',
    effortLow: 'Низьке',
    effortMedium: 'Середнє',
    effortHigh: 'Високе',
    effortXhigh: 'Дуже високе',
    effortMax: 'Максимальне',
    effortUltracode: 'Ultracode',
    effortUltracodeNote: 'xhigh + workflows',
    effortUnsupported: 'Ця модель не приймає налаштування зусилля.',
    effortScale: 'Зусилля на роздуми',
    effortFaster: 'Швидше',
    effortSmarter: 'Розумніше',

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

    changeEverywhere: 'замінено всюди',

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
    sectionInstructions: 'Інструкції',
    pullRequestInstruction: 'Опис pull request',
    pullRequestInstructionHint:
      'Надсилається агенту, коли ви просите його описати зміну для pull request. Проєкт може написати свою інструкцію, і тоді використовується вона.',
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

    model: 'Модель для написання коду',
    modelHint:
      'На чому працює нова розмова. Список надає сам агент, тож він порожній, доки не запуститься перша сесія.',
    planModel: 'Модель для плану та досліджень',
    planModelHint:
      'Використовується, доки увімкнено План: план продумує одна модель, а виконує інша. Залиште те саме, щоб одна модель робила обидві справи.',

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
    baseUnknown:
      'Не вдалося знайти, звідки цей воркспейс відгалузився від {{branch}}. Гілку могли перейменувати або видалити — перевірте налаштування проєкту.',
    duplicateProject: 'Цей репозиторій уже доданий як проєкт «{{name}}».',
    notConnected: 'Не вдалося звернутися до GitHub. Перевірте акаунт у налаштуваннях.',
    listFailed: 'GitHub повернув щось неочікуване.',
    cloneFailed: 'Не вдалося клонувати {{repository}}.',
    noCommits: 'У цій гілці немає нічого, чого немає в {{base}}.',
    pushFailed: 'Не вдалося запушити {{branch}} на GitHub.',
    createFailed: 'Не вдалося відкрити pull request. GitHub його відхилив.',
    alreadyExists: '{{path}} уже існує. Додайте його з диска.',
    branchUnmerged:
      '{{branch}} має коміти, яких немає в базовій гілці. Зніміть прапорець видалення гілки або спершу злийте її.',
    branchExists: 'Гілка {{branch}} уже існує.',
    pathExists: '{{path}} уже існує.',
    uncommittedChanges: 'У {{name}} є незакомічені зміни.',
    nameEmpty: 'Назва не може бути порожньою.',
    worktreeMissing: 'Цього воркспейсу вже немає.',
    tooManyChats_one: 'Воркспейс тримає щонайбільше {{count}} розмову.',
    tooManyChats_few: 'Воркспейс тримає щонайбільше {{count}} розмови.',
    tooManyChats_many: 'Воркспейс тримає щонайбільше {{count}} розмов.',
    tooManyChats_other: 'Воркспейс тримає щонайбільше {{count}} розмови.',
    lastChat: 'Останню розмову закрити не можна. Щоб почати її спочатку, скористайтеся /clear.',
    nothingToFork: 'Ця розмова ще не почалася, тож продовжувати нема чого.',
    forkFailed: 'Агент не зміг скопіювати цю розмову.',
    unknown: 'Щось пішло не так: {{message}}'
  }
}

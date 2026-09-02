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
    removeDetail:
      'Його скрипти, список файлів і змінні буде видалено з ~/.octopus, разом із креденшіалами. Репозиторій лишається на диску там, де він є.',
    removeDetailWorkspaces_one:
      'Його воркспейс буде видалено разом з гілкою, спершу для нього виконається скрипт очищення. Його скрипти, список файлів і змінні буде видалено з ~/.octopus, разом із креденшіалами. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_few:
      'Його {{count}} воркспейси буде видалено разом з гілками, спершу для кожного виконається скрипт очищення. Його скрипти, список файлів і змінні буде видалено з ~/.octopus, разом із креденшіалами. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_many:
      'Його {{count}} воркспейсів буде видалено разом з гілками, спершу для кожного виконається скрипт очищення. Його скрипти, список файлів і змінні буде видалено з ~/.octopus, разом із креденшіалами. Сам репозиторій лишається на диску.',
    removeDetailWorkspaces_other:
      'Його {{count}} воркспейсів буде видалено разом з гілками, спершу для кожного виконається скрипт очищення. Його скрипти, список файлів і змінні буде видалено з ~/.octopus, разом із креденшіалами. Сам репозиторій лишається на диску.',
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
    requestRunning: 'Pull request #{{number}} — перевірки виконуються',
    requestPassed: 'Pull request #{{number}} — перевірки пройшли',
    requestFailed: 'Pull request #{{number}} — перевірка впала',
    requestWaiting: 'Pull request #{{number}} — перевірок немає',
    requestMerged: 'Pull request #{{number}} — влитий',
    requestClosed: 'Pull request #{{number}} — закритий без злиття',
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

  limits: {
    title: 'Клод',
    empty: 'Ще не читалось — натисніть, щоб запитати акаунт.',
    refresh: 'Прочитати ліміти зараз',
    unavailable: 'Немає через що запитати. Спершу відкрийте воркспейс.',
    noPlan: 'У цього акаунта немає вікон тарифу.',
    failed: 'Акаунт не відповів. Натисніть, щоб спробувати ще раз.',
    none: 'Акаунт не повідомив жодного вікна.',
    windowFiveHour: '5 год',
    windowSevenDay: '1 тиж',
    windowSevenDayOpus: '1 тиж Opus',
    windowSevenDaySonnet: '1 тиж Sonnet',
    windowSevenDayOauthApps: '1 тиж застосунки',
    windowModelScoped: '1 тиж на модель',
    windowModel: '1 тиж {{name}}',
    reading: 'Вікно {{name}}, використано {{percentage}}%',
    resets: 'скинеться через {{time}}',
    hours: 'г',
    minutes: 'хв',
    soon: 'ось-ось',
    stale:
      'Прочитано до того, як це вікно обнулилось, тож частка застаріла. Наступний хід її оновить.'
  },

  project: {
    title: 'Налаштування проєкту',
    sectionGeneral: 'Загальні',
    sectionGit: 'Git',
    sectionScripts: 'Скрипти',
    sectionFiles: 'Файли',
    sectionEnv: 'Env',
    sectionSkills: 'Скіли',
    sectionInstructions: 'Інструкції',
    sectionRepository: 'Репозиторій',
    sectionDanger: 'Небезпечна зона',
    repoLoading: 'Читаю репозиторій…',
    repoHint:
      'Налаштування проєкту лежать у ~/.octopus — на цій машині й разом із нею зникають. Репозиторій може нести копію в .octopus/, і тоді свіжа інсталяція відновлюється з репозиторію, а не з памʼяті. Під час роботи застосунок звідти нічого не читає, і ніщо там не запускається саме собою.',
    repoIgnored:
      'git ігнорує .octopus/, тож усе записане туди лишиться на цій машині. Прибери теку з .gitignore, щоб копія дійшла до інших.',
    scriptFromRepo:
      '\u0426\u0435\u0439 \u0447\u0435\u043a\u0430\u0443\u0442 \u0437\u0430\u0434\u0430\u0454 \u0446\u0435\u0439 \u0441\u043a\u0440\u0438\u043f\u0442, \u0443 {{from}}, \u0456 \u0441\u0430\u043c\u0435 \u0432\u0456\u043d \u0432\u0438\u043a\u043e\u043d\u0443\u0454\u0442\u044c\u0441\u044f. \u041d\u0438\u0436\u0447\u0435 \u2014 \u0432\u043b\u0430\u0441\u043d\u0430 \u043a\u043e\u043f\u0456\u044f \u043f\u0440\u043e\u0454\u043a\u0442\u0443, \u0432\u043e\u043d\u0430 \u0437\u0431\u0435\u0440\u0456\u0433\u0430\u0454\u0442\u044c\u0441\u044f, \u0430\u043b\u0435 \u043d\u0435 \u0432\u0438\u043a\u043e\u0440\u0438\u0441\u0442\u043e\u0432\u0443\u0454\u0442\u044c\u0441\u044f.',
    repoRuns:
      '\u0429\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u0454 \u0446\u0435\u0439 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439',
    repoRunsNone:
      '\u0426\u0435\u0439 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439 \u043d\u0435 \u0437\u0430\u0434\u0430\u0454 \u0441\u043a\u0440\u0438\u043f\u0442\u0456\u0432, \u0442\u043e\u0436 \u0432\u0438\u043a\u043e\u043d\u0443\u044e\u0442\u044c\u0441\u044f \u0442\u0456, \u0449\u043e \u0432 \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u0445 \u043f\u0440\u043e\u0454\u043a\u0442\u0443.',
    repoRunsAllowed:
      '\u0426\u0435 \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043d\u043e \u0439 \u0434\u043e\u0437\u0432\u043e\u043b\u0435\u043d\u043e \u0432\u0438\u043a\u043e\u043d\u0443\u0432\u0430\u0442\u0438.',
    repoRunsWaiting:
      '\u0426\u044c\u043e\u0433\u043e \u0449\u0435 \u043d\u0435 \u0447\u0438\u0442\u0430\u043b\u0438, \u0442\u043e\u0436 Run \u0432\u0438\u043c\u043a\u043d\u0435\u043d\u0438\u0439, \u0434\u043e\u043a\u0438 \u043d\u0435 \u0434\u043e\u0437\u0432\u043e\u043b\u0438\u0442\u0435 \u2014 \u043d\u0430 \u0432\u043a\u043b\u0430\u0434\u0446\u0456 Scripts \u0430\u0431\u043e \u043f\u0435\u0440\u0435\u043c\u0438\u043a\u0430\u0447\u0435\u043c \u043d\u0438\u0436\u0447\u0435.',
    repoTrustHint:
      '\u0414\u043e\u0432\u0456\u0440\u044f\u0442\u0438 \u0441\u043a\u0440\u0438\u043f\u0442\u0430\u043c \u0446\u044c\u043e\u0433\u043e \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u044e. \u0412\u0438\u043c\u043a\u043d\u0435\u043d\u043e \u2014 \u043a\u043e\u0436\u043d\u0430 \u0432\u0435\u0440\u0441\u0456\u044f \u043f\u043e\u043a\u0430\u0437\u0443\u0454\u0442\u044c\u0441\u044f \u0440\u0430\u0437 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043f\u0443\u0441\u043a\u043e\u043c, \u0456 git pull, \u044f\u043a\u0438\u0439 \u043f\u0435\u0440\u0435\u043f\u0438\u0441\u0430\u0432 \u0441\u043a\u0440\u0438\u043f\u0442, \u0441\u043f\u0438\u0442\u0430\u0454 \u0437\u043d\u043e\u0432\u0443. \u0423\u0432\u0456\u043c\u043a\u043d\u0435\u043d\u043e \u2014 \u0432\u0438\u043a\u043e\u043d\u0443\u0454\u0442\u044c\u0441\u044f \u0442\u0435, \u0449\u043e \u0454 \u0432 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0457, \u0431\u0435\u0437 \u0437\u0430\u043f\u0438\u0442\u0430\u043d\u044c: \u0440\u043e\u0437\u0443\u043c\u043d\u043e \u0434\u043b\u044f \u0441\u0432\u043e\u0433\u043e \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u044e \u0439 \u043d\u0435\u0440\u043e\u0437\u0443\u043c\u043d\u043e \u0434\u043b\u044f \u0447\u0443\u0436\u043e\u0433\u043e \u043a\u043b\u043e\u043d\u0430.',
    repoIn: 'З репозиторію',
    repoOut: 'До репозиторію',
    repoImport: 'Імпортувати',
    repoExport: 'Експортувати',
    repoNothingOffered: 'Цей репозиторій поки нічого не несе.',
    repoShow: 'Показати вміст {{path}}',
    repoStateOnlyInRepository: 'ще немає тут',
    repoStateOnlyInApp: 'немає в репозиторії',
    repoStateSame: 'однакове',
    repoStateDiffers: 'відрізняється',
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
      'По одному шляху в рядку, відносно репозиторію. У worktree лежить тільки те, що відстежує git, тож gitignored-файли — .env, config/master.key — треба привезти. Копіюються при створенні й ще раз перед запуском; наявний файл ніколи не перезаписується. Допишіть «= /інший/шлях/.env», щоб узяти файл з іншого чекауту — це відповідь для проєкту, склонованого з GitHub, де в чекауті gitignored-файлів немає взагалі. Ці шляхи лишаються на цій машині й не потрапляють у копію в репозиторії.',
    archiveScript: 'Скрипт прибирання',
    archiveScriptHint:
      'Виконується при видаленні воркспейсу, у його теці, доки вона ще є. Щоб забрати назад те, що видав скрипт збірки, — базу чи контейнер, названі за воркспейсом. Ніщо в ньому не може завадити видаленню. Зберігається як archive.sh.',
    envFile: 'Файл env',
    envFileHint:
      'У який файл воркспейсу записуються змінні, шлях відносно його кореня. .env підходить більшості стеків; Vite читає .env.local і не побачить нічого, записаного поруч.',
    envProfile: '\u041d\u0430\u0431\u0456\u0440 \u0437\u043c\u0456\u043d\u043d\u0438\u0445',
    envProfileHint:
      '\u041f\u0440\u043e\u0454\u043a\u0442 \u043c\u043e\u0436\u0435 \u0442\u0440\u0438\u043c\u0430\u0442\u0438 \u043a\u0456\u043b\u044c\u043a\u0430 \u2014 \u0441\u043a\u0430\u0436\u0456\u043c\u043e, dev \u0456 prod \u2014 \u0456 \u043a\u043e\u0436\u0435\u043d \u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441 \u043a\u043e\u0440\u0438\u0441\u0442\u0443\u0454\u0442\u044c\u0441\u044f \u043e\u0434\u043d\u0438\u043c. \u0426\u0435 \u0432\u0438\u0431\u0456\u0440, \u0437\u0440\u043e\u0431\u043b\u0435\u043d\u0438\u0439 \u0442\u0443\u0442, \u0430 \u043d\u0435 \u0437\u0430\u043a\u043e\u043c\u0435\u043d\u0442\u043e\u0432\u0430\u043d\u0438\u0439 \u0431\u043b\u043e\u043a \u0443 \u0444\u0430\u0439\u043b\u0456, \u0434\u0435 \u043c\u043e\u0432\u0447\u043a\u0438 \u0432\u0438\u0433\u0440\u0430\u0454 \u043e\u0441\u0442\u0430\u043d\u043d\u044f \u043f\u0440\u0430\u0432\u043a\u0430. \u0423 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439 \u0432\u043e\u043d\u0438 \u043d\u0435 \u0457\u0434\u0443\u0442\u044c \u043d\u0456\u043a\u043e\u043b\u0438: \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439 \u0432\u0438\u0440\u0456\u0448\u0443\u0454, \u0449\u043e \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u0454\u0442\u044c\u0441\u044f, \u0430 \u043c\u0430\u0448\u0438\u043d\u0430 \u2014 \u043f\u0440\u043e\u0442\u0438 \u044f\u043a\u043e\u0433\u043e \u043e\u0442\u043e\u0447\u0435\u043d\u043d\u044f.',
    envProfileName:
      '\u041d\u0430\u0437\u0432\u0430 \u043d\u043e\u0432\u043e\u0433\u043e \u043d\u0430\u0431\u043e\u0440\u0443 (\u043c\u0430\u043b\u0456 \u043b\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438 \u0442\u0430 \u0434\u0435\u0444\u0456\u0441\u0438)',
    envProfileNew: '\u041d\u043e\u0432\u0438\u0439',
    envProfileDuplicate: '\u041a\u043e\u043f\u0456\u044f',
    envProfileRemove: '\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438',
    envProfileMakeDefault:
      '\u0417\u0440\u043e\u0431\u0438\u0442\u0438 \u0442\u0438\u043f\u043e\u0432\u0438\u043c',
    envOf: '\u0417\u043c\u0456\u043d\u043d\u0456 \u0432 \u00ab{{name}}\u00bb',
    env: 'Змінні, що додаються в кожен воркспейс',
    envHint:
      'По одному KEY=value в рядку. Дописуються в кінець {{file}} у воркспейсі, тож перебивають те, що скопіювалося, — і стають усім файлом там, де клонові не було чого копіювати. $OCTOPUS_PORT замінюється на власний порт воркспейсу, а $OCTOPUS_WORKSPACE_SLUG — на його назву у формі, придатній для ідентифікатора: малими літерами, усе інше — підкреслення. Саме це потрібно базі, названій за воркспейсом. Лишаються на цій машині, у репозиторій не потрапляють.',
    envNotIgnored:
      'git не ігнорує {{file}} у цьому репозиторії, тож усе, що тут введено, з’явиться у воркспейсі як зміна — і може потрапити в коміт. Додайте його до .gitignore, а якщо репозиторій його відстежує — спершу приберіть з відстеження.',
    envMarker:
      'Рядок {{line}}: це власний маркер октопуса — його буде прибрано перед записом блока.',
    envNoAssignment: 'Рядок {{line}}: «{{subject}}» — це не KEY=value, тож ніхто його не прочитає.',
    envBadName: 'Рядок {{line}}: «{{subject}}» — таке ім’я env-файл тримати не може.',
    envDuplicate: 'Рядок {{line}}: {{subject}} задано вдруге — врахується лише останнє.',
    envUnknownVariable:
      'Рядок {{line}}: ${{subject}} — не наша змінна, тож лишиться у файлі як текст.',
    runScript: 'Скрипт сервера',
    runScriptHint:
      'Запускає dev-сервер. $OCTOPUS_PORT — власний порт воркспейсу, тож кілька можуть працювати одночасно. Зберігається як run.sh.',
    sources: 'Що агент бере сам',
    sourcesHint:
      'Октопус завантажує ті самі налаштування, що й Claude Code у терміналі, тож агент приходить, уже знаючи все, що цей репозиторій і ця машина для нього написали. Нічого з цього октопус не надсилає.',
    sourceProjectMemory: 'CLAUDE.md цього репозиторію',
    sourceProjectSettings: '.claude/settings.json',
    sourceLocalSettings: '.claude/settings.local.json',
    sourceUserSettings: 'Ваш settings.json',
    sourceUserMemory: 'Ваш CLAUDE.md',
    sourceCommands: 'Слеш-команди',
    sourceAgents: 'Субагенти',
    sourceMcp: 'MCP-сервери (.mcp.json)',
    sourceSkills: 'Скіли',
    sourceUserCommands: 'Ваші слеш-команди',
    sourceUserAgents: 'Ваші субагенти',
    sourceNotLoaded: 'є на диску, не читається',
    sourcePresent: 'завантажено',
    sourceAbsent: 'немає',
    sourceCount: 'завантажено: {{count}}',
    repository: 'Репозиторій',
    repositoryHint:
      '\u0414\u0435 \u0436\u0438\u0432\u0435 \u043f\u0440\u043e\u0454\u043a\u0442. \u0428\u043b\u044f\u0445 \u043c\u043e\u0436\u043d\u0430 \u0437\u043c\u0456\u043d\u0438\u0442\u0438, \u043f\u043e\u043a\u0438 \u0432 \u043f\u0440\u043e\u0454\u043a\u0442\u0456 \u043d\u0435\u043c\u0430\u0454 \u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441\u0456\u0432 \u2014 \u0441\u043a\u0440\u0438\u043f\u0442\u0438, \u0437\u043c\u0456\u043d\u043d\u0456 \u0442\u0430 \u0456\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457 \u043b\u0438\u0448\u0430\u044e\u0442\u044c\u0441\u044f, \u0431\u043e \u0432\u043e\u043d\u0438 \u0437\u0430\u043f\u0438\u0441\u0430\u043d\u0456 \u0437\u0430 \u043f\u0440\u043e\u0454\u043a\u0442\u043e\u043c, \u0430 \u043d\u0435 \u0437\u0430 \u0448\u043b\u044f\u0445\u043e\u043c.',
    repositoryLocked:
      '\u041a\u043e\u0436\u0435\u043d \u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441 \u2014 \u0446\u0435 git-worktree, \u0437\u0430\u0440\u0435\u0454\u0441\u0442\u0440\u043e\u0432\u0430\u043d\u0438\u0439 \u0443 \u0446\u044c\u043e\u043c\u0443 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0457, \u0442\u043e\u0436 \u0448\u043b\u044f\u0445 \u043d\u0435 \u0437\u043c\u0456\u043d\u0438\u0442\u0438, \u043f\u043e\u043a\u0438 \u0432\u043e\u043d\u0438 \u0454. \u0421\u043f\u0435\u0440\u0448\u0443 \u0432\u0438\u0434\u0430\u043b\u0456\u0442\u044c \u0457\u0445.',
    repositoryChange: '\u0417\u043c\u0456\u043d\u0438\u0442\u0438\u2026',
    repositoryPick:
      '\u041e\u0431\u0435\u0440\u0456\u0442\u044c \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439 \u0434\u043b\u044f \u0446\u044c\u043e\u0433\u043e \u043f\u0440\u043e\u0454\u043a\u0442\u0443',
    dangerZone: 'Небезпечна зона',
    removeHint:
      'Прибирає проєкт з Octopus. Кожен воркспейс зникає — спершу для нього виконується скрипт очищення, — а скрипти, файли та змінні цього проєкту видаляються з ~/.octopus разом із креденшіалами. Репозиторій лишається на диску.'
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
    editScripts: 'Редагувати скрипти цього проєкту',
    env: 'Env',
    envRestart:
      '\u0421\u0435\u0440\u0432\u0435\u0440 \u0449\u0435 \u043f\u0440\u0430\u0446\u044e\u0454 \u0437 \u043f\u043e\u043f\u0435\u0440\u0435\u0434\u043d\u0456\u043c \u043d\u0430\u0431\u043e\u0440\u043e\u043c \u0437\u043c\u0456\u043d\u043d\u0438\u0445. \u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0456\u0442\u044c \u0439\u043e\u0433\u043e, \u0449\u043e\u0431 \u0437\u043c\u0456\u043d\u0430 \u043f\u043e\u0434\u0456\u044f\u043b\u0430.',
    envFollow: '\u042f\u043a \u0443 \u043f\u0440\u043e\u0454\u043a\u0442\u0456 ({{name}})',
    editEnv: 'Змінні…',
    repoUnreadable:
      '\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f \u0446\u044c\u043e\u0433\u043e \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u044e \u043d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u0438, \u0442\u043e\u0436 \u0442\u0443\u0442 \u043d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0438: {{reason}}',
    repoNotice:
      '\u0426\u0435\u0439 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0439 \u0437\u0430\u0434\u0430\u0454 \u0441\u043a\u0440\u0438\u043f\u0442\u0438 \u043d\u0438\u0436\u0447\u0435. \u041f\u0440\u043e\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u0457\u0445, \u043f\u0435\u0440\u0448 \u043d\u0456\u0436 \u0432\u043e\u043d\u0438 \u0432\u0438\u043a\u043e\u043d\u0430\u044e\u0442\u044c\u0441\u044f: \u0432\u043e\u043d\u0438 \u043f\u0440\u0438\u0457\u0445\u0430\u043b\u0438 \u0437 git pull, \u0442\u043e\u0436 \u0442\u0443\u0442 \u0432\u0438\u043a\u043e\u043d\u0443\u0454\u0442\u044c\u0441\u044f \u0442\u0435, \u0449\u043e \u043a\u0430\u0436\u0435 \u0433\u0456\u043b\u043a\u0430.',
    repoApprove: '\u0414\u043e\u0437\u0432\u043e\u043b\u0438\u0442\u0438',
    showEnv: 'Env цього воркспейсу',
    noEnv:
      'У цього воркспейсу ще немає env-файлу. Він з’явиться, коли проєкт скопіює файл або додасть власні змінні.',
    editFiles: 'Скопійовані файли…',
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

  instructions: {
    scopeGlobal: 'Проєкт може написати власну — тоді діятиме вона.',
    scopeProject:
      'Діє замість тієї, що в Налаштуваннях; порожня означає, що проєкт нічого не додає.',

    pullRequest: 'Описи pull request',
    pullRequestHint: 'Надсилається, коли ви просите агента описати зміну для pull request.',
    commitMessage: 'Повідомлення комітів',
    commitMessageHint:
      'Надсилається разом із попередньою, коли панель pull request комітить цей воркспейс, а повідомлення ніхто не написав.',
    fixChecks: 'Полагодити перевірку, що впала',
    fixChecksHint:
      'Надсилається, коли перевірка на pull request впала і ви просите агента це полагодити.',
    addressReview: 'Опрацювати ревю',
    addressReviewHint: 'Надсилається, коли ви віддаєте агентові ревю на pull request.',
    review: 'Зробити ревю',
    reviewHint: 'Надсилається, коли ви просите агента відревʼювати сам pull request.',
    multiAgentReview: 'Ревю з кількох боків',
    multiAgentReviewHint:
      'Надсилається, коли ви просите ревю кількома субагентами одночасно, кожен читає щось своє.',
    resolveConflicts: 'Розвʼязати конфлікти',
    resolveConflictsHint:
      'Надсилається, коли pull request конфліктує з базовою гілкою і ви просите агента це владнати.'
  },

  pullRequest: {
    noWorkspace: 'Виберіть воркспейс, щоб відкрити для нього pull request.',
    loading: 'Питаю GitHub про цю гілку…',
    editInstructions: 'Інструкції для нового PR',
    ask: 'Попросити агента описати',
    drafting: 'Пише…',
    emptyHint:
      'Лишіть порожніми — і агент напише сам: заголовок із того, що зробила задача, а опис так, як просить цей проєкт.',
    emptyHintSettings: 'Змінити, як він пише',
    written: 'Написав агент. Відредагуйте — і відкривайте.',
    noConversation: 'Спершу відкрийте розмову в цьому воркспейсі.',
    nothingToOpen:
      'Поки нічого відкривати. У цій гілці немає комітів, яких немає в {{base}}, — зробіть спершу коміт.',
    willPush: 'Цієї гілки ще немає на GitHub. Відкриття запушить її.',
    dirty:
      'Тут є незакомічені зміни. Вони підуть у request разом із рештою — під повідомленням вище або тим, яке напише агент.',
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
    stateClosed: 'Pull request #{{number}} закрито без злиття.',

    createShortcut: 'Створити PR',
    commitMessage: 'Повідомлення коміту',
    commitMessagePlaceholder: 'Перейменувати те саме',
    commitHint:
      'Закомітить усі зміни в цьому воркспейсі під цим повідомленням, а тоді відкриє request.',
    envNotIgnored:
      'git не ігнорує {{file}}, а octopus пише туди змінні цього воркспейса. Закомітивши все, ви відправите їх у pull request.',
    envNotIgnoredPush:
      'git не ігнорує {{file}}, а octopus пише туди змінні цього воркспейса. Закомітивши й відправивши, ви надішлете їх на GitHub.',

    refresh: 'Перечитати з GitHub',
    isDraft: 'Чернетка',

    checks: 'Перевірки',
    checksNone: 'Цей репозиторій нічого не запускає на pull request.',
    checkPending: 'виконується',
    checkPassed: 'пройшла',
    checkFailed: 'впала',
    checkSkipped: 'пропущено',

    review: 'Ревю',
    unknownAuthor: 'видалений акаунт',
    reviewNone: 'Поки ніхто нічого не сказав.',
    addToChat: 'Додати в чат',
    resolved: 'розвʼязано',
    verdictApproved: 'схвалив',
    verdictChangesRequested: 'просить змін',
    verdictCommented: 'прокоментував',
    verdictDismissed: 'відхилено',
    decisionApproved: 'Схвалено',
    decisionChangesRequested: 'Просять змін',
    decisionReviewRequired: 'Потрібне ревю',

    merge: 'Влити',
    close: 'Закрити',
    closing: 'Закриваю…',
    merging: 'Вливаю…',
    methodMerge: 'Merge-коміт',
    methodSquash: 'Squash і влити',
    methodRebase: 'Rebase і влити',
    conflicting: 'Ця гілка конфліктує з {{base}}.',
    mergeBlocked: 'GitHub поки не вливає — бракує обовʼязкового ревю або перевірки.',
    mergeBehind: '{{base}} пішла вперед, відколи ця гілка від неї відділилася.',
    mergeUnstable: 'Перевірка не пройшла, але вливати все одно дозволено.',
    mergeDraft: 'Чернетку не влити. Спершу позначте її готовою на GitHub.',

    fixChecks: 'Полагодити перевірки',
    addressReview: 'Опрацювати ревю',
    doReview: 'Зробити ревю',
    multiAgentReview: 'Мультиагентне ревю',
    resolveConflicts: 'Розвʼязати конфлікти',
    commitAndPush: 'Закомітити і запушити',
    answerCommit: 'Відповідь на ревю',
    sending: 'Надсилаю…',

    context: 'Pull request #{{number}} — гілка {{branch}} у {{base}}\n{{url}}',
    failedChecks: 'Перевірки, що впали:\n{{list}}',
    failedCheck: '- {{name}} — {{url}}',
    failedCheckNoLink: '- {{name}}',
    quoteIntro: 'З ревю на цьому pull request:'
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
    revert: 'Відкотити',
    revertFile: 'Відкотити {{path}}',
    revertTitle: 'Відкотити цей файл?',
    revertMessage: '{{path}} повернеться до стану, який мав на момент відгалуження воркспейсу.',
    revertDetail:
      'Незбережені правки в ньому зникнуть безповоротно — git їхньої копії не тримає. Усе вже закомічене лишиться в гілці, скасоване зміною в робочому дереві.',
    revertConfirm: 'Відкотити',
    revertCancel: 'Лишити',
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

    skills: 'Скіли',
    skillsTitle: 'Скіли цієї розмови',
    skillsGlobal: 'Скрізь',
    skillsProject: 'Цей проєкт',
    skillsRepository: 'З цього репозиторію',
    skillsNote: 'Вимкнений скіл не потрапляє в список агента. Файли залишаються на диску.',
    skillsEmpty: 'Скілів поки немає.',
    skillsEmptyNote: 'Додайте скіл у налаштуваннях — і він з’явиться тут у кожній розмові.',
    skillsSettings: 'Відкрити налаштування',
    attach: 'Прикріпити',
    attachSoon: 'Прикріплення ще не працює.',

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

    usageReached: 'ліміт вичерпано'
  },

  usage: {
    title: 'Використання',
    unavailable: 'Ця сесія не може сказати, скільки вже використано.',

    session: 'Сесія',
    cost: 'Загальна вартість',
    costValue: '${{amount}}',
    tokens: 'Токени',
    tokensValue: '{{input}} вхідних · {{output}} вихідних',
    cache: 'Кеш',
    cacheValue: '{{read}} прочитано · {{write}} записано',
    apiTime: 'Час API',
    wallTime: 'Загальний час',
    changes: 'Зміни в коді',
    changesValue: '+{{added}} / −{{removed}} рядків',

    limits: 'Ліміти',
    noPlan: 'До цієї сесії ліміти плану не застосовуються.',
    windowFiveHour: 'Поточна сесія',
    windowSevenDay: 'Поточний тиждень (усі моделі)',
    windowSevenDayOpus: 'Поточний тиждень (Opus)',
    windowSevenDaySonnet: 'Поточний тиждень (Sonnet)',
    windowSevenDayOauthApps: 'Поточний тиждень (підключені застосунки)',
    windowModel: 'Поточний тиждень ({{name}})',
    windowModelScoped: 'Поточний тиждень (за моделлю)',
    reading: '{{name}} — використано {{percentage}}%',
    resets: 'скидання {{at}}',

    extra: 'Додаткове використання',
    extraSpent: '{{used}} із {{limit}}',

    contributing: 'Що впливає',
    day: 'Останні 24 год',
    week: 'Останні 7 днів',
    requests_one: '{{count}} запит',
    requests_few: '{{count}} запити',
    requests_many: '{{count}} запитів',
    requests_other: '{{count}} запитів',
    sessions_one: '{{count}} сесія',
    sessions_few: '{{count}} сесії',
    sessions_many: '{{count}} сесій',
    sessions_other: '{{count}} сесій',

    behaviourCacheMiss: 'Промахи кешу',
    behaviourLongContext: 'Довгий контекст',
    behaviourSubagentHeavy: 'Субагенти',
    behaviourHighParallel: 'Паралельна робота',
    behaviourCron: 'Заплановані запуски',

    skills: 'Навички',
    agents: 'Агенти',
    plugins: 'Плагіни',
    mcpServers: 'Сервери MCP',
    share: '{{name}} — {{percentage}}%',
    approximate:
      'Приблизно, за сесіями на цій машині — інші пристрої та claude.ai не враховано. Характеристики перетинаються, а не ділять загальну суму.',

    minutes: 'хв',
    seconds: 'с'
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
    sectionSkills: 'Скіли',
    sectionInstructions: 'Інструкції',
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
      'Що агент завантажує сам. «Усе» — це те, що робить Claude Code у терміналі, і те, з чим октопус постачається: CLAUDE.md проєкту, його команди, скіли й субагенти. Звужуйте, лише якщо свідомо хочете агента, який знає менше за ваш термінал.',
    settingSourcesNone: 'Нічого',
    settingSourcesNoneHint:
      'Агент не читає ні CLAUDE.md, ні команд, ні скілів. Ізоляція ціною агента, який нічого не знає про проєкт.',
    settingSourcesProject: 'Лише проєкт',
    settingSourcesProjectHint: 'Підтягує CLAUDE.md і налаштування самого репозиторію.',
    settingSourcesAll: 'Усе',
    settingSourcesAllHint: 'Налаштування користувача, проєкту й локальні — те саме, що читає CLI.',

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

  skills: {
    global: 'Скіли для всіх проєктів',
    globalNote: 'Доступні в кожному проєкті, доки розмова їх не вимкне.',
    project: 'Скіли цього проєкту',
    projectNote: 'Доступні лише в цьому проєкті. Зберігаються в octopus, а не в репозиторії.',

    add: 'Новий скіл',
    import: 'Імпортувати…',
    empty: 'Тут ще немає скілів.',
    onByDefault: 'Увімкнено за замовчуванням',
    rowActions: 'Що зробити зі скілом {{name}}',
    edit: 'Редагувати',
    remove: 'Видалити',
    removeTitle: 'Видалити {{name}}?',
    removeMessage: 'Скіл і весь вміст його теки буде видалено.',
    removeDetail: 'Розмови, де він був увімкнений, просто перестануть його бачити.',
    removeConfirm: 'Видалити',
    removeCancel: 'Скасувати',

    inRepository: 'У цьому репозиторії',
    inRepositoryNote: 'Агент і так їх завантажує. Скопіюйте, щоб мати скіл усюди.',
    copyToGlobal: 'Скопіювати для всіх проєктів',

    editorNew: 'Новий скіл',
    editorEdit: 'Редагування {{name}}',
    name: 'Назва',
    nameHint: 'Малі латинські літери, цифри й дефіси. Це назва теки, де він лежить.',
    nameInvalid: 'Лише малі латинські літери, цифри й одиничні дефіси.',
    nameTaken: 'Скіл із такою назвою вже є.',
    description: 'Коли його вмикати',
    descriptionHint: 'Той єдиний рядок, за яким агент вирішує, чи братися за цей скіл.',
    body: 'Інструкції',
    bodyHint: 'Markdown. Що агент має робити, коли візьметься за цей скіл.',
    showRaw: 'Показати SKILL.md',
    hideRaw: 'Назад до форми',
    rawHint: 'Увесь документ разом із frontmatter. Зберігається точно як написано.',
    save: 'Зберегти',
    cancel: 'Скасувати',

    importTitle: 'Імпорт скіла',
    fromDisk: 'З диска',
    fromDiskNote: 'Тека скіла або окремий SKILL.md.',
    choose: 'Обрати…',
    fromText: 'Вставити',
    fromTextNote: 'Увесь SKILL.md разом із frontmatter.',
    fromUrl: 'За посиланням',
    fromUrlNote: 'Адреса https, що віддає один SKILL.md. Нічого поруч не завантажується.',
    url: 'Адреса',
    importAction: 'Імпортувати'
  },

  trust: {
    title: 'Що цей репозиторій може робити',
    explain:
      'Октопус завантажує ті самі налаштування, що й Claude Code у терміналі, тож цей репозиторій може наперед дозволяти інструменти без запиту, запускати власні команди навколо кожного виклику й піднімати MCP-сервери. Прочитайте, що він приносить, перш ніж дозволити. Схвалення потребують лише ці файли — інструкції на кшталт CLAUDE.md ні, і після схвалення читаються так само.',
    approve: 'Дозволити',
    notice:
      'Цей проєкт приносить налаштування, які наперед дозволяють інструменти й запускають власні команди. Поки ви їх не прочитали, агент працює без нічого з цього репозиторію — включно з його CLAUDE.md.',
    review: 'Переглянути'
  },
  errors: {
    branchMissing:
      '\u0423 \u0446\u044c\u043e\u043c\u0443 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0457 \u043d\u0435\u043c\u0430\u0454 \u0433\u0456\u043b\u043a\u0438 \u00ab{{branch}}\u00bb. \u041e\u0431\u0435\u0440\u0456\u0442\u044c \u0431\u0430\u0437\u043e\u0432\u0443 \u0433\u0456\u043b\u043a\u0443, \u044f\u043a\u0430 \u0432 \u043d\u044c\u043e\u043c\u0443 \u0454, \u043f\u0435\u0440\u0448 \u043d\u0456\u0436 \u043f\u0435\u0440\u0435\u043d\u0430\u0446\u0456\u043b\u044e\u0432\u0430\u0442\u0438 \u043f\u0440\u043e\u0454\u043a\u0442.',
    draftFailed:
      '\u041e\u043f\u0438\u0441 \u043d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0441\u043a\u043b\u0430\u0441\u0442\u0438: {{reason}}',
    envProfileExists:
      '\u0423 \u0446\u044c\u043e\u0433\u043e \u043f\u0440\u043e\u0454\u043a\u0442\u0443 \u0432\u0436\u0435 \u0454 \u043d\u0430\u0431\u0456\u0440 \u0437\u043c\u0456\u043d\u043d\u0438\u0445 \u00ab{{name}}\u00bb.',
    envProfileMissing:
      '\u041d\u0430\u0431\u043e\u0440\u0443 \u0437\u043c\u0456\u043d\u043d\u0438\u0445 \u00ab{{name}}\u00bb \u0431\u0456\u043b\u044c\u0448\u0435 \u043d\u0435\u043c\u0430\u0454.',
    envProfileName:
      '\u00ab{{name}}\u00bb \u043d\u0435 \u043c\u043e\u0436\u0435 \u0431\u0443\u0442\u0438 \u043d\u0430\u0437\u0432\u043e\u044e \u043d\u0430\u0431\u043e\u0440\u0443: \u043c\u0430\u043b\u0456 \u043b\u0456\u0442\u0435\u0440\u0438, \u0446\u0438\u0444\u0440\u0438 \u0442\u0430 \u0434\u0435\u0444\u0456\u0441\u0438, \u043f\u043e\u0447\u0438\u043d\u0430\u044e\u0447\u0438 \u0437 \u043b\u0456\u0442\u0435\u0440\u0438 \u0430\u0431\u043e \u0446\u0438\u0444\u0440\u0438. \u041d\u0430\u0437\u0432\u0430 \u0441\u0442\u0430\u0454 \u0456\u043c\u0435\u043d\u0435\u043c \u0444\u0430\u0439\u043b\u0430, \u0430 \u043d\u0430 \u0446\u0456\u0439 \u0444\u0430\u0439\u043b\u043e\u0432\u0456\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u0456 \u00abProd\u00bb \u0456 \u00abprod\u00bb \u2014 \u0446\u0435 \u043e\u0434\u0438\u043d \u0456 \u0442\u043e\u0439 \u0441\u0430\u043c\u0438\u0439 \u0444\u0430\u0439\u043b.',
    repoPathHasWorkspaces:
      '\u0423 \u043f\u0440\u043e\u0454\u043a\u0442\u0456 \u0449\u0435 \u0454 \u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441\u0438, \u0430 \u043a\u043e\u0436\u0435\u043d \u0456\u0437 \u043d\u0438\u0445 \u2014 git-worktree, \u0437\u0430\u0440\u0435\u0454\u0441\u0442\u0440\u043e\u0432\u0430\u043d\u0438\u0439 \u0443 \u043d\u0438\u043d\u0456\u0448\u043d\u044c\u043e\u043c\u0443 \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0457. \u0412\u0438\u0434\u0430\u043b\u0456\u0442\u044c \u0457\u0445, \u043f\u0435\u0440\u0448 \u043d\u0456\u0436 \u043f\u0435\u0440\u0435\u043d\u0430\u0446\u0456\u043b\u044e\u0432\u0430\u0442\u0438.',
    repoPathTaken:
      '\u00ab{{name}}\u00bb \u0432\u0436\u0435 \u043a\u043e\u0440\u0438\u0441\u0442\u0443\u0454\u0442\u044c\u0441\u044f \u0446\u0438\u043c \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u0454\u043c.',
    repoPathRelative:
      '{{path}} \u2014 \u043d\u0435 \u0430\u0431\u0441\u043e\u043b\u044e\u0442\u043d\u0438\u0439 \u0448\u043b\u044f\u0445.',
    repoPathEmpty:
      '\u0428\u043b\u044f\u0445 \u0434\u043e \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0456\u044e \u043d\u0435 \u043c\u043e\u0436\u0435 \u0431\u0443\u0442\u0438 \u043f\u043e\u0440\u043e\u0436\u043d\u0456\u043c.',
    envFileEscapes:
      '{{path}} — не всередині воркспейса. Змінні пишуться у ворктрі, тож файл має бути в ньому.',
    envFileEmpty: 'Імʼя env-файла не може бути порожнім.',
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
    pushFailed: 'Не вдалося запушити {{branch}}. Git каже: {{reason}}',
    fetchFailed:
      'Не вдалося отримати оновлення з {{remote}}, тож цей воркспейс почався б із застарілої базової гілки. Git каже: {{reason}}',
    createFailed: 'Не вдалося відкрити pull request. GitHub каже: {{reason}}',
    nothingToCommit: 'Тут немає чого комітити.',
    commitFailed: 'Не вдалося зробити коміт. Git каже: {{reason}}',
    mergeFailed: 'GitHub не влив #{{number}}. Каже: {{reason}}',
    closeFailed: 'GitHub не закрив #{{number}}. Каже: {{reason}}',
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
    repoConfigSymlink:
      '{{path}} — символічне посилання. octopus не читає й не пише через нього, бо воно може вести куди завгодно поза репозиторієм.',
    repoConfigTooLarge: '{{path}} більший, ніж дозволено файлу такого роду.',
    repoConfigMalformed: '{{path}} не описує проєкт.',
    skillNameInvalid:
      '\u00ab{{name}}\u00bb не може бути назвою скіла: лише малі латинські літери, цифри й одиничні дефіси. Назва стає текою, де скіл лежить.',
    skillNameMismatch:
      'Документ називає \u00ab{{found}}\u00bb, а скіл записаний як \u00ab{{name}}\u00bb. Змініть назву в документі або імпортуйте його як новий скіл.',
    skillExists: 'Скіл із назвою \u00ab{{name}}\u00bb уже є.',
    skillMissing: 'Цього скіла вже немає.',
    skillFrontmatterMissing:
      'У SKILL.md має бути frontmatter із назвою скіла й описом, коли його вмикати. Тут його прочитати не вдалося.',
    skillTooLarge:
      'Це більше, ніж може бути один скіл, тому нічого не записано. Обмеження — {{limit}}.',
    skillLinkRefused:
      '\u00ab{{name}}\u00bb — символічне посилання. Скіл копіюється як є, а посилання зробило б його вміст питанням про інше місце на диску.',
    skillUrlRefused:
      'З {{url}} нічого не вдалося завантажити. Дозволені лише адреси https, а перенаправлення поза https відхиляється.',
    unknown: 'Щось пішло не так: {{message}}'
  }
}

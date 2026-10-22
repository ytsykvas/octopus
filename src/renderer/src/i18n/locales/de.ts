import type { Translation } from './en.js'

/**
 * German locale.
 *
 * Typed as `Translation`, so a missing or renamed key fails the type check
 * instead of silently falling back to English at runtime.
 */
export const de: Translation = {
  app: {
    name: 'octopus'
  },

  sidebar: {
    empty: 'Noch nichts hier. Füge mit „+“ ein Repository hinzu.',
    pick: 'Wähle ganz links ein Projekt.',
    addProject: 'Repository hinzufügen',
    projectDone: 'Ein Agent ist hier fertig geworden, während du weg warst',
    addFromDisk: 'Von der Festplatte…',
    addFromDiskHint: 'Ein Repository, das schon auf diesem Rechner liegt',
    addFromGitHubHint: 'Eines aus deinem GitHub-Konto klonen',
    addFromGitHub: 'Von GitHub…',
    removeProject: 'Projekt entfernen',
    editProject: 'Bearbeiten…',
    projectActions: 'Mehr',
    renameHint: 'Enter zum Speichern, Escape zum Abbrechen',
    removeTitle: 'Projekt entfernen?',
    removeMessage: '„{{name}}“ aus der Liste entfernen?',
    removeDetail:
      'Skripte, Mitnahmeliste und Variablen werden aus ~/.octopus gelöscht, Zugangsdaten inklusive. Das Repository bleibt auf der Festplatte, genau wo es ist.',
    removeDetailWorkspaces_one:
      'Sein Workspace wird samt Branch gelöscht, vorher läuft das Aufräumskript. Skripte, Mitnahmeliste und Variablen werden aus ~/.octopus gelöscht, Zugangsdaten inklusive. Das Repository selbst bleibt auf der Festplatte.',
    removeDetailWorkspaces_few:
      'Seine {{count}} Workspaces werden samt Branches gelöscht, vorher läuft für jeden das Aufräumskript. Skripte, Mitnahmeliste und Variablen werden aus ~/.octopus gelöscht, Zugangsdaten inklusive. Das Repository selbst bleibt auf der Festplatte.',
    removeDetailWorkspaces_many:
      'Seine {{count}} Workspaces werden samt Branches gelöscht, vorher läuft für jeden das Aufräumskript. Skripte, Mitnahmeliste und Variablen werden aus ~/.octopus gelöscht, Zugangsdaten inklusive. Das Repository selbst bleibt auf der Festplatte.',
    removeDetailWorkspaces_other:
      'Seine {{count}} Workspaces werden samt Branches gelöscht, vorher läuft für jeden das Aufräumskript. Skripte, Mitnahmeliste und Variablen werden aus ~/.octopus gelöscht, Zugangsdaten inklusive. Das Repository selbst bleibt auf der Festplatte.',
    removeConfirm: 'Entfernen',
    removeCancel: 'Abbrechen',
    collapse: 'Workspaces ausblenden',
    expand: 'Workspaces einblenden',
    settings: 'Einstellungen',
    plugins: 'Plugins',
    help: 'Hilfe'
  },

  repositories: {
    title: 'Von GitHub hinzufügen',
    search: 'Repositorys durchsuchen',
    empty: 'Keine Repositorys gefunden.',
    noMatch: 'Nichts passt zu „{{query}}“.',
    loading: 'Wird geladen…',
    private: 'Privat',
    cancel: 'Abbrechen',
    add: 'Hinzufügen',
    cloning: '{{name}} wird geklont…',
    cloneInto: 'Klonen nach',
    cloneIntoUnset: 'Du wirst gefragt, wohin geklont wird.',
    connect: 'GitHub verbinden…',
    capped:
      'GitHub hat so viele Repositorys geliefert wie angefragt – es kann also mehr geben, als hier stehen.',
    noOrganisations:
      'Fehlt hier eine Organisation, darf das angemeldete Token keine Organisationen sehen. So gibst du ihm das Recht:',
    silentOrganisations:
      'Du bist Mitglied von {{names}}, aber hier steht keines ihrer Repositorys. Entweder darfst du dort nirgends pushen, oder das Token muss dafür auf GitHub per SSO autorisiert werden.',
    grantOrgScope: 'gh auth refresh -s read:org'
  },

  workspaces: {
    requestRunning: 'Pull Request #{{number}} – Checks laufen',
    requestPassed: 'Pull Request #{{number}} – Checks bestanden',
    requestFailed: 'Pull Request #{{number}} – ein Check ist fehlgeschlagen',
    requestWaiting: 'Pull Request #{{number}} – keine Checks',
    requestMerged: 'Pull Request #{{number}} – gemergt',
    requestClosed: 'Pull Request #{{number}} – ohne Merge geschlossen',
    create: 'Neuer Workspace',
    createFirst: 'Ersten Workspace anlegen',
    createFirstHint: 'Eigener Branch von {{branch}}',
    rename: 'Umbenennen',
    remove: 'Workspace entfernen',
    missing: 'Verzeichnis fehlt',
    statusRunning: 'Der Agent arbeitet hier',
    statusWaiting: 'Wartet auf deine Antwort',
    statusError: 'Die letzte Runde endete mit einem Fehler',
    lineRunning: 'Arbeitet',
    lineRunningAgents_one: 'Arbeitet · {{count}} Agent',
    lineRunningAgents_few: 'Arbeitet · {{count}} Agenten',
    lineRunningAgents_many: 'Arbeitet · {{count}} Agenten',
    lineRunningAgents_other: 'Arbeitet · {{count}} Agenten',
    lineWaiting: 'Braucht deine Antwort',
    lineError: 'Fehler',
    lineDone: 'Fertig',
    lineInterrupted: 'Unterbrochen',
    lineIdle: 'Nicht gestartet',
    missingHint: 'Außerhalb der App gelöscht. Du kannst den Eintrag gefahrlos entfernen.',
    headElsewhere:
      'Der Worktree ist nicht auf {{branch}}. Was hier passiert, landet nicht im Branch dieses Workspaces.',
    changedFiles_one: '{{count}} Datei',
    changedFiles_few: '{{count}} Dateien',
    changedFiles_many: '{{count}} Dateien',
    changedFiles_other: '{{count}} Dateien',

    removeTitle: 'Workspace entfernen?',
    removeMessage: '„{{name}}“ entfernen?',
    removeDetail: 'Das Worktree-Verzeichnis wird gelöscht. Committete Arbeit bleibt im Branch.',
    removeDirty:
      'Dieser Workspace hat nicht committete Änderungen. Sie gehen verloren – es gibt keine weitere Kopie.',
    removeBranch: 'Auch den Branch {{branch}} löschen',
    removeConfirm: 'Entfernen',
    removeCancel: 'Abbrechen'
  },

  limits: {
    title: 'Claude',
    empty: 'Noch nicht abgefragt – klicke zum Abfragen.',
    refresh: 'Limits jetzt abfragen',
    unavailable: 'Noch keine Sitzung zum Abfragen. Öffne zuerst einen Workspace.',
    noPlan: 'Dieses Konto hat keine Plan-Zeitfenster.',
    failed: 'Das Konto hat nicht geantwortet. Klicke für einen neuen Versuch.',
    none: 'Das Konto hat keine Zeitfenster gemeldet.',
    windowFiveHour: '5h',
    windowSevenDay: '1W',
    windowSevenDayOpus: '1W Opus',
    windowSevenDaySonnet: '1W Sonnet',
    windowSevenDayOauthApps: '1W Apps',
    windowModelScoped: '1W pro Modell',
    windowModel: '1W {{name}}',
    reading: 'Zeitfenster {{name}}, {{percentage}} % verbraucht',
    binding: '{{name}} · jetzt',
    resets: 'Reset in {{time}}',
    hours: 'h',
    minutes: 'min',
    soon: 'jetzt',
    stale:
      'Vor dem Reset dieses Zeitfensters gelesen, der Wert ist also veraltet. Die nächste Runde aktualisiert ihn.',
    asOf: 'Stand vor {{age}}',
    asOfHint:
      'Das Konto hat auf keine neue Abfrage geantwortet, das sind also die letzten bekannten Werte. Klicke für einen neuen Versuch.'
  },

  project: {
    title: 'Projekteinstellungen',
    sectionGeneral: 'Allgemein',
    sectionGit: 'Git',
    sectionScripts: 'Skripte',
    sectionFiles: 'Dateien',
    sectionEnv: 'Env',
    sectionSkills: 'Skills',
    sectionLibrary: 'Befehle',
    sectionInstructions: 'Anweisungen',
    sectionRepository: 'Repository',
    sectionDanger: 'Gefahrenzone',
    repoLoading: 'Repository wird gelesen…',
    repoHint:
      'Ein Projekt speichert seine Einstellungen in ~/.octopus auf diesem Rechner. Sein Repository kann sie in .octopus/ mitbringen, und die App liest sie dort bei der Arbeit: Skripte, Anweisungen und – bei einem vertrauenswürdigen Repository – Basis-Branch und Env-Datei, jeweils sofern du nichts Eigenes gewählt hast. Seine Mitnahmeliste ergänzt die dieses Projekts. Name, Icon und Farbe werden einmal beim Hinzufügen übernommen. „Exportieren“ schreibt den Stand dieser Installation in den Checkout, als ganz normale nicht committete Änderung.',
    repoIgnored:
      'git ignoriert .octopus/, also bleibt alles, was dort landet, auf diesem Rechner. Nimm es aus der .gitignore, damit die Kopie auch andere erreicht.',
    trustTitle: 'Vertrauen',
    trustSwitch: 'Diesem Repository vertrauen',
    trustHint:
      'An: Seine Skripte laufen, und seine Claude-Einstellungen, Hooks und MCP-Server werden geladen, ohne dass du sie vorher siehst – sinnvoll für ein eigenes Repository, nicht für einen Klon. Aus: Jede Version wird vor der Nutzung einmal angezeigt; ein git pull, der etwas ändert, fragt also erneut.',
    trustLegacy:
      'Seine Skripte gelten noch aus der Zeit vor diesem Schalter als vertrauenswürdig, seine Claude-Einstellungen, Hooks und MCP-Server nicht. Schalte das ein, um allem zu vertrauen.',
    trustScripts: 'Mitgelieferte Skripte',
    repoRunsNone:
      'Dieses Repository liefert keine Skripte, es laufen also die aus den Einstellungen dieses Projekts.',
    repoRunsAllowed: 'Diese wurden gelesen und dürfen laufen.',
    repoRunsWaiting:
      'Diese wurden noch nicht gelesen, daher ist „Run“ gesperrt, bis sie erlaubt sind.',
    trustSettings: 'Claude-Einstellungen, Hooks und MCP-Server',
    trustSettingsNone: 'Dieses Repository bringt keine mit, es gibt also nichts zu erlauben.',
    trustSettingsAllowed: 'Diese wurden gelesen, und jede Sitzung lädt sie.',
    trustSettingsWaiting:
      'Diese wurden noch nicht gelesen, daher laden Sitzungen keine eigenen Einstellungen des Repositorys – auch nicht seine CLAUDE.md –, bis sie erlaubt sind.',
    trustReview: 'Prüfen und erlauben',
    repoOut: 'Ins Repository',
    repoExport: 'Exportieren',
    repoOverwrite_one:
      'Das Repository hat diese Datei bereits mit anderem Inhalt, und das ganze Team arbeitet damit. Überschreiben?',
    repoOverwrite_few:
      'Das Repository hat diese {{count}} Dateien bereits mit anderem Inhalt, und das ganze Team arbeitet damit. Überschreiben?',
    repoOverwrite_many:
      'Das Repository hat diese {{count}} Dateien bereits mit anderem Inhalt, und das ganze Team arbeitet damit. Überschreiben?',
    repoOverwrite_other:
      'Das Repository hat diese {{count}} Dateien bereits mit anderem Inhalt, und das ganze Team arbeitet damit. Überschreiben?',
    repoOverwriteConfirm: 'Überschreiben',
    repoOverwriteCancel: 'Repository-Version behalten',
    repoStateOnlyInRepository: 'noch nicht hier',
    repoStateOnlyInApp: 'nicht im Repository',
    repoStateSame: 'gleich',
    repoStateDiffers: 'anders',
    done: 'Fertig',
    name: 'Name',
    nameHint: 'Wird in der Seitenleiste angezeigt. Repository und Ordner bleiben unverändert.',
    baseBranch: 'Basis-Branch',
    baseBranchHint:
      'Neue Workspaces zweigen hier ab. Bestehende behalten den Branch, von dem sie erstellt wurden.',
    branchSearch: 'Branches durchsuchen',
    branchNone: 'Kein passender Branch',
    branchFailed:
      'Dieser Branch konnte nicht gesetzt werden. Vielleicht wurde er gelöscht, seit die Liste gelesen wurde.',
    color: 'Farbe',
    colorHint: 'Kennzeichnet das Projekt in der Tab-Leiste und färbt diese Seitenleiste.',
    icon: 'Icon',
    iconHint: 'Steht auf dem Projekt-Tab anstelle der Initialen.',
    iconNone: 'Initialen',
    setupScript: 'Build-Skript',
    setupScriptHint:
      'Läuft in einem neuen Workspace: Abhängigkeiten installieren, bauen, was gebaut werden muss – alles, was ein frischer Checkout braucht. Gespeichert als setup.sh.',
    files: 'Dateien, die in den Workspace mitkommen',
    filesHint:
      'Ein Pfad pro Zeile, relativ zum Repository. Ein Worktree enthält nur, was git verfolgt, daher müssen ignorierte Dateien – eine .env, eine config/master.key – mitgebracht werden. Sie werden beim Anlegen und vor jedem Run kopiert; eine vorhandene Datei wird nie überschrieben. Hänge „= /somewhere/else/.env“ an, um eine Datei stattdessen aus einem anderen Checkout zu holen – die Lösung für ein von GitHub geklontes Projekt, dessen Checkout keine ignorierten Dateien hat. Diese Quellen bleiben auf diesem Rechner und fehlen in der Kopie im Repository. Ein vertrauenswürdiges Repository ergänzt eigene Zeilen über .octopus/carry: Es zählt nur der Pfad, nur wenn git die Datei im Workspace ignoriert, und eine Zeile hier geht einer dort vor.',
    archiveScript: 'Aufräumskript',
    archiveScriptHint:
      'Läuft beim Entfernen eines Workspaces in dessen Verzeichnis, solange es noch existiert. Damit räumst du weg, was das Build-Skript angelegt hat – etwa eine Datenbank oder einen Container, benannt nach dem Workspace. Nichts, was es tut, hält das Entfernen auf. Gespeichert als archive.sh.',
    envFile: 'Env-Datei',
    envFileHint:
      'Die Datei im Workspace, in die die Variablen geschrieben werden, relativ zu seinem Wurzelverzeichnis. .env passt für die meisten Stacks; Vite liest .env.local und ignoriert alles daneben.',
    envProfile: 'Variablen-Set',
    envProfileHint:
      'Ein Projekt kann mehrere haben – etwa ein Dev- und ein Produktions-Set –, und jeder Workspace nutzt eines. Die Wahl triffst du hier, statt Blöcke in einer Datei ein- und auszukommentieren, wo die letzte Änderung stillschweigend gewinnt. Sie landen nie im Repository: Das Repository bestimmt, was läuft, dieser Rechner, wogegen. Welches Set ein Workspace nutzt, wählst du rechts in der Run-Zeile.',
    envProfileName: 'Name des Sets (Kleinbuchstaben, Ziffern und Bindestriche)',
    envProfileNewTitle: 'Neues Variablen-Set',
    envProfileDuplicateTitle: 'Kopie von „{{name}}“',
    envProfileRenameTitle: '„{{name}}“ umbenennen',
    envProfileNameConfirm: 'Anlegen',
    envProfileRenameConfirm: 'Umbenennen',
    envProfileNameCancel: 'Abbrechen',
    envProfileNameInvalid:
      'Nur Kleinbuchstaben, Ziffern und Bindestriche, beginnend mit einem Buchstaben oder einer Ziffer.',
    envProfileNew: 'Neu',
    envProfileDuplicate: 'Duplizieren',
    envProfileRename: 'Umbenennen',
    envProfileRemove: 'Löschen',
    envProfileRemoveTitle: '„{{name}}“ löschen?',
    envProfileRemoveMessage:
      'Das ist die einzige Kopie. Ein Variablen-Set wird nie ins Repository geschrieben, es gibt also nichts, woraus es sich wiederherstellen ließe.',
    envProfileRemoveDetail:
      'Workspaces, die es nutzen, fallen ohne Hinweis auf das Standard-Set des Projekts zurück.',
    envProfileRemoveConfirm: 'Set löschen',
    envProfileRemoveCancel: 'Behalten',
    envProfileMakeDefault: 'Als Standard nutzen',
    envOf: 'Variablen in „{{name}}“',
    envPlaceholder: 'MYSQL_HOST=dev.example\nAPP_URL=http://localhost:$OCTOPUS_PORT',
    envHint:
      'Ein KEY=value pro Zeile. Wird ans Ende von {{file}} im Workspace geschrieben, hat also Vorrang vor allem Kopierten – und ist die ganze Datei, wenn ein Klon nichts zum Kopieren hatte. $OCTOPUS_PORT wird zum eigenen Port des Workspaces und $OCTOPUS_WORKSPACE_SLUG zu seinem Namen in einer Form, die als Bezeichner taugt – kleingeschrieben, alles andere ein Unterstrich –, genau das, was eine nach dem Workspace benannte Datenbank braucht. Build-, Server- und Aufräumskript bekommen diese Variablen auch in ihrer eigenen Umgebung, dazu $OCTOPUS_ENV_PROFILE mit dem Namen des Sets – so kann ein setup.sh für jedes Set einen anderen Dump laden. Bleibt auf diesem Rechner, nie im Repository.',
    envNotIgnored:
      'git ignoriert {{file}} in diesem Repository nicht, also erscheint, was du hier eingibst, im Workspace als Änderung – und kann committet werden. Füge die Datei zur .gitignore hinzu oder, falls das Repository sie verfolgt, beende zuerst das Tracking.',
    envMarker:
      'Zeile {{line}}: Das ist eine von octopus’ eigenen Markierungen – sie wird entfernt, bevor der Block geschrieben wird.',
    envNoAssignment: 'Zeile {{line}}: „{{subject}}“ ist kein KEY=value, also liest es niemand.',
    envBadName: 'Zeile {{line}}: „{{subject}}“ ist kein gültiger Name für eine Env-Datei.',
    envDuplicate: 'Zeile {{line}}: {{subject}} wird erneut gesetzt – nur der letzte Wert zählt.',
    envUnknownVariable:
      'Zeile {{line}}: ${{subject}} ist keine Variable von octopus und bleibt als Text in der Datei.',
    runScript: 'Server-Skript',
    runScriptHint:
      'Startet den Dev-Server. $OCTOPUS_PORT ist auf den eigenen Port des Workspaces gesetzt, so können mehrere gleichzeitig laufen. Gespeichert als run.sh.',
    sources: 'Was der Agent von selbst mitnimmt',
    sourcesHint:
      'octopus lädt dieselben Einstellungen wie Claude Code im Terminal, der Agent kennt also schon, was dieses Repository und dieser Rechner für ihn festgelegt haben – die des Repositorys, sobald sie gelesen und erlaubt sind. Nichts davon sendet octopus selbst.',
    permissions: 'Was diese Einstellungen erlauben und verbieten',
    permissionsHint:
      'Regeln, die Claude Code selbst anwendet, bevor octopus überhaupt fragt. Angezeigt werden sie hier, geändert in ihrer Datei – zwei der drei liegen im Repository, und bearbeitet octopus eine davon, ist das Projekt nicht mehr freigegeben.',
    permissionAllow: 'erlaubt',
    permissionDeny: 'verbietet',
    permissionAsk: 'fragt',
    sourceProjectMemory: 'CLAUDE.md in diesem Repository',
    sourceProjectSettings: '.claude/settings.json',
    sourceLocalSettings: '.claude/settings.local.json',
    sourceUserSettings: 'Deine settings.json',
    sourceUserMemory: 'Deine CLAUDE.md',
    sourceCommands: 'Slash-Befehle',
    sourceAgents: 'Subagenten',
    sourceMcp: 'MCP-Server (.mcp.json)',
    sourceSkills: 'Skills',
    sourceUserCommands: 'Deine Slash-Befehle',
    sourceUserAgents: 'Deine Subagenten',
    sourceNotLoaded: 'vorhanden, nicht gelesen',
    sourcePresent: 'geladen',
    sourceAbsent: 'keine',
    sourceCount: '{{count}} geladen',
    repository: 'Repository',
    repositoryHint:
      'Wo das Projekt liegt. Solange das Projekt keine Workspaces hat, kann der Pfad geändert werden – Skripte, Variablen und Anweisungen bleiben erhalten, weil sie am Projekt hängen, nicht am Pfad.',
    repositoryLocked:
      'Jeder Workspace ist ein Git-Worktree, der in diesem Repository registriert ist, daher lässt sich der Pfad nicht ändern, solange es welche gibt. Entferne sie zuerst.',
    repositoryChange: 'Ändern…',
    repositoryPick: 'Repository für dieses Projekt wählen',
    dangerZone: 'Gefahrenzone',
    removeHint:
      'Entfernt das Projekt aus octopus. Alle Workspaces verschwinden, nachdem ihr Aufräumskript gelaufen ist, und Skripte, Dateien und Variablen dieses Projekts werden aus ~/.octopus gelöscht – Zugangsdaten inklusive. Das Repository bleibt auf der Festplatte.'
  },

  combobox: {
    search: 'Suchen',
    empty: 'Nichts gefunden'
  },

  modal: {
    close: 'Schließen',
    minimize: 'Minimieren'
  },

  scripts: {
    build: 'Build',
    server: 'Server',
    serverRestart: 'Neu starten',
    stop: 'Stoppen',
    openInBrowser: 'localhost:{{port}} öffnen',
    busy: 'läuft…',
    foldBuild: 'Build einklappen',
    unfoldBuild: 'Build anzeigen',
    edit: 'Skript schreiben',
    editScripts: 'Skripte dieses Projekts bearbeiten',
    env: 'Env',
    envRestart:
      'Der Server läuft noch mit dem vorherigen Variablen-Set. Starte ihn neu, um die Änderung zu übernehmen.',
    envSwitch: 'Variablen-Set dieses Workspaces',
    envRebuild:
      'Gebaut mit „{{built}}“. Ein Neustart behält diesen Build – stoppe und drück dann erneut „Run“, um mit „{{current}}“ zu bauen.',
    envFollow: 'Wie im Projekt ({{name}})',
    editEnv: 'Variablen…',
    strayTitle: 'Hier läuft bereits ein Server',
    strayMessage:
      'Octopus hat ihn nicht gestartet – ein Agent oder ein Terminal war es. Solange er läuft, startet der Server dieses Workspaces womöglich nicht.',
    strayLine: '{{command}} – Prozess {{pid}}, Port {{ports}}',
    strayConfirm: 'Stoppen und starten',
    strayCancel: 'Abbrechen',
    repoUnreadable:
      'Die Einstellungen dieses Repositorys konnten nicht gelesen werden, daher kann hier nichts laufen: {{reason}}',
    repoNotice:
      'Dieses Repository liefert die Skripte unten. Lies sie, bevor sie laufen – sie kommen mit einem git pull, also läuft hier, was immer der Branch vorgibt.',
    repoApprove: 'Erlauben',
    showEnv: 'Env dieses Workspaces',
    noEnv:
      'Dieser Workspace hat noch keine Env-Datei. Sie entsteht, sobald das Projekt eine Datei mitnimmt oder eigene Variablen hinzufügt.',
    editFiles: 'Mitgenommene Dateien…',
    carryMissing:
      'Nicht mitgenommen, die Skripte laufen also ohne: {{files}}. Prüfe die Liste unter „Dateien“ – vielleicht wurde die Quelle verschoben, oder dieser Checkout hatte sie nie.',
    runAll: 'Run',
    running: 'Baut…',
    runHint: 'Baut diesen Workspace und startet dann seinen Server.',
    runBuilding: 'Baut. Der Server startet, wenn das fertig ist.',
    runServing: 'Läuft.',
    buildFailed: 'Der Build ist fehlgeschlagen, der Server wurde nicht gestartet.',
    awaitingApproval: 'Erlaube zuerst die Skripte dieses Repositorys im Tab „Skripte“.',
    portSilent: 'Läuft, aber auf {{port}} lauscht nichts. Nutzt das Skript $OCTOPUS_PORT?',
    noWorkspaceTitle: 'Noch nichts zu starten',
    noWorkspaceBody: 'Wähle links einen Workspace, um hier seine Skripte zu starten.',
    noSetupTitle: 'Noch kein Build-Skript',
    noSetupBody:
      'Es läuft in einem frischen Workspace – installiert Abhängigkeiten und alles, was ein Checkout vor der Arbeit braucht.',
    noRunTitle: 'Noch kein Server-Skript',
    noRunBody:
      'Es startet den Dev-Server und bekommt einen eigenen Port, damit mehrere Workspaces gleichzeitig laufen können.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Führt setup.sh in diesem Workspace aus.',
    runIdle: 'Startet den Dev-Server für diesen Workspace.'
  },

  panel: {
    files: 'Dateien',
    changes: 'Änderungen',
    terminal: 'Terminal',
    scripts: 'Skripte',
    pullRequest: 'Pull Request',
    notes: 'Notizen',
    collapse: 'Bereich einklappen',
    expand: 'Bereich anzeigen',
    terminalPlaceholderTitle: 'Alles ruhig hier',
    terminalPlaceholderBody:
      'Wähle links einen Workspace, dann öffnet sich ein Terminal in seinem Verzeichnis.',
    resize: 'Größe ändern'
  },

  files: {
    tree: 'Dateien dieses Workspaces',
    refresh: 'Aktualisieren',
    collapseAll: 'Alle Ordner einklappen',
    reveal: 'Geöffnete Datei zeigen',
    filter: 'Dateien filtern',
    matches: 'Passende Dateien',
    noMatchTitle: 'Keine passende Datei',
    noMatchBody: 'Keine Datei im Baum heißt auch nur ähnlich wie „{{query}}“.',
    matchesCapped: 'Die ersten {{limit}} Treffer. Tippe weiter, um sie einzugrenzen.',
    noWorkspaceTitle: 'Noch nichts zum Durchsehen',
    noWorkspaceBody: 'Wähle links einen Workspace, um seine Dateien zu durchsuchen.',
    loading: 'Dateien werden gelesen…',
    emptyTitle: 'Keine Datei in Sicht',
    emptyBody: 'Dieser Workspace hat noch keine Dateien.',
    truncated: 'Nur die ersten {{limit}} Dateien werden angezeigt.',
    loadingFolder: 'Wird gelesen…',
    folderFailed: 'Dieser Ordner konnte nicht gelesen werden.',
    folderTruncated: 'Nur die ersten {{limit}} Einträge werden angezeigt.',
    folderEmpty: 'Dieser Ordner ist leer.',
    ignored: 'von git ignoriert',
    changesInside: 'enthält Änderungen',
    statusConflictedLabel: 'Konflikt',
    tabs: 'Geöffnete Dateien',
    preview: '{{name}} – Vorschau. Eine andere Datei ersetzt sie; Doppelklick hält sie offen.',
    close: '{{name}} schließen',
    copyPath: 'Pfad kopieren (⌥⌘C)',
    copyRelativePath: 'Relativen Pfad kopieren (⌥⇧⌘C)',
    addToChat: 'Zum Chat hinzufügen',
    pathCopied: 'Pfad kopiert',
    copyFailed: 'Pfad konnte nicht kopiert werden'
  },

  viewer: {
    loading: 'Wird geöffnet…',
    binary: 'Das ist eine Binärdatei ({{size}}), sie wird hier nicht angezeigt.',
    tooLarge: 'Diese Datei ist {{size}} groß – mehr als die {{limit}}, die hier angezeigt werden.',
    missing: 'Diese Datei gibt es nicht mehr.',
    deleted: 'Diese Datei wurde gelöscht. Das ist ihre zuletzt committete Version.',
    deletedUnreadable:
      'Diese Datei wurde gelöscht, und ihre zuletzt committete Version kann hier nicht angezeigt werden.',
    plain: 'Ohne Farben angezeigt: Die Datei ist zu groß für Syntax-Hervorhebung.',
    openExternally: 'Im Editor öffnen',
    reload: 'Neu laden',
    selection: 'Zeilen {{range}}',
    addTo: 'Zu {{name}} hinzufügen',
    copyReference: 'Pfad kopieren',
    copied: 'Pfad kopiert',
    copyFailed: 'Kopieren fehlgeschlagen',
    notePlaceholder: 'Was soll der Agent über diese Zeilen wissen? (optional)'
  },

  sources: {
    layerRepository: 'Repository',
    layerProject: 'Dieses Projekt',
    layerGlobal: 'Einstellungen',
    layerTemplate: 'Vorlage',
    inEffect: 'Aktiv: {{layer}}',
    nothingInEffect: 'Nichts läuft',
    layers: 'Woher {{setting}} kommen kann',
    useMine: 'Eigene statt der des Repositorys nutzen',
    useMineHint:
      'Das Repository liefert das, und seine Version gilt. Ist der Schalter an, gilt stattdessen die dieses Projekts, und die des Repositorys wird nicht gelesen.',
    useMineHintCarry:
      'Die Liste des Repositorys ergänzt die dieses Projekts um ihre Zeilen, und deine gewinnt, wo beide dieselbe Datei nennen. Ist der Schalter an, wird nur die Liste dieses Projekts übernommen, und die des Repositorys wird nicht gelesen.',
    fromRepository: 'Aus {{path}} im Checkout. Ändere es dort oder nutze eine eigene.',
    fromRepositoryCarry:
      'Aus {{path}}. Seine Zeilen kommen zur Liste dieses Projekts dazu – nur Dateien, die git im Workspace ignoriert, nie von dem Ort, den eine Zeile nennt, und erst, wenn du dem Repository vertraust.',
    fromGlobal: 'Aus Einstellungen → Anweisungen, für jedes Projekt ohne eigene.',
    fromTemplate: 'Was octopus mitliefert. Gilt, wenn sonst nichts geschrieben ist.',
    scriptTemplate: 'Der Startpunkt für den Editor. Davon läuft nichts.',
    repositoryStates: 'Das Repository setzt {{value}}.',
    warningRepositoryNotTrusted:
      'Dem Repository wird noch nicht vertraut, daher gilt die Einstellung dieses Projekts. Vertraue ihm unter „Repository“.',
    warningBaseBranchMissing:
      'Dieser Checkout hat keinen solchen Branch, daher gilt die Einstellung dieses Projekts.',
    warningEnvFileOutside:
      'Dieser Pfad führt aus dem Worktree heraus, daher gilt die Einstellung dieses Projekts.',
    warningEnvFileNotIgnored:
      'git würde diese Datei committen, und die Variablen darin sind Zugangsdaten, daher gilt die Einstellung dieses Projekts.',
    warningProjectFileUnreadable:
      '.octopus/project.json des Repositorys konnte nicht gelesen werden, daher gilt die Einstellung dieses Projekts.',
    tableTitle: 'Woher jede Einstellung kommt',
    tableHint:
      'Das .octopus/ des Repositorys wird gelesen, während die App läuft, und hat standardmäßig Vorrang; stell einen Eintrag um, damit die Einstellung dieses Projekts gilt. Die Mitnahmeliste des Repositorys ergänzt die dieses Projekts, statt sie zu ersetzen. Name, Icon und Farbe gehören diesem Projekt – die des Repositorys werden einmalig übernommen, wenn das Projekt hinzugefügt wird.',
    columnSetting: 'Einstellung',
    columnInEffect: 'Aktiv',
    columnUseMine: 'Eigene',
    open: '{{setting}} öffnen'
  },

  instructions: {
    scopeGlobal:
      'Ein Projekt kann eine eigene schreiben, die dann statt dieser gilt – und ein Repository mit einer eigenen in .octopus/instructions/ geht beiden vor.',
    scopeProject:
      'Gilt statt der in den Einstellungen; leer heißt, dieses Projekt fügt nichts hinzu. Ein Repository mit einer eigenen in .octopus/instructions/ geht vor, außer du wählst deine eigene.',

    pullRequest: 'PR-Beschreibungen',
    pullRequestHint:
      'Wird gesendet, wenn du den Agenten bittest, eine Änderung für einen Pull Request zu beschreiben.',
    commitMessage: 'Commit-Nachrichten',
    commitMessageHint:
      'Wird mit der obigen gesendet, wenn der Tab „Pull Request“ diesen Workspace committet und niemand eine Nachricht dafür geschrieben hat.',
    fixChecks: 'Fehlgeschlagenen Check beheben',
    fixChecksHint:
      'Wird gesendet, wenn ein Check am Pull Request fehlgeschlagen ist und du den Agenten bittest, ihn zu beheben.',
    addressReview: 'Auf ein Review antworten',
    addressReviewHint:
      'Wird gesendet, wenn du das Review eines Pull Requests an den Agenten übergibst.',
    review: 'Eine Änderung reviewen',
    reviewHint: 'Wird gesendet, wenn du den Agenten bittest, den Pull Request selbst zu reviewen.',
    multiAgentReview: 'Review aus mehreren Blickwinkeln',
    multiAgentReviewHint:
      'Wird gesendet, wenn du ein Review durch mehrere Subagenten zugleich anforderst, von denen jeder auf eine Sache achtet.',
    resolveConflicts: 'Konflikte lösen',
    resolveConflictsHint:
      'Wird gesendet, wenn der Pull Request mit seinem Basis-Branch kollidiert und du den Agenten bittest, das zu lösen.',
    setupScripts: 'Das Projekt startklar machen',
    setupScriptsHint:
      'Wird ungesendet in ein neues Gespräch gelegt, wenn du Hilfe → „Dieses Projekt startklar machen“ wählst. Octopus fügt darunter den Checkout, die geltenden Skripte, die mitgenommenen Dateien und die Namen der Variablen an — nie ihre Werte.',
    diagnoseRun: 'Einen fehlgeschlagenen Lauf untersuchen',
    diagnoseRunHint:
      'Wird ungesendet in ein neues Gespräch gelegt, wenn du Hilfe → „Warum funktioniert Run nicht?“ wählst. Octopus fügt dieselben Fakten und die letzten Zeilen des jüngsten Builds und Servers mit ihren Exit-Codes an.'
  },

  help: {
    setup: 'Dieses Projekt startklar machen',
    setupHint:
      'Der Agent liest das Repository und schreibt die Skripte für Build, Server und Aufräumen',
    diagnose: 'Warum funktioniert Run nicht?',
    diagnoseHint:
      'Der Agent liest die Ausgabe des letzten Laufs, die Skripte und die Variablennamen',
    /* Die Fakten, die octopus unter die Anweisung schreibt. Der Agent liest sie,
       also schlicht und wörtlich. */
    context: {
      heading: '\u2014 Was octopus über diesen Workspace weiß \u2014',
      checkout: 'Checkout ($OCTOPUS_ROOT_PATH): {{path}}',
      envFile: 'Env-Datei, in die das Variablen-Set geschrieben wird: {{name}}',
      profile: 'Geltendes Variablen-Set: {{name}}',
      variables:
        'Variablen, die es den Skripten gibt (nur Namen; die Werte bleiben in octopus): {{names}}',
      noVariables: 'Das geltende Set setzt keine Variablen.',
      scripts: 'Geltende Skripte:',
      script: '- {{kind}}: {{from}}',
      scriptMissing: '- {{kind}}: keins',
      unapproved:
        'Die Skripte des Repositorys sind noch nicht erlaubt, deshalb bleibt Run deaktiviert, bis sie es sind.',
      carry: 'Dateien, die vor einem Lauf in den Workspace mitgenommen werden:',
      noCarry: 'Es werden keine Dateien in den Workspace mitgenommen.',
      problems: 'Probleme im Variablen-Set:',
      problemNoAssignment: '- Zeile {{line}} ist keine Zuweisung',
      problemBadName:
        '- Zeile {{line}}: was vor „=“ steht, ist kein Name, den ein Parser akzeptiert',
      problemDuplicate:
        '- Zeile {{line}}: {{subject}} ist doppelt gesetzt, und nur der letzte zählt',
      problemUnknownVariable:
        '- Zeile {{line}}: ${{subject}} ist keine Variable, die octopus setzt',
      problemMarker: '- Zeile {{line}}: hier wurde eine octopus-Markierung eingefügt',
      lastRun: '{{stage}}: um {{at}} mit Exit-Code {{code}} beendet. Die letzten Zeilen:',
      lastRunStopped: '{{stage}}: um {{at}} durch ein Signal beendet. Die letzten Zeilen:',
      lastRunRunning: '{{stage}}: läuft noch. Die letzten Zeilen bisher:',
      lastRunRefused: '{{stage}}: nicht gestartet. Der Tab Skripte meldete: {{reason}}',
      noOutput: '(keine Ausgabe)',
      noRun:
        'Seit octopus gestartet wurde, ist in diesem Workspace nichts gelaufen. Drück Run im Tab Skripte und frag dann noch einmal.'
    }
  },

  pullRequest: {
    capped:
      'GitHub wurde nach den neuesten hundert Kommentaren und fünfzig Threads gefragt und hat genau so viele geliefert – es kann also ältere geben, die hier fehlen. Auf GitHub sind alle zu sehen.',
    noWorkspaceTitle: 'Noch nichts vorzuschlagen',
    noWorkspaceBody:
      'Wähle links einen Workspace, um aus seinem Branch einen Pull Request zu öffnen.',
    loading: 'Frage GitHub nach diesem Branch…',
    editInstructions: 'Anweisungen für einen neuen PR',
    ask: 'Den Agenten beschreiben lassen',
    drafting: 'Wird geschrieben…',
    emptyHint:
      'Lass diese Felder leer, dann schreibt der Agent sie: den Titel aus dem, was die Aufgabe getan hat, die Beschreibung so, wie dieses Projekt sie verlangt.',
    emptyHintSettings: 'Ändern, wie er sie schreibt',
    written: 'Vom Agenten geschrieben. Bearbeite es und öffne dann den Pull Request.',
    noConversation: 'Öffne zuerst einen Chat in diesem Workspace.',
    nothingToOpen:
      'Noch nichts zu öffnen. Dieser Branch hat keine Commits, die {{base}} nicht hat – erstelle zuerst einen.',
    willPush: 'Dieser Branch ist noch nicht auf GitHub. Beim Öffnen wird er gepusht.',
    dirty:
      'Hier gibt es nicht committete Änderungen. Sie werden mit dem Pull Request committet – mit der Nachricht oben oder einer, die der Agent schreibt.',
    title: 'Titel',
    titlePlaceholder: 'Was diese Änderung macht',
    body: 'Beschreibung',
    bodyPlaceholder: 'Alles, was ein Reviewer wissen muss',
    draft: 'Als Entwurf öffnen',
    create: 'Pull Request öffnen',
    creating: 'Wird geöffnet…',
    open: 'Auf GitHub öffnen',
    stateOpen: 'Pull Request #{{number}} ist offen.',
    stateMerged: 'Pull Request #{{number}} wurde gemergt.',
    stateClosed: 'Pull Request #{{number}} wurde ohne Merge geschlossen.',

    createShortcut: 'PR erstellen',
    commitMessage: 'Commit-Nachricht',
    commitMessagePlaceholder: 'Das Ding umbenennen',
    commitHint:
      'Committet alle Änderungen in diesem Workspace mit dieser Nachricht und öffnet dann den Pull Request.',
    envNotIgnored:
      'git ignoriert {{file}} nicht, und octopus schreibt die Variablen dieses Workspaces hinein. Alles zu committen würde sie in den Pull Request bringen.',
    envNotIgnoredPush:
      'git ignoriert {{file}} nicht, und octopus schreibt die Variablen dieses Workspaces hinein. Committen und Pushen würde sie an GitHub senden.',

    refresh: 'Neu von GitHub laden',
    readAt: 'Stand: {{time}}',
    isDraft: 'Entwurf',

    checks: 'Checks',
    checksNone: 'Dieses Repository führt bei einem Pull Request nichts aus.',
    rerunFailed: 'Fehlgeschlagene',
    rerunFailedTitle: 'Fehlgeschlagene Jobs erneut ausführen',
    rerunAll: 'Alle',
    rerunAllTitle: 'Alle Checks erneut ausführen',
    checkPending: 'läuft',
    checkPassed: 'bestanden',
    checkFailed: 'fehlgeschlagen',
    checkSkipped: 'übersprungen',

    review: 'Review',
    unknownAuthor: 'ein gelöschtes Konto',
    reviewNone: 'Bisher hat niemand etwas gesagt.',
    addToChat: 'Zum Chat hinzufügen',
    resolved: 'gelöst',
    reply: 'Antworten',
    replyPlaceholder: 'Auf diesen Thread antworten…',
    replySend: 'Senden',
    replying: 'Wird gesendet…',
    replyCancel: 'Abbrechen',
    resolveThread: 'Lösen',
    unresolveThread: 'Wieder öffnen',
    mergedDone: 'Dieser Branch ist gemergt. Sein Workspace ist noch da.',
    removeWorkspace: 'Workspace entfernen…',
    verdictApproved: 'hat genehmigt',
    verdictChangesRequested: 'hat Änderungen angefordert',
    verdictCommented: 'hat kommentiert',
    verdictDismissed: 'verworfen',
    decisionApproved: 'Genehmigt',
    decisionChangesRequested: 'Änderungen angefordert',
    decisionReviewRequired: 'Review erforderlich',

    merge: 'Mergen',
    close: 'Schließen',
    closing: 'Wird geschlossen…',
    merging: 'Wird gemergt…',
    methodMerge: 'Merge-Commit',
    methodSquash: 'Squash and merge',
    methodRebase: 'Rebase and merge',
    conflicting: 'Dieser Branch kollidiert mit {{base}}.',
    mergeBlocked: 'GitHub mergt das noch nicht – ein erforderliches Review oder ein Check fehlt.',
    mergeBehind: '{{base}} hat sich weiterentwickelt, seit dieser Branch abgezweigt wurde.',
    mergeUnstable: 'Ein Check ist nicht bestanden, aber Mergen ist trotzdem erlaubt.',
    mergeDraft: 'Ein Entwurf kann nicht gemergt werden. Markiere ihn zuerst auf GitHub als bereit.',
    mergeChecksRunning_one: '{{count}} Check läuft noch.',
    mergeChecksRunning_few: '{{count}} Checks laufen noch.',
    mergeChecksRunning_many: '{{count}} Checks laufen noch.',
    mergeChecksRunning_other: '{{count}} Checks laufen noch.',
    mergeChecksFailed_one: '{{count}} Check fehlgeschlagen. Behebe ihn vor dem Merge.',
    mergeChecksFailed_few: '{{count}} Checks fehlgeschlagen. Behebe sie vor dem Merge.',
    mergeChecksFailed_many: '{{count}} Checks fehlgeschlagen. Behebe sie vor dem Merge.',
    mergeChecksFailed_other: '{{count}} Checks fehlgeschlagen. Behebe sie vor dem Merge.',

    fixChecks: 'Checks beheben',
    addressReview: 'Review bearbeiten',
    doReview: 'Reviewen',
    multiAgentReview: 'Multi-Agent-Review',
    resolveConflicts: 'Konflikte lösen',
    commitAndPush: 'Committen und pushen',
    push: 'Pushen',
    pushing: 'Wird gepusht…',
    unpushed_one: '{{count}} Commit ist noch nicht auf GitHub.',
    unpushed_few: '{{count}} Commits sind noch nicht auf GitHub.',
    unpushed_many: '{{count}} Commits sind noch nicht auf GitHub.',
    unpushed_other: '{{count}} Commits sind noch nicht auf GitHub.',
    unpushedUnknown:
      'Was noch zu pushen ist, lässt sich von hier nicht zählen: Diesem Checkout fehlt, was GitHub für diesen Branch hat, oder HEAD steht nicht darauf. Führe zuerst im Terminal git fetch aus.',
    commitNeedsMessage: 'Schreib zuerst oben eine Commit-Nachricht.',
    commitAndPushHint:
      'Committet alle Änderungen in diesem Workspace mit dieser Nachricht und pusht sie dann in den Pull Request.',
    sending: 'Wird gesendet…',

    context: 'Pull Request #{{number}} – Branch {{branch}} in {{base}}\n{{url}}',
    failedChecks: 'Fehlgeschlagene Checks:\n{{list}}',
    failedCheck: '- {{name}} – {{url}}',
    failedCheckNoLink: '- {{name}}',
    quoteIntro: 'Aus dem Review zu diesem Pull Request:'
  },

  diff: {
    noWorkspaceTitle: 'Noch nichts zu vergleichen',
    noWorkspaceBody: 'Wähle links einen Workspace, um zu sehen, was er geändert hat.',
    cleanTitle: 'Keine einzige Änderung',
    cleanBody:
      'In diesem Workspace hat sich noch nichts geändert. Änderungen – deine oder die des Agenten – erscheinen hier.',
    loading: 'Änderungen werden gelesen…',
    against: 'gegenüber {{branch}}',
    fileCount_one: '{{count}} Datei',
    fileCount_few: '{{count}} Dateien',
    fileCount_many: '{{count}} Dateien',
    fileCount_other: '{{count}} Dateien',
    refresh: 'Änderungen neu laden',
    expandAll: 'Alle Dateien aufklappen',
    collapseAll: 'Alle Dateien einklappen',
    unified: 'Eine Spalte',
    split: 'Nebeneinander',
    splitTooNarrow: 'Der Bereich ist zu schmal für zwei Spalten – zieh ihn breiter.',
    renamedFrom: 'verschoben von {{path}}',
    modeExecutable: 'ausführbar gemacht',
    modeNotExecutable: 'nicht mehr ausführbar',
    modeChanged: 'Modus {{from}} → {{to}}',
    binary: 'Binärdatei – nichts anzuzeigen.',
    tooLarge: 'Zu groß zum Anzeigen. Öffne die Datei, um sie zu lesen.',
    nestedRepository:
      'Ein eigenes Repository. Git speichert es als Verweis statt seiner Dateien, sobald es einen eigenen Commit hat.',
    revert: 'Zurücksetzen',
    revertFile: '{{path}} zurücksetzen',
    revertTitle: 'Diese Datei zurücksetzen?',
    revertMessage:
      '{{path}} kehrt zum Stand zurück, den die Datei beim Abzweigen dieses Workspaces hatte.',
    revertDetail:
      'Nicht gespeicherte Änderungen darin gehen endgültig verloren – git hat keine Kopie davon. Bereits Committetes bleibt im Branch und wird durch eine Änderung im Arbeitsverzeichnis rückgängig gemacht.',
    revertConfirm: 'Zurücksetzen',
    revertCancel: 'Behalten',
    invisibleCharacters:
      'Diese Datei enthält Zeichen, die anders dargestellt werden, als sie sind – eine Zeile kann anders aussehen, als sie ausgeführt wird.',
    writtenBy: 'Geschrieben von {{names}}',
    writtenByFilter: 'Nur zeigen, was {{name}} geschrieben hat',
    writtenByAll: 'Alles',
    omittedFiles_one: '{{count}} Datei ist zu groß zum Anzeigen',
    omittedFiles_few: '{{count}} Dateien sind zu groß zum Anzeigen',
    omittedFiles_many: '{{count}} Dateien sind zu groß zum Anzeigen',
    omittedFiles_other: '{{count}} Dateien sind zu groß zum Anzeigen',
    publishUncommitted: 'nicht committet',
    publishCommitted: 'committet',
    publishPushed: 'gepusht',
    publishUncommittedLabel: 'Nicht committet – erst committen, dann pushen',
    publishCommittedLabel: 'Hier committet, noch nicht auf GitHub – jetzt pushen',
    publishPushedLabel: 'Auf GitHub, und hier ist nichts neuer',
    publishStale: 'Der Pull Request zeigt noch eine ältere Version dieser Datei.',
    publishNoRemote: 'Dieser Branch ist noch nicht auf GitHub.',
    publishNoRemoteShort: 'nicht auf GitHub',
    pathWithStatus: '{{status}}: {{path}}',
    fileState: '{{status}} · {{stage}}',
    publishHeadElsewhere:
      'HEAD steht nicht auf dem Branch {{branch}} dieses Workspaces, daher lässt sich hier nichts über GitHub sagen. Checke ihn im Terminal aus.',
    publishAllSent: 'Alles hier ist auf GitHub.',
    publishUnpushed_one: '{{count}} Commit nicht gepusht',
    publishUnpushed_few: '{{count}} Commits nicht gepusht',
    publishUnpushed_many: '{{count}} Commits nicht gepusht',
    publishUnpushed_other: '{{count}} Commits nicht gepusht',
    publishStaleCount_one: '{{count}} Datei ist im Pull Request veraltet',
    publishStaleCount_few: '{{count}} Dateien sind im Pull Request veraltet',
    publishStaleCount_many: '{{count}} Dateien sind im Pull Request veraltet',
    publishStaleCount_other: '{{count}} Dateien sind im Pull Request veraltet',
    publishStaleHint:
      'Die Version auf GitHub ist veraltet: Der Pull Request enthält ältere Versionen dieser Dateien als du hier. Pushe, um ihn zu aktualisieren.',
    publishCount: '{{count}} {{state}}',
    push: 'Pushen',
    pushing: 'Wird gepusht…',
    copyPath: 'Pfad kopieren',
    copied: 'Pfad kopiert',
    copyFailed: 'Kopieren fehlgeschlagen',
    openFile: 'Datei öffnen',
    fileActions: 'Aktionen für {{path}}',
    statusAddedLabel: 'Hinzugefügt',
    statusModifiedLabel: 'Geändert',
    statusDeletedLabel: 'Gelöscht',
    statusRenamedLabel: 'Umbenannt',
    statusCopiedLabel: 'Kopiert',
    statusTypeChangedLabel: 'Typ geändert',
    statusUntrackedLabel: 'Nicht verfolgt',
    comment: 'Zeile {{line}} kommentieren',
    commentOld: 'Zeile {{line}} der alten Fassung kommentieren',
    addToChat: 'Zum Chat hinzufügen',
    commentPlaceholder: 'Was soll der Agent hier ändern?',
    commentSave: 'Hinzufügen',
    commentCancel: 'Abbrechen',
    commentRemove: 'Diese Notiz entfernen',
    commentIntro: 'Review-Notizen zu den Änderungen:',
    noteOldSide: '(in der alten Fassung, vor dieser Änderung)',
    noteOldSideShort: '(alte Fassung)'
  },

  chat: {
    tabs: 'Chats',
    tab: '{{agent}} {{number}}',
    side: {
      title: 'Nebenfragen',
      open: 'Nebenfrage stellen',
      close: 'Nebenfragen schließen',
      clear: 'Nebenfragen leeren',
      hint: 'Frag etwas zum Chat, ohne ihn zu unterbrechen. Der Agent antwortet aus dem, was er schon weiß, ohne Tools – und nichts hiervon landet im Chat.',
      placeholder: 'Nebenfrage stellen',
      field: 'Deine Nebenfrage',
      send: 'Fragen',
      answering: 'Antwortet…',
      empty: 'Der Agent hatte hierauf keine Antwort.',
      unread: 'Eine Antwort wartet',
      fork: 'Mit dieser Antwort in einem neuen Chat weitermachen'
    },
    tabStatus: '{{name}}: {{state}}',
    tabStatusIdle: 'noch nichts geschrieben',
    tabStatusDone: 'fertig',
    tabStatusInterrupted: 'unterbrochen',
    newTab: 'Neuer Chat',
    renameTab: 'Umbenennen…',
    forkTab: 'In neuem Chat fortsetzen',
    forkTabHint: 'Der Agent behält, was er aus diesem Chat weiß.',
    copyTranscript: 'Verlauf kopieren',
    copyTranscriptHint: 'Um einen anderen Chat über diesen zu informieren.',
    closeTab: 'Chat schließen',
    todos: 'Aufgaben',
    todosProgress: '{{done}} von {{total}}',
    todoStatus: {
      pending: 'offen',
      in_progress: 'in Arbeit',
      completed: 'erledigt'
    },
    today: 'Heute',
    yesterday: 'Gestern',
    dateLocale: 'de-DE',
    waiting: 'Eingereiht',
    waitingHint:
      'Der Agent nimmt diese Nachricht, sobald er bereit ist. „Stopp“ zieht sie nicht zurück: Sie läuft dann als eigene Runde.',
    rewind: 'Vor diese Nachricht zurückspulen',
    rewindTitle: 'Vor diese Nachricht zurückspulen',
    rewindBoth: 'Chat und Dateien',
    rewindConversation: 'Nur Chat',
    rewindFiles: 'Nur Dateien',
    rewindDropsMessages:
      'Entfernt diese Nachricht und alles danach. Die Nachricht kommt zurück ins Eingabefeld, zum Bearbeiten und erneuten Senden.',
    rewindPutsFilesBack_one:
      'Setzt {{count}} Datei auf den Stand vor dieser Nachricht zurück (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_few:
      'Setzt {{count}} Dateien auf den Stand vor dieser Nachricht zurück (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_many:
      'Setzt {{count}} Dateien auf den Stand vor dieser Nachricht zurück (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_other:
      'Setzt {{count}} Dateien auf den Stand vor dieser Nachricht zurück (+{{insertions}} −{{deletions}}).',
    rewindKeepsFiles: 'Die Dateien bleiben, wie sie sind.',
    rewindKeepsConversation: 'Der Chat bleibt, wie er ist.',
    rewindNoConversation:
      'Der Agent kennt diesen Punkt nicht mehr: Der Chat wurde seitdem komprimiert oder von einem anderen abgezweigt.',
    rewindFilesBusy: 'Ein anderer Chat in diesem Workspace arbeitet gerade.',
    rewindNothing: 'Die Dateien sind schon auf dem Stand vor dieser Nachricht.',
    rewindFilesRefused: 'Die Dateien lassen sich nicht zurücksetzen: {{reason}}',
    rewindFilesRefusedPlain:
      'Die Dateien lassen sich nicht auf den Stand dieser Nachricht zurücksetzen.',
    rewindDetail:
      'Alles, was seitdem in den Dateien geändert wurde – vom Agenten oder von dir –, wird überschrieben und lässt sich nicht wiederherstellen.',
    rewindCancel: 'Abbrechen',
    filesRewound:
      'Dateien auf den Stand einer früheren Nachricht zurückgesetzt: {{files}} geändert, +{{insertions}} −{{deletions}}',
    filesRewoundSkipped_one: '({{count}} übersprungen – an ihrem Pfad lag ein Link)',
    filesRewoundSkipped_few: '({{count}} übersprungen – an ihren Pfaden lag ein Link)',
    filesRewoundSkipped_many: '({{count}} übersprungen – an ihren Pfaden lag ein Link)',
    filesRewoundSkipped_other: '({{count}} übersprungen – an ihren Pfaden lag ein Link)',
    history: 'Geschlossene Chats',
    historyEmpty: 'Noch nichts geschlossen',
    historyUntitled: 'Chat ohne Nachrichten',
    historyClosed: 'Geschlossen {{when}}',
    historyFull: 'Schließ zuerst einen Tab – {{limit}} sind offen',

    placeholder: 'Bitte den Agenten, etwas in diesem Workspace zu tun…',
    send: 'Senden',
    stop: 'Stopp',
    stopHint: 'Stopp (Esc)',
    working: 'Arbeitet…',
    thinking: 'Denkt nach',
    memoryReset: 'Das Gedächtnis des Agenten für diesen Chat beginnt hier neu',
    compacted: 'Der Agent hat alles oben zusammengefasst, um Platz zu schaffen',
    worktreeEntered:
      'Der Agent wechselt in einen anderen Worktree, {{target}}. „Änderungen“, „Dateien“, das Terminal und die Skripte hier bleiben bei diesem Workspace.',
    worktreeEnteredNew:
      'Der Agent wechselt in einen neuen Worktree. „Änderungen“, „Dateien“, das Terminal und die Skripte hier bleiben bei diesem Workspace.',
    worktreeLeft: 'Der Agent verlässt den anderen Worktree und behält ihn.',
    worktreeRemoved: 'Der Agent verlässt den anderen Worktree und entfernt ihn samt Branch.',
    cwdMoved:
      'Die Shell des Agenten ist nach {{path}} gewechselt. „Änderungen“, „Dateien“, das Terminal und die Skripte hier bleiben bei diesem Workspace.',
    cwdBack: 'Die Shell des Agenten ist zurück im Worktree dieses Workspaces.',
    processStopped:
      'Claude Code wurde von außen beendet – vom System oder einem anderen Programm. Schick eine Nachricht, um weiterzumachen; der Chat bleibt erhalten.',
    processFailed:
      'Claude Code wurde mit einem Fehler beendet (Code {{code}}). Schick eine Nachricht, um es erneut zu versuchen; der Chat bleibt erhalten.',
    compactedBy:
      'Der Agent hat alles oben zusammengefasst, um Platz zu schaffen – aus {{before}} wurden {{after}}',

    refusalSwapped:
      '{{from}} hat diese Runde abgelehnt, also hat {{to}} sie übernommen – und den Rest dieses Chats',
    refusalSwappedLocally:
      '{{from}} hat einen Teil dieser Runde abgelehnt, also hat {{to}} diesen Teil beantwortet',
    refusalDeclined:
      '{{from}} hat diese Runde abgelehnt, und kein anderes Modell hat sie übernommen',
    deniedByAuto: 'Der Auto-Modus hat {{tool}} blockiert',
    deniedByRule: '{{tool}} wurde ohne Nachfrage abgelehnt',
    autoFellBack:
      'Der Auto-Modus ist hier nicht verfügbar, daher läuft dieser Chat jetzt im Modus {{mode}}',
    retracted: 'Der Agent hat das zurückgenommen, nachdem das Modell die Runde abgelehnt hat.',

    emptyTitle: 'Starte den Chat',
    envLabel: 'Läuft gegen',
    emptyBody:
      'Die erste Nachricht startet eine Agent-Sitzung in diesem Worktree. Der Branch existiert bereits.',

    modeToggle: 'Berechtigungen: {{mode}}',
    modeDefault: 'Manual',
    modeAcceptEdits: 'Accept edits',
    modeAuto: 'Auto',
    planMode: 'Plan',
    modeCycle: 'Modus wechseln – Manual, Accept edits, Plan, Auto (Shift+Tab)',

    context: 'Kontext',
    contextTitle: 'Kontextfenster – {{used}} von {{total}}',
    contextCompactNote: 'Der Agent behält eine Zusammenfassung des Chats und macht weiter.',
    contextClearNote: 'Der Agent vergisst diesen Chat, und der Verlauf wird gelöscht.',
    autoCompactTitle: 'Auto-Komprimierung',
    autoCompactNote:
      'Wann dieser Chat von selbst komprimiert wird. Eine Änderung startet die Sitzung neu; der Chat bleibt erhalten.',
    autoCompactAuto: 'Auto',
    autoCompactAutoNote: 'Wie Claude Code entscheidet',
    autoCompactAutoNow: 'Wie Claude Code entscheidet – jetzt {{window}}',
    autoCompactTooLarge: 'Mehr, als dieses Modell fasst ({{window}})',
    autoCompactPending: 'Gilt ab der nächsten Nachricht, sobald der Agent fertig ist.',
    autoCompactOverridden:
      'Stattdessen entscheidet {{variable}}={{value}} in {{from}}. Entferne es dort und wähle dann hier erneut.',
    autoCompactOverriddenEnv:
      'Stattdessen entscheidet {{variable}}={{value}} in der Umgebung. Entferne es dort und wähle dann hier erneut.',
    autoCompactMismatch: 'Aktiv: {{effective}}, nicht das gewählte {{chosen}}.',
    autoCompactMismatchRetry:
      'Aktiv: {{effective}}, nicht das gewählte {{chosen}}. Wähle es erneut, um die Sitzung neu zu starten.',
    clearTitle: 'Diesen Chat leeren?',
    clearMessage: 'Der Agent beginnt neu, ohne Erinnerung an das hier Gesagte.',
    clearDetail: 'Der Verlauf wird mitgelöscht und lässt sich nicht wiederherstellen.',
    clearConfirm: 'Leeren',
    clearCancel: 'Abbrechen',

    skills: 'Skills',
    skillsTitle: 'Skills für diesen Chat',
    skillsGlobal: 'Überall',
    skillsProject: 'Dieses Projekt',
    skillsRepository: 'Aus diesem Repository',
    skillsSession: 'Von Claude Code',
    skillsSessionCount: '{{count}} an',
    skillsBuiltin: 'In Claude Code eingebaut',
    skillsPlugin: 'Plugins',
    skillsPluginNote: 'Nur mit dem ganzen Plugin an- und abschaltbar, über /plugin in Claude Code',
    skillsSynced: 'Von claude.ai synchronisiert',
    skillsOwn: 'Deine eigenen',
    skillsNote:
      'Ein abgeschalteter Skill fehlt in der Liste des Agenten. Die Dateien bleiben auf der Festplatte.',
    skillsEmpty: 'Noch keine Skills.',
    skillsEmptyNote: 'Füge einen in den Einstellungen hinzu, dann erscheint er hier in jedem Chat.',
    skillsSettings: 'Einstellungen öffnen',
    attach: 'Dateien anhängen',
    attachRemove: 'Diese Datei wieder entfernen',
    attachIntro: 'Dateien, auf die ich dich hinweise:',
    attachDrop: 'Zum Anhängen ablegen',
    tabWithNotes: '{{described}}, {{waiting}}',
    notesWaiting_one: '{{count}} Notiz wartet',
    notesWaiting_few: '{{count}} Notizen warten',
    notesWaiting_many: '{{count}} Notizen warten',
    notesWaiting_other: '{{count}} Notizen warten',

    model: 'Modell',
    modelDefault: 'Standardmodell',
    modelDefaultNote: 'standardmäßig',
    modelsTitle: 'Modelle für diesen Chat',
    modelsPlan: 'Planung und Recherche',
    modelsCode: 'Code schreiben',
    modelsSame: 'Wie beim Codeschreiben',
    modelsSessionOnly:
      'Diese Sitzung läuft mit {{model}}: /model hat es nur für diese Sitzung gewählt.',

    effort: 'Aufwand',
    effortLow: 'Niedrig',
    effortMedium: 'Mittel',
    effortHigh: 'Hoch',
    effortXhigh: 'Sehr hoch',
    effortMax: 'Maximal',
    effortUltracode: 'Ultracode',
    effortUltracodeNote: 'xhigh + Workflows',
    effortUnsupported: 'Dieses Modell kennt keine Aufwandsstufe.',
    effortScale: 'Denkaufwand',
    effortJob: 'Welche Aufgabe',
    effortWhileWorking: 'Code schreiben',
    effortWhilePlanning: 'Planen',
    effortSameAsWork: 'Wie beim Codeschreiben',
    effortMatchWork: 'Wie beim Codeschreiben übernehmen',
    effortFaster: 'Schneller',
    effortSmarter: 'Klüger',

    toolRunning: 'Läuft',
    toolDone: 'Fertig',
    toolFailed: 'Fehlgeschlagen',
    toolStopped: 'Kein Ergebnis – die Runde endete vorher',
    toolScope: 'in {{scope}}',
    resultLines_one: '{{count}} Zeile',
    resultLines_few: '{{count}} Zeilen',
    resultLines_many: '{{count}} Zeilen',
    resultLines_other: '{{count}} Zeilen',
    resultLinesAtLeast_one: 'mindestens {{count}} Zeile',
    resultLinesAtLeast_few: 'mindestens {{count}} Zeilen',
    resultLinesAtLeast_many: 'mindestens {{count}} Zeilen',
    resultLinesAtLeast_other: 'mindestens {{count}} Zeilen',
    resultFiles_one: '{{count}} Datei',
    resultFiles_few: '{{count}} Dateien',
    resultFiles_many: '{{count}} Dateien',
    resultFiles_other: '{{count}} Dateien',
    resultMatches_one: '{{count}} Treffer',
    resultMatches_few: '{{count}} Treffer',
    resultMatches_many: '{{count}} Treffer',
    resultMatches_other: '{{count}} Treffer',
    resultMoreLines_one: '… +{{count}} Zeile',
    resultMoreLines_few: '… +{{count}} Zeilen',
    resultMoreLines_many: '… +{{count}} Zeilen',
    resultMoreLines_other: '… +{{count}} Zeilen',
    resultEmpty: '(keine Ausgabe)',
    agentToolUses_one: '{{count}} Tool-Aufruf',
    agentToolUses_few: '{{count}} Tool-Aufrufe',
    agentToolUses_many: '{{count}} Tool-Aufrufe',
    agentToolUses_other: '{{count}} Tool-Aufrufe',
    agentBackground: 'Läuft im Hintergrund',
    diffMoreLines_one: '{{count}} weitere Zeile',
    diffMoreLines_few: '{{count}} weitere Zeilen',
    diffMoreLines_many: '{{count}} weitere Zeilen',
    diffMoreLines_other: '{{count}} weitere Zeilen',
    outputMoreLines_one: '{{count}} weitere Zeile anzeigen',
    outputMoreLines_few: '{{count}} weitere Zeilen anzeigen',
    outputMoreLines_many: '{{count}} weitere Zeilen anzeigen',
    outputMoreLines_other: '{{count}} weitere Zeilen anzeigen',
    outputSavedHead: 'Nur der Anfang dieser Ausgabe wurde gespeichert.',
    outputSavedHeadOf_one:
      'Nur der Anfang dieser Ausgabe wurde gespeichert – insgesamt {{count}} Zeile.',
    outputSavedHeadOf_few:
      'Nur der Anfang dieser Ausgabe wurde gespeichert – insgesamt {{count}} Zeilen.',
    outputSavedHeadOf_many:
      'Nur der Anfang dieser Ausgabe wurde gespeichert – insgesamt {{count}} Zeilen.',
    outputSavedHeadOf_other:
      'Nur der Anfang dieser Ausgabe wurde gespeichert – insgesamt {{count}} Zeilen.',
    toolInput: 'Eingabe',
    toolOutput: 'Ausgabe',
    agentReport: 'Bericht',
    openFile: '{{path}} öffnen – Doppelklick hält die Datei offen',
    expandAll: 'Alle Schritte zeigen (⌘O)',
    collapseAll: 'Alle Schritte einklappen (⌘O)',
    jumpToEnd: 'Zur neuesten Nachricht',
    previousMessage: 'Deine vorige Nachricht',
    nextMessage: 'Deine nächste Nachricht',
    workingElapsed: 'Arbeitet… {{elapsed}}',

    changeEverywhere: 'überall ersetzt',

    plan: 'Plan',
    executePlan: 'Ausführen',
    executePlanMessage: 'Setze den Plan „{{title}}“ um.',
    copy: 'Kopieren',
    copied: 'Kopiert',
    copyFailed: 'Kopieren fehlgeschlagen',
    planReady: 'Der Plan ist fertig',
    planExecute: 'Ausführen',
    planEdit: 'Bearbeiten',
    planEditDone: 'Zurück zum Plan',
    planEditLabel: 'Der Plan als Markdown',
    planEdited: 'Plan, wie du ihn bearbeitet hast',
    planExecuteHint: 'Läuft mit Accept edits – Dateiänderungen gehen ohne Nachfrage durch.',
    planExecuteHintAuto:
      'Läuft in Auto – jeder Schritt wird für dich erlaubt oder abgelehnt, und bei Unklarem wird nachgefragt.',
    planFeedback: 'Noch etwas zu klären?',
    planFeedbackPlaceholder: 'Schreib hier, und der Agent überarbeitet den Plan',
    planSendFeedback: 'Notiz senden und weiterplanen',
    planWaiting: 'Der Plan wartet auf deine Antwort',
    planReopen: 'Plan öffnen',
    questionTitle: 'Der Agent fragt',
    questionOther: 'Etwas anderes',
    questionOtherPlaceholder: 'Schreib deine eigene Antwort',
    questionSend: 'Antworten',
    questionSkip: 'Überspringen',
    questionAnswered: 'Beantwortet.',
    questionUnanswered: 'Nicht beantwortet.',

    permissionTitle: 'Der Agent möchte {{tool}} verwenden',
    permissionAnswered: 'Bereits beantwortet.',
    allow: 'Erlauben',
    always: 'Immer erlauben',
    deny: 'Ablehnen',

    duration: '{{seconds}} s',
    tokens_one: '{{tokens}} Token',
    tokens_few: '{{tokens}} Tokens',
    tokens_many: '{{tokens}} Tokens',
    tokens_other: '{{tokens}} Tokens',

    endedInterrupted: 'gestoppt',
    endedLimit: 'Limit erreicht',
    endedTooLong: 'Chat zu lang',
    endedBlocked: 'von einem Hook gestoppt',
    endedFailed: 'mit Fehler beendet',

    usageReached: 'Limit erreicht'
  },

  agents: {
    count_one: '{{count}} Agent',
    count_few: '{{count}} Agenten',
    count_many: '{{count}} Agenten',
    count_other: '{{count}} Agenten',
    chipWorking_one: '{{count}} Agent arbeitet – zeigen, was er tut',
    chipWorking_few: '{{count}} Agenten arbeiten – zeigen, was sie tun',
    chipWorking_many: '{{count}} Agenten arbeiten – zeigen, was sie tun',
    chipWorking_other: '{{count}} Agenten arbeiten – zeigen, was sie tun',
    chipWaiting: 'Ein Agent wartet auf deine Antwort',
    chipDone: 'Die Agenten dieses Chats – zeigen, was sie getan haben',
    title: 'Agenten',
    working_one: '{{count}} aktiv',
    working_few: '{{count}} aktiv',
    working_many: '{{count}} aktiv',
    working_other: '{{count}} aktiv',
    ended_one: '{{count}} fertig',
    ended_few: '{{count}} fertig',
    ended_many: '{{count}} fertig',
    ended_other: '{{count}} fertig',
    commands: 'Hintergrundbefehle',
    commandCount_one: '{{count}} Befehl',
    commandCount_few: '{{count}} Befehle',
    commandCount_many: '{{count}} Befehle',
    commandCount_other: '{{count}} Befehle',
    statusRunning: 'Arbeitet',
    statusWaiting: 'Braucht deine Antwort',
    statusCompleted: 'Fertig',
    statusFailed: 'Fehlgeschlagen',
    statusStopped: 'Gestoppt',
    tokens_one: '{{tokens}} Token',
    tokens_few: '{{tokens}} Tokens',
    tokens_many: '{{tokens}} Tokens',
    tokens_other: '{{tokens}} Tokens',
    toolUses_one: '{{count}} Tool-Aufruf',
    toolUses_few: '{{count}} Tool-Aufrufe',
    toolUses_many: '{{count}} Tool-Aufrufe',
    toolUses_other: '{{count}} Tool-Aufrufe',
    kindShell: 'Befehl',
    kindWorkflow: 'Workflow',
    kindOther: 'Aufgabe',
    workflowAgents_one: '{{running}} von {{count}} Agent aktiv',
    workflowAgents_few: '{{running}} von {{count}} Agenten aktiv',
    workflowAgents_many: '{{running}} von {{count}} Agenten aktiv',
    workflowAgents_other: '{{running}} von {{count}} Agenten aktiv',
    workflowNoPhase: 'Agenten',
    mainAgent: 'Der Chat',
    back: 'Alle Agenten',
    detailModel: 'Modell',
    detailType: 'Typ',
    detailElapsed: 'Zeit',
    detailTokens: 'Tokens',
    detailToolUses: 'Tool-Aufrufe',
    detailSpawnedBy: 'Gestartet von',
    prompt: 'Aufgabe',
    steps: 'Letzte Schritte',
    noSteps: 'Noch keine Schritte.',
    showInChat: 'Im Chat zeigen',
    stop: '{{name}} stoppen',
    stopAgent: 'Agent stoppen',
    asking: '{{name}} fragt',
    lineWorking_one: '{{count}} Agent arbeitet im Hintergrund',
    lineWorking_few: '{{count}} Agenten arbeiten im Hintergrund',
    lineWorking_many: '{{count}} Agenten arbeiten im Hintergrund',
    lineWorking_other: '{{count}} Agenten arbeiten im Hintergrund'
  },

  usage: {
    title: 'Nutzung',
    unavailable: 'Diese Sitzung kann nicht sagen, wie viel verbraucht wurde.',

    session: 'Sitzung',
    cost: 'Gesamtkosten',
    costValue: '${{amount}}',
    tokens: 'Tokens',
    tokensValue: '{{input}} ein · {{output}} aus',
    cache: 'Cache',
    cacheValue: '{{read}} gelesen · {{write}} geschrieben',
    apiTime: 'API-Zeit',
    wallTime: 'Gesamtzeit',
    changes: 'Codeänderungen',
    changesValue: '+{{added}} / −{{removed}} Zeilen',

    limits: 'Limits',
    noPlan: 'Plan-Limits gelten für diese Sitzung nicht.',
    windowFiveHour: 'Aktuelle Sitzung',
    windowSevenDay: 'Aktuelle Woche (alle Modelle)',
    windowSevenDayOpus: 'Aktuelle Woche (Opus)',
    windowSevenDaySonnet: 'Aktuelle Woche (Sonnet)',
    windowSevenDayOauthApps: 'Aktuelle Woche (verbundene Apps)',
    windowModel: 'Aktuelle Woche ({{name}})',
    windowModelScoped: 'Aktuelle Woche (pro Modell)',
    reading: '{{name}} – {{percentage}} % genutzt',
    binding: 'gerade maßgeblich',
    resets: 'Reset {{at}}',

    extra: 'Zusätzliche Nutzung',
    extraSpent: '{{used}} von {{limit}}',

    contributing: 'Was dazu beiträgt',
    day: 'Letzte 24 h',
    week: 'Letzte 7 Tage',
    requests_one: '{{count}} Anfrage',
    requests_few: '{{count}} Anfragen',
    requests_many: '{{count}} Anfragen',
    requests_other: '{{count}} Anfragen',
    sessions_one: '{{count}} Sitzung',
    sessions_few: '{{count}} Sitzungen',
    sessions_many: '{{count}} Sitzungen',
    sessions_other: '{{count}} Sitzungen',

    behaviourCacheMiss: 'Cache-Misses',
    behaviourLongContext: 'Langer Kontext',
    behaviourSubagentHeavy: 'Subagenten',
    behaviourHighParallel: 'Parallele Arbeit',
    behaviourCron: 'Geplante Läufe',

    skills: 'Skills',
    agents: 'Agenten',
    plugins: 'Plugins',
    mcpServers: 'MCP-Server',
    share: '{{name}} – {{percentage}} %',
    approximate:
      'Ungefähr, aus Sitzungen auf diesem Rechner – andere Geräte und claude.ai zählen nicht mit. Die Merkmale überschneiden sich, statt die Summe aufzuteilen.',

    minutes: 'min',
    seconds: 's'
  },

  center: {
    noProjectsTitle: 'Womit legen wir los?',
    noProjectsBody:
      'Füge ein Repository von diesem Rechner hinzu oder klone eins von GitHub. Darin entstehen Workspaces – jeder mit eigenem Branch, Verzeichnis und eigener Agent-Sitzung.',
    noSelectionTitle: 'Welches Projekt heute?',
    noSelectionBody: 'Wähle ganz links eins aus oder füge ein weiteres Repository hinzu.',
    firstWorkspaceTitle: 'Dein erster Workspace ist nur einen Klick entfernt',
    firstWorkspaceBody:
      'Ein Workspace ist eine Kopie dieses Projekts auf einem eigenen Branch, mit eigenem Ordner und eigener Agent-Sitzung. Was du in einem tust, berührt keinen anderen.',
    noWorkspaceTitle: 'Mit welchem Workspace fangen wir an?',
    noWorkspaceBody:
      'Jeder Chat gehört zu einem Workspace. Der Agent arbeitet an dessen eigener Kopie des Projekts, und was er ändert, landet auf dem Branch dieses Workspaces.',
    addFromDisk: 'Von der Festplatte hinzufügen…',
    addFromGitHub: 'Von GitHub hinzufügen…',
    checkingGitHub: 'GitHub wird geprüft…'
  },

  settings: {
    title: 'Einstellungen',
    sectionGeneral: 'Allgemein',
    sectionGit: 'Git',
    sectionAgent: 'Agent',
    sectionSkills: 'Skills',
    sectionLibrary: 'Befehle',
    sectionInstructions: 'Anweisungen',
    sectionAccounts: 'Claude',
    sectionAbout: 'Über',

    theme: 'Design',
    themeSystem: 'Wie das System',
    themeLight: 'Hell',
    themeDark: 'Dunkel',

    language: 'Sprache',
    languageHint: 'Standard ist Englisch. Kein Neustart nötig.',
    notificationSound: 'Ton',
    notificationSoundHint:
      'Ein leiser Ton, wenn ein Agent fertig ist, scheitert oder eine Antwort von dir braucht, während du woanders hinschaust.',
    notificationSoundChoice: 'Welcher Ton',
    notificationSoundChoiceHint:
      'Drück ▶, um einen Ton vor der Auswahl anzuhören. Nur das Glockenspiel klingt bei fertig, fehlgeschlagen und wartend jeweils anders.',
    soundPreview: '{{name}} anhören',
    sounds: {
      chime: 'Glockenspiel',
      airport: 'Flughafen',
      'alarm-clock': 'Wecker',
      bam: 'Bam',
      'cell-phone': 'Handy',
      craw: 'Krähe',
      'door-bell': 'Türklingel',
      drum: 'Trommel',
      fairy: 'Fee',
      'funny-sound': 'Lustiger Ton',
      gong: 'Gong',
      'hola-papa': 'Hola papa',
      japanese: 'Japanisch',
      oyoy: 'Oy-oy',
      'sms-incoming': 'Eingehende SMS',
      'uh-oh': 'Uh-oh',
      'water-drop': 'Wassertropfen',
      whistle: 'Pfiff',
      'whistle-here': 'Pfiff hierher',
      wow: 'Wow'
    },

    branchPrefix: 'Branch-Präfix',
    branchPrefixHint:
      'Workspace-Branches heißen <prefix>/<workspace>. Oft nimmt man dafür den GitHub-Benutzernamen.',
    branchPrefixUnusable: 'Das Präfix braucht mindestens ein Zeichen, das Git verwenden kann.',
    branchPrefixBecomes: 'Wird gespeichert als {{prefix}}',

    cloneDirectory: 'Klon-Ziel',
    cloneDirectoryHint:
      'Repositorys von GitHub werden hierhin geklont. Jedes bekommt einen eigenen Ordner mit dem Namen des Repositorys.',
    cloneDirectoryUnset: 'Nicht festgelegt – du wirst beim ersten Klonen gefragt.',
    change: 'Ändern…',

    settingSources: 'Quellen für Anweisungen',
    settingSourcesHint:
      'Was der Agent selbst lädt. „Alles“ ist das, was Claude Code im Terminal tut und was octopus standardmäßig nutzt: die CLAUDE.md des Projekts, seine Befehle, Skills und Subagenten. Schränke es nur ein, wenn der Agent weniger wissen soll als dein Terminal.',
    settingSourcesNone: 'Nichts',
    settingSourcesNoneHint:
      'Der Agent liest keine CLAUDE.md, keine Befehle und keine Skills. Isoliert – um den Preis eines Agenten, der nichts über das Projekt weiß.',
    settingSourcesProject: 'Nur Projekt',
    settingSourcesProjectHint:
      'Lädt die eigene CLAUDE.md und die Einstellungen des Repositorys, sobald du sie gelesen und erlaubt hast.',
    settingSourcesAll: 'Alles',
    settingSourcesAllHint: 'Benutzer-, Projekt- und lokale Einstellungen – das, was die CLI lädt.',

    effort: 'Standard-Aufwand',
    effortHint:
      'Wie viel Nachdenken ein neuer Chat verlangt. Danach lässt sich das für jeden Chat einzeln im Eingabefeld ändern.',

    model: 'Modell für Code',
    modelHint:
      'Womit ein neuer Chat läuft. Die Liste kommt vom Agenten selbst und bleibt leer, bis einmal eine Sitzung lief.',
    planModel: 'Modell für Planung und Recherche',
    planModelHint:
      'Wird genutzt, solange Plan an ist – so kann ein Modell den Plan ausdenken und ein anderes ihn umsetzen. Lass es gleich, um für beides ein Modell zu nutzen.',

    permissionMode: 'Was ein neuer Chat darf',
    permissionModeHint:
      'Der Ausgangspunkt für jeden Workspace, damit die Frage nicht bei jedem neuen Branch erneut kommt. Jeder Chat lässt sich trotzdem einzeln umstellen.',
    permissionAsk: 'Manual',
    permissionAskHint:
      'Lesen läuft ohne Nachfrage; Schreiben und Befehle warten auf deine Antwort.',
    permissionAcceptEdits: 'Accept edits',
    permissionAcceptEditsHint:
      'Dateiänderungen gehen ohne Nachfrage durch, die einfachen Dateibefehle auch (mkdir, mv, rm). Andere Befehle warten weiterhin.',
    permissionAuto: 'Auto',
    permissionAutoHint:
      'Ein Klassifikator erlaubt oder verweigert jeden Schritt und fragt, wenn er unsicher ist. Ablehnungen erscheinen im Chat. Nicht jedes Konto und Modell hat ihn; fehlt er, fällt der Chat auf Manual zurück.',
    planExecution: 'Genehmigten Plan umsetzen',
    planExecutionHint:
      'Worauf ein Chat umschaltet, wenn du bei einem Plan auf „Ausführen“ drückst.',
    planExecutionAutoHint:
      'Der Klassifikator erlaubt oder verweigert jeden Schritt. Wo Auto nicht verfügbar ist, wird stattdessen Accept edits genutzt.',
    planExecutionAcceptEditsHint:
      'Dateiänderungen gehen ohne Nachfrage durch; andere Befehle warten weiterhin.',

    alwaysAllowed: 'Mit „immer“ beantwortet',
    alwaysAllowedHint:
      'Tools, die du durchgewunken hast. Danach wird in keinem Workspace mehr gefragt, bis du sie hier entfernst.',
    alwaysAllowedEmpty: 'Noch nichts.',
    alwaysAllowedEverywhere: 'überall',
    alwaysAllowedRemove: 'Wieder fragen',

    accountsHint:
      'octopus speichert nie Zugangsdaten. Die CLI legt sie im Schlüsselbund ab; hier steht nur, was sie meldet.',
    gitHint:
      'Verbinde GitHub, um Projekte durch Klonen deiner Repositorys hinzuzufügen, Pull Requests zu öffnen und Checks zu lesen. Die Zugangsdaten bleiben bei der gh-CLI im Schlüsselbund.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'Der Agent läuft über dieses Konto.',
    claudeAccountSetup:
      'Zur Anmeldung muss Claude Code auf diesem Mac installiert sein. Ohne Konto öffnet sich octopus trotzdem, aber der Agent kann nicht antworten.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Projekte von GitHub, Pull Requests und Checks.',
    githubAccountSetup:
      'Benötigt die GitHub CLI (brew install gh). Ohne sie funktioniert alles andere, Pull Requests und Klonen jedoch nicht.',
    connected: 'Verbunden',
    notConnected: 'Nicht verbunden',
    signIn: 'Anmelden',
    signOut: 'Abmelden',
    recheck: 'Aktualisieren',
    signInRunning: 'Anmeldung bei {{service}}',
    signingOut: 'Abmelden…',
    signOutFailed: 'Abmelden von {{service}} fehlgeschlagen.',
    signInDone: 'Fertig. Schließen führt zurück zur Kontoliste.',
    signInKilled: 'Der Befehl wurde vor dem Ende unterbrochen.',
    signInFailed: 'Der Befehl endete mit Code {{code}}.',
    closeTerminal: 'Fertig',
    opensTerminal:
      'Die Anmeldung öffnet hier ein Terminal – beide Tools stellen interaktiv Fragen. Danach wird die Kontoliste aktualisiert.',
    plan: 'Tarif',
    organisation: 'Organisation',
    deviceId: 'Geräte-ID',
    installedAt: 'Erster Start',

    attachments: 'Eingefügte Bilder',
    attachmentsEmpty: 'Noch keine',
    attachmentsHeld_one: '{{count}} Bild, {{size}}',
    attachmentsHeld_few: '{{count}} Bilder, {{size}}',
    attachmentsHeld_many: '{{count}} Bilder, {{size}}',
    attachmentsHeld_other: '{{count}} Bilder, {{size}}',
    attachmentsClear: 'Leeren',
    attachmentsClearTitle: 'Eingefügte Bilder leeren?',
    attachmentsClearMessage:
      'Jedes in ein Eingabefeld eingefügte Bild wird von der Festplatte gelöscht.',
    attachmentsClearDetail:
      'Nachrichten mit einem Bild behalten den Pfad, ein alter Chat zeigt dann eine Datei, die es nicht mehr gibt. Sonst ist nichts betroffen.',
    attachmentsClearConfirm: 'Löschen',
    attachmentsClearCancel: 'Behalten',

    terminals: 'Laufende Terminals',
    terminalsNone: 'Keine',
    terminalPurpose: {
      shell: 'Terminal',
      setup: 'Setup-Skript',
      run: 'Dev-Server',
      archive: 'Archiv-Skript',
      auth: 'Anmeldung'
    },
    terminalsEnd: 'Beenden',
    terminalsEndTitle: 'Diese Sitzung beenden?',
    terminalsEndMessage: 'Die Shell und alles, was sie gestartet hat, werden gestoppt.',
    terminalsEndDetail:
      'Ein Dev-Server wird zuerst gebeten, sich zu beenden, und sonst hart beendet. Alles Ungespeicherte in der Sitzung geht verloren.',
    terminalsEndConfirm: 'Beenden',
    terminalsEndCancel: 'Weiterlaufen lassen'
  },

  skills: {
    global: 'Skills überall',
    globalNote: 'In jedem Projekt verfügbar, außer ein Chat schaltet einen ab.',
    project: 'Skills für dieses Projekt',
    projectNote: 'Nur in diesem Projekt verfügbar. Liegt in octopus, nicht im Repository.',

    add: 'Neuer Skill',
    import: 'Importieren…',
    empty: 'Hier gibt es noch keine Skills.',
    onByDefault: 'Standardmäßig an',
    rowActions: 'Aktionen für {{name}}',
    edit: 'Bearbeiten',
    rename: 'Umbenennen',
    renameTitle: '„{{name}}“ umbenennen',
    renameLabel: 'Neuer Name (Kleinbuchstaben, Ziffern und Bindestriche)',
    renameConfirm: 'Umbenennen',
    renameCancel: 'Abbrechen',
    renameInvalid:
      'Nur Kleinbuchstaben, Ziffern und Bindestriche, beginnend mit Buchstabe oder Ziffer.',
    remove: 'Entfernen',
    removeTitle: '{{name}} entfernen?',
    removeMessage: 'Der Skill und alles in seinem Ordner werden gelöscht.',
    removeDetail: 'Chats, in denen er an war, sehen ihn einfach nicht mehr.',
    removeConfirm: 'Entfernen',
    removeCancel: 'Abbrechen',

    inRepository: 'In diesem Repository',
    inRepositoryNote:
      'Der Agent findet diese selbst im Checkout. Schalte einen ab, um ihn aus den Chats hier herauszuhalten, oder kopiere ihn, um ihn in jedem Projekt zu nutzen.',
    copyToGlobal: 'In alle Projekte kopieren',
    inspectAction: 'Lesen',
    noDescription: 'Ohne Beschreibung.',

    editorNew: 'Neuer Skill',
    editorEdit: '{{name}} bearbeiten',
    name: 'Name',
    nameHint: 'Kleinbuchstaben, Ziffern und Bindestriche. So heißt auch sein Ordner.',
    nameInvalid: 'Nutze Kleinbuchstaben, Ziffern und einzelne Bindestriche.',
    nameTaken: 'Ein Skill mit diesem Namen existiert hier schon.',
    description: 'Wann er genutzt wird',
    descriptionHint: 'Die eine Zeile, nach der der Agent entscheidet, ob er ihn nutzt.',
    body: 'Anweisungen',
    bodyHint: 'Markdown. Was der Agent tun soll, sobald er ihn aufgreift.',
    showRaw: 'SKILL.md zeigen',
    hideRaw: 'Zurück zum Formular',
    rawHint: 'Das ganze Dokument samt Frontmatter. Wird genau so gespeichert.',
    save: 'Speichern',
    cancel: 'Abbrechen',

    importTitle: 'Skill importieren',
    fromDisk: 'Von der Festplatte',
    fromDiskNote: 'Der Ordner eines Skills oder eine einzelne SKILL.md.',
    choose: 'Auswählen…',
    fromText: 'Einfügen',
    fromTextNote: 'Die ganze SKILL.md samt Frontmatter.',
    fromUrl: 'Über einen Link',
    fromUrlNote:
      'Eine https-Adresse, die genau eine SKILL.md liefert. Nichts daneben wird geladen.',
    url: 'Adresse',
    importAction: 'Importieren'
  },

  library: {
    commands: 'Befehle',
    commandsNote:
      'Wird in jedem Chat nach einem Schrägstrich getippt. Liegt in octopus, nicht im Repository.',
    commandsProjectNote:
      'Wird in den Chats dieses Projekts nach einem Schrägstrich getippt. Liegt in octopus, nicht im Repository.',
    subagents: 'Subagenten',
    subagentsNote:
      'Helfer, die der Agent selbst heranzieht, jeder mit eigenen Anweisungen. Liegen in octopus, nicht im Repository. Ein neuer erreicht nur Chats, die danach starten, keine laufenden.',
    subagentsProjectNote:
      'Helfer, die der Agent in diesem Projekt heranzieht, jeder mit eigenen Anweisungen. Liegen in octopus, nicht im Repository. Ein neuer erreicht nur Chats, die danach starten, keine laufenden.',

    empty: {
      command: 'Hier gibt es noch keine Befehle.',
      subagent: 'Hier gibt es noch keine Subagenten.'
    },
    add: {
      command: 'Neuer Befehl',
      subagent: 'Neuer Subagent'
    },
    new: {
      command: 'Neuer Befehl',
      subagent: 'Neuer Subagent'
    },
    import: 'Importieren…',
    importTitle: {
      command: 'Befehl importieren',
      subagent: 'Subagent importieren'
    },

    rowActions: 'Aktionen für {{name}}',
    edit: 'Bearbeiten',
    editing: '{{name}} bearbeiten',
    rename: 'Umbenennen',
    renameTitle: '„{{name}}“ umbenennen',
    renameLabel: 'Neuer Name (Kleinbuchstaben, Ziffern, Binde- und Unterstriche)',
    renameConfirm: 'Umbenennen',
    renameCancel: 'Abbrechen',
    renameInvalid: 'Nur Kleinbuchstaben, Ziffern, Binde- und Unterstriche.',
    remove: 'Entfernen',
    removeTitle: '{{name}} entfernen?',
    removeMessage: 'Die Datei wird gelöscht.',
    removeDetail: 'Bereits laufende Chats sehen sie nicht mehr.',
    removeConfirm: 'Entfernen',
    removeCancel: 'Abbrechen',

    name: 'Name',
    nameHint: {
      command:
        'Was du nach dem Schrägstrich tippst. Kleinbuchstaben, Ziffern, Binde- und Unterstriche.',
      subagent: 'Wie der Agent ihn nennt. Kleinbuchstaben, Ziffern, Binde- und Unterstriche.'
    },
    nameInvalid: 'Nutze Kleinbuchstaben, Ziffern, Binde- und Unterstriche.',
    nameTaken: 'Hier gibt es schon etwas mit diesem Namen.',
    document: 'Dokument',
    documentHint: {
      command:
        'Markdown. Die ganze Datei ist der Prompt; $ARGUMENTS ist, was danach getippt wurde.',
      subagent:
        'Markdown mit Frontmatter, das ihn benennt und sagt, wann er genutzt wird. tools und model bleiben wie geschrieben.'
    },
    save: 'Speichern',
    cancel: 'Abbrechen',

    fromDisk: 'Von der Festplatte',
    fromDiskNote: 'Eine einzelne Markdown-Datei.',
    choose: 'Auswählen…',
    fromText: 'Einfügen',
    fromTextNote: 'Die ganze Datei, samt Frontmatter, falls vorhanden.',
    fromUrl: 'Über einen Link',
    fromUrlNote:
      'Eine https-Adresse, die genau eine Markdown-Datei liefert. Nichts daneben wird geladen.',
    url: 'Adresse',
    inspectAction: 'Lesen',
    importAction: 'Importieren',
    noDescription: 'Ohne Beschreibung.'
  },

  elicitation: {
    from: 'Eine Frage von {{server}}',
    optional: '{{label}} (optional)',
    choose: 'Auswählen…',
    send: 'Antworten',
    decline: 'Ablehnen',
    was: {
      accept: 'Beantwortet.',
      decline: 'Abgelehnt.',
      cancel: 'Zurückgezogen, als die Runde stoppte.'
    },
    gone: 'Wartet nicht mehr auf eine Antwort.'
  },

  notes: {
    placeholder: 'Eine Notiz an dich selbst zu diesem Workspace. Der Agent liest sie nie.',
    noWorkspaceTitle: 'Noch kein Ort zum Schreiben',
    noWorkspaceBody: 'Wähle links einen Workspace, um Notizen dazu zu machen.',
    remaining_one: 'Noch {{count}} Zeichen',
    remaining_few: 'Noch {{count}} Zeichen',
    remaining_many: 'Noch {{count}} Zeichen',
    remaining_other: 'Noch {{count}} Zeichen'
  },

  trust: {
    title: 'Was dieses Repository darf',
    explain:
      'octopus lädt dieselben Einstellungen wie Claude Code im Terminal. Dieses Repository kann also Tools vorab freigeben, bei jedem Tool-Aufruf eigene Befehle ausführen und MCP-Server starten. Lies, was es mitbringt, bevor du es erlaubst. Nur diese Dateien brauchen deine Freigabe – Anweisungen wie CLAUDE.md nicht; sie werden nach der Freigabe ohnehin gelesen.',
    approve: 'Erlauben',
    notice:
      'Dieses Projekt bringt Einstellungen mit, die Tools vorab erlauben und eigene Befehle ausführen würden. Bis du sie gelesen hast, arbeitet der Agent ohne alles aus diesem Repository – auch ohne seine CLAUDE.md.',
    review: 'Prüfen',
    linkRefused: 'Ein Link aus diesem Worktree hinaus. Er wird gezeigt, nicht gelesen: {{target}}',
    linkBroken: 'Ein Link, der ins Leere zeigt.'
  },

  notices: {
    done: 'Fertig',
    error: 'Mit Fehler beendet',
    question: 'Hat eine Frage an dich',
    plan: 'Der Plan ist bereit zur Prüfung',
    permission: 'Möchte {{tool}} nutzen',
    show: 'Zeigen',
    dismiss: 'Ausblenden'
  },

  statusBar: {
    label: 'Status',
    hide: 'Statusleiste ausblenden',
    show: 'Statusleiste einblenden',
    working_one: '{{count}} arbeitet',
    working_few: '{{count}} arbeiten',
    working_many: '{{count}} arbeiten',
    working_other: '{{count}} arbeiten',
    waiting_one: '{{count}} wartet',
    waiting_few: '{{count}} warten',
    waiting_many: '{{count}} warten',
    waiting_other: '{{count}} warten',
    workingTitle: 'Agenten bei der Arbeit',
    waitingTitle: 'Warten auf dich',
    nobodyWorking: 'Kein Agent arbeitet.',
    nobodyWaiting: 'Nichts wartet auf dich.',
    requests_one: '{{count}} Pull Request',
    requests_few: '{{count}} Pull Requests',
    requests_many: '{{count}} Pull Requests',
    requests_other: '{{count}} Pull Requests',
    needsAction_one: '{{count}} braucht dich',
    needsAction_few: '{{count}} brauchen dich',
    needsAction_many: '{{count}} brauchen dich',
    needsAction_other: '{{count}} brauchen dich',
    ready_one: '{{count}} bereit zum Mergen',
    ready_few: '{{count}} bereit zum Mergen',
    ready_many: '{{count}} bereit zum Mergen',
    ready_other: '{{count}} bereit zum Mergen',
    requestsTitle: 'Offene Pull Requests',
    needsActionTitle: 'Pull Requests, die dich brauchen',
    readyTitle: 'Pull Requests bereit zum Mergen',
    noRequests: 'Kein Workspace hat einen offenen Pull Request.',
    noneNeedsAction: 'Nichts braucht dein Eingreifen.',
    noneReady: 'Noch nichts ist bereit zum Mergen.',
    request: '#{{number}}',
    pending: 'Läuft',
    checksFailed: 'ein Check ist fehlgeschlagen',
    changesRequested: 'Änderungen angefordert',
    conflict: 'Merge-Konflikt',
    turn: '{{chat}} · {{elapsed}}',
    resources: 'CPU {{cpu}} · {{memory}}',
    resourcesTitle: 'Was octopus verbraucht',
    resourcesReading: 'Wird gemessen…',
    app: 'octopus selbst',
    agent: 'Agent',
    server: 'Server',
    terminal: 'Terminal',
    part: '{{kind}} {{memory}}'
  },

  plugins: {
    title: 'Plugins',
    troubleDot: 'Ein Plugin ließ sich nicht laden',
    tabInstalled: 'Installiert',
    tabInstalledCount: 'Installiert · {{count}}',
    tabStore: 'Store',
    userLayerOff:
      'Einstellungen → Agent lässt deine Benutzereinstellungen weg, und genau dort sind Plugins aktiviert, die für alle Projekte installiert sind. Sie bleiben installiert, aber Chats hier laden sie nicht.',
    openAgentSettings: 'Agent-Einstellungen öffnen',
    applied_one: 'Auf {{count}} offenen Chat angewendet.',
    applied_few: 'Auf {{count}} offene Chats angewendet.',
    applied_many: 'Auf {{count}} offene Chats angewendet.',
    applied_other: 'Auf {{count}} offene Chats angewendet.',
    appliedNone: 'Angewendet. Ab jetzt gestartete Chats laden es.',
    searchInstalled: 'Installierte Plugins filtern',
    searchStore: 'Plugins nach Name, Beschreibung oder Stichwort suchen',
    loading: 'Plugins werden gelesen…',
    noneInstalled: 'Noch keine Plugins',
    noneInstalledHint:
      'Plugins erweitern Claude Code um Skills, Befehle, Agenten und Tools. Finde eins im Store.',
    browseStore: 'Store durchsuchen',
    noMatch: 'Nichts passt zu „{{query}}“.',
    scope: {
      user: 'Alle Projekte',
      project: 'Projekt',
      local: 'Projekt, nur du',
      managed: 'Verwaltet'
    },
    switchLabel: '{{name}} verwenden',
    stateOn: 'An',
    stateOff: 'Aus',
    managedNote: 'Von deiner Organisation eingerichtet, daher hier nicht änderbar.',
    unreachableNote:
      'Claude Code hat nicht gesagt, wo dieses Plugin installiert ist, daher ist es hier nicht änderbar.',
    homepage: 'Website',
    remove: '{{name}} entfernen',
    removeTitle: 'Plugin entfernen?',
    removeMessage: '„{{name}}“ entfernen?',
    removeDetail:
      'Sein Datenverzeichnis wird mitgelöscht – seine Einstellungen und alles, was es gespeichert hat. Offene Chats nutzen es sofort nicht mehr.',
    removeConfirm: 'Entfernen',
    cancel: 'Abbrechen',
    loadErrors: 'Nicht geladen: {{errors}}',
    components: {
      skills: 'Skills',
      commands: 'Befehle',
      agents: 'Agenten',
      hooks: 'Hooks',
      mcp: 'MCP',
      lsp: 'LSP'
    },
    allCategories: 'Alle',
    categoriesLabel: 'Kategorien',
    categories: {
      development: 'Entwicklung',
      productivity: 'Produktivität',
      database: 'Datenbanken',
      monitoring: 'Monitoring',
      security: 'Sicherheit',
      deployment: 'Deployment',
      design: 'Design',
      automation: 'Automatisierung',
      learning: 'Lernen',
      location: 'Standort',
      testing: 'Testen',
      math: 'Mathematik',
      migration: 'Migration'
    },
    otherCategory: 'Sonstige',
    installs_one: '{{formatted}} Installation',
    installs_few: '{{formatted}} Installationen',
    installs_many: '{{formatted}} Installationen',
    installs_other: '{{formatted}} Installationen',
    install: 'Installieren',
    installing: 'Wird installiert…',
    installed: 'Installiert',
    by: 'von {{author}}',
    from: 'Aus {{marketplace}}',
    version: 'Version {{version}}',
    noDescription: 'Keine Beschreibung.',
    closeDetails: 'Details schließen',
    trustNote:
      'Ein Plugin hat dieselben Rechte wie Claude Code: Seine Hooks und Server führen Befehle auf diesem Rechner aus. Installiere nur, was du für vertrauenswürdig hältst.',
    consentTitle: 'Diesen Befehl ausführen?',
    consentMessage:
      '„{{name}}“ wird über einen Befehl aus seinem Marketplace installiert. Lies ihn, bevor du fortfährst.',
    consentConfirm: 'Ausführen und installieren',
    connectTitle: 'Der Store ist leer',
    connectHint:
      'Der offizielle Claude Code Marketplace ist auf diesem Rechner noch nicht verbunden. Beim Verbinden wird sein Katalog von GitHub geladen.',
    connect: 'Offiziellen Marketplace verbinden',
    connecting: 'Wird verbunden…',
    refresh: 'Offiziellen Marketplace auf neue Plugins prüfen',
    catalogFailedTitle: 'Der Store ließ sich nicht lesen',
    catalogFailedHint: 'Claude Code hat keine Plugin-Liste geliefert. Der Grund steht oben.',
    retry: 'Erneut versuchen'
  },

  tips: {
    headsUp: 'Hinweis',
    learnMore: 'Mehr erfahren',
    showLess: 'Weniger anzeigen',
    addToChat: 'Zum Chat hinzufügen',
    knewIt: 'Wusste ich schon',
    dismiss: 'Ausblenden',
    rewindSkipsCommands: {
      title:
        'Zurückspulen setzt bei Dateien nur zurück, was der Agent mit seinen Bearbeitungstools geändert hat. Änderungen durch Befehle im Terminal bleiben.',
      detail:
        'Dateien werden fürs Zurückspulen gesichert, wenn der Agent sie mit Edit oder Write bearbeitet. Ein Befehl – ein Formatter, ein Codegenerator, git checkout, rm – ändert Dateien an diesen Sicherungen vorbei, daher lässt das Zurückspulen unberührt, was er getan hat. Vor einem Befehl, den du vielleicht rückgängig machen willst, committe oder stashe deine Arbeit; der Tab „Änderungen“ zeigt, was in den Dateien hinzugekommen und weggefallen ist.'
    }
  },

  errors: {
    pluginCliUnavailable: 'Claude Code ließ sich nicht ausführen: {{message}}',
    pluginTimedOut:
      'Claude Code wurde nicht innerhalb von {{seconds}} Sekunden fertig. Meist liegt es an einem langsamen Netzwerk – versuch es erneut.',
    pluginActionFailed: 'Claude Code hat abgelehnt: {{message}}',
    pluginOutputUnreadable: 'Claude Code hat etwas Unerwartetes geantwortet: {{message}}',
    pluginNotInstalled:
      'Dieses Plugin ist dort nicht mehr installiert. Die Liste wurde neu gelesen.',
    pluginProjectMissing: 'Das Projekt dieses Plugins existiert nicht mehr: {{path}}',
    libraryNameInvalid:
      '„{{name}}“ ist als Name nicht möglich: Verwende Kleinbuchstaben, Ziffern, Bindestriche und Unterstriche. Der Name wird zum Dateinamen, und auf diesem Dateisystem wären „Ship“ und „ship“ dieselbe Datei.',
    libraryExists: 'Etwas namens „{{name}}“ gibt es hier schon oder im Store daneben.',
    libraryMissing: 'Diese Datei ist nicht mehr da.',
    libraryTooLarge: 'Es ist länger als {{limit}} Zeichen – zu lang für einen Prompt.',
    libraryUrlRefused:
      '„{{url}}“ ließ sich nicht lesen. Abgerufen werden nur https-Adressen, die mit genau einer Markdown-Datei antworten.',
    librarySubagentNeedsDescription:
      'Ein Subagent braucht Frontmatter mit einer Beschreibung, wann er genutzt wird, sonst greift der Agent nie auf ihn zurück.',
    branchMissing:
      'Dieses Repository hat keinen Branch namens „{{branch}}“. Wähle einen Basis-Branch, den es hat, bevor du das Projekt darauf richtest.',
    draftFailed: 'Die Beschreibung ließ sich nicht entwerfen: {{reason}}',
    trustChanged:
      'Was das Repository mitbringt, hat sich nach der Anzeige geändert, daher wurde es nicht erlaubt. Hier ist der aktuelle Stand – lies ihn erneut, bevor du ihn erlaubst.',
    draftUnreadable:
      'Der Agent hat geantwortet, aber nicht mit Titel und Beschreibung. Versuch es erneut oder schreib sie selbst.',
    envProfileExists: 'Dieses Projekt hat schon ein Variablen-Set namens „{{name}}“.',
    envProfileMissing: 'Es gibt kein Variablen-Set namens „{{name}}“ mehr.',
    envProfileName:
      '„{{name}}“ ist als Set-Name nicht möglich: Verwende Kleinbuchstaben, Ziffern und Bindestriche, beginnend mit einem Buchstaben oder einer Ziffer. Der Name wird zum Dateinamen, und auf diesem Dateisystem wären „Prod“ und „prod“ dieselbe Datei.',
    repoPathHasWorkspaces:
      'Dieses Projekt hat noch Workspaces, und jeder ist ein Git-Worktree, der in seinem aktuellen Repository registriert ist. Entferne sie, bevor du es woandershin richtest.',
    repoPathTaken: '„{{name}}“ nutzt dieses Repository bereits.',
    repoPathRelative: '{{path}} ist kein absoluter Pfad.',
    repoPathEmpty: 'Der Repository-Pfad darf nicht leer sein.',
    envFileEscapes:
      '{{path}} liegt nicht im Workspace. Die Variablen werden in den Worktree geschrieben, daher muss die Datei darin liegen.',
    envFileEmpty: 'Der Name der Env-Datei darf nicht leer sein.',
    valueRefused: 'Dieser Wert wurde abgelehnt: {{reason}}',
    fileUnreadable: '{{path}} ließ sich nicht lesen: {{issues}}',
    notARepository: '{{path}} ist kein Git-Repository.',
    emptyRepository:
      '{{path}} hat noch keine Commits. Erstelle einen ersten Commit – ohne ihn lässt sich kein Worktree anlegen.',
    noBaseBranch:
      'Kein Basis-Branch in {{path}} gefunden. Checke den gewünschten Branch aus und versuch es erneut.',
    baseUnknown:
      'Nicht gefunden, wo dieser Workspace von {{branch}} abzweigt. Der Branch wurde vielleicht umbenannt oder gelöscht – prüfe die Projekteinstellungen.',
    notRemoved: '{{path}} ist noch da: Es ließ sich nicht entfernen.',
    duplicateProject: 'Dieses Repository ist bereits als Projekt „{{name}}“ hinzugefügt.',
    notConnected: 'GitHub ist nicht erreichbar. Prüfe das Konto in den Einstellungen.',
    listFailed: 'GitHub hat etwas Unerwartetes geliefert.',
    cloneFailed: '{{repository}} ließ sich nicht klonen.',
    noCommits: 'Dieser Branch hat nichts, was {{base}} nicht hat.',
    pushFailed: '{{branch}} ließ sich nicht pushen. Git meldet: {{reason}}',
    fetchFailed:
      '{{remote}} ließ sich nicht fetchen, daher würde dieser Workspace von einem veralteten Basis-Branch starten. Git meldet: {{reason}}',
    envPathEscapes:
      '{{file}} verlässt diesen Workspace über einen symbolischen Link, daher würden die Variablen außerhalb geschrieben. Richte das Projekt auf eine Datei, die wirklich im Worktree liegt, oder entferne den Link.',
    createFailed: 'Der Pull Request ließ sich nicht öffnen. GitHub meldet: {{reason}}',
    strayStopFailed:
      'Prozess {{pid}} ließ sich nicht stoppen. Stoppe ihn selbst und drück dann erneut „Run“.',
    nothingToCommit: 'Hier gibt es nichts zu committen.',
    commitFailed: 'Die Änderungen ließen sich nicht committen. Git meldet: {{reason}}',
    mergeFailed: 'GitHub hat #{{number}} nicht gemergt. Meldung: {{reason}}',
    requestNotOnBranch:
      'Pull Request #{{number}} liegt auf {{head}}, nicht auf {{branch}} dieses Workspaces. Es wurde nichts getan.',
    headNotOnBranch:
      'HEAD ist nicht auf dem Branch {{branch}} dieses Workspaces. Es wurde nichts committet oder gepusht – checke ihn zuerst im Terminal aus.',
    closeFailed: 'GitHub hat #{{number}} nicht geschlossen. Meldung: {{reason}}',
    nothingToRerun: 'Kein GitHub-Actions-Lauf von #{{number}} lässt sich gerade neu starten.',
    rerunFailed: 'GitHub hat die Checks von #{{number}} nicht neu gestartet. Meldung: {{reason}}',
    replyFailed: 'GitHub hat die Antwort nicht gepostet. Meldung: {{reason}}',
    attachmentTooLarge:
      'Das Bild ist größer als {{limit}} MB. Speichere es und hänge stattdessen die Datei an.',
    attachmentType:
      'octopus kann {{type}} nicht anhängen. Speichere es und hänge stattdessen die Datei an.',
    resolveFailed: 'GitHub hat den Thread nicht geändert. Meldung: {{reason}}',
    alreadyExists: '{{path}} existiert bereits. Füge es stattdessen von der Festplatte hinzu.',
    branchUnmerged:
      '{{branch}} hat Commits, die nicht im Basis-Branch sind. Entferne den Workspace ohne das Häkchen beim Branch, oder merge ihn zuerst.',
    branchExists: 'Ein Branch namens {{branch}} existiert bereits.',
    slugTaken:
      'Ein anderer Workspace, „{{name}}“, nutzt bereits den Datenbanknamen {{slug}}. Zwei Workspaces mit derselben Datenbank überschreiben gegenseitig ihre Daten. Wähle einen Namen, der sich um mehr als einen Bindestrich oder Punkt unterscheidet.',
    pathExists: '{{path}} existiert bereits.',
    uncommittedChanges: '{{name}} hat nicht committete Änderungen.',
    nameEmpty: 'Der Name darf nicht leer sein.',
    worktreeMissing: 'Dieser Workspace ist nicht mehr da.',
    tooManyChats_one: 'Ein Workspace fasst höchstens {{count}} Chat.',
    tooManyChats_few: 'Ein Workspace fasst höchstens {{count}} Chats.',
    tooManyChats_many: 'Ein Workspace fasst höchstens {{count}} Chats.',
    tooManyChats_other: 'Ein Workspace fasst höchstens {{count}} Chats.',
    lastChat: 'Der letzte Chat lässt sich nicht schließen. Starte ihn mit /clear neu.',
    nothingToFork: 'Dieser Chat hat noch nicht begonnen, es gibt also nichts fortzusetzen.',
    forkFailed: 'Der Agent konnte diesen Chat nicht kopieren.',
    rewindBusy: 'Der Agent arbeitet. Stoppe ihn vor dem Zurückspulen.',
    rewindUnavailable: 'Dieser Chat lässt sich nicht bis zu dieser Nachricht zurückspulen.',
    rewindUnavailableReason:
      'Dieser Chat lässt sich nicht bis zu dieser Nachricht zurückspulen: {{reason}}',
    rewindInProgress: 'Dieser Chat wird gerade zurückgespult. Warte, bis es fertig ist.',
    chatClosed: 'Dieser Chat wurde geschlossen. Öffne ihn zuerst wieder über „Geschlossene Chats“.',
    autoModeUnavailable: 'Der Auto-Modus ist hier nicht verfügbar: {{reason}}',
    turnRunning:
      'Der Agent arbeitet noch. Warte, bis er fertig ist, und klicke dann erneut auf den Button.',
    sideQuestionUnsupported:
      'Diese Version von Claude Code kann keine Nebenfragen beantworten. Aktualisiere sie und versuch es erneut.',
    sideQuestionFailed: 'Die Nebenfrage ließ sich nicht beantworten: {{reason}}',
    sideQuestionTimedOut:
      'Die Nebenfrage hat zu lange gedauert und wurde abgebrochen. Versuch es erneut.',
    pushTargetChanged:
      '{{branch}} wurde nicht gepusht: origin pusht jetzt nach {{current}}, nicht mehr dorthin wie bei deinem Klick.',
    repoConfigSymlink:
      '{{path}} ist ein symbolischer Link. octopus liest und schreibt nicht über Links, weil sie überallhin außerhalb des Repositorys zeigen können.',
    repoConfigTooLarge: '{{path}} ist größer, als diese Art Datei sein darf.',
    repoConfigMalformed: '{{path}} beschreibt kein Projekt.',
    skillNameInvalid:
      '„{{name}}“ ist als Skill-Name nicht möglich: Verwende Kleinbuchstaben, Ziffern und einzelne Bindestriche. Der Name wird zum Ordner des Skills.',
    skillNameMismatch:
      'Das Dokument nennt „{{found}}“, aber dieser Skill ist als „{{name}}“ abgelegt. Benenne ihn im Dokument um oder importiere ihn als neuen Skill.',
    skillExists: 'Ein Skill namens „{{name}}“ ist bereits vorhanden.',
    skillMissing: 'Dieser Skill ist nicht mehr da.',
    skillFrontmatterMissing:
      'Eine SKILL.md braucht Frontmatter, das den Skill benennt und sagt, wann er zu verwenden ist. Diese hat keines, das sich lesen ließ.',
    skillTooLarge:
      'Das ist größer, als ein Skill je sein sollte, daher wurde nichts geschrieben. Das Limit ist {{limit}}.',
    skillLinkRefused:
      '„{{name}}“ ist ein symbolischer Link. Ein Skill wird so kopiert, wie er ist, und bei einem Link hinge sein Inhalt von einem anderen Ort auf der Festplatte ab.',
    skillUrlRefused:
      'Von {{url}} ließ sich nichts abrufen. Nur https-Adressen werden verfolgt, und eine Weiterleitung weg von https wird abgelehnt.',
    unknown: 'Etwas ist schiefgelaufen: {{message}}'
  }
}

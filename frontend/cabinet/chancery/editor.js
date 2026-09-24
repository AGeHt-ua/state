/* Канцелярія — Word-подібний редактор документів.
   Документ — один суцільний contenteditable на аркуші A4 з розбивкою на сторінки.
   «Поля» (ПІБ, номер, дата…) — атомарні span.fld, які оновлюються наживо з панелі. */
(function () {
  'use strict';

  const user = typeof requireAuth === 'function' ? requireAuth() : null;
  if (!user) return;

  const $ = (id) => document.getElementById(id);
  const STORE = 'gov_chancery_v2';
  const OLD_STORE = 'gov_chancery_v1';
  const UI_STORE = 'gov_chancery_ui';
  const SLOTS = 5;
  const MM = 96 / 25.4;

  const COURT_BG = 'https://media.discordapp.net/attachments/1547182239794860032/1547182567265140808/photo_5323606809891249632_y.png?ex=6aa27d8d&is=6aa12c0d&hm=5b9f17272e79c20e44a1ff0d3899eb7e11718418a07f5373e77e568db8884461&=&format=webp&quality=lossless';
  const BG_PRESETS = {
    court: [{ name: 'Судова рамка', src: COURT_BG }],
    governor: [],
    directors: [],
    prosecutor: []
  };
  // Встав свої webhook тільки сюди. На сторінці вони не показуються.
  const DISCORD_CHANNELS = [
    { id: 'gov', name: 'Уряд', webhook: '', offices: ['governor', 'directors'] },
    { id: 'prosecutor_ch', name: 'Прокуратура', webhook: '', offices: ['prosecutor'] },
    { id: 'court_templates', name: '📄・шаблони-доків', webhook: '', offices: ['court'] }
  ];
  const OFFICE_DOCS = {
    governor: ['nakaz', 'rozp', 'ukaz', 'post', 'dor', 'order'],
    directors: ['nakaz', 'rozp', 'dor'],
    prosecutor: ['nakaz', 'order'],
    court: ['scorder', 'summons', 'ruling', 'arrest']
  };
  const ID_KINDS = {
    ident: 'ідентифікаційний номер',
    badge: 'номер жетона',
    passport: 'номер паспорта',
    cert: 'номер посвідчення'
  };

  const FIELDS = {
    number: { label: 'Номер документа', token: 'НОМЕР' },
    date: { label: 'Дата', token: 'ДАТА' },
    city: { label: 'Місто', token: 'МІСТО' },
    name: { label: 'ПІБ особи', token: 'ПІБ' },
    post: { label: 'Посада особи', token: 'ПОСАДА' },
    idKind: { label: 'Вид номера', token: 'Вид номера' },
    id: { label: 'Номер особи', token: 'НОМЕР_ОСОБИ' },
    postId: { label: 'Номер посади', token: 'ID_ПОСАДИ' },
    officer: { label: 'Посада підписанта', token: 'ПОСАДА_ПІДПИСАНТА' },
    signer: { label: 'ПІБ підписанта', token: 'ПІДПИСАНТ' },
    signText: { label: 'Розчерк', token: 'ПІДПИС' },
    caseNo: { label: 'Справа №', token: 'СПРАВА' },
    role: { label: 'Роль у справі', token: 'РОЛЬ' },
    hearing: { label: 'Дата й час засідання', token: 'ЗАСІДАННЯ' },
    venue: { label: 'Місце / адреса', token: 'МІСЦЕ_ЗАСІДАННЯ' }
  };
  const TOKEN_TO_KEY = { ID: 'id' };
  Object.keys(FIELDS).forEach((k) => { TOKEN_TO_KEY[FIELDS[k].token] = k; });
  const TOKEN_RE = new RegExp('\\{(' + Object.keys(TOKEN_TO_KEY).sort((a, b) => b.length - a.length).join('|') + ')\\}', 'g');

  const FIELD_GROUPS = [
    { id: 'doc', title: 'Документ', keys: ['number', 'date', 'city'] },
    { id: 'person', title: 'Кого стосується', keys: ['name', 'post', 'idKind', 'id', 'postId'] },
    { id: 'court', title: 'Суд', keys: ['caseNo', 'role', 'hearing', 'venue'] },
    { id: 'sign', title: 'Хто підписує', keys: ['officer', 'signer', 'signText'] }
  ];
  const PROFILE_DEFAULT = { show: ['number', 'date', 'city', 'name', 'post', 'idKind', 'id', 'postId'] };
  const PROFILES = {
    scorder: { person: 'Кого призначають / звільняють', show: ['number', 'date', 'city', 'name', 'post', 'idKind', 'id'] },
    summons: { person: 'Кого викликають', court: 'Засідання', show: ['date', 'city', 'name', 'post', 'caseNo', 'role', 'hearing', 'venue'] },
    ruling: { person: 'Сторони / заявник', court: 'Справа', show: ['date', 'city', 'name', 'post', 'caseNo', 'hearing'] },
    arrest: { person: 'Особа / власник', court: 'Справа і об’єкт', show: ['number', 'date', 'city', 'name', 'post', 'caseNo', 'venue'] },
    order: { person: 'Кого уповноважують', show: PROFILE_DEFAULT.show }
  };

  const TYPES = {
    nakaz: {
      label: 'Наказ',
      title: 'Наказ №{НОМЕР}',
      subject: '“Про призначення на посаду {ПОСАДА}”',
      preamble: 'Я, {ПОСАДА_ПІДПИСАНТА} {ПІДПИСАНТ}, керуючись Конституцією штату San-Andreas та іншими нормативно-правовими актами, НАКАЗУЮ:',
      effective: 'Цей наказ набуває чинності з моменту його публікації.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: профільний департамент; Кадрова служба; Преса Уряду; Архів.',
      tpls: [
        { label: 'Призначити', text: 'Призначити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на посаду {ПОСАДА}.' },
        { label: 'Повноваження', text: 'Надати {ПІБ} усі права та повноваження відповідно до посади {ПОСАДА} (ідентифікаційний номер посади {ID_ПОСАДИ}) згідно Конституції та інших нормативно-правових актів.' },
        { label: 'Звільнити', text: 'Звільнити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) з посади {ПОСАДА} з дня опублікування цього наказу.' },
        { label: 'Скасувати', text: 'Визнати таким, що втратив чинність, Наказ №___ у частині, що суперечить цьому акту.' },
        { label: 'Опублікувати', text: 'Ознайомити заінтересованих осіб під підпис та опублікувати наказ протягом 24 годин. Копію направити до Архіву Уряду.' }
      ]
    },
    rozp: {
      label: 'Розпорядження',
      title: 'Розпорядження №{НОМЕР}',
      subject: '“Про організацію роботи щодо посади {ПОСАДА}”',
      preamble: 'Керуючись Конституцією штату San-Andreas та Законом про діяльність Уряду,',
      effective: 'Розпорядження набирає чинності з дня доведення до виконавців.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: виконавці; Канцелярія Уряду; Архів.',
      tpls: [
        { label: 'Організувати', text: 'Організувати виконання заходів щодо посади {ПОСАДА} у м. {МІСТО}.' },
        { label: 'Відповідальний', text: 'Відповідальним призначити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}).' },
        { label: 'Строк', text: 'Встановити строк виконання — до {ДАТА} включно.' },
        { label: 'Звіт', text: 'Звіт про виконання подати до Канцелярії Уряду.' },
        { label: 'Контроль', text: 'Контроль за виконанням цього розпорядження залишаю за собою.' }
      ]
    },
    ukaz: {
      label: 'Указ',
      title: 'Указ №{НОМЕР}',
      subject: '“Про кадрові питання”',
      preamble: 'Відповідно до Конституції штату San-Andreas постановляю:',
      effective: 'Указ підлягає негайному опублікуванню.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: Уряд; профільний департамент; Преса; Архів.',
      tpls: [
        { label: 'Призначити', text: 'Призначити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на посаду {ПОСАДА}.' },
        { label: 'Статус', text: 'Установити, що {ПІБ} здійснює повноваження {ПОСАДА} з дня опублікування цього указу.' },
        { label: 'Звільнити', text: 'Звільнити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) з посади {ПОСАДА}.' },
        { label: 'Скасувати', text: 'Визнати таким, що втратив чинність, Указ №___.' },
        { label: 'Оприлюднити', text: 'Оприлюднити цей указ у офіційних джерелах штату San-Andreas.' }
      ]
    },
    post: {
      label: 'Постанова',
      title: 'Постанова №{НОМЕР}',
      subject: '“Про окремі питання діяльності виконавчої влади”',
      preamble: 'Уряд штату San-Andreas постановляє:',
      effective: 'Постанова чинна з моменту офіційного оприлюднення.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: органи виконавчої влади; Канцелярія; Архів.',
      tpls: [
        { label: 'Затвердити', text: 'Затвердити запропонований порядок щодо {ПОСАДА}.' },
        { label: 'Зобов’язати', text: 'Зобов’язати профільні органи забезпечити виконання постанови у м. {МІСТО}.' },
        { label: 'Виконавець', text: 'Координацію покласти на {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}).' },
        { label: 'Ресурс', text: 'Передбачити організаційно-технічне забезпечення виконання цієї постанови.' },
        { label: 'Оприлюднити', text: 'Опублікувати постанову та надіслати копії виконавцям.' }
      ]
    },
    dor: {
      label: 'Доручення',
      title: 'Доручення №{НОМЕР}',
      subject: '“Щодо виконання обов’язків {ПОСАДА}”',
      preamble: 'Доручаю відповідним органам забезпечити виконання нижченаведеного.',
      effective: 'Контроль за виконанням залишаю за собою.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: виконавець; безпосередній керівник; Архів.',
      tpls: [
        { label: 'Виконати', text: 'До {ДАТА} забезпечити виконання завдань, пов’язаних із посадою {ПОСАДА}.' },
        { label: 'Кому', text: 'Виконання доручити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}).' },
        { label: 'Порядок', text: 'Діяти в межах Конституції штату San-Andreas та посадових інструкцій.' },
        { label: 'Доповісти', text: 'Про результати доповісти {ПОСАДА_ПІДПИСАНТА} письмово.' },
        { label: 'Контроль', text: 'Контроль залишаю за собою.' }
      ]
    },
    order: {
      label: 'Ордер',
      title: 'Ордер №{НОМЕР}',
      subject: '“На вчинення процесуальних / службових дій”',
      preamble: 'Керуючись Конституцією штату San-Andreas, Законом про діяльність Уряду та встановленим порядком видачі ордерів,',
      effective: 'Ордер дійсний з моменту підписання і підлягає пред’явленню перед виконанням.',
      officer: 'Губернатор штату',
      copies: 'Розсилка: виконавець ордера; реєстр ордерів; Архів.',
      tpls: [
        { label: 'Уповноважити', text: 'Уповноважити {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на виконання цього ордера.' },
        { label: 'Дія', text: 'Дозволити проведення службових дій щодо об’єкта / особи в межах м. {МІСТО}, штат San-Andreas.' },
        { label: 'Межі', text: 'Дії вчиняти строго в межах, зазначених у цьому ордері, без перевищення повноважень.' },
        { label: 'Строк', text: 'Строк дії ордера — до {ДАТА} включно, якщо його не відкликано раніше.' },
        { label: 'Звіт', text: 'Після виконання подати звіт до органу, що видав ордер, та повернути оригінал до реєстру.' }
      ]
    },
    scorder: {
      label: 'Наказ Голови ВС',
      title: 'Наказ Голови Верховного суду',
      subject: 'SUPREME COURT OF SAN-ANDREAS',
      preamble: 'Я, {ПОСАДА_ПІДПИСАНТА} {ПІДПИСАНТ}, на підставі Конституції штату San-Andreas та інших нормативно-правових актів, НАКАЗУЮ:',
      effective: 'Цей наказ набуває чинності з моменту його публікації.',
      officer: 'Голова Верховного суду',
      copies: '',
      tpls: [
        { label: 'Призначити Верховного суддю', text: 'Призначити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на посаду Верховного судді та надати всі права та повноваження відповідно посади.' },
        { label: 'Призначити апеляційного суддю', text: 'Призначити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на посаду апеляційного судді та надати всі права та повноваження відповідно посади.' },
        { label: 'Призначити окружного суддю', text: 'Призначити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) на посаду окружного судді та надати всі права та повноваження відповідно посади.' },
        { label: 'Звільнити Верховного суддю', text: 'Звільнити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) з посади Верховного судді та скасувати всі права та повноваження відповідно посади.' },
        { label: 'Звільнити апеляційного суддю', text: 'Звільнити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) з посади апеляційного судді та скасувати всі права та повноваження відповідно посади.' },
        { label: 'Звільнити окружного суддю', text: 'Звільнити громадянина {ПІБ} ({Вид номера} {НОМЕР_ОСОБИ}) з посади окружного судді та скасувати всі права та повноваження відповідно посади.' }
      ]
    },
    summons: {
      label: 'Повістка',
      title: 'Повістка',
      subject: 'DISTRICT COURT — DISTRICT OF SAN-ANDREAS',
      preamble: 'Шановний {ПОСАДА} {ПІБ}, Окружний суд повідомляє про виклик Вас для участі у судовому засіданні у якості {РОЛЬ} у справі №{СПРАВА} від {ДАТА}.',
      effective: 'Просимо з’явитись до суду у зазначений час та мати при собі документи, що посвідчують особу, а також процесуальні матеріали, необхідні для розгляду справи.',
      officer: 'Окружний суддя',
      copies: 'Розсилка: адресат повістки; канцелярія окружного суду; матеріали справи №{СПРАВА}.',
      tpls: [
        { label: 'Коли і де', text: 'Судове засідання відбудеться {ЗАСІДАННЯ} {МІСЦЕ_ЗАСІДАННЯ}.' },
        { label: 'Як підсудного', text: 'Викликати {ПІБ} ({ПОСАДА}) для участі у судовому засіданні у якості підсудного у справі №{СПРАВА}.' },
        { label: 'Як свідка', text: 'Викликати {ПІБ} ({ПОСАДА}) для участі у судовому засіданні у якості свідка у справі №{СПРАВА}.' },
        { label: 'Як потерпілого', text: 'Викликати {ПІБ} ({ПОСАДА}) для участі у судовому засіданні у якості потерпілого у справі №{СПРАВА}.' },
        { label: 'Документи', text: 'З’явитись особисто, мати при собі документи, що посвідчують особу, та процесуальні матеріали, необхідні для розгляду справи №{СПРАВА}.' }
      ]
    },
    ruling: {
      label: 'Ухвала суду',
      title: 'Ухвала суду',
      subject: 'DISTRICT COURT — DISTRICT OF SAN-ANDREAS',
      preamble: 'Суд у складі {ПОСАДА_ПІДПИСАНТА} {ПІДПИСАНТ}, керуючись чинним законодавством штату San-Andreas, постановив:',
      effective: 'НАБРАННЯ ЧИННОСТІ: ухвала набирає чинності з моменту проголошення та може бути оскаржена в установленому порядку.',
      officer: 'Окружний суддя',
      copies: 'Розсилка: сторони у справі №{СПРАВА}; канцелярія окружного суду; Архів суду.',
      tpls: [
        { label: 'Обставини — позов', text: 'ОБСТАВИНИ СПРАВИ. До суду надійшов позов щодо {ПІБ}, якому інкримінується вчинення правопорушень, передбачених кримінальним кодексом штату San-Andreas.' },
        { label: 'Обставини — клопотання', text: 'ОБСТАВИНИ СПРАВИ. До суду надійшло клопотання від {ПОСАДА} {ПІБ}.' },
        { label: 'Встановлено судом', text: 'ВСТАНОВЛЕНО СУДОМ. Дослідивши матеріали, суд дійшов висновку, зазначеного нижче.' },
        { label: 'Перенести засідання', text: 'СУД УХВАЛИВ. Про перенесення судового засідання. Засідання, яке мало відбутися {ЗАСІДАННЯ}, переноситься.' },
        { label: 'Залишити без задоволення', text: 'СУД УХВАЛИВ. Залишити позов без задоволення у зв’язку з недостатністю доказової бази.' },
        { label: 'Задовольнити', text: 'СУД УХВАЛИВ. Задовольнити позов / клопотання щодо {ПІБ} у справі №{СПРАВА}.' }
      ]
    },
    arrest: {
      label: 'Ордер',
      title: 'Ордер №{НОМЕР}',
      subject: 'DISTRICT COURT — DISTRICT OF SAN-ANDREAS',
      preamble: 'До: будь-якого уповноваженого працівника правоохоронних органів штату San-Andreas.',
      effective: 'ВИДАНО. Суддею окружного суду {ПІДПИСАНТ}. Ордер підлягає негайному виконанню в межах, зазначених нижче.',
      officer: 'Суддя окружного суду',
      copies: '',
      tpls: [
        { label: 'Проведення рейду', text: 'Дозволити проведення рейду щодо {ПІБ} / об’єкта {ПОСАДА} за адресою {МІСЦЕ_ЗАСІДАННЯ} у справі №{СПРАВА}. Під час рейду дозволено затримання причетних осіб та фіксацію речових доказів.' },
        { label: 'Арешт особи', text: 'На підставі судового рішення у справі №{СПРАВА} від {ДАТА} здійснити арешт {ПІБ}.' },
        { label: 'Обшук приміщення', text: 'Дозволити проведення обшуку приміщення / володіння {ПІБ} за адресою: {МІСЦЕ_ЗАСІДАННЯ}.' },
        { label: 'Вилучення майна', text: 'Дозволити вилучення приватної власності {ПІБ}, а саме: {ПОСАДА}, що перебуває {МІСЦЕ_ЗАСІДАННЯ}.' },
        { label: 'Заборона розпоряджатись', text: 'Заборонити {ПІБ} відчужувати, переміщувати або іншим чином розпоряджатись майном, зазначеним у цьому ордері, до окремого рішення суду.' },
        { label: 'Межі виконання', text: 'Дії вчиняти строго в межах цього ордера, у м. {МІСТО}, штат San-Andreas, без перевищення повноважень.' }
      ]
    }
  };

  const ICONS = (() => {
    const s = (d) => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    const dot = (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="1.1" fill="currentColor" stroke="none"/>';
    const num = (x, y, t) => '<text x="' + x + '" y="' + y + '" font-size="5.2" font-family="Arial" font-weight="700" fill="currentColor" stroke="none">' + t + '</text>';
    return {
      save: s('<path d="M3 2h8l3 3v9H2V3a1 1 0 0 1 1-1z"/><path d="M5 2v4h5V2M4.5 14v-4.5h7V14"/>'),
      undo: s('<path d="M5.5 3 2.5 6l3 3"/><path d="M2.8 6H10a3.5 3.5 0 0 1 0 7H6"/>'),
      redo: s('<path d="m10.5 3 3 3-3 3"/><path d="M13.2 6H6a3.5 3.5 0 0 0 0 7h4"/>'),
      newdoc: s('<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3M8 7v5M5.5 9.5h5"/>'),
      trash: s('<path d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.7 9.5h5.6l.7-9.5"/>'),
      download: s('<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"/>'),
      print: s('<path d="M4 6V2h8v4"/><rect x="2" y="6" width="12" height="6" rx="1"/><path d="M4.5 10h7v4h-7z"/>'),
      chat: s('<path d="M2.5 3h11v8H7l-3 3v-3H2.5z"/><path d="M5 6h6M5 8.5h4"/>'),
      send: s('<path d="M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5z"/>'),
      globe: s('<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.2 2.2 2.2 9.8 0 12M8 2c-2.2 2.2-2.2 9.8 0 12"/>'),
      paste: s('<rect x="3" y="3" width="10" height="11.5" rx="1"/><path d="M6 3V1.8h4V3M5.5 7h5M5.5 9.5h5M5.5 12h3"/>'),
      pastetext: s('<rect x="3" y="3" width="10" height="11.5" rx="1"/><path d="M6 3V1.8h4V3M6 7h4M8 7v5"/>'),
      cut: s('<circle cx="4.5" cy="12" r="2"/><circle cx="11.5" cy="12" r="2"/><path d="M5.8 10.5 11.5 2M10.2 10.5 4.5 2"/>'),
      copy: s('<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V2.5a.5.5 0 0 0-.5-.5h-8a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5H5"/>'),
      clear: s('<path d="M3 13 6.5 3h1l2 5.5M4.3 9.5h4"/><path d="m10 10.5 4 4M14 10.5l-4 4"/>'),
      marker: s('<path d="m4.5 10.5 6-7.5 2.5 2-6 7.5H4.5z"/><path d="M4.5 10.5 3 12"/>'),
      bullets: s(dot(3, 4) + dot(3, 8) + dot(3, 12) + '<path d="M6 4h8M6 8h8M6 12h8"/>'),
      numbers: s(num(0.6, 5.8, '1') + num(0.6, 9.8, '2') + num(0.6, 13.8, '3') + '<path d="M6 4h8M6 8h8M6 12h8"/>'),
      subnumbers: s(num(0.6, 5.8, '1') + num(3.6, 11.8, '1.1') + '<path d="M5.5 4h8.5M10 10h4"/>'),
      outdent: s('<path d="M7 3h7M7 6.5h7M7 10h7M2 13.5h12"/><path d="M4.5 4.5 2 7l2.5 2.5"/>'),
      indent: s('<path d="M7 3h7M7 6.5h7M7 10h7M2 13.5h12"/><path d="M2 4.5 4.5 7 2 9.5"/>'),
      firstline: s('<path d="M6 3h8M2 6.5h12M2 10h12M2 13.5h9"/><path d="M2 1.5v3M2 3h2.5"/>'),
      lineheight: s('<path d="M7.5 3h6.5M7.5 6.5h6.5M7.5 10h6.5M7.5 13.5h6.5"/><path d="M3.5 2v12M1.8 4 3.5 2l1.7 2M1.8 12l1.7 2 1.7-2"/>'),
      alignL: s('<path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/>'),
      alignC: s('<path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/>'),
      alignR: s('<path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/>'),
      alignJ: s('<path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12"/>'),
      search: s('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>'),
      replace: s('<path d="M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5"/>'),
      selectall: s('<rect x="2" y="2" width="12" height="12" stroke-dasharray="2 1.6"/><path d="M5 6h6M5 9.5h6"/>'),
      pagebreak: s('<path d="M4 1.5v4h8v-4M4 14.5v-4h8v4"/><path d="M1.5 8h2M6 8h1.5M9.5 8H11M13 8h1.5"/>'),
      table: s('<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.2h12M2 9.9h12M6 2.5v11M10 2.5v11"/>'),
      image: s('<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/>'),
      seal: s('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.6"/><path d="M8 6.8v2.4M6.8 8h2.4"/>'),
      hr: s('<path d="M2 8h12"/><path d="M4 4.5h8M4 11.5h8" opacity=".4"/>'),
      signature: s('<path d="M2 11.5c1.8-5.5 3.3-6.5 3.8-4.6.5 1.9-1.2 4.8.7 3.8 1.9-1 2-3.8 3.1-2.9 1 .9.8 2.6 4.4.9"/><path d="M2 14h12"/>'),
      field: s('<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4.8 6.3 3.8 8l1 1.7M11.2 6.3l1 1.7-1 1.7M6.8 8h2.4"/>'),
      calendar: s('<rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>'),
      template: s('<path d="M3 1.5h10v13H3z"/><path d="M5.5 5h5M5.5 8h5M5.5 11h3"/>'),
      margins: s('<rect x="2.5" y="1.5" width="11" height="13"/><path d="M2.5 4h11M2.5 12h11M5 1.5v13M11 1.5v13" stroke-dasharray="1 1.3"/>'),
      orient: s('<rect x="1.5" y="5" width="8" height="9.5" rx=".5"/><path d="M11.5 2.5A3 3 0 0 1 14 5.5M12.5 4.8 14 5.5l.6-1.6"/>'),
      background: s('<rect x="2" y="2" width="12" height="12" rx="1"/><rect x="4" y="4" width="8" height="8" stroke-dasharray="1.2 1.2"/>'),
      upload: s('<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M2.5 13.5h11"/>'),
      page: s('<path d="M4 1.5h5.5l3 3v10H4z"/><path d="M9.5 1.5v3h3"/>'),
      fitwidth: s('<rect x="4" y="2" width="8" height="12"/><path d="M1 8h3M12 8h3M2.3 6.7 1 8l1.3 1.3M13.7 6.7 15 8l-1.3 1.3"/>'),
      pane: s('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M10 2.5v11M11.5 5.5h1.5M11.5 8h1.5"/>'),
      rowabove: s('<rect x="2" y="8" width="12" height="6" rx=".5"/><path d="M8 1.5v5M5.5 4h5"/>'),
      rowbelow: s('<rect x="2" y="2" width="12" height="6" rx=".5"/><path d="M8 9.5v5M5.5 12h5"/>'),
      colleft: s('<rect x="8" y="2" width="6" height="12" rx=".5"/><path d="M1.5 8h5M4 5.5v5"/>'),
      colright: s('<rect x="2" y="2" width="6" height="12" rx=".5"/><path d="M9.5 8h5M12 5.5v5"/>')
    };
  })();

  const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  const TEXT_COLORS = [
    '#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47',
    '#f2f2f2', '#7f7f7f', '#d0cece', '#d6dce4', '#d9e2f3', '#fbe5d5', '#ededed', '#fff2cc', '#deebf6', '#e2efd9',
    '#bfbfbf', '#595959', '#aeaaaa', '#adb9ca', '#b4c6e7', '#f7cbac', '#dbdbdb', '#fee599', '#bdd7ee', '#c5e0b3',
    '#7f7f7f', '#262626', '#3a3838', '#323f4f', '#2f5496', '#c55a11', '#7b7b7b', '#bf8f00', '#2e75b5', '#538135',
    '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'
  ];
  const HILITE_COLORS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080', '#008000', '#800080',
    '#800000', '#808000', '#808080', '#c0c0c0', '#000000'];
  const SYMBOLS = ['№', '§', '«', '»', '„', '“', '”', '’', '—', '–', '…', '•', '·', '°', '±', '×', '÷', '≈', '≠', '≤', '≥', '→', '←', '↑',
    '✓', '✗', '©', '®', '™', '₴', '€', '$', '½', '¼', '¾', '¹', '²', '³', '†', '‡'];

  /* ---------- Утиліти ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function fmtPt(v) { return String(Math.round(v * 2) / 2).replace('.', ','); }
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function loadUi() { try { return JSON.parse(localStorage.getItem(UI_STORE)) || {}; } catch (e) { return {}; } }
  function saveUi() { try { localStorage.setItem(UI_STORE, JSON.stringify(ui)); } catch (e) { /* не критично */ } }

  const editor = $('editor');
  const sheet = $('sheet');
  const canvas = $('canvas');
  const office = typeof userOffice === 'function' ? userOffice(user) : 'governor';
  const officeTypes = OFFICE_DOCS[office] || OFFICE_DOCS.governor;
  const ui = Object.assign({ pane: window.innerWidth > 900, ruler: true, shade: true, zoom: 100 }, loadUi());

  /* ---------- Стан документа ---------- */
  function defaultFields(type) {
    const t = TYPES[type] || TYPES.nakaz;
    return {
      number: '415/2026', date: today(), city: 'Los-Santos',
      name: 'Danichka Swarovski', post: type === 'summons' ? 'Співробітнику LSPD штату San-Andreas' : 'Заступник Директора департаменту культури',
      idKind: type === 'scorder' ? 'passport' : 'ident', id: '5587', postId: '43099',
      officer: user.post || t.officer, signer: user.username || '', signText: user.username || '',
      caseNo: 'DOJ-91', role: 'підсудного', hearing: '29 серпня 2026 року о 21:00',
      venue: 'у приміщенні Капітолію міста Los-Santos'
    };
  }
  function defaultState(type) {
    const tp = type && officeTypes.indexOf(type) !== -1 ? type : officeTypes[0];
    const court = office === 'court';
    return {
      v: 2,
      office: office,
      type: tp,
      fields: defaultFields(tp),
      layout: court
        ? { top: 37, bottom: 36, left: 25, right: 25, landscape: false, baseSize: 14 }
        : { top: 20, bottom: 20, left: 30, right: 15, landscape: false, baseSize: 14 },
      bgImageSrc: court ? COURT_BG : '',
      seal: { show: true, src: '', x: 540, y: 900, size: 118 },
      html: null,
      pristine: true,
      updated: 0
    };
  }
  function mergeState(s) {
    const d = defaultState(s.type);
    const st = Object.assign(d, s, {
      fields: Object.assign(d.fields, s.fields || {}),
      layout: Object.assign(d.layout, s.layout || {}),
      seal: Object.assign(d.seal, s.seal || {})
    });
    if (officeTypes.indexOf(st.type) === -1) st.type = officeTypes[0];
    st.office = office;
    return st;
  }

  /* Перенесення чернеток зі старого редактора (gov_chancery_v1) */
  function v1Html(c, vis) {
    const parts = [];
    if (vis.header !== false) {
      parts.push('<p style="text-align:center"><span style="font-size:12pt;color:#444444">' + (c.place || '') + '</span></p>');
      parts.push('<h1>' + (c.number || '') + '</h1>');
      parts.push('<p style="text-align:center"><b><i>' + (c.subject || '') + '</i></b></p>');
    }
    if (c.preamble) parts.push('<p style="text-align:center">' + c.preamble + '</p>');
    if (Array.isArray(c.points) && c.points.length) {
      let html = '<ol>';
      let openSub = false;
      c.points.forEach((p) => {
        const text = esc(String(p.text || '').replace(/^\s*\d+(\.\d+)?\.\s*/, ''));
        if (p.sub) {
          if (!openSub) { html = html.replace(/<\/li>$/, '') + '<ol>'; openSub = true; }
          html += '<li>' + text + '</li>';
        } else {
          if (openSub) { html += '</ol></li>'; openSub = false; }
          html += '<li>' + text + '</li>';
        }
      });
      if (openSub) html += '</ol></li>';
      parts.push(html + '</ol>');
    }
    if (c.effective) parts.push('<p style="text-align:center"><b>' + c.effective + '</b></p>');
    if (c.copies) parts.push('<p><span style="font-size:12pt">' + c.copies + '</span></p>');
    if (vis.footer !== false) {
      parts.push('<table class="sig"><tbody><tr><td><b>' + (c.title || '') + '</b><br>' + (c.name || '') +
        '</td><td style="text-align:center"><span class="signature">' + (c.sign || '') +
        '</span></td><td style="text-align:right"><b>' + (c.date || '') + '</b></td></tr></tbody></table>');
    }
    return parts.join('');
  }
  function convertV1(s) {
    const st = defaultState(s.type);
    Object.assign(st.fields, s.fields || {});
    const p = s.padding || {};
    const mm = (v, d) => (v ? Math.round(v / MM) : d);
    st.layout.top = mm(p.top, st.layout.top);
    st.layout.bottom = mm(p.bottom, st.layout.bottom);
    st.layout.left = st.layout.right = mm(p.side, st.layout.left);
    st.bgImageSrc = s.bgImageSrc && s.bgImageSrc !== 'image_7133bb.jpg' ? s.bgImageSrc : '';
    const pos = (s.positions && s.positions.sealLayer) || {};
    st.seal = {
      show: !s.visibility || s.visibility.seal !== false,
      src: s.sealSrc || '',
      x: pos.x != null ? pos.x : 540,
      y: pos.y != null ? pos.y : 900,
      size: p.seal || 118
    };
    if (s.content) { st.html = v1Html(s.content, s.visibility || {}); st.pristine = false; }
    return st;
  }
  function loadDb() {
    try {
      const db = JSON.parse(localStorage.getItem(STORE));
      if (db && db.slots) return db;
    } catch (e) { /* пошкоджене сховище — почнемо заново */ }
    const db = { active: 1, slots: {} };
    try {
      const old = JSON.parse(localStorage.getItem(OLD_STORE));
      if (old && old.slots) {
        Object.keys(old.slots).forEach((k) => {
          try { db.slots[k] = convertV1(old.slots[k]); } catch (e) { console.warn('v1 slot', k, e); }
        });
        db.active = old.active || 1;
      }
    } catch (e) { /* немає старих даних */ }
    return db;
  }

  let db = loadDb();
  let slot = clamp(+db.active || 1, 1, SLOTS);
  let state = defaultState();
  window.state = state;

  /* ---------- Поля ---------- */
  function fieldText(k) {
    const v = state.fields[k] == null ? '' : String(state.fields[k]);
    return k === 'idKind' ? (ID_KINDS[v] || v) : v;
  }
  function fieldSpan(k) {
    const v = fieldText(k);
    return '<span class="fld' + (v ? '' : ' empty') + '" data-f="' + k + '" contenteditable="false">' +
      esc(v || '[' + FIELDS[k].label + ']') + '</span>';
  }
  function tok(str) {
    return esc(str).replace(TOKEN_RE, (m, t) => fieldSpan(TOKEN_TO_KEY[t]));
  }
  function refreshFields(onlyKey) {
    const sel = onlyKey ? '.fld[data-f="' + onlyKey + '"]' : '.fld';
    editor.querySelectorAll(sel).forEach((sp) => {
      const k = sp.getAttribute('data-f');
      if (!FIELDS[k]) return;
      const v = fieldText(k);
      const text = v || '[' + FIELDS[k].label + ']';
      if (sp.textContent !== text) sp.textContent = text;
      sp.classList.toggle('empty', !v);
      sp.setAttribute('contenteditable', 'false');
    });
    scheduleLayout();
  }
  function setField(k, v, from) {
    state.fields[k] = v;
    refreshFields(k);
    if (from !== 'pane') {
      const inp = $('f-' + k);
      if (inp) inp.value = v;
    }
    updateTitle();
    scheduleSave();
  }

  function sigTableHtml() {
    return '<table class="sig"><tbody><tr>' +
      '<td><b>' + tok('{ПОСАДА_ПІДПИСАНТА}') + '</b><br>' + tok('{ПІДПИСАНТ}') + '</td>' +
      '<td style="text-align:center"><span class="signature">' + tok('{ПІДПИС}') + '</span></td>' +
      '<td style="text-align:right"><b>' + tok('{ДАТА}') + '</b></td>' +
      '</tr></tbody></table>';
  }
  function buildTemplate(typeKey) {
    const t = TYPES[typeKey] || TYPES.nakaz;
    const points = t.tpls.slice(0, 3).map((x) => '<li>' + tok(x.text) + '</li>').join('');
    return [
      '<p style="text-align:center"><span style="font-size:12pt;color:#444444">Штат San-Andreas • м. ' + tok('{МІСТО}') + '</span></p>',
      '<h1>' + tok(t.title) + '</h1>',
      '<p style="text-align:center"><b><i>' + tok(t.subject) + '</i></b></p>',
      '<p style="text-align:center">' + tok(t.preamble) + '</p>',
      '<ol>' + points + '</ol>',
      '<p style="text-align:center"><b>' + tok(t.effective) + '</b></p>',
      t.copies ? '<p><span style="font-size:12pt">' + tok(t.copies) + '</span></p>' : '',
      sigTableHtml()
    ].join('');
  }

  /* ---------- Виділення ---------- */
  let savedRange = null;
  const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,div,blockquote,pre';

  function inEditor(node) { return !!node && (node === editor || editor.contains(node)); }
  function anchorEl() {
    if (!savedRange) return null;
    const n = savedRange.startContainer;
    const el = n.nodeType === 1 ? (n.childNodes[savedRange.startOffset] && n.childNodes[savedRange.startOffset].nodeType === 1 ? n.childNodes[savedRange.startOffset] : n) : n.parentElement;
    return inEditor(el) ? el : null;
  }
  function blockOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const b = el && el.closest(BLOCK_SEL);
    return b && b !== editor && editor.contains(b) ? b : null;
  }
  function restoreSel() {
    editor.focus({ preventScroll: true });
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange);
    }
  }
  function captureSel() {
    const s = window.getSelection();
    if (s.rangeCount && inEditor(s.getRangeAt(0).commonAncestorContainer)) savedRange = s.getRangeAt(0).cloneRange();
  }
  function selectedBlocks() {
    const r = savedRange;
    if (!r) return [];
    const set = new Set();
    const sb = blockOf(r.startContainer);
    if (sb) set.add(sb);
    const root = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (r.intersectsNode(n)) { const b = blockOf(n); if (b) set.add(b); }
    }
    // У списку з вкладеністю беремо найглибший блок
    return Array.from(set).filter((b) => !Array.from(set).some((o) => o !== b && b.contains(o) && o.tagName !== 'TD'));
  }
  function ensureBlocks() {
    let blocks = selectedBlocks();
    if (!blocks.length) {
      restoreSel();
      document.execCommand('formatBlock', false, 'p');
      captureSel();
      blocks = selectedBlocks();
    }
    return blocks;
  }
  function placeCaretIn(el, atStart) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!!atStart);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
  }

  /* ---------- Команди редагування ---------- */
  function exec(cmd, val) {
    restoreSel();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, val == null ? null : val);
    afterEdit();
  }

  let markSeq = 0;
  const pendingMarks = {};
  function applyInline(styles) {
    restoreSel();
    const mark = 'wdm' + (++markSeq);
    pendingMarks[mark] = styles;
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontName', false, mark);
    convertMarks();
    afterEdit();
  }
  function convertMarks() {
    const apply = (el, st) => {
      Object.keys(st).forEach((p) => {
        el.style[p] = st[p];
        el.querySelectorAll('*').forEach((ch) => {
          if (ch.style && ch.style[p]) ch.style[p] = '';
          if (ch.tagName === 'FONT' && p === 'fontSize') ch.removeAttribute('size');
          if (ch.tagName === 'FONT' && p === 'fontFamily') ch.removeAttribute('face');
        });
      });
    };
    editor.querySelectorAll('font[face^="wdm"]').forEach((f) => {
      const st = pendingMarks[f.getAttribute('face')];
      f.removeAttribute('face');
      if (st) apply(f, st);
    });
    editor.querySelectorAll('[style*="wdm"]').forEach((el) => {
      const m = /wdm\d+/.exec(el.style.fontFamily || '');
      el.style.fontFamily = '';
      if (m && pendingMarks[m[0]]) apply(el, pendingMarks[m[0]]);
    });
  }
  function currentSizePt() {
    const el = anchorEl();
    if (!el) return state.layout.baseSize;
    return Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 2) / 2;
  }
  function setFontSize(pt) {
    pt = clamp(+pt || 14, 1, 400);
    applyInline({ fontSize: pt + 'pt' });
    $('fontSize').value = fmtPt(pt);
  }
  function stepFont(dir) {
    const cur = currentSizePt();
    let next;
    if (dir > 0) next = FONT_SIZES.find((s) => s > cur) || cur + 12;
    else next = FONT_SIZES.slice().reverse().find((s) => s < cur) || Math.max(1, cur - 1);
    setFontSize(next);
  }
  function setColor(c, kind) {
    restoreSel();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(kind === 'hilite' ? 'hiliteColor' : 'foreColor', false, c);
    document.execCommand('styleWithCSS', false, false);
    if (kind === 'hilite' && c !== 'transparent') { ui.hilite = c; $('hiliteSwatch').style.background = c; }
    if (kind !== 'hilite') { ui.color = c; $('colorSwatch').style.background = c; }
    saveUi();
    afterEdit();
  }
  function changeCase(mode) {
    restoreSel();
    const s = window.getSelection();
    const txt = s.toString();
    if (!txt) { toast('Спершу виділіть текст'); return; }
    let out = txt;
    if (mode === 'upper') out = txt.toLocaleUpperCase('uk');
    if (mode === 'lower') out = txt.toLocaleLowerCase('uk');
    if (mode === 'sentence') out = txt.toLocaleLowerCase('uk').replace(/(^\s*|[.!?]\s+)(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('uk'));
    if (mode === 'title') out = txt.toLocaleLowerCase('uk').replace(/(^|\s|["«(“])(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('uk'));
    document.execCommand('insertText', false, out);
    afterEdit();
  }
  function clearFormatting() {
    restoreSel();
    document.execCommand('removeFormat');
    selectedBlocks().forEach((b) => {
      ['lineHeight', 'textIndent', 'marginLeft', 'marginBottom', 'color', 'fontSize', 'fontFamily'].forEach((p) => { b.style[p] = ''; });
      if (!b.getAttribute('style')) b.removeAttribute('style');
    });
    afterEdit();
  }
  function setBlockStyle(prop, value, toggle) {
    const blocks = ensureBlocks();
    const off = toggle && blocks.length && blocks.every((b) => b.style[prop] === value);
    blocks.forEach((b) => {
      b.style[prop] = off ? '' : value;
      if (!b.getAttribute('style')) b.removeAttribute('style');
    });
    afterEdit();
  }
  function applyStyle(tag) {
    if (tag === 'sign') { applyInline({ fontFamily: '"Great Vibes", cursive', fontSize: '26pt' }); return; }
    restoreSel();
    document.execCommand('formatBlock', false, tag);
    afterEdit();
  }
  function inList() {
    const el = anchorEl();
    return !!(el && el.closest('li'));
  }
  function indent(dir) {
    if (inList()) {
      exec(dir > 0 ? 'indent' : 'outdent');
      normalizeLists();
      return;
    }
    ensureBlocks().forEach((b) => {
      const cur = parseFloat(b.style.marginLeft) || 0;
      const next = Math.max(0, Math.round((cur + dir * 1.25) * 100) / 100);
      b.style.marginLeft = next ? next + 'cm' : '';
      if (!b.getAttribute('style')) b.removeAttribute('style');
    });
    afterEdit();
  }
  function toggleList(ordered) {
    exec(ordered ? 'insertOrderedList' : 'insertUnorderedList');
    normalizeLists();
  }
  /* Chrome при відступі в списку кладе <ol> прямо в <ol>; переносимо його в попередній <li>,
     щоб нумерація 1. / 1.1. рахувалась правильно. */
  function normalizeLists() {
    const s = window.getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    const saved = r ? [r.startContainer, r.startOffset, r.endContainer, r.endOffset] : null;
    let moved = false;
    editor.querySelectorAll('ol > ol, ol > ul, ul > ol, ul > ul').forEach((nested) => {
      const prev = nested.previousElementSibling;
      if (prev && prev.tagName === 'LI') { prev.appendChild(nested); moved = true; }
    });
    if (moved && saved && inEditor(saved[0]) && inEditor(saved[2])) {
      try {
        const nr = document.createRange();
        nr.setStart(saved[0], saved[1]);
        nr.setEnd(saved[2], saved[3]);
        s.removeAllRanges();
        s.addRange(nr);
        savedRange = nr.cloneRange();
      } catch (e) { /* позиція курсора вже недійсна */ }
    }
  }

  function insertNodeAtCaret(node) {
    restoreSel();
    const s = window.getSelection();
    if (!s.rangeCount) { editor.appendChild(node); return; }
    const r = s.getRangeAt(0);
    r.deleteContents();
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
  }
  function topBlock(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el.parentElement !== editor) el = el.parentElement;
    return el && el.parentElement === editor ? el : null;
  }
  function insertBlockAfterCaret(el) {
    const tb = savedRange ? topBlock(savedRange.startContainer) : null;
    if (tb) tb.after(el); else editor.appendChild(el);
    return el;
  }
  function insertField(k) {
    const holder = document.createElement('span');
    holder.innerHTML = fieldSpan(k);
    const sp = holder.firstChild;
    insertNodeAtCaret(sp);
    // пробіл після поля, щоб курсор мав куди стати
    const after = sp.nextSibling;
    if (!after || (after.nodeType === 3 && !/^\s/.test(after.data))) insertNodeAtCaret(document.createTextNode(' '));
    afterEdit();
  }
  function insertPoint(html, sub) {
    const el = anchorEl();
    const li = el ? el.closest('li') : null;
    const item = document.createElement('li');
    item.innerHTML = html || '<br>';
    if (li && inEditor(li)) {
      if (sub) {
        let ol = li.querySelector(':scope > ol');
        if (!ol) { ol = document.createElement('ol'); li.appendChild(ol); }
        ol.appendChild(item);
      } else {
        li.after(item);
      }
    } else {
      let ol = editor.querySelector(':scope > ol');
      if (!ol) { ol = document.createElement('ol'); insertBlockAfterCaret(ol); }
      if (sub) {
        let last = ol.lastElementChild;
        if (!last) { last = document.createElement('li'); ol.appendChild(last); }
        let nested = last.querySelector(':scope > ol');
        if (!nested) { nested = document.createElement('ol'); last.appendChild(nested); }
        nested.appendChild(item);
      } else {
        ol.appendChild(item);
      }
    }
    editor.focus({ preventScroll: true });
    placeCaretIn(item, false);
    afterEdit();
  }
  function insertTable(rows, cols) {
    const t = document.createElement('table');
    let html = '<tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td><br></td>';
      html += '</tr>';
    }
    t.innerHTML = html + '</tbody>';
    insertBlockAfterCaret(t);
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    t.after(p);
    editor.focus({ preventScroll: true });
    placeCaretIn(t.querySelector('td'), true);
    afterEdit();
  }
  function insertPageBreak() {
    const pb = document.createElement('div');
    pb.className = 'page-break';
    pb.setAttribute('contenteditable', 'false');
    insertBlockAfterCaret(pb);
    let next = pb.nextElementSibling;
    if (!next) { next = document.createElement('p'); next.innerHTML = '<br>'; pb.after(next); }
    editor.focus({ preventScroll: true });
    placeCaretIn(next, true);
    afterEdit();
  }
  function insertSigBlock() {
    const holder = document.createElement('div');
    holder.innerHTML = sigTableHtml();
    insertBlockAfterCaret(holder.firstChild);
    afterEdit();
  }

  /* ---------- Таблиці ---------- */
  function curCell() {
    const el = anchorEl();
    const td = el && el.closest('td,th');
    return td && inEditor(td) ? td : null;
  }
  function tableOp(op) {
    const td = curCell();
    if (!td) { toast('Поставте курсор у таблицю'); return; }
    const tr = td.parentElement;
    const table = td.closest('table');
    const idx = td.cellIndex;
    const newCell = (tag) => { const c = document.createElement(tag || 'td'); c.innerHTML = '<br>'; return c; };
    if (op === 'rowAbove' || op === 'rowBelow') {
      const nr = document.createElement('tr');
      Array.from(tr.cells).forEach((c) => nr.appendChild(newCell(c.tagName)));
      if (op === 'rowAbove') tr.before(nr); else tr.after(nr);
    }
    if (op === 'colLeft' || op === 'colRight') {
      Array.from(table.rows).forEach((row) => {
        const ref = row.cells[Math.min(idx, row.cells.length - 1)];
        const c = newCell(ref ? ref.tagName : 'td');
        if (!ref) row.appendChild(c);
        else if (op === 'colLeft') ref.before(c);
        else ref.after(c);
      });
    }
    if (op === 'delRow') {
      tr.remove();
      if (!table.rows.length) table.remove();
    }
    if (op === 'delCol') {
      Array.from(table.rows).forEach((row) => { if (row.cells[idx]) row.cells[idx].remove(); });
      if (!table.rows[0] || !table.rows[0].cells.length) table.remove();
    }
    if (op === 'delTable') table.remove();
    if (op === 'tableBorders') table.classList.toggle('noborder');
    afterEdit();
  }

  /* ---------- Зображення ---------- */
  function readImage(file, maxW) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          if (img.width <= maxW) { resolve(fr.result); return; }
          const c = document.createElement('canvas');
          c.width = maxW;
          c.height = Math.round(img.height * maxW / img.width);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function insertImageFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    try {
      const src = await readImage(file, 1400);
      restoreSel();
      document.execCommand('insertHTML', false, '<img src="' + src + '" alt="" style="width:220px">');
      afterEdit();
    } catch (e) { toast('Не вдалося прочитати зображення'); }
  }
  let selImg = null;
  function selectImage(img) {
    if (selImg) selImg.classList.remove('sel');
    selImg = img;
    const box = $('imgBox');
    if (!img) { box.hidden = true; return; }
    img.classList.add('sel');
    const r = document.createRange();
    r.selectNode(img);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
    positionImgBox();
  }
  function positionImgBox() {
    const box = $('imgBox');
    if (!selImg || !editor.contains(selImg)) { box.hidden = true; selImg = null; return; }
    const z = zoomFactor();
    const sr = sheet.getBoundingClientRect();
    const ir = selImg.getBoundingClientRect();
    box.hidden = false;
    box.style.left = (ir.left - sr.left) / z + 'px';
    box.style.top = (ir.top - sr.top) / z + 'px';
    box.style.width = ir.width / z + 'px';
    box.style.height = ir.height / z + 'px';
  }

  /* ---------- Вставлення з буфера: чистимо розмітку Word/браузера ---------- */
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'OL', 'UL', 'LI',
    'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'SPAN', 'FONT', 'DIV', 'IMG', 'HR', 'BLOCKQUOTE', 'A']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'NOSCRIPT', 'TEMPLATE', 'XML']);
  const STYLE_OK = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'color', 'background-color', 'font-size', 'font-family'];
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node) => {
      Array.from(node.childNodes).forEach((ch) => {
        if (ch.nodeType === 8) { ch.remove(); return; }
        if (ch.nodeType !== 1) return;
        const tag = ch.tagName.toUpperCase();
        if (DROP.has(tag) || tag.indexOf(':') !== -1 && !ch.childNodes.length) { ch.remove(); return; }
        walk(ch);
        if (!ALLOWED.has(tag)) {
          while (ch.firstChild) ch.parentNode.insertBefore(ch.firstChild, ch);
          ch.remove();
          return;
        }
        const keep = {};
        if (tag === 'IMG' && /^(data:image\/|https?:)/i.test(ch.getAttribute('src') || '')) keep.src = ch.getAttribute('src');
        if (tag === 'A' && /^https?:/i.test(ch.getAttribute('href') || '')) keep.href = ch.getAttribute('href');
        if ((tag === 'TD' || tag === 'TH') && ch.getAttribute('colspan')) keep.colspan = ch.getAttribute('colspan');
        if ((tag === 'TD' || tag === 'TH') && ch.getAttribute('rowspan')) keep.rowspan = ch.getAttribute('rowspan');
        const style = [];
        STYLE_OK.forEach((p) => {
          const v = ch.style.getPropertyValue(p);
          if (v && !/mso|windowtext/i.test(v)) style.push(p + ':' + v);
        });
        Array.from(ch.attributes).forEach((a) => ch.removeAttribute(a.name));
        Object.keys(keep).forEach((k) => ch.setAttribute(k, keep[k]));
        if (style.length) ch.setAttribute('style', style.join(';'));
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  async function pasteFromClipboard(plain) {
    restoreSel();
    try {
      if (!plain && navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          if (it.types.indexOf('text/html') !== -1) {
            const html = await (await it.getType('text/html')).text();
            restoreSel();
            document.execCommand('insertHTML', false, sanitize(html));
            afterEdit();
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      restoreSel();
      document.execCommand('insertText', false, text);
      afterEdit();
    } catch (e) {
      toast('Браузер не дав доступ до буфера — натисніть Ctrl+V');
    }
  }

  /* ---------- Макет сторінки ---------- */
  function pageSize() {
    return state.layout.landscape ? { w: 297, h: 210 } : { w: 210, h: 297 };
  }
  let zoom = clamp(+ui.zoom || 100, 30, 250);
  function zoomFactor() { return zoom / 100; }

  function applyLayout() {
    const L = state.layout;
    const ps = pageSize();
    sheet.style.width = ps.w + 'mm';
    sheet.style.padding = L.top + 'mm ' + L.right + 'mm ' + L.bottom + 'mm ' + L.left + 'mm';
    editor.style.fontSize = L.baseSize + 'pt';
    editor.style.minHeight = (ps.h - L.top - L.bottom) + 'mm';
    if (state.bgImageSrc) {
      sheet.style.backgroundImage = 'url("' + String(state.bgImageSrc).replace(/"/g, '%22') + '")';
      sheet.style.backgroundSize = ps.w + 'mm ' + ps.h + 'mm';
    } else {
      sheet.style.backgroundImage = 'none';
    }
    $('printPage').textContent = '@page { size: A4 ' + (L.landscape ? 'landscape' : 'portrait') + '; margin: 0; }';
    $('mTop').value = L.top;
    $('mBottom').value = L.bottom;
    $('mLeft').value = L.left;
    $('mRight').value = L.right;
    $('baseSize').value = String(L.baseSize);
    drawRuler();
    layoutPages();
  }

  let pageCount = 1;
  function offsetIn(el) {
    let y = 0;
    let n = el;
    while (n && n !== sheet) { y += n.offsetTop; n = n.offsetParent; }
    return y;
  }
  function resetPushes(root) {
    root.querySelectorAll('.wd-pushed').forEach((el) => {
      el.style.paddingTop = el.getAttribute('data-wd-pt') || '';
      el.style.marginTop = el.getAttribute('data-wd-mt') || '';
      el.removeAttribute('data-wd-pt');
      el.removeAttribute('data-wd-mt');
      el.classList.remove('wd-pushed');
      if (!el.className) el.removeAttribute('class');
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    root.querySelectorAll('.page-break').forEach((pb) => { pb.style.height = ''; if (!pb.getAttribute('style')) pb.removeAttribute('style'); });
  }
  /* Імітація сторінок Word: блок, що перетинає нижнє поле, зсуваємо на початок наступної сторінки. */
  function layoutPages() {
    const L = state.layout;
    const ps = pageSize();
    const pageH = ps.h * MM;
    const top = L.top * MM;
    const bottom = L.bottom * MM;
    const usable = pageH - top - bottom;
    resetPushes(editor);

    const items = [];
    Array.from(editor.children).forEach((ch) => {
      if (ch.tagName === 'OL' || ch.tagName === 'UL') {
        ch.querySelectorAll('li').forEach((li) => { if (!li.querySelector('li')) items.push(li); });
      } else {
        items.push(ch);
      }
    });
    const push = (el, amount) => {
      const useMargin = el.tagName === 'TABLE';
      const prop = useMargin ? 'marginTop' : 'paddingTop';
      const attr = useMargin ? 'data-wd-mt' : 'data-wd-pt';
      el.setAttribute(attr, el.style[prop] || '');
      const base = parseFloat(getComputedStyle(el)[prop]) || 0;
      el.style[prop] = (base + amount) + 'px';
      el.classList.add('wd-pushed');
    };
    items.forEach((el) => {
      const y = offsetIn(el);
      const k = Math.floor(y / pageH);
      if (el.classList.contains('page-break')) {
        el.style.height = Math.max(0, (k + 1) * pageH + top - y) + 'px';
        return;
      }
      const h = el.offsetHeight;
      const pageTop = k * pageH;
      const limit = pageTop + pageH - bottom;
      if (k > 0 && y < pageTop + top - 0.5) {
        push(el, pageTop + top - y);
      } else if (y + h > limit + 0.5 && h <= usable && y > pageTop + top + 1) {
        push(el, (k + 1) * pageH + top - y);
      }
    });

    const contentBottom = editor.offsetTop + editor.offsetHeight + bottom;
    pageCount = Math.max(1, Math.ceil((contentBottom - 1) / pageH));
    sheet.style.height = (pageCount * ps.h) + 'mm';
    const marks = $('pageMarks');
    let html = '';
    for (let i = 1; i < pageCount; i++) html += '<div class="page-mark" style="top:' + (i * ps.h) + 'mm"><span>Сторінка ' + (i + 1) + '</span></div>';
    marks.innerHTML = html;
    updateSizer();
    positionImgBox();
    updateStatus();
  }
  let layoutTimer = null;
  function scheduleLayout() {
    cancelAnimationFrame(layoutTimer);
    layoutTimer = requestAnimationFrame(layoutPages);
  }

  function updateSizer() {
    const z = zoomFactor();
    const box = $('zoomBox');
    box.style.transform = z === 1 ? 'none' : 'scale(' + z + ')';
    box.style.width = sheet.offsetWidth + 'px';
    const sizer = $('zoomSizer');
    sizer.style.width = sheet.offsetWidth * z + 'px';
    sizer.style.height = box.offsetHeight * z + 'px';
  }
  function setZoom(pct, silent) {
    zoom = clamp(Math.round(pct), 30, 250);
    $('zoomRange').value = zoom;
    $('zoomLabel').textContent = zoom + '%';
    updateSizer();
    positionImgBox();
    if (!silent) { ui.zoom = zoom; saveUi(); }
  }
  function fitWidth() {
    setZoom((canvas.clientWidth - 48) / sheet.offsetWidth * 100);
  }
  function fitPage() {
    const h = pageSize().h * MM + 40;
    setZoom(Math.min((canvas.clientHeight - 40) / h, (canvas.clientWidth - 48) / sheet.offsetWidth) * 100);
  }

  function drawRuler() {
    const r = $('ruler');
    r.classList.toggle('off', !ui.ruler);
    const L = state.layout;
    const w = pageSize().w;
    let html = '<div class="rl-m" style="left:0;width:' + L.left + 'mm"></div>' +
      '<div class="rl-m" style="right:0;width:' + L.right + 'mm"></div>';
    for (let q = -Math.floor(L.left / 2.5); q * 2.5 + L.left <= w; q++) {
      const x = L.left + q * 2.5;
      if (x < 0 || q === 0) continue;
      if (q % 4 === 0) html += '<span class="rl-n" style="left:' + x + 'mm">' + Math.abs(q / 4) + '</span>';
      else html += '<span class="rl-t ' + (q % 2 === 0 ? 'm' : 's') + '" style="left:' + x + 'mm"></span>';
    }
    html += '<div class="rl-h" data-side="left" style="left:' + L.left + 'mm" title="Ліве поле: ' + L.left + ' мм"></div>';
    html += '<div class="rl-h" data-side="right" style="left:' + (w - L.right) + 'mm" title="Праве поле: ' + L.right + ' мм"></div>';
    r.innerHTML = html;
  }
  function bindRuler() {
    $('ruler').addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.rl-h');
      if (!h) return;
      e.preventDefault();
      const side = h.dataset.side;
      const rect = $('ruler').getBoundingClientRect();
      const move = (ev) => {
        const w = pageSize().w;
        const xmm = (ev.clientX - rect.left) / zoomFactor() / MM;
        if (side === 'left') state.layout.left = clamp(Math.round(xmm), 0, w - state.layout.right - 40);
        else state.layout.right = clamp(Math.round(w - xmm), 0, w - state.layout.left - 40);
        applyLayout();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        scheduleSave();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /* ---------- Печатка ---------- */
  function applySeal() {
    const s = state.seal;
    const layer = $('sealLayer');
    layer.hidden = !s.show;
    layer.style.left = s.x + 'px';
    layer.style.top = s.y + 'px';
    layer.style.width = layer.style.height = s.size + 'px';
    $('sealImg').hidden = !s.src;
    if (s.src) $('sealImg').src = s.src; else $('sealImg').removeAttribute('src');
    $('sealDefault').hidden = !!s.src;
    $('sealShow').checked = !!s.show;
    $('sealSize').value = s.size;
    $('sealSizeVal').textContent = s.size + ' px';
    $('btnSealIns').classList.toggle('on', !!s.show);
  }
  function bindSeal() {
    const layer = $('sealLayer');
    layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const resize = e.target.id === 'sealHandle';
      const z = zoomFactor();
      const sx = e.clientX;
      const sy = e.clientY;
      const s0 = Object.assign({}, state.seal);
      layer.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = (ev.clientX - sx) / z;
        const dy = (ev.clientY - sy) / z;
        if (resize) state.seal.size = clamp(Math.round(s0.size + Math.max(dx, dy)), 40, 320);
        else {
          state.seal.x = Math.round(s0.x + dx);
          state.seal.y = Math.round(s0.y + dy);
        }
        applySeal();
      };
      const up = () => {
        layer.removeEventListener('pointermove', move);
        layer.removeEventListener('pointerup', up);
        scheduleSave();
      };
      layer.addEventListener('pointermove', move);
      layer.addEventListener('pointerup', up);
    });
  }

  /* ---------- Збереження ---------- */
  function cleanHtml(forPublish) {
    const clone = editor.cloneNode(true);
    resetPushes(clone);
    clone.querySelectorAll('img.sel').forEach((i) => { i.classList.remove('sel'); if (!i.className) i.removeAttribute('class'); });
    if (forPublish) {
      clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
      clone.querySelectorAll('.fld.empty').forEach((el) => el.remove());
    }
    return clone.innerHTML;
  }
  let saveTimer = null;
  function setSaved(text, cls) {
    const el = $('saveState');
    el.textContent = text;
    el.className = cls || '';
  }
  function persist(show) {
    clearTimeout(saveTimer);
    try {
      state.html = cleanHtml(false);
      state.updated = Date.now();
      const copy = JSON.parse(JSON.stringify(state));
      if ((copy.bgImageSrc || '').length > 1800000) copy.bgImageSrc = '';
      if ((copy.seal.src || '').length > 800000) copy.seal.src = '';
      db.active = slot;
      db.slots[slot] = copy;
      localStorage.setItem(STORE, JSON.stringify(db));
      setSaved('Збережено');
      if (show) toast('Чернетку ' + slot + ' збережено');
      refreshSlotList();
    } catch (e) {
      console.error(e);
      setSaved('Не збережено', 'err');
      toast('Не вдалося зберегти: сховище браузера переповнене (завеликі зображення)');
    }
  }
  function scheduleSave() {
    setSaved('Зберігається…', 'dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(false), 600);
  }
  function afterEdit() {
    captureSel();
    scheduleSave();
    scheduleLayout();
    updateToolbar();
  }

  function refreshSlotList() {
    const sel = $('slotSel');
    let html = '';
    for (let i = 1; i <= SLOTS; i++) {
      const s = i === slot ? state : db.slots[i];
      let label = 'порожня';
      if (s) {
        const t = TYPES[s.type];
        label = (t ? t.label : 'Документ') + (s.fields && s.fields.number ? ' №' + s.fields.number : '');
      }
      html += '<option value="' + i + '"' + (i === slot ? ' selected' : '') + '>Чернетка ' + i + ' — ' + esc(label) + '</option>';
    }
    sel.innerHTML = html;
  }
  function updateTitle() {
    const t = TYPES[state.type] || TYPES.nakaz;
    const numbered = /\{НОМЕР\}/.test(t.title) && state.fields.number;
    const name = t.label + (numbered ? ' №' + state.fields.number : '');
    $('docTitle').textContent = name;
    document.title = name + ' — Канцелярія';
  }

  function loadSlot(n) {
    slot = n;
    const saved = db.slots[n];
    state = saved ? mergeState(saved) : defaultState();
    window.state = state;
    if (!state.seal.src && user.photo) state.seal.src = user.photo;
    editor.innerHTML = state.html != null ? state.html : buildTemplate(state.type);
    if (state.html == null) state.pristine = true;
    ensureNotEmpty();
    normalizeLists();
    refreshFields();
    renderPane();
    applyLayout();
    applySeal();
    updateTitle();
    refreshSlotList();
    savedRange = null;
    selectImage(null);
  }
  function ensureNotEmpty() {
    if (!editor.firstElementChild) editor.innerHTML = '<p><br></p>';
  }
  function applyTemplate(force) {
    const t = TYPES[state.type];
    if (!force && !state.pristine && !confirm('Замінити текст документа шаблоном «' + t.label + '»?\nПоточний текст буде втрачено.')) return false;
    if (t.officer && !user.post) setField('officer', t.officer);
    editor.innerHTML = buildTemplate(state.type);
    state.pristine = true;
    normalizeLists();
    refreshFields();
    renderPane();
    savedRange = null;
    afterEdit();
    return true;
  }

  /* ---------- Панель полів ---------- */
  function renderPane() {
    $('officeBadge').textContent = typeof officeTitle === 'function' ? officeTitle(user) : '';
    const tsel = $('fldType');
    tsel.innerHTML = officeTypes.map((k) => '<option value="' + k + '">' + esc(TYPES[k].label) + '</option>').join('');
    tsel.value = state.type;

    const box = $('paneFields');
    box.innerHTML = '';
    FIELD_GROUPS.forEach((g) => {
      const sec = document.createElement('section');
      sec.dataset.group = g.id;
      sec.innerHTML = '<h4 class="pane-h" data-gtitle="' + g.id + '">' + esc(g.title) + '</h4>';
      g.keys.forEach((k) => {
        const row = document.createElement('div');
        row.className = 'pf';
        row.dataset.key = k;
        let input;
        if (k === 'idKind') {
          input = '<select id="f-' + k + '" data-field="' + k + '">' +
            Object.keys(ID_KINDS).map((v) => '<option value="' + v + '">' + esc(ID_KINDS[v][0].toUpperCase() + ID_KINDS[v].slice(1)) + '</option>').join('') + '</select>';
        } else {
          input = '<input id="f-' + k + '" data-field="' + k + '" autocomplete="off">';
        }
        if (k === 'date') input = '<div class="pf-in">' + input + '<button type="button" data-act="today">Сьогодні</button></div>';
        row.innerHTML = '<div class="pf-top"><label for="f-' + k + '">' + esc(FIELDS[k].label) + '</label>' +
          '<button type="button" class="pf-ins" data-ins="' + k + '" title="Вставити поле «' + esc(FIELDS[k].label) + '» у позицію курсора">⤵</button></div>' + input;
        sec.appendChild(row);
        const inp = row.querySelector('[data-field]');
        inp.value = state.fields[k] == null ? '' : state.fields[k];
      });
      box.appendChild(sec);
    });
    updatePaneVisibility();
    renderTemplates();
  }
  function updatePaneVisibility() {
    const prof = PROFILES[state.type] || PROFILE_DEFAULT;
    const used = new Set(Array.from(editor.querySelectorAll('.fld')).map((s) => s.getAttribute('data-f')));
    const all = $('showAllFields').checked;
    document.querySelectorAll('#paneFields .pf').forEach((row) => {
      const k = row.dataset.key;
      const sign = ['officer', 'signer', 'signText'].indexOf(k) !== -1;
      row.hidden = !(all || sign || prof.show.indexOf(k) !== -1 || used.has(k));
    });
    document.querySelectorAll('#paneFields section').forEach((sec) => {
      sec.hidden = !sec.querySelector('.pf:not([hidden])');
    });
    const pt = document.querySelector('[data-gtitle="person"]');
    if (pt) pt.textContent = prof.person || 'Кого стосується';
    const ct = document.querySelector('[data-gtitle="court"]');
    if (ct) ct.textContent = prof.court || 'Суд';
  }
  function renderTemplates() {
    const tpls = (TYPES[state.type] || TYPES.nakaz).tpls;
    const plain = (s) => s.replace(TOKEN_RE, (m, t) => fieldText(TOKEN_TO_KEY[t]) || FIELDS[TOKEN_TO_KEY[t]].label);
    $('paneTpls').innerHTML = tpls.map((x, i) => '<button type="button" data-tpl="' + i + '" title="' + esc(plain(x.text)) + '">+ ' + esc(x.label) + '</button>').join('');
    $('menu-tpl').innerHTML = tpls.map((x, i) => '<button type="button" data-tpl="' + i + '"><b>' + esc(x.label) + '</b><small>' + esc(plain(x.text).slice(0, 70)) + '…</small></button>').join('');
  }
  function insertTemplatePoint(i) {
    const tpl = (TYPES[state.type] || TYPES.nakaz).tpls[i];
    if (tpl) insertPoint(tok(tpl.text), false);
  }

  /* ---------- Редагування поля на місці ---------- */
  let popSpan = null;
  function openFieldPop(span) {
    const k = span.getAttribute('data-f');
    if (!FIELDS[k]) return;
    popSpan = span;
    const pop = $('fldPop');
    $('fldPopLabel').textContent = FIELDS[k].label + ' (оновиться всюди в документі)';
    const row = $('fldPopRow');
    if (k === 'idKind') {
      row.innerHTML = '<select id="fldPopInput">' + Object.keys(ID_KINDS).map((v) => '<option value="' + v + '">' + esc(ID_KINDS[v]) + '</option>').join('') + '</select>';
    } else {
      row.innerHTML = '<input id="fldPopInput" autocomplete="off">';
    }
    const inp = $('fldPopInput');
    inp.value = state.fields[k] == null ? '' : state.fields[k];
    pop.hidden = false;
    const r = span.getBoundingClientRect();
    pop.style.left = clamp(r.left, 8, window.innerWidth - 296) + 'px';
    pop.style.top = (r.bottom + 6 + 150 > window.innerHeight ? r.top - 130 : r.bottom + 6) + 'px';
    inp.focus();
    if (inp.select) inp.select();
    inp.addEventListener('input', () => setField(k, inp.value));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); closeFieldPop(); }
      if (e.key === 'Escape') closeFieldPop();
    });
  }
  function closeFieldPop() {
    $('fldPop').hidden = true;
    if (popSpan && editor.contains(popSpan)) {
      editor.focus({ preventScroll: true });
      const r = document.createRange();
      r.setStartAfter(popSpan);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      savedRange = r.cloneRange();
    }
    popSpan = null;
  }
  function fieldToText(span) {
    if (!span) return;
    const text = span.classList.contains('empty') ? '' : span.textContent;
    span.replaceWith(document.createTextNode(text));
    afterEdit();
    updatePaneVisibility();
  }

  /* ---------- Пошук і заміна ---------- */
  let findMatches = [];
  let findIdx = -1;
  const hasHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function computeMatches() {
    const q = $('findQ').value;
    findMatches = [];
    if (!q) { paintMatches(); return; }
    const cs = $('findCase').checked;
    const needle = cs ? q : q.toLocaleLowerCase('uk');
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const hay = cs ? n.data : n.data.toLocaleLowerCase('uk');
      let i = hay.indexOf(needle);
      while (i !== -1) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        findMatches.push(r);
        i = hay.indexOf(needle, i + Math.max(1, q.length));
      }
    }
    paintMatches();
  }
  function paintMatches() {
    $('findCount').textContent = $('findQ').value ? (findMatches.length ? (findIdx + 1 > 0 ? findIdx + 1 : 0) + '/' + findMatches.length : '0') : '';
    if (!hasHighlights) return;
    CSS.highlights.set('wd-find', new Highlight(...findMatches));
    if (findMatches[findIdx]) CSS.highlights.set('wd-find-cur', new Highlight(findMatches[findIdx]));
    else CSS.highlights.delete('wd-find-cur');
  }
  function gotoMatch(dir) {
    computeMatches();
    if (!findMatches.length) { findIdx = -1; paintMatches(); return; }
    const ref = savedRange;
    if (findIdx === -1 && ref) {
      findIdx = findMatches.findIndex((m) => m.compareBoundaryPoints(Range.START_TO_START, ref) >= 0);
      if (dir < 0) findIdx = (findIdx === -1 ? findMatches.length : findIdx) - 1;
      if (findIdx < 0 || findIdx >= findMatches.length) findIdx = dir > 0 ? 0 : findMatches.length - 1;
    } else {
      findIdx = (findIdx + dir + findMatches.length) % findMatches.length;
    }
    const m = findMatches[findIdx];
    savedRange = m.cloneRange();
    const el = m.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!hasHighlights) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(m);
    }
    paintMatches();
  }
  function replaceOne() {
    const m = findMatches[findIdx];
    if (!m || (m.startContainer.parentElement && m.startContainer.parentElement.closest('.fld'))) { gotoMatch(1); return; }
    savedRange = m.cloneRange();
    restoreSel();
    document.execCommand('insertText', false, $('replQ').value);
    afterEdit();
    findIdx -= 1;
    gotoMatch(1);
    $('replQ').focus();
  }
  function replaceAll() {
    computeMatches();
    const list = findMatches.filter((m) => !(m.startContainer.parentElement && m.startContainer.parentElement.closest('.fld')));
    if (!list.length) { toast('Нічого не знайдено'); return; }
    for (let i = list.length - 1; i >= 0; i--) {
      savedRange = list[i];
      restoreSel();
      document.execCommand('insertText', false, $('replQ').value);
    }
    afterEdit();
    findIdx = -1;
    computeMatches();
    toast('Замінено: ' + list.length);
  }
  function openFind(withReplace) {
    const box = $('findBox');
    box.hidden = false;
    $('replRow').hidden = !withReplace;
    const s = window.getSelection().toString();
    if (s && s.length < 80 && s.indexOf('\n') === -1) $('findQ').value = s;
    $('findQ').focus();
    $('findQ').select();
    findIdx = -1;
    computeMatches();
  }
  function closeFind() {
    $('findBox').hidden = true;
    findMatches = [];
    findIdx = -1;
    if (hasHighlights) { CSS.highlights.delete('wd-find'); CSS.highlights.delete('wd-find-cur'); }
    restoreSel();
  }

  /* ---------- Текст для Discord / сайту ---------- */
  function docLines() {
    const root = document.createElement('div');
    root.innerHTML = cleanHtml(true);
    const lines = [];
    const txt = (n) => n.textContent.replace(/[\s  ]+/g, ' ').trim();
    const list = (el, pre, ordered) => {
      let i = 0;
      Array.from(el.children).forEach((ch) => {
        if (ch.tagName === 'LI') {
          i++;
          const c = ch.cloneNode(true);
          c.querySelectorAll('ol,ul').forEach((x) => x.remove());
          const t = txt(c);
          if (t) lines.push({ kind: 'li', text: (ordered ? pre + i + '.' : '•') + ' ' + t });
          ch.querySelectorAll(':scope > ol, :scope > ul').forEach((sub) => list(sub, ordered ? pre + i + '.' : pre, sub.tagName === 'OL'));
        } else if (ch.tagName === 'OL' || ch.tagName === 'UL') {
          list(ch, pre + i + '.', ch.tagName === 'OL');
        }
      });
    };
    Array.from(root.children).forEach((el) => {
      const tag = el.tagName;
      if (tag === 'OL' || tag === 'UL') list(el, '', tag === 'OL');
      else if (tag === 'TABLE') {
        Array.from(el.rows).forEach((r) => {
          const t = Array.from(r.cells).map(txt).filter(Boolean).join(' — ');
          if (t) lines.push({ kind: 'row', text: t });
        });
      } else if (tag === 'HR') lines.push({ kind: 'hr', text: '' });
      else if (!el.classList.contains('page-break')) {
        const t = txt(el);
        if (t) lines.push({ kind: tag === 'H1' ? 'h1' : /^H[2-6]$/.test(tag) ? 'h' : 'p', text: tag === 'H1' ? t.toLocaleUpperCase('uk') : t });
      }
    });
    return lines;
  }
  function plainText() {
    const lines = docLines();
    let out = '';
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      if (i) out += prev && prev.kind === 'li' && l.kind === 'li' ? '\n' : '\n\n';
      out += l.kind === 'hr' ? '————————' : l.text;
    });
    return out;
  }
  function ansiText() {
    const C = { red: '\u001b[1;31m', gold: '\u001b[1;33m', blue: '\u001b[1;34m', gray: '\u001b[1;30m', rst: '\u001b[0m' };
    const line = C.gray + '────────────────────────────────────────' + C.rst;
    let out = '```ansi\n';
    docLines().forEach((l) => {
      if (l.kind === 'h1') out += C.red + l.text + C.rst + '\n';
      else if (l.kind === 'h') out += C.gold + l.text + C.rst + '\n';
      else if (l.kind === 'li') out += C.gold + l.text + C.rst + '\n';
      else if (l.kind === 'row') out += line + '\n' + C.blue + l.text + C.rst + '\n';
      else if (l.kind === 'hr') out += line + '\n';
      else out += l.text + '\n\n';
    });
    return out.replace(/\n+$/, '\n') + '```';
  }
  function copyAnsi() {
    const text = ansiText();
    const done = () => toast(text.length > 2000 ? 'Скопійовано, але текст довший за ліміт Discord (2000 символів)' : 'Discord-текст скопійовано');
    navigator.clipboard.writeText(text).then(done).catch(() => { window.prompt('Скопіюйте вручну:', text); });
  }

  /* ---------- Експорт ---------- */
  async function renderSheet(scale) {
    const prevZoom = zoom;
    selectImage(null);
    setZoom(100, true);
    document.body.classList.add('exporting');
    try {
      return await html2canvas(sheet, {
        scale: scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        ignoreElements: (el) => el.classList && el.classList.contains('no-export')
      });
    } finally {
      document.body.classList.remove('exporting');
      setZoom(prevZoom, true);
    }
  }
  function fileBase() {
    const t = TYPES[state.type] || TYPES.nakaz;
    return (t.label + '_' + (state.fields.number || '')).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+$/, '');
  }
  async function exportPng() {
    if (typeof html2canvas !== 'function') { toast('Бібліотека html2canvas не завантажилась'); return; }
    toast('Готую PNG…');
    try {
      const c = await renderSheet(3);
      const a = document.createElement('a');
      a.download = fileBase() + '.png';
      a.href = c.toDataURL('image/png');
      a.click();
      toast('PNG збережено');
    } catch (e) {
      console.error(e);
      toast('Експорт не вдався (фон з іншого сайту блокує збереження?)');
    }
  }
  function hasWebhooks() {
    return DISCORD_CHANNELS.some((ch) => ch.webhook && ch.webhook.indexOf('/webhooks/') !== -1 && (!ch.offices || ch.offices.indexOf(office) !== -1));
  }
  function openDsModal() {
    const list = DISCORD_CHANNELS.filter((ch) => !ch.offices || ch.offices.indexOf(office) !== -1);
    $('dsChannelBtns').innerHTML = list.map((ch, i) => '<label><input type="radio" name="dsChan" value="' + ch.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(ch.name) + '</label>').join('');
    $('dsModal').hidden = false;
  }
  async function sendToDiscord() {
    const chosen = Array.from(document.querySelectorAll('#dsChannelBtns input:checked')).map((el) => el.value);
    const targets = DISCORD_CHANNELS.filter((ch) => chosen.indexOf(ch.id) !== -1 && ch.webhook && ch.webhook.indexOf('/webhooks/') !== -1);
    if (!targets.length) { toast('Для цього каналу не налаштовано webhook'); return; }
    toast('Надсилаю…');
    try {
      const c = await renderSheet(2.5);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const t = TYPES[state.type] || TYPES.nakaz;
      const h1 = editor.querySelector('h1');
      const subj = h1 && h1.nextElementSibling ? h1.nextElementSibling.textContent.trim() : '';
      const caption = '**' + t.label + (state.fields.number ? ' №' + state.fields.number : '') + '**' + (subj ? '\n*' + subj + '*' : '') +
        '\n\nПідпис: ' + (state.fields.officer || '') + ' **' + (state.fields.signer || '') + '**';
      let ok = 0;
      for (const ch of targets) {
        const form = new FormData();
        form.append('file', blob, fileBase() + '.png');
        form.append('payload_json', JSON.stringify({ username: 'Канцелярія San-Andreas', content: caption }));
        try { const res = await fetch(ch.webhook, { method: 'POST', body: form }); if (res.ok) ok++; } catch (e) { console.error(e); }
      }
      toast(ok ? 'Надіслано: ' + ok + ' з ' + targets.length : 'Не вдалося надіслати');
    } catch (e) {
      console.error(e);
      toast('Не вдалося зібрати PNG');
    }
  }
  let printZoom = null;
  window.addEventListener('beforeprint', () => {
    printZoom = zoom;
    selectImage(null);
    setZoom(100, true);
  });
  window.addEventListener('afterprint', () => { if (printZoom) setZoom(printZoom, true); printZoom = null; });

  /* ---------- Публікація ---------- */
  const editId = new URLSearchParams(location.search).get('id');
  function canEditDoc(d) {
    return !d.ownerLogin || d.ownerLogin === user.login || (user.roles || [])[0] === 'governor';
  }
  function publish() {
    persist(false);
    const t = TYPES[state.type] || TYPES.nakaz;
    const f = state.fields;
    const onHome = $('chkHome').checked;
    const curId = new URLSearchParams(location.search).get('id');
    const prev = curId && typeof getDoc === 'function' ? getDoc(curId) : null;
    if (prev && !canEditDoc(prev)) { toast('Редагувати цей акт може лише автор'); return; }
    const h1 = editor.querySelector('h1');
    const subjEl = h1 && h1.nextElementSibling;
    const numbered = /\{НОМЕР\}/.test(t.title) && f.number;
    const doc = Object.assign({}, prev || {}, {
      id: (prev && prev.id) || (typeof newDocId === 'function' ? newDocId() : 'act-' + Date.now().toString(36)),
      type: t.label,
      typeKey: state.type,
      number: f.number,
      date: f.date,
      title: t.label + (numbered ? ' №' + f.number : ''),
      subject: subjEl ? subjEl.textContent.replace(/\s+/g, ' ').trim() : '',
      body: typeof officeTitle === 'function' ? officeTitle(user) : 'Канцелярія',
      status: onHome ? 'ok' : 'draft',
      publishHome: onHome,
      text: plainText(),
      html: cleanHtml(true),
      author: (prev && prev.author) || user.username,
      ownerLogin: (prev && prev.ownerLogin) || user.login,
      office: office,
      editor: {
        type: state.type,
        fields: Object.assign({}, state.fields),
        layout: Object.assign({}, state.layout),
        seal: Object.assign({}, state.seal, { src: (state.seal.src || '').length > 300000 ? '' : state.seal.src }),
        bgImageSrc: /^https?:/.test(state.bgImageSrc || '') ? state.bgImageSrc : ''
      }
    });
    saveDoc(doc);
    if (!getDoc(doc.id) || getDoc(doc.id).html !== doc.html) {
      toast('Не вдалося зберегти на сайті: сховище переповнене (завеликі зображення)');
      return;
    }
    history.replaceState(null, '', '?id=' + encodeURIComponent(doc.id));
    toast(onHome ? 'Опубліковано на сайті та на головній' : 'Опубліковано в базі документів');
    if (hasWebhooks() && confirm('Документ опубліковано.\n\nНадіслати його в Discord?')) openDsModal();
  }
  function loadFromDoc(id) {
    const d = typeof getDoc === 'function' ? getDoc(id) : null;
    if (!d) return;
    if (!canEditDoc(d)) { toast('Цей акт може редагувати лише автор'); return; }
    if (!d.editor || !d.html) { toast('Цей акт створено без редактора — відкрийте його у «Опубліковані»'); return; }
    state = mergeState(Object.assign({}, d.editor, { html: d.html, pristine: false }));
    db.slots[slot] = state;
    loadSlot(slot);
    $('chkHome').checked = !!d.publishHome;
    toast('«' + d.title + '» відкрито в чернетці ' + slot);
  }

  /* ---------- Стан кнопок стрічки ---------- */
  function updateToolbar() {
    const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    const el = anchorEl();
    document.querySelectorAll('[data-cmd][data-state]').forEach((b) => b.classList.toggle('on', !!el && q(b.dataset.cmd)));
    if (!el) return;
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const fs = $('fontName');
    if (!Array.from(fs.options).some((o) => o.value === fam)) {
      let o = fs.querySelector('option[data-temp]');
      if (!o) { o = document.createElement('option'); o.dataset.temp = '1'; fs.insertBefore(o, fs.firstChild); }
      o.value = o.textContent = fam;
    }
    fs.value = fam;
    if (document.activeElement !== $('fontSize')) $('fontSize').value = fmtPt(parseFloat(cs.fontSize) * 0.75);
    const blk = blockOf(el);
    const ta = blk ? getComputedStyle(blk).textAlign : 'left';
    const a = ta === 'center' ? 'center' : (ta === 'right' || ta === 'end') ? 'right' : ta === 'justify' ? 'justify' : 'left';
    document.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('on', b.dataset.align === a));
    const tag = blk ? blk.tagName.toLowerCase() : 'p';
    const signFont = /Great Vibes/.test(cs.fontFamily);
    document.querySelectorAll('.style-item').forEach((b) => b.classList.toggle('on', signFont ? b.dataset.val === 'sign' : b.dataset.val === tag));
    const li = el.closest('li');
    $('btnNumbers').classList.toggle('on', !!(li && li.parentElement.tagName === 'OL'));
    $('btnBullets').classList.toggle('on', !!(li && li.parentElement.tagName === 'UL'));
    $('btnFirstIndent').classList.toggle('on', !!(blk && blk.style.textIndent));
    const td = el.closest('td,th');
    const inTable = !!(td && inEditor(td));
    $('tabTable').hidden = !inTable;
    if (inTable) $('btnTableBorders').classList.toggle('on', !td.closest('table').classList.contains('noborder') && !td.closest('table').classList.contains('sig'));
    if (!inTable && document.querySelector('.wd-tab.active') === $('tabTable')) switchTab('home');
    updateStatus();
  }
  function updateStatus() {
    let cur = 1;
    if (savedRange) {
      const rects = savedRange.getClientRects();
      const rr = rects.length ? rects[0] : (anchorEl() ? anchorEl().getBoundingClientRect() : null);
      if (rr) {
        const y = (rr.top - sheet.getBoundingClientRect().top) / zoomFactor();
        cur = clamp(Math.floor(y / (pageSize().h * MM)) + 1, 1, pageCount);
      }
    }
    $('stPage').textContent = 'Сторінка ' + cur + ' з ' + pageCount;
    const words = (editor.innerText || '').trim().split(/\s+/).filter(Boolean).length;
    $('stWords').textContent = 'Слів: ' + words;
  }

  /* ---------- Меню ---------- */
  let openMenuEl = null;
  function openMenu(id, anchor, at) {
    closeMenu();
    const m = $(id);
    if (!m) return;
    if (id === 'menu-bg') buildBgMenu();
    m.classList.add('open');
    openMenuEl = m;
    let x, y;
    if (at) { x = at.x; y = at.y; } else {
      const r = anchor.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 2;
    }
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    if (x + mw > window.innerWidth - 6) x = window.innerWidth - mw - 6;
    if (y + mh > window.innerHeight - 6) y = at ? Math.max(6, y - mh) : Math.max(6, (anchor ? anchor.getBoundingClientRect().top : y) - mh - 2);
    m.style.left = Math.max(6, x) + 'px';
    m.style.top = y + 'px';
  }
  function closeMenu() {
    if (openMenuEl) openMenuEl.classList.remove('open');
    openMenuEl = null;
  }
  function buildMenus() {
    $('menu-size').innerHTML = FONT_SIZES.map((s) => '<button type="button" data-act="size" data-val="' + s + '">' + fmtPt(s) + '</button>').join('');
    const pal = (list, act) => '<div class="pal-grid">' + list.map((c) => '<button type="button" data-act="' + act + '" data-val="' + c + '" title="' + c + '" style="background:' + c + '"></button>').join('') + '</div>';
    $('menu-color').innerHTML = '<button type="button" class="row" data-act="color" data-val="#000000"><span class="swatch" style="background:#000;width:14px;height:14px"></span>Автоматично</button>' +
      '<div class="menu-sep"></div>' + pal(TEXT_COLORS, 'color') + '<button type="button" data-act="colorCustom">Інші кольори…</button>';
    $('menu-hilite').innerHTML = pal(HILITE_COLORS, 'hilite') + '<button type="button" data-act="hilite" data-val="transparent">Без кольору</button>';
    $('menu-symbol').innerHTML = '<div class="sym-grid">' + SYMBOLS.map((c) => '<button type="button" data-act="symbol" data-val="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>';
    $('menu-field').innerHTML = '<div class="menu-title">Вставити поле</div>' + Object.keys(FIELDS).map((k) => '<button type="button" data-ins="' + k + '"><b>' + esc(FIELDS[k].label) + '</b><small>' + esc(fieldText(k) || '—') + '</small></button>').join('');
    let grid = '';
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 10; c++) grid += '<span data-r="' + r + '" data-c="' + c + '"></span>';
    $('tableGrid').innerHTML = grid;
  }
  function buildBgMenu() {
    const list = BG_PRESETS[office] || [];
    let html = '<div class="menu-title">Готові рамки кабінету</div>';
    html += list.length ? list.map((bg, i) => '<button type="button" data-act="bgPreset" data-val="' + i + '">' + esc(bg.name) + '</button>').join('') : '<button type="button" disabled>Для цього кабінету немає</button>';
    html += '<div class="menu-sep"></div><button type="button" data-act="bgUpload">Завантажити з комп’ютера…</button>';
    html += '<button type="button" data-act="bgClear"' + (state.bgImageSrc ? '' : ' disabled') + '>Прибрати фон</button>';
    $('menu-bg').innerHTML = html;
  }
  function showContextMenu(e) {
    const fld = e.target.closest && e.target.closest('.fld');
    const td = e.target.closest && e.target.closest('td,th');
    const items = [];
    items.push('<button type="button" class="row" data-act="cut">Вирізати<span class="kbd">Ctrl+X</span></button>');
    items.push('<button type="button" class="row" data-act="copy">Копіювати<span class="kbd">Ctrl+C</span></button>');
    items.push('<button type="button" class="row" data-act="paste">Вставити<span class="kbd">Ctrl+V</span></button>');
    if (fld) {
      ctxField = fld;
      items.push('<div class="menu-sep"></div><div class="menu-title">Поле: ' + esc(FIELDS[fld.getAttribute('data-f')] ? FIELDS[fld.getAttribute('data-f')].label : '') + '</div>');
      items.push('<button type="button" data-act="ctxEditField">Змінити значення…</button>');
      items.push('<button type="button" data-act="ctxFieldText">Перетворити на звичайний текст</button>');
    }
    if (td && inEditor(td)) {
      items.push('<div class="menu-sep"></div><div class="menu-title">Таблиця</div>');
      items.push('<button type="button" data-act="rowAbove">Вставити рядок вище</button>');
      items.push('<button type="button" data-act="rowBelow">Вставити рядок нижче</button>');
      items.push('<button type="button" data-act="colLeft">Вставити стовпець ліворуч</button>');
      items.push('<button type="button" data-act="colRight">Вставити стовпець праворуч</button>');
      items.push('<button type="button" data-act="delRow">Видалити рядок</button>');
      items.push('<button type="button" data-act="delCol">Видалити стовпець</button>');
      items.push('<button type="button" data-act="delTable">Видалити таблицю</button>');
      items.push('<button type="button" data-act="tableBorders">Межі таблиці: увімк./вимк.</button>');
    }
    items.push('<div class="menu-sep"></div>');
    items.push('<button type="button" data-act="point">Вставити пункт</button>');
    items.push('<button type="button" data-menu-open="menu-field">Вставити поле…</button>');
    items.push('<button type="button" class="row" data-act="selectAll">Виділити все<span class="kbd">Ctrl+A</span></button>');
    $('ctxMenu').innerHTML = items.join('');
    openMenu('ctxMenu', null, { x: e.clientX, y: e.clientY });
  }
  let ctxField = null;

  function switchTab(name) {
    document.querySelectorAll('.wd-tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.rb-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  }
  function setPane(on) {
    ui.pane = on;
    saveUi();
    $('pane').classList.toggle('off', !on);
    $('optPane').checked = on;
    $('paneTabBtn').classList.toggle('on', on);
    requestAnimationFrame(updateSizer);
  }

  /* ---------- Дії ---------- */
  const ACTIONS = {
    save: () => persist(true),
    undo: () => exec('undo'),
    redo: () => exec('redo'),
    cut: () => exec('cut'),
    copy: () => { restoreSel(); document.execCommand('copy'); },
    paste: () => pasteFromClipboard(false),
    pastePlain: () => pasteFromClipboard(true),
    selectAll: () => { editor.focus(); document.execCommand('selectAll'); captureSel(); },
    grow: () => stepFont(1),
    shrink: () => stepFont(-1),
    size: (b) => setFontSize(b.dataset.val),
    case: (b) => changeCase(b.dataset.val),
    clearFmt: clearFormatting,
    color: (b) => setColor(b.dataset.val || ui.color || '#c00000', 'color'),
    colorCustom: () => { $('colorPicker').dataset.kind = 'color'; $('colorPicker').click(); },
    hilite: (b) => setColor(b.dataset.val || ui.hilite || '#ffff00', 'hilite'),
    bullets: () => toggleList(false),
    numbers: () => toggleList(true),
    indent: () => indent(1),
    outdent: () => indent(-1),
    firstIndent: () => setBlockStyle('textIndent', '1.25cm', true),
    lh: (b) => setBlockStyle('lineHeight', b.dataset.val),
    spaceAfter: (b) => setBlockStyle('marginBottom', b.dataset.val + 'pt'),
    style: (b) => applyStyle(b.dataset.val),
    find: () => openFind(false),
    replace: () => openFind(true),
    findNext: () => gotoMatch(1),
    findPrev: () => gotoMatch(-1),
    closeFind: closeFind,
    replOne: replaceOne,
    replAll: replaceAll,
    pagebreak: insertPageBreak,
    point: () => insertPoint('', false),
    subpoint: () => insertPoint('', true),
    hr: () => exec('insertHorizontalRule'),
    sigblock: insertSigBlock,
    date: () => exec('insertText', today()),
    symbol: (b) => exec('insertText', b.dataset.val),
    sealToggle: () => { state.seal.show = !state.seal.show; applySeal(); scheduleSave(); },
    sealDefault: () => { state.seal.src = ''; state.seal.show = true; applySeal(); scheduleSave(); },
    margins: (b) => {
      const v = b.dataset.val.split(',').map(Number);
      Object.assign(state.layout, { top: v[0], bottom: v[1], left: v[2], right: v[3] });
      applyLayout();
      scheduleSave();
    },
    orient: (b) => { state.layout.landscape = b.dataset.val === 'landscape'; applyLayout(); scheduleSave(); },
    bgPreset: (b) => { state.bgImageSrc = (BG_PRESETS[office] || [])[+b.dataset.val].src; applyLayout(); scheduleSave(); },
    bgUpload: () => $('bgUploader').click(),
    bgClear: () => { state.bgImageSrc = ''; applyLayout(); scheduleSave(); },
    zoom: (b) => setZoom(+b.dataset.val),
    zoomIn: () => setZoom(zoom + 10),
    zoomOut: () => setZoom(zoom - 10),
    fitWidth: fitWidth,
    fitPage: fitPage,
    togglePane: () => setPane(!ui.pane),
    applyTemplate: () => applyTemplate(false),
    resetSlot: () => {
      if (!confirm('Очистити чернетку ' + slot + '? Текст і налаштування буде скинуто.')) return;
      delete db.slots[slot];
      loadSlot(slot);
      persist(false);
      toast('Чернетку очищено');
    },
    png: exportPng,
    print: () => window.print(),
    ansi: copyAnsi,
    discord: openDsModal,
    dsCancel: () => { $('dsModal').hidden = true; },
    dsConfirm: () => { $('dsModal').hidden = true; sendToDiscord(); },
    publish: publish,
    today: () => setField('date', today()),
    rowAbove: () => tableOp('rowAbove'),
    rowBelow: () => tableOp('rowBelow'),
    colLeft: () => tableOp('colLeft'),
    colRight: () => tableOp('colRight'),
    delRow: () => tableOp('delRow'),
    delCol: () => tableOp('delCol'),
    delTable: () => tableOp('delTable'),
    tableBorders: () => tableOp('tableBorders'),
    ctxEditField: () => { if (ctxField) openFieldPop(ctxField); },
    ctxFieldText: () => fieldToText(ctxField),
    fldPopOk: closeFieldPop,
    fldPopText: () => { const sp = popSpan; closeFieldPop(); fieldToText(sp); }
  };

  /* ---------- Прив'язка подій ---------- */
  function bind() {
    document.querySelectorAll('i[data-icon]').forEach((i) => { i.innerHTML = ICONS[i.dataset.icon] || ''; });
    buildMenus();

    // Кнопки не забирають фокус у документа
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rb-btn, .menu button, .tb-qa, .style-item, .table-grid span, .combo-arrow, .pane-tpls button, .pf-ins, .wd-tab')) e.preventDefault();
      if (openMenuEl && !e.target.closest('.menu') && !e.target.closest('[data-menu]')) closeMenu();
      if (!$('fldPop').hidden && !e.target.closest('#fldPop')) closeFieldPop();
    });

    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.wd-tab[data-tab]');
      if (tab) { switchTab(tab.dataset.tab); return; }
      const mbtn = e.target.closest('[data-menu]');
      if (mbtn) {
        const id = mbtn.dataset.menu;
        if (openMenuEl && openMenuEl.id === id) closeMenu(); else openMenu(id, mbtn);
        return;
      }
      const mo = e.target.closest('[data-menu-open]');
      if (mo) { const r = mo.getBoundingClientRect(); openMenu(mo.dataset.menuOpen, null, { x: r.right, y: r.top }); return; }
      const cmd = e.target.closest('[data-cmd]');
      if (cmd) { exec(cmd.dataset.cmd); return; }
      const ins = e.target.closest('[data-ins]');
      if (ins) { closeMenu(); insertField(ins.dataset.ins); updatePaneVisibility(); return; }
      const tpl = e.target.closest('[data-tpl]');
      if (tpl) { closeMenu(); insertTemplatePoint(+tpl.dataset.tpl); return; }
      const cell = e.target.closest('.table-grid span');
      if (cell) { closeMenu(); insertTable(+cell.dataset.r, +cell.dataset.c); return; }
      const act = e.target.closest('[data-act]');
      if (act && ACTIONS[act.dataset.act]) {
        if (act.closest('.menu')) closeMenu();
        ACTIONS[act.dataset.act](act, e);
      }
    });

    $('tableGrid').addEventListener('mouseover', (e) => {
      const c = e.target.closest('span');
      if (!c) return;
      const R = +c.dataset.r;
      const C = +c.dataset.c;
      $('tableGrid').querySelectorAll('span').forEach((s) => s.classList.toggle('on', +s.dataset.r <= R && +s.dataset.c <= C));
      $('tgLabel').textContent = 'Таблиця ' + C + '×' + R;
    });

    $('fontName').addEventListener('change', () => {
      const v = $('fontName').value;
      applyInline({ fontFamily: /\s/.test(v) ? '"' + v + '"' : v });
    });
    $('fontSize').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); setFontSize(parseFloat($('fontSize').value.replace(',', '.'))); }
    });
    $('fontSize').addEventListener('change', () => setFontSize(parseFloat($('fontSize').value.replace(',', '.'))));
    $('colorPicker').addEventListener('change', () => setColor($('colorPicker').value, 'color'));

    // Редактор
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.addEventListener('selectionchange', () => {
      const s = window.getSelection();
      if (s.rangeCount && inEditor(s.getRangeAt(0).commonAncestorContainer)) {
        savedRange = s.getRangeAt(0).cloneRange();
        clearTimeout(bind.tb);
        bind.tb = setTimeout(updateToolbar, 30);
      }
    });
    editor.addEventListener('input', () => {
      convertMarks();
      ensureNotEmpty();
      state.pristine = false;
      afterEdit();
    });
    editor.addEventListener('keydown', onEditorKey);
    editor.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const file = Array.from(cd.files || []).find((f) => /^image\//.test(f.type));
      e.preventDefault();
      captureSel();
      if (file) { insertImageFile(file); return; }
      const html = cd.getData('text/html');
      if (html && !pasteFromClipboard.plainNext) document.execCommand('insertHTML', false, sanitize(html));
      else document.execCommand('insertText', false, cd.getData('text/plain'));
      pasteFromClipboard.plainNext = false;
      afterEdit();
    });
    editor.addEventListener('drop', (e) => {
      const file = e.dataTransfer && Array.from(e.dataTransfer.files || []).find((f) => /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault();
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (r) savedRange = r;
      insertImageFile(file);
    });
    editor.addEventListener('click', (e) => {
      const img = e.target.closest('img');
      selectImage(img && inEditor(img) ? img : null);
      const fld = e.target.closest('.fld');
      if (fld) {
        const r = document.createRange();
        r.selectNode(fld);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        savedRange = r.cloneRange();
        const k = fld.getAttribute('data-f');
        document.querySelectorAll('#paneFields .pf').forEach((row) => row.classList.toggle('hot', row.dataset.key === k));
      } else {
        document.querySelectorAll('#paneFields .pf.hot').forEach((row) => row.classList.remove('hot'));
      }
    });
    editor.addEventListener('dblclick', (e) => {
      const fld = e.target.closest('.fld');
      if (fld) { e.preventDefault(); openFieldPop(fld); }
    });
    editor.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!e.target.closest('.fld')) captureSel();
      showContextMenu(e);
    });

    // Клік на полях аркуша ставить курсор у найближчий рядок
    sheet.addEventListener('mousedown', (e) => {
      if (e.target !== sheet && e.target.id !== 'pageMarks') return;
      e.preventDefault();
      const er = editor.getBoundingClientRect();
      const x = clamp(e.clientX, er.left + 2, er.right - 2);
      const y = clamp(e.clientY, er.top + 2, er.bottom - 2);
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      editor.focus({ preventScroll: true });
      if (r && inEditor(r.startContainer)) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    });

    // Зображення: зміна розміру
    $('imgHandle').addEventListener('pointerdown', (e) => {
      if (!selImg) return;
      e.preventDefault();
      e.stopPropagation();
      const img = selImg;
      const sx = e.clientX;
      const w0 = img.offsetWidth;
      const maxW = editor.clientWidth;
      const move = (ev) => {
        img.style.width = clamp(Math.round(w0 + (ev.clientX - sx) / zoomFactor()), 24, maxW) + 'px';
        img.style.height = 'auto';
        positionImgBox();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        afterEdit();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    // Панель полів
    $('paneFields').addEventListener('input', (e) => {
      const k = e.target.dataset.field;
      if (k) setField(k, e.target.value, 'pane');
    });
    $('paneFields').addEventListener('change', (e) => {
      const k = e.target.dataset.field;
      if (k) setField(k, e.target.value, 'pane');
    });
    $('fldType').addEventListener('change', () => {
      state.type = $('fldType').value;
      renderTemplates();
      updatePaneVisibility();
      updateTitle();
      if (state.pristine || confirm('Застосувати шаблон «' + TYPES[state.type].label + '»?\nТекст документа буде замінено. «Скасувати» — лишити поточний текст.')) applyTemplate(true);
      else scheduleSave();
    });
    $('showAllFields').addEventListener('change', updatePaneVisibility);

    // Макет
    [['mTop', 'top'], ['mBottom', 'bottom'], ['mLeft', 'left'], ['mRight', 'right']].forEach(([id, key]) => {
      $(id).addEventListener('change', () => {
        state.layout[key] = clamp(+$(id).value || 0, 0, 120);
        applyLayout();
        scheduleSave();
      });
    });
    $('baseSize').addEventListener('change', () => { state.layout.baseSize = +$('baseSize').value; applyLayout(); scheduleSave(); });
    $('sealShow').addEventListener('change', () => { state.seal.show = $('sealShow').checked; applySeal(); scheduleSave(); });
    $('sealSize').addEventListener('input', () => { state.seal.size = +$('sealSize').value; applySeal(); scheduleSave(); });
    $('sealUploader').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        state.seal.src = await readImage(file, 600);
        state.seal.show = true;
        applySeal();
        persist(true);
      } catch (err) { toast('Не вдалося прочитати файл'); }
    });
    $('bgUploader').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) { toast('Файл фону завеликий (понад 6 МБ)'); return; }
      try {
        state.bgImageSrc = await readImage(file, 1654);
        applyLayout();
        persist(true);
      } catch (err) { toast('Не вдалося прочитати файл'); }
    });
    $('imgUploader').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      insertImageFile(file);
    });

    // Вигляд
    $('optRuler').addEventListener('change', () => { ui.ruler = $('optRuler').checked; saveUi(); drawRuler(); updateSizer(); });
    $('optPane').addEventListener('change', () => setPane($('optPane').checked));
    $('optShade').addEventListener('change', () => { ui.shade = $('optShade').checked; saveUi(); document.body.classList.toggle('no-shade', !ui.shade); });
    $('zoomRange').addEventListener('input', () => setZoom(+$('zoomRange').value));
    canvas.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 10 : -10));
    }, { passive: false });

    // Пошук
    $('findQ').addEventListener('input', () => { findIdx = -1; computeMatches(); });
    $('findCase').addEventListener('change', () => { findIdx = -1; computeMatches(); });
    $('findQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') closeFind();
    });
    $('replQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
      if (e.key === 'Escape') closeFind();
    });

    // Чернетки
    $('slotSel').addEventListener('change', () => {
      persist(false);
      loadSlot(+$('slotSel').value);
      db.active = slot;
      persist(false);
      toast('Чернетка ' + slot);
    });

    // Глобальні комбінації
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { closeMenu(); if (!$('fldPop').hidden) closeFieldPop(); if (!$('findBox').hidden) closeFind(); }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); persist(true); }
      if (k === 'p') { e.preventDefault(); window.print(); }
      if (k === 'f' || k === 'а') { e.preventDefault(); openFind(false); }
      if (k === 'h' || k === 'р') { e.preventDefault(); openFind(true); }
    });

    window.addEventListener('resize', () => { closeMenu(); updateSizer(); });
    window.addEventListener('beforeunload', () => { if (saveTimer) persist(false); });
    bindRuler();
    bindSeal();
  }

  function onEditorKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.shiftKey && !e.altKey) {
      const map = { e: 'justifyCenter', l: 'justifyLeft', r: 'justifyRight', j: 'justifyFull' };
      const code = e.code ? e.code.replace('Key', '').toLowerCase() : k.toLowerCase();
      if (map[code]) { e.preventDefault(); exec(map[code]); return; }
      if (k === 'Enter') { e.preventDefault(); captureSel(); insertPageBreak(); return; }
      if (k === ']') { e.preventDefault(); captureSel(); setFontSize(currentSizePt() + 1); return; }
      if (k === '[') { e.preventDefault(); captureSel(); setFontSize(Math.max(1, currentSizePt() - 1)); return; }
      if (code === 'y') { e.preventDefault(); exec('redo'); return; }
    }
    if (mod && e.shiftKey) {
      if (k === '>' || e.code === 'Period') { e.preventDefault(); captureSel(); stepFont(1); return; }
      if (k === '<' || e.code === 'Comma') { e.preventDefault(); captureSel(); stepFont(-1); return; }
      if (e.code === 'KeyV') { pasteFromClipboard.plainNext = true; return; }
      if (e.code === 'KeyL') { e.preventDefault(); captureSel(); toggleList(false); return; }
    }
    if (k === 'Tab') {
      e.preventDefault();
      captureSel();
      const el = anchorEl();
      const td = el && el.closest('td,th');
      if (td && inEditor(td)) {
        const cells = Array.from(td.closest('table').querySelectorAll('td,th'));
        let i = cells.indexOf(td) + (e.shiftKey ? -1 : 1);
        if (i >= cells.length) { tableOp('rowBelow'); captureSel(); i = cells.length; }
        const all = Array.from(td.closest('table').querySelectorAll('td,th'));
        const target = all[clamp(i, 0, all.length - 1)];
        if (target) placeCaretIn(target, false);
        return;
      }
      if (el && el.closest('li')) { indent(e.shiftKey ? -1 : 1); return; }
      if (!e.shiftKey) exec('insertText', '  ');
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && selImg) {
      e.preventDefault();
      selImg.remove();
      selectImage(null);
      afterEdit();
    }
  }

  /* ---------- Старт ---------- */
  bind();
  $('tbUser').textContent = (user.username || '') + (typeof officeTitle === 'function' ? ' · ' + officeTitle(user) : '');
  $('btnDiscord').hidden = !hasWebhooks();
  $('optRuler').checked = !!ui.ruler;
  $('optShade').checked = ui.shade !== false;
  document.body.classList.toggle('no-shade', ui.shade === false);
  if (ui.color) $('colorSwatch').style.background = ui.color;
  if (ui.hilite) $('hiliteSwatch').style.background = ui.hilite;
  const narrow = window.innerWidth <= 900;
  if (narrow) {
    $('pane').classList.add('off');
    $('optPane').checked = false;
    ui.pane = false;
  } else {
    setPane(!!ui.pane);
  }
  loadSlot(slot);
  setZoom(narrow ? (canvas.clientWidth - 24) / sheet.offsetWidth * 100 : zoom, true);
  if (editId) loadFromDoc(editId);
  if (!db.slots[slot]) persist(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutPages());

  window.chanceryApi = {
    getState: () => state,
    persist: persist,
    applySeal: applySeal
  };
})();

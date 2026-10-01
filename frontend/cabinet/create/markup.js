/* Розмітка документа для швидкої вставки в редактор (як BB-коди на форумі + простий Markdown).
   window.markupToHtml(text, { field }) → HTML для аркуша. field(token) повертає HTML поля документа або null.
   Довідка й інструкція для ШІ — MARKUP_HELP / MARKUP_AI_PROMPT нижче. */
(function () {
  'use strict';

  const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ALIGN = { center: 'center', right: 'right', left: 'left', justify: 'justify' };

  // Вбудоване форматування в межах рядка (текст уже екранований)
  function inline(s, opts) {
    s = s
      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<b>$1</b>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<i>$1</i>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
      .replace(/\[size=(\d{1,2})\]([\s\S]*?)\[\/size\]/gi, (m, n, t) => '<span style="font-size:' + Math.min(Math.max(+n, 6), 48) + 'pt">' + t + '</span>')
      .replace(/\[color=(#[0-9a-f]{3,6}|[a-z]{3,20})\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/(^|[\s(«"])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?»"]|$)/g, '$1<i>$2</i>')
      .replace(/\[br\]/gi, '<br>');
    // Поля документа: {ПІБ}, {НОМЕР}, {ДАТА}… — стають живими полями редактора
    return s.replace(/\{([A-ZА-ЯІЇЄҐ_ ]{2,30})\}/g, (m, t) => (opts.field && opts.field(t.trim())) || m);
  }

  function markupToHtml(src, opts) {
    opts = opts || {};
    const lines = escHtml(String(src || '').replace(/\r\n?/g, '\n')).split('\n');
    const out = [];
    let align = '';        // [center]…[/center] на кількох рядках
    let indent = false;    // [indent]…[/indent] — абзацний відступ
    let list = null;       // { tag, items: [{ level, html }] }
    let table = null;      // рядки таблиці | a | b |

    const pStyle = (extra) => {
      const st = [];
      if (align) st.push('text-align:' + align);
      if (indent) st.push('text-indent:1.25cm');
      if (extra) st.push(extra);
      return st.length ? ' style="' + st.join(';') + '"' : '';
    };
    function flushList() {
      if (!list) return;
      // Вкладені пункти (відступ 2+ пробіли) — підсписок останнього пункту
      let html = '<' + list.tag + '>';
      let open = false;
      list.items.forEach((it, i) => {
        if (it.level === 0) {
          if (open) { html += '</' + list.tag + '></li>'; open = false; }
          else if (i) html += '</li>';
          html += '<li>' + it.html;
        } else {
          if (!open) { html += '<' + list.tag + '>'; open = true; }
          html += '<li>' + it.html + '</li>';
        }
      });
      html += (open ? '</' + list.tag + '></li>' : '</li>') + '</' + list.tag + '>';
      out.push(html);
      list = null;
    }
    function flushTable() {
      if (!table) return;
      const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r));
      out.push('<table><tbody>' + rows.map((r, i) => {
        const cells = r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|');
        const tag = i === 0 && table.length > 1 && /^\|?\s*:?-{2,}/.test(table[1]) ? 'th' : 'td';
        return '<tr>' + cells.map((c) => '<' + tag + '>' + (inline(c.trim(), opts) || '<br>') + '</' + tag + '>').join('') + '</tr>';
      }).join('') + '</tbody></table>');
      table = null;
    }
    const flush = () => { flushList(); flushTable(); };

    for (let raw of lines) {
      let line = raw.replace(/\s+$/, '');
      // Вирівнювання блоками: тег на окремому рядку відкриває/закриває, на одному рядку — лише цей абзац
      const one = line.match(/^\s*\[(center|right|left|justify)\]([\s\S]*)\[\/\1\]\s*$/i);
      if (one) {
        flush();
        const keep = align; align = ALIGN[one[1].toLowerCase()];
        out.push('<p' + pStyle() + '>' + (inline(one[2], opts) || '<br>') + '</p>');
        align = keep;
        continue;
      }
      const open = line.match(/^\s*\[(center|right|left|justify)\]\s*$/i);
      if (open) { flush(); align = ALIGN[open[1].toLowerCase()]; continue; }
      if (/^\s*\[\/(center|right|left|justify)\]\s*$/i.test(line)) { flush(); align = ''; continue; }
      if (/^\s*\[indent\]\s*$/i.test(line)) { flush(); indent = true; continue; }
      if (/^\s*\[\/indent\]\s*$/i.test(line)) { flush(); indent = false; continue; }

      if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); (table = table || []).push(line.trim()); continue; }
      flushTable();

      const li = line.match(/^(\s*)(\d+[.)]|[-*•])\s+(.*)$/);
      if (li) {
        const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
        const level = li[1].replace(/\t/g, '  ').length >= 2 ? 1 : 0;
        if (list && list.tag !== tag && level === 0) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push({ level, html: inline(li[3], opts) });
        continue;
      }
      flushList();

      if (!line.trim()) continue;
      if (/^\s*(-{3,}|\[hr\])\s*$/i.test(line)) { out.push('<hr>'); continue; }
      if (/^\s*\[(pagebreak|розрив)\]\s*$/i.test(line)) { out.push('<div class="page-break" contenteditable="false"></div>'); continue; }
      if (/^\s*\[(sign|підпис)\]\s*$/i.test(line)) { out.push(opts.signBlock ? opts.signBlock() : ''); continue; }
      const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
      if (h) {
        const n = h[1].length;
        // # — назва документа (як у шаблонах), ## / ### — розділи й підрозділи по центру
        out.push('<h' + n + (n > 1 ? ' style="text-align:center"' : '') + '>' + inline(h[2], opts) + '</h' + n + '>');
        continue;
      }
      out.push('<p' + pStyle() + '>' + inline(line.trim(), opts) + '</p>');
    }
    flush();
    return out.join('') || '<p><br></p>';
  }

  const HELP = [
    ['# Назва документа', 'Головний заголовок (як «НАКАЗ №…»)'],
    ['## Розділ I. Загальні положення', 'Заголовок розділу по центру; ### — підрозділ'],
    ['[center]текст[/center]', 'По центру. Також [right], [left], [justify]. Тег на окремому рядку охоплює всі рядки до закриття'],
    ['[indent] … [/indent]', 'Абзацний відступ першого рядка для всіх абзаців усередині'],
    ['**жирний**  *курсив*  __підкреслений__  ~~закреслений~~', 'Або [b] [i] [u] [s]'],
    ['[size=12]текст[/size]  [color=#444444]текст[/color]', 'Розмір у пунктах і колір'],
    ['1. Пункт   /   - Пункт', 'Нумерований або маркований список; 2 пробіли на початку — підпункт'],
    ['| Колонка | Колонка |', 'Таблиця: кожен рядок у |…|; рядок |---|---| після першого робить його заголовком'],
    ['---', 'Горизонтальна лінія'],
    ['[pagebreak]', 'Розрив сторінки'],
    ['[sign]', 'Блок підпису (посада, ПІБ, розчерк, дата підписанта)'],
    ['{ПІБ} {ПОСАДА} {НОМЕР} {ДАТА} {МІСТО}', 'Поля документа — заповнюються у вкладці «Документ»'],
    ['{ПІДПИСАНТ} {ПОСАДА_ПІДПИСАНТА} {ПІДПИС}', 'Поля підписанта'],
    ['{НОМЕР_ОСОБИ} {ID_ПОСАДИ} {СПРАВА} {РОЛЬ} {ЗАСІДАННЯ} {МІСЦЕ_ЗАСІДАННЯ}', 'Інші поля'],
    ['Порожній рядок', 'Між абзацами не обов\'язковий: кожен рядок — окремий абзац']
  ];

  const AI_PROMPT = [
    'Склади документ у розмітці порталу штату (редактор «Канцелярія»). Відповідай лише розміткою, без пояснень.',
    'Правила:',
    '- кожен рядок — окремий абзац;',
    '- # Назва — головний заголовок документа; ## — розділ (по центру); ### — підрозділ;',
    '- [center]…[/center], [right]…[/right], [justify]…[/justify] — вирівнювання (тег на окремому рядку охоплює кілька рядків);',
    '- **жирний**, *курсив*, __підкреслений__; [size=12]…[/size] — розмір у пунктах;',
    '- "1. " — нумерований пункт, "- " — маркований; два пробіли на початку — підпункт;',
    '- таблиці: | A | B | (кожен рядок у |…|);',
    '- --- лінія, [pagebreak] розрив сторінки, [sign] блок підпису в кінці;',
    '- поля, які заповнюються в редакторі: {ПІБ} {ПОСАДА} {НОМЕР} {ДАТА} {МІСТО} {НОМЕР_ОСОБИ} {ID_ПОСАДИ} {ПІДПИСАНТ} {ПОСАДА_ПІДПИСАНТА} {ПІДПИС} {СПРАВА} {РОЛЬ} {ЗАСІДАННЯ} {МІСЦЕ_ЗАСІДАННЯ};',
    '- для основного закону (Конституція, кодекс): рядки «Розділ I. Назва» робі через ##, статті — абзацами, що починаються зі «Стаття 1. Назва статті.» — так на сайті з\'явиться зміст із посиланнями.',
    'Мова — українська, офіційно-діловий стиль, реалії штату San Andreas (Ukraine GTA 5 RP).',
    '',
    'Документ: '
  ].join('\n');

  const EXAMPLE = [
    '[center][size=12][color=#444444]Штат San-Andreas • м. {МІСТО}[/color][/size][/center]',
    '# НАКАЗ №{НОМЕР}',
    '[center]**_Про призначення на посаду {ПОСАДА}_**[/center]',
    '[justify]',
    'Керуючись Конституцією штату San Andreas, НАКАЗУЮ:',
    '[/justify]',
    '1. Призначити {ПІБ} ({НОМЕР_ОСОБИ}) на посаду {ПОСАДА}.',
    '2. Контроль за виконанням наказу залишаю за собою.',
    '[center]**Цей наказ набуває чинності з моменту його публікації.**[/center]',
    '[sign]'
  ].join('\n').replace('**_', '**').replace('_**', '**');

  window.markupToHtml = markupToHtml;
  window.MARKUP_HELP = HELP;
  window.MARKUP_AI_PROMPT = AI_PROMPT;
  window.MARKUP_EXAMPLE = EXAMPLE;
})();

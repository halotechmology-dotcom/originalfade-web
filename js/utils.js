/* ==========================================================================
   ORIGINALFADE · Utilidades compartidas (sitio público y admin)
   - Crear elementos del DOM de forma segura (sin innerHTML con datos).
   - Íconos SVG, formato de precios, WhatsApp, horarios en hora argentina.
   ========================================================================== */
(function () {
  'use strict';

  const C = window.OF_CONFIG;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------------
     DOM seguro: h('p', { class: 'x', text: 'hola' }, hijos...)
     Todo texto entra como textContent / nodo de texto, nunca como HTML.
     ------------------------------------------------------------------------ */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const val = props[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === 'class') el.className = val;
        else if (key === 'text') el.textContent = String(val);
        else if (key === 'dataset') Object.assign(el.dataset, val);
        else if (key === 'style' && typeof val === 'object') {
          for (const prop of Object.keys(val)) {
            if (prop.indexOf('--') === 0) el.style.setProperty(prop, String(val[prop]));
            else el.style[prop] = val[prop];
          }
        }
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
        else if (key === 'value') el.value = val;
        else if (key === 'checked' || key === 'selected' || key === 'disabled') { el[key] = !!val; if (val) el.setAttribute(key, ''); }
        else if (val === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(val));
      }
    }
    appendAll(el, children);
    return el;
  }

  function appendAll(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  /* Reemplaza el contenido de un nodo por los hijos indicados */
  function mount(el, ...children) {
    el.replaceChildren();
    return appendAll(el, children);
  }

  /* ------------------------------------------------------------------------
     Íconos: se inyecta un "sprite" SVG una sola vez y se usan con <use>.
     Es markup propio y fijo (no viene de la base), por eso es seguro.
     ------------------------------------------------------------------------ */
  const ICONS = {
    wa: '<path fill="currentColor" stroke="none" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.41Z"/>',
    ig: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/>',
    bag: '<path d="M5.5 8h13l-1.1 12.1a1 1 0 0 1-1 .9H7.6a1 1 0 0 1-1-.9L5.5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    'chev-l': '<path d="m15 5-7 7 7 7"/>',
    'chev-r': '<path d="m9 5 7 7-7 7"/>',
    'arrow-r': '<path d="M4 12h15M13 6l6 6-6 6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    moon: '<path fill="currentColor" stroke="none" d="M20.2 14.6A8.5 8.5 0 1 1 9.4 3.8a6.8 6.8 0 0 0 10.8 10.8Z"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4M12 17h.01"/>'
  };

  function injectSprite() {
    if (document.getElementById('of-sprite')) return;
    const symbols = Object.keys(ICONS).map(function (name) {
      return '<symbol id="i-' + name + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</symbol>';
    }).join('');
    const wrap = document.createElement('div');
    wrap.innerHTML = '<svg id="of-sprite" xmlns="' + SVG_NS + '" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">' + symbols + '</svg>';
    document.body.prepend(wrap.firstChild);
  }

  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }

  /* ------------------------------------------------------------------------
     Formatos
     ------------------------------------------------------------------------ */
  const moneyFmt = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  function money(n) { return moneyFmt.format(Math.round(Number(n) || 0)); }

  /* Convierte "23.000", "$ 23000" o 23000 en el entero 23000 */
  function parsePrice(value) {
    const digits = String(value === null || value === undefined ? '' : value).replace(/[^0-9]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  function waLink(message) {
    return 'https://wa.me/' + C.WHATSAPP + '?text=' + encodeURIComponent(message);
  }

  function plural(n, uno, varios) { return n === 1 ? uno : varios; }

  /* ------------------------------------------------------------------------
     Fechas y horarios en hora de Argentina (sin depender del reloj local)
     ------------------------------------------------------------------------ */
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const arFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: C.ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  /* Hoy en Argentina: { y, m, d, dow, minutes, key } */
  function arNow() {
    const parts = {};
    for (const p of arFmt.formatToParts(new Date())) parts[p.type] = p.value;
    const y = +parts.year, m = +parts.month, d = +parts.day;
    const hh = +parts.hour % 24, mm = +parts.minute;
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    return { y: y, m: m, d: d, dow: date.getUTCDay(), minutes: hh * 60 + mm, key: dateKey(date), date: date };
  }

  /* Día calendario a "offset" días de una fecha base (usa mediodía UTC para no saltar de día) */
  function addDays(baseDate, offset) {
    const d = new Date(baseDate.getTime());
    d.setUTCDate(d.getUTCDate() + offset);
    return { date: d, key: dateKey(d), dow: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
  }

  function dateKey(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function ddmm(d) {
    return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* "10:00:00" → 600 */
  function toMinutes(t) {
    if (!t) return null;
    const p = String(t).split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  /* 600 → "10:00" */
  function fmtMinutes(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }

  /* Filas de business_hours → arreglo de 7 días (0 = domingo) */
  function hoursByDay(rows) {
    const out = [];
    for (let i = 0; i < 7; i++) out.push({ dow: i, open: null, close: null, closed: true });
    (rows || []).forEach(function (r) {
      const open = toMinutes(r.open_time), close = toMinutes(r.close_time);
      const valid = !r.closed && open !== null && close !== null && close > open;
      out[r.day_of_week] = { dow: r.day_of_week, open: open, close: close, closed: !valid };
    });
    return out;
  }

  /* Estado del local ahora mismo, en hora de Argentina */
  function storeStatus(week, now) {
    now = now || arNow();
    const today = week[now.dow];
    if (!today.closed && now.minutes >= today.open && now.minutes < today.close) {
      return { open: true, text: 'Abierto hoy hasta las ' + fmtMinutes(today.close) };
    }
    if (!today.closed && now.minutes < today.open) {
      return { open: false, text: 'Cerrado ahora · abre hoy a las ' + fmtMinutes(today.open) };
    }
    for (let i = 1; i <= 7; i++) {
      const day = week[(now.dow + i) % 7];
      if (!day.closed) {
        const cuando = i === 1 ? 'mañana' : 'el ' + DIAS[day.dow];
        return { open: false, text: 'Cerrado ahora · abre ' + cuando + ' a las ' + fmtMinutes(day.open) };
      }
    }
    return { open: false, text: 'Cerrado ahora' };
  }

  /* ------------------------------------------------------------------------
     Imágenes: rutas relativas del sitio, URLs completas o rutas del bucket
     ------------------------------------------------------------------------ */
  function publicUrl(path) {
    return C.SUPABASE_URL + '/storage/v1/object/public/' + C.BUCKET + '/' + String(path).replace(/^\/+/, '');
  }

  function resolveImg(url) {
    if (!url) return '';
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u) || u.indexOf('./') === 0 || u.indexOf('/') === 0 || u.indexOf('assets/') === 0) return u;
    return publicUrl(u);
  }

  /* Si la URL es de nuestro bucket devuelve la ruta interna ("productos/x.webp") */
  function bucketPath(url) {
    const marker = '/storage/v1/object/public/' + C.BUCKET + '/';
    const i = String(url || '').indexOf(marker);
    return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
  }

  /* ------------------------------------------------------------------------
     Varios
     ------------------------------------------------------------------------ */
  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error(message || 'timeout')); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(timer); });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Elementos enfocables dentro de un contenedor (para atrapar el foco en paneles) */
  function focusables(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  /* Toast accesible: un único mensaje a la vez, con acción opcional */
  let toastTimer = null;
  function toast(message, opts) {
    opts = opts || {};
    const region = document.getElementById('toast');
    if (!region) return;
    clearTimeout(toastTimer);
    const children = [h('span', { class: 'toast__msg', text: message })];
    if (opts.actionLabel && opts.onAction) {
      children.push(h('button', {
        type: 'button', class: 'toast__action', text: opts.actionLabel,
        onclick: function () { hide(); opts.onAction(); }
      }));
    }
    mount(region, h('div', { class: 'toast__card' + (opts.tone ? ' toast__card--' + opts.tone : '') }, children));
    region.dataset.show = '';
    toastTimer = setTimeout(hide, opts.duration || 4200);
    function hide() { delete region.dataset.show; }
  }

  window.OF = {
    h: h, mount: mount, appendAll: appendAll, icon: icon, injectSprite: injectSprite,
    money: money, parsePrice: parsePrice, waLink: waLink, plural: plural,
    DIAS: DIAS, DIAS_CORTOS: DIAS_CORTOS, MESES_CORTOS: MESES_CORTOS, capitalize: capitalize,
    arNow: arNow, addDays: addDays, dateKey: dateKey, ddmm: ddmm,
    toMinutes: toMinutes, fmtMinutes: fmtMinutes, hoursByDay: hoursByDay, storeStatus: storeStatus,
    publicUrl: publicUrl, resolveImg: resolveImg, bucketPath: bucketPath,
    withTimeout: withTimeout, uuid: uuid, reducedMotion: reducedMotion, focusables: focusables, toast: toast
  };

  injectSprite();
})();

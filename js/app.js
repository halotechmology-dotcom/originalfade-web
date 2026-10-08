/* ==========================================================================
   ORIGINALFADE · Sitio público
   Lee servicios, barberos, horarios y productos desde Supabase.
   Turnos y pedidos se cierran por WhatsApp (no hay pagos online).
   Cada sección del menú es una pantalla propia (#inicio, #servicios, #turnos,
   #tienda, #contacto).
   Regla de oro: los textos que vienen de la base se insertan siempre con
   textContent (a través de OF.h), nunca como HTML.
   ========================================================================== */
(function () {
  'use strict';

  const C = window.OF_CONFIG;
  const OF = window.OF;
  const h = OF.h, mount = OF.mount, icon = OF.icon, money = OF.money, waLink = OF.waLink;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const MSG_CONSULTA = 'Hola ORIGINALFADE! Quería hacer una consulta.';
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ------------------------------------------------------------------------
     Estado
     ------------------------------------------------------------------------ */
  const state = {
    services: [], barbers: [], week: null, products: [],
    // Horarios ocupados que marca el panel: "barberoId|AAAA-MM-DD" → minutos de inicio de cada turno ocupado
    blocked: {},
    // null = cargando · true = ok · false = error
    ok: { services: null, barbers: null, hours: null, products: null, blocked: null },
    shopFilter: 'Todo',
    cart: [],
    cartNotice: '',
    zoneId: C.ENTREGAS[0].id,
    buyer: { name: '', address: '' },
    bk: { step: 1, barberId: null, serviceId: null, date: null, time: null, name: '', phone: '', sent: false }
  };

  let sb = null;

  /* ========================================================================
     1. Datos (Supabase)
     ======================================================================== */
  function createClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    return window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  const QUERIES = {
    services: function () {
      return sb.from('services').select('id,name,description,duration_min,price,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true });
    },
    barbers: function () {
      return sb.from('barbers').select('id,name,specialty,photo_url,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true });
    },
    hours: function () {
      return sb.from('business_hours').select('day_of_week,open_time,close_time,closed').order('day_of_week', { ascending: true });
    },
    blocked: function () {
      const days = nextDays();
      return sb.from('blocked_slots').select('barber_id,day,start_time')
        .gte('day', days[0].key).lte('day', days[days.length - 1].key);
    },
    products: function () {
      return sb.from('products').select('id,name,description,category,price,sizes,images,in_stock,sort_order,created_at')
        .eq('visible', true).order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    }
  };

  async function loadOne(key) {
    state.ok[key] = null;
    renderFor(key);
    try {
      if (!sb) throw new Error('Supabase no disponible');
      const res = await OF.withTimeout(QUERIES[key](), 12000, 'La consulta tardó demasiado');
      if (res.error) throw res.error;
      const rows = res.data || [];
      if (key === 'hours') state.week = OF.hoursByDay(rows);
      else if (key === 'blocked') state.blocked = groupBlocked(rows);
      else state[key] = rows;
      state.ok[key] = true;
    } catch (err) {
      console.warn('[ORIGINALFADE] No se pudo cargar "' + key + '":', err && err.message ? err.message : err);
      state.ok[key] = false;
    }
    renderFor(key);
  }

  function renderFor(key) {
    if (key === 'services') { renderServices(); renderBooking(); }
    if (key === 'barbers') { renderBarbers(); renderBooking(); }
    if (key === 'hours') { renderStatus(); renderHours(); renderFooterHours(); renderBooking(); }
    if (key === 'products') { renderShop(); if (state.ok.products) revalidateCart(); }
    if (key === 'blocked') { sanitizeBooking(); renderBooking(); }
  }

  function setBusy(root, key) { root.setAttribute('aria-busy', String(state.ok[key] === null)); }

  /* Aviso amable con salida por WhatsApp (nunca una pantalla rota) */
  function errorNotice(text, retryKeys) {
    return h('div', { class: 'notice', role: 'alert' },
      h('p', { text: text }),
      h('div', { class: 'notice__actions' },
        waButton('Escribinos por WhatsApp', 'btn btn--lens'),
        retryKeys ? h('button', {
          type: 'button', class: 'btn btn--ghost',
          onclick: function () { retryKeys.forEach(loadOne); }
        }, 'Reintentar') : null
      )
    );
  }

  function waButton(label, cls, message) {
    return h('a', { class: cls, href: waLink(message || MSG_CONSULTA), target: '_blank', rel: 'noopener' }, icon('wa'), label);
  }

  function priceText(n) { return Number(n) > 0 ? money(n) : 'a consultar'; }

  /* Anuncio para lectores de pantalla */
  function announce(text) {
    const el = $('#announce');
    el.textContent = '';
    requestAnimationFrame(function () { el.textContent = text; });
  }

  /* ========================================================================
     2. Estado del local y horarios
     ======================================================================== */
  function renderStatus() {
    const box = $('#status'), text = $('#status-text');
    const mirrors = $$('[data-status-mirror]');
    if (!state.week) {
      if (state.ok.hours === false) {
        text.textContent = 'Horarios por WhatsApp';
        box.dataset.open = 'unknown';
        mirrors.forEach(function (m) { m.textContent = 'Consultá horarios por WhatsApp'; });
      }
      return;
    }
    const st = OF.storeStatus(state.week);
    box.dataset.open = String(st.open);
    text.textContent = st.text;
    mirrors.forEach(function (m) { m.textContent = st.text; });
  }

  function renderHours() {
    const body = $('#hours-body');
    if (state.ok.hours === null) return;
    if (state.ok.hours === false) {
      mount(body, h('tr', null, h('td', { colspan: '2', style: { textAlign: 'left' } },
        'No pudimos cargar los horarios. ',
        h('a', { href: waLink(MSG_CONSULTA), target: '_blank', rel: 'noopener', text: 'Consultalos por WhatsApp' }), '.'
      )));
      return;
    }
    const today = OF.arNow().dow;
    const order = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
    mount(body, order.map(function (dow) {
      const d = state.week[dow];
      return h('tr', { 'data-today': dow === today ? '' : null },
        h('th', { scope: 'row', text: OF.DIAS[dow] }),
        h('td', { 'data-closed': d.closed ? '' : null, text: d.closed ? 'Cerrado' : OF.fmtMinutes(d.open) + ' a ' + OF.fmtMinutes(d.close) })
      );
    }));
  }

  /* Resumen corto para el footer: agrupa días seguidos con el mismo horario */
  function renderFooterHours() {
    const list = $('#footer-hours');
    if (!state.week) {
      if (state.ok.hours === false) mount(list, h('li', { text: 'Consultá por WhatsApp' }));
      return;
    }
    const order = [1, 2, 3, 4, 5, 6, 0];
    const hourText = function (m) { return m % 60 ? OF.fmtMinutes(m) : String(Math.floor(m / 60)); };
    const same = function (a, b) { return a.closed === b.closed && a.open === b.open && a.close === b.close; };
    const groups = [];
    order.forEach(function (dow) {
      const d = state.week[dow], last = groups[groups.length - 1];
      if (last && same(state.week[last.days[last.days.length - 1]], d)) last.days.push(dow);
      else groups.push({ days: [dow] });
    });
    mount(list, groups.map(function (g) {
      const d = state.week[g.days[0]];
      const first = OF.capitalize(OF.DIAS[g.days[0]]);
      const label = g.days.length === 1 ? first : first + ' a ' + OF.DIAS[g.days[g.days.length - 1]];
      return h('li', { text: label + ': ' + (d.closed ? 'cerrado' : hourText(d.open) + ' a ' + hourText(d.close)) });
    }));
  }

  /* ========================================================================
     3. Servicios (pizarra de precios)
     ======================================================================== */
  function renderServices() {
    const root = $('#services-root');
    setBusy(root, 'services');
    if (state.ok.services === null) return;
    if (state.ok.services === false) {
      mount(root, errorNotice('No pudimos cargar los servicios. Probá de nuevo en un rato o consultanos por WhatsApp.', ['services']));
      return;
    }
    if (!state.services.length) {
      mount(root, h('div', { class: 'notice' },
        h('p', { text: 'Estamos actualizando la lista de servicios. Consultanos precios por WhatsApp.' }),
        h('div', { class: 'notice__actions' }, waButton('Escribinos', 'btn btn--lens'))
      ));
      return;
    }
    mount(root, h('ul', { class: 'board' }, state.services.map(function (s, i) {
      return h('li', { class: 'brow', 'data-reveal': '', style: { '--d': i } },
        h('div', { class: 'brow__head' },
          h('h3', { class: 'brow__name', text: s.name }),
          h('span', { class: 'brow__leader', 'aria-hidden': 'true' }),
          h('span', { class: 'tag' }, icon('clock'), s.duration_min + ' min'),
          h('p', { class: 'brow__price', text: Number(s.price) > 0 ? money(s.price) : 'Consultá' })
        ),
        s.description ? h('p', { class: 'brow__desc', text: s.description }) : null,
        h('button', {
          type: 'button', class: 'link-arrow brow__cta',
          'aria-label': 'Reservar ' + s.name,
          onclick: function () { bookFromService(s.id); }
        }, 'Reservar', icon('arrow-r'))
      );
    })));
    observeReveals(root);
  }

  /* ========================================================================
     4. Turnos (flujo por pasos)
     ======================================================================== */
  const STEPS = ['Barbero', 'Servicio', 'Día', 'Hora', 'Datos', 'Confirmar'];
  const ANY_BARBER = { id: 'any', name: 'Me da igual', specialty: 'El primero que esté libre' };
  let advanceTimer = null;

  function bkService() { return state.services.find(function (s) { return s.id === state.bk.serviceId; }) || null; }
  function bkBarberName() {
    if (state.bk.barberId === 'any') return 'Sin preferencia';
    const b = state.barbers.find(function (x) { return x.id === state.bk.barberId; });
    return b ? b.name : '';
  }

  /* Los próximos N días (en hora argentina) */
  function nextDays() {
    const now = OF.arNow();
    const out = [];
    for (let i = 0; i < C.DIAS_A_MOSTRAR; i++) out.push(OF.addDays(now.date, i));
    return out;
  }
  function dayByKey(key) { return nextDays().find(function (d) { return d.key === key; }) || null; }

  /* Filas de blocked_slots → { "barbero|día": [minutos] } */
  function groupBlocked(rows) {
    const out = {};
    rows.forEach(function (r) {
      const k = r.barber_id + '|' + r.day;
      (out[k] = out[k] || []).push(OF.toMinutes(r.start_time));
    });
    return out;
  }

  /* ¿El barbero tiene algún bloque ocupado que se pise con [inicio, inicio + duración)? */
  function barberBusy(barberId, dayKey, start, duration) {
    const cells = state.blocked[barberId + '|' + dayKey];
    if (!cells) return false;
    return cells.some(function (c) { return c < start + duration && c + C.INTERVALO_MIN > start; });
  }
  function barberFree(barberId, dayKey, start, duration) {
    if (!barberId || barberId === 'any') {
      // "Me da igual": alcanza con que algún barbero esté libre
      return !state.barbers.length || state.barbers.some(function (b) { return !barberBusy(b.id, dayKey, start, duration); });
    }
    return !barberBusy(barberId, dayKey, start, duration);
  }

  /* Horarios libres: un turno cada INTERVALO_MIN desde la apertura hasta (cierre − duración),
     sin los que ya pasaron ni los que el panel marcó como ocupados */
  function slotsFor(dayKey, svc) {
    if (!state.week || !svc) return [];
    const day = dayByKey(dayKey);
    if (!day) return [];
    const hours = state.week[day.dow];
    if (hours.closed) return [];
    const now = OF.arNow();
    const duration = Number(svc.duration_min);
    const out = [];
    for (let m = hours.open; m + duration <= hours.close; m += C.INTERVALO_MIN) {
      if (day.key === now.key && m <= now.minutes) continue; // hoy: ocultar horarios pasados
      if (!barberFree(state.bk.barberId, day.key, m, duration)) continue;
      out.push(m);
    }
    return out;
  }

  function nameValid() { return state.bk.name.trim().length >= 2; }
  function phoneValid() { return state.bk.phone.replace(/[^0-9]/g, '').length >= 8; }

  function stepDone(n) {
    const bk = state.bk;
    if (n === 1) return !!bk.barberId;
    if (n === 2) return !!bkService();
    if (n === 3) return !!bk.date;
    if (n === 4) return bk.time !== null;
    if (n === 5) return nameValid() && phoneValid();
    return false;
  }
  function firstPending() {
    for (let n = 1; n <= 5; n++) if (!stepDone(n)) return n;
    return 6;
  }
  function reachable(n) {
    for (let i = 1; i < n; i++) if (!stepDone(i)) return false;
    return true;
  }

  /* Si cambió el servicio o pasó la hora, invalida día/horario que ya no sirven */
  function sanitizeBooking() {
    const bk = state.bk, svc = bkService();
    if (bk.date && svc) {
      const slots = slotsFor(bk.date, svc);
      if (!slots.length) { bk.date = null; bk.time = null; }
      else if (bk.time !== null && slots.indexOf(bk.time) === -1) bk.time = null;
    }
    if (bk.date && !dayByKey(bk.date)) { bk.date = null; bk.time = null; }
  }

  function goStep(n, opts) {
    opts = opts || {};
    clearTimeout(advanceTimer);
    const dir = n >= state.bk.step ? 1 : -1;
    state.bk.step = Math.max(1, Math.min(6, n));
    renderBooking({ animate: dir, focus: opts.focus !== false });
  }

  /* Después de elegir algo, avanza solo al próximo paso pendiente */
  function autoAdvance() {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(function () { goStep(firstPending()); }, OF.reducedMotion.matches ? 60 : 220);
  }

  /* Lleva a la pantalla de Turnos */
  function scrollToBooking() {
    goToView('turnos');
  }

  function bookFromService(serviceId) {
    state.bk.serviceId = serviceId;
    state.bk.sent = false;
    sanitizeBooking();
    goStep(state.bk.barberId ? firstPending() : 1, { focus: false });
    scrollToBooking();
  }

  function bookFromBarber(barberId) {
    state.bk.barberId = barberId;
    state.bk.sent = false;
    sanitizeBooking(); // el horario elegido puede estar ocupado para este barbero
    goStep(firstPending(), { focus: false });
    scrollToBooking();
  }

  function resetBooking() {
    state.bk = { step: 1, barberId: null, serviceId: null, date: null, time: null, name: state.bk.name, phone: state.bk.phone, sent: false };
    goStep(1);
  }

  function renderBooking(opts) {
    opts = opts || {};
    const stage = $('#stage');
    const section = $('#turnos');
    const nav = { back: $('#bk-back'), next: $('#bk-next') };
    const deps = ['services', 'barbers', 'hours'];

    if (deps.some(function (k) { return state.ok[k] === null; })) {
      stage.setAttribute('aria-busy', 'true');
      return;
    }
    stage.setAttribute('aria-busy', 'false');

    if (deps.some(function (k) { return state.ok[k] === false; })) {
      mount($('#steps'));
      mount($('#booking-where'));
      nav.back.hidden = true; nav.next.hidden = true;
      section.dataset.step = '0';
      mount(stage, errorNotice('No pudimos cargar la agenda. Podés pedir tu turno directo por WhatsApp.',
        deps.filter(function (k) { return state.ok[k] === false; })));
      renderTicket();
      return;
    }
    if (!state.barbers.length || !state.services.length) {
      nav.back.hidden = true; nav.next.hidden = true;
      mount(stage, h('div', { class: 'notice' },
        h('p', { text: 'La reserva online no está disponible en este momento. Escribinos y te damos turno.' }),
        h('div', { class: 'notice__actions' }, waButton('Pedir turno por WhatsApp', 'btn btn--lens', 'Hola ORIGINALFADE! Quiero reservar un turno 💈'))
      ));
      return;
    }

    sanitizeBooking();
    const bk = state.bk;
    if (!reachable(bk.step)) bk.step = firstPending();
    section.dataset.step = String(bk.sent ? 6 : bk.step);

    renderSteps();
    $('#booking-where').textContent = 'Paso ' + bk.step + ' de 6 · ' + STEPS[bk.step - 1];

    const panel = bk.sent ? panelSent() : [panelBarber, panelService, panelDay, panelTime, panelData, panelConfirm][bk.step - 1]();
    mount(stage, panel);

    nav.back.hidden = bk.step === 1 || bk.sent;
    nav.next.hidden = bk.sent || bk.step === 6;
    nav.next.disabled = bk.step < 5 && !stepDone(bk.step);

    renderTicket();

    if (opts.animate) animatePanel(panel, opts.animate);
    if (opts.focus) {
      const title = $('.panel__title', panel);
      if (title) title.focus({ preventScroll: true });
      const top = stage.getBoundingClientRect().top;
      const navH = $('#nav').offsetHeight;
      if (top < navH + 8) window.scrollBy({ top: top - navH - 90, behavior: OF.reducedMotion.matches ? 'auto' : 'smooth' });
      $('#bk-live').textContent = bk.sent ? 'Turno enviado por WhatsApp' : 'Paso ' + bk.step + ' de 6: ' + STEPS[bk.step - 1];
    }
  }

  /* Entrada del panel en la dirección del avance (atrás entra desde la izquierda) */
  function animatePanel(panel, dir) {
    if (!panel.animate) return;
    if (OF.reducedMotion.matches) {
      panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease' });
      return;
    }
    panel.animate(
      [{ opacity: 0, transform: 'translateX(' + (dir * 22) + 'px)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: EASE_OUT }
    );
  }

  function renderSteps() {
    const bk = state.bk;
    mount($('#steps'), STEPS.map(function (label, i) {
      const n = i + 1;
      const current = n === bk.step && !bk.sent;
      const done = stepDone(n) && !current;
      const canJump = !current && reachable(n) && !bk.sent;
      const estado = current ? 'actual' : done ? 'listo' : 'pendiente';
      return h('li', null,
        h('button', {
          type: 'button', class: 'step',
          'aria-current': current ? 'step' : null,
          'data-done': done ? '' : null,
          disabled: !canJump,
          'aria-label': 'Paso ' + n + ', ' + label + ' (' + estado + ')',
          onclick: function () { goStep(n); }
        },
          h('span', { class: 'step__bar', 'aria-hidden': 'true' }),
          h('span', { class: 'step__label', 'aria-hidden': 'true', text: n + '. ' + label })
        )
      );
    }));
  }

  function panelShell(title, hint, body) {
    const id = 'panel-title-' + state.bk.step;
    return h('div', { class: 'panel', role: 'group', 'aria-labelledby': id },
      h('h3', { class: 'panel__title', id: id, tabindex: '-1', text: title }),
      hint ? h('p', { class: 'panel__hint', text: hint }) : null,
      chosenChips(),
      h('div', { class: 'panel__body' }, body)
    );
  }

  /* Resumen corto de lo elegido (en mobile el ticket no se muestra) */
  function chosenChips() {
    const bk = state.bk, svc = bkService(), out = [];
    if (bk.step > 1 && bk.barberId) out.push(bkBarberName());
    if (bk.step > 2 && svc) out.push(svc.name);
    if (bk.step > 3 && bk.date) { const d = dayByKey(bk.date); if (d) out.push(OF.DIAS_CORTOS[d.dow] + ' ' + OF.ddmm(d.date)); }
    if (bk.step > 4 && bk.time !== null) out.push(OF.fmtMinutes(bk.time));
    return h('p', { class: 'chosen', 'aria-label': out.length ? 'Elegiste: ' + out.join(', ') : null },
      out.map(function (t) { return h('span', { text: t }); }));
  }

  function optionButton(opts) {
    return h('button', {
      type: 'button', class: 'opt', 'aria-pressed': String(!!opts.selected), onclick: opts.onclick
    },
      opts.avatar,
      h('span', { class: 'opt__text' },
        h('span', { class: 'opt__name', text: opts.name }),
        opts.meta ? h('span', { class: 'opt__meta', text: opts.meta }) : null
      ),
      icon('check', 'opt__check')
    );
  }

  function barberAvatar(b) {
    if (b.id === 'any') return h('span', { class: 'opt__avatar opt__avatar--any', 'aria-hidden': 'true' }, icon('moon'));
    const av = h('span', { class: 'opt__avatar', 'aria-hidden': 'true' });
    if (b.photo_url) {
      const img = h('img', { src: OF.resolveImg(b.photo_url), alt: '', width: '104', height: '104', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { mount(av, initialOf(b.name)); });
      av.append(img);
    } else {
      av.textContent = initialOf(b.name);
    }
    return av;
  }

  function initialOf(name) { return (String(name || '?').trim().charAt(0) || '?').toUpperCase(); }

  function panelBarber() {
    const list = state.barbers.concat([ANY_BARBER]);
    return panelShell('Elegí tu barbero', 'Todos hacen fade, clásico, diseño y navaja.',
      h('div', { class: 'options' }, list.map(function (b) {
        return optionButton({
          name: b.name, meta: b.specialty, avatar: barberAvatar(b),
          selected: state.bk.barberId === b.id,
          onclick: function (e) {
            state.bk.barberId = b.id;
            sanitizeBooking();
            markPressed(e.currentTarget);
            autoAdvance();
          }
        });
      }))
    );
  }

  function panelService() {
    return panelShell('¿Qué te hacés?', null,
      h('div', { class: 'options' }, state.services.map(function (s) {
        return optionButton({
          name: s.name, meta: s.duration_min + ' min · ' + (Number(s.price) > 0 ? money(s.price) : 'precio a consultar'),
          selected: state.bk.serviceId === s.id,
          onclick: function (e) {
            state.bk.serviceId = s.id;
            sanitizeBooking();
            markPressed(e.currentTarget);
            autoAdvance();
          }
        });
      }))
    );
  }

  /* Marca visualmente la opción elegida sin redibujar (así se ve el tap antes de avanzar) */
  function markPressed(btn) {
    $$('[aria-pressed]', btn.parentElement).forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
    renderTicket();
    const next = $('#bk-next');
    if (next) next.disabled = false;
  }

  function panelDay() {
    const svc = bkService();
    const days = nextDays();
    const cal = h('div', { class: 'cal' });
    ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].forEach(function (d) {
      cal.append(h('span', { class: 'cal__dow', 'aria-hidden': 'true', text: d }));
    });
    const lead = (days[0].dow + 6) % 7; // huecos para que el calendario arranque en lunes
    for (let i = 0; i < lead; i++) cal.append(h('span', { class: 'day day--blank', 'aria-hidden': 'true' }));

    days.forEach(function (d, i) {
      const closed = state.week[d.dow].closed;
      const noSlots = !closed && slotsFor(d.key, svc).length === 0;
      const disabled = closed || noSlots;
      const sub = i === 0 ? 'hoy' : (d.day === 1 ? OF.MESES_CORTOS[d.month] : '');
      const label = OF.capitalize(OF.DIAS[d.dow]) + ' ' + d.day + ' de ' + mesLargo(d.month) +
        (closed ? ', cerrado' : noSlots ? ', sin horarios libres' : '') + (i === 0 ? ' (hoy)' : '');
      cal.append(h('button', {
        type: 'button', class: 'day',
        'aria-pressed': String(state.bk.date === d.key),
        'aria-label': label,
        disabled: disabled,
        onclick: function (e) {
          state.bk.date = d.key;
          sanitizeBooking();
          markPressed(e.currentTarget);
          autoAdvance();
        }
      },
        h('span', { class: 'day__num', text: String(d.day) }),
        h('span', { class: 'day__sub', text: sub || ' ' })
      ));
    });

    const first = days[0], last = days[days.length - 1];
    const hint = 'Del ' + first.day + ' de ' + mesLargo(first.month) + ' al ' + last.day + ' de ' + mesLargo(last.month) + '. Los días tachados no hay turnos disponibles.';
    return panelShell('¿Qué día venís?', hint, cal);
  }

  function mesLargo(m) {
    return ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m];
  }

  function panelTime() {
    const svc = bkService(), day = dayByKey(state.bk.date);
    const slots = slotsFor(state.bk.date, svc);
    if (!slots.length) {
      return panelShell('No quedan horarios ese día', 'Elegí otro día o escribinos por WhatsApp.',
        h('div', { class: 'notice__actions' },
          h('button', { type: 'button', class: 'btn btn--primary', onclick: function () { state.bk.date = null; goStep(3); } }, 'Elegir otro día'),
          waButton('WhatsApp', 'btn btn--ghost', 'Hola ORIGINALFADE! Quiero reservar un turno 💈')));
    }
    const groups = [
      { name: 'Mañana', test: function (m) { return m < 12 * 60; } },
      { name: 'Tarde', test: function (m) { return m >= 12 * 60 && m < 18 * 60; } },
      { name: 'Noche', test: function (m) { return m >= 18 * 60; } }
    ];
    const body = groups.map(function (g) {
      const list = slots.filter(g.test);
      if (!list.length) return null;
      const gid = 'slots-' + g.name.toLowerCase();
      return h('div', { class: 'slot-group', role: 'group', 'aria-labelledby': gid },
        h('p', { class: 'label slot-group__title', id: gid, text: g.name }),
        h('div', { class: 'slots' }, list.map(function (m) {
          return h('button', {
            type: 'button', class: 'slot', 'aria-pressed': String(state.bk.time === m),
            onclick: function (e) {
              state.bk.time = m;
              markPressed(e.currentTarget);
              $$('.slot', $('#stage')).forEach(function (b) { b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
              autoAdvance();
            }
          }, OF.fmtMinutes(m));
        }))
      );
    });
    const hint = OF.capitalize(OF.DIAS[day.dow]) + ' ' + OF.ddmm(day.date) + ' · ' + svc.name + ' dura ' + svc.duration_min + ' min.';
    return panelShell('¿A qué hora?', hint, body);
  }

  function panelData() {
    const bk = state.bk;
    const nameErr = h('p', { class: 'field__error', id: 'bk-name-err' });
    const phoneErr = h('p', { class: 'field__error', id: 'bk-phone-err' });
    const name = h('input', {
      class: 'input', id: 'bk-name', name: 'name', type: 'text', autocomplete: 'name', required: true,
      value: bk.name, placeholder: 'Nombre y apellido', 'aria-describedby': 'bk-name-err',
      oninput: function (e) { bk.name = e.target.value; clearErr(e.target, nameErr); renderTicket(); }
    });
    const phone = h('input', {
      class: 'input', id: 'bk-phone', name: 'tel', type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true,
      value: bk.phone, placeholder: '11 2345 6789', 'aria-describedby': 'bk-phone-err',
      oninput: function (e) { bk.phone = e.target.value; clearErr(e.target, phoneErr); renderTicket(); }
    });
    const form = h('form', {
      class: 'form-grid form-grid--2', novalidate: true,
      onsubmit: function (e) { e.preventDefault(); submitData(); }
    },
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'bk-name', text: 'Tu nombre' }), name, nameErr),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'bk-phone' }, 'Tu WhatsApp ', h('small', { text: '(para confirmarte)' })), phone, phoneErr),
      h('button', { type: 'submit', class: 'sr-only', tabindex: '-1' }, 'Continuar')
    );
    return panelShell('Tus datos', 'Los usamos solo para confirmarte el turno.', form);
  }

  function clearErr(input, errEl) { input.removeAttribute('aria-invalid'); errEl.textContent = ''; }

  function submitData() {
    const name = $('#bk-name'), phone = $('#bk-phone');
    let firstBad = null;
    if (!nameValid()) {
      name.setAttribute('aria-invalid', 'true');
      $('#bk-name-err').textContent = 'Escribí tu nombre.';
      firstBad = firstBad || name;
    }
    if (!phoneValid()) {
      phone.setAttribute('aria-invalid', 'true');
      $('#bk-phone-err').textContent = 'Escribí un teléfono válido, por ejemplo 11 2345 6789.';
      firstBad = firstBad || phone;
    }
    if (firstBad) { firstBad.focus(); return; }
    goStep(6);
  }

  /* Paso final: se muestra el mensaje exacto que se va a mandar */
  function panelConfirm() {
    return panelShell('Revisá y confirmá', 'Este es el mensaje que se abre en WhatsApp. Si algo no está bien, volvé al paso que quieras.',
      h('div', { class: 'confirm' },
        h('p', { class: 'label', id: 'bk-msg-label', text: 'Tu mensaje' }),
        h('p', { class: 'bubble', 'aria-labelledby': 'bk-msg-label', text: bookingMessage() }),
        h('a', {
          class: 'btn btn--lens btn--lg btn--block', href: waLink(bookingMessage()), target: '_blank', rel: 'noopener',
          onclick: onConfirmBooking
        }, icon('wa'), 'Confirmar por WhatsApp'),
        h('p', { class: 'confirm__note' },
          h('strong', { text: 'Todavía no está reservado.' }),
          ' El turno queda confirmado cuando la barbería te responde por WhatsApp.')
      )
    );
  }

  function panelSent() {
    const panel = h('div', { class: 'panel booking__done', role: 'group', 'aria-labelledby': 'bk-sent-title' },
      h('h3', { class: 'panel__title', id: 'bk-sent-title', tabindex: '-1', text: 'Listo, mandá el mensaje' }),
      h('p', { class: 'panel__hint', text: 'Se abrió WhatsApp con tu pedido de turno. Enviá el mensaje y esperá la respuesta: el turno queda confirmado cuando la barbería te contesta.' }),
      h('div', { class: 'notice__actions' },
        h('a', { class: 'btn btn--primary', href: waLink(bookingMessage()), target: '_blank', rel: 'noopener' }, icon('wa'), 'Abrir WhatsApp de nuevo'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: resetBooking }, 'Reservar otro turno')
      )
    );
    return panel;
  }

  function bookingMessage() {
    const bk = state.bk, svc = bkService(), day = dayByKey(bk.date);
    if (!svc || !day || bk.time === null) return '';
    return [
      'Hola ORIGINALFADE! Quiero reservar un turno 💈',
      '• Barbero: ' + bkBarberName(),
      '• Servicio: ' + svc.name + ' (' + svc.duration_min + ' min) — ' + priceText(svc.price),
      '• Día: ' + OF.capitalize(OF.DIAS[day.dow]) + ' ' + OF.ddmm(day.date),
      '• Hora: ' + OF.fmtMinutes(bk.time),
      '• Nombre: ' + bk.name.trim(),
      '• Teléfono: ' + bk.phone.trim()
    ].join('\n');
  }

  function renderTicket() {
    const bk = state.bk, svc = bkService(), day = bk.date ? dayByKey(bk.date) : null;
    const rows = [
      ['Barbero', bk.barberId ? bkBarberName() : ''],
      ['Servicio', svc ? svc.name + ' · ' + svc.duration_min + ' min' : ''],
      ['Día', day ? OF.capitalize(OF.DIAS[day.dow]) + ' ' + OF.ddmm(day.date) : ''],
      ['Hora', bk.time !== null ? OF.fmtMinutes(bk.time) : ''],
      ['Nombre', bk.name.trim()],
      ['Teléfono', bk.phone.trim()]
    ];
    let cta;
    if (bk.sent) {
      cta = h('p', { class: 'ticket__note' }, h('strong', { text: 'Mensaje listo.' }), ' Esperá la respuesta de la barbería por WhatsApp.');
    } else {
      cta = h('p', { class: 'ticket__note' }, 'Lo confirmás por WhatsApp. ', h('strong', { text: 'El turno queda confirmado cuando la barbería te responde.' }));
    }

    mount($('#ticket'),
      h('div', { class: 'ticket__head' },
        h('p', { class: 'ticket__brand' }, 'ORIGINALFADE', h('span', { text: 'Turno · Azcuénaga 1850' })),
        icon('moon', 'ticket__moon')
      ),
      h('ul', { class: 'ticket__rows' }, rows.map(function (r) {
        return h('li', { class: 'ticket__row' },
          h('span', { class: 'ticket__k', text: r[0] }),
          h('span', { class: 'ticket__v', 'data-empty': r[1] ? null : '', text: r[1] || 'Sin elegir' })
        );
      })),
      h('div', { class: 'ticket__row ticket__total' },
        h('span', { class: 'ticket__k', text: 'Precio' }),
        h('span', { class: 'ticket__v', 'data-empty': svc ? null : '', text: svc ? (Number(svc.price) > 0 ? money(svc.price) : 'A consultar') : 'Sin elegir' })
      ),
      cta
    );
  }

  function onConfirmBooking(e) {
    // Revalida justo antes de abrir WhatsApp: si el horario ya pasó, vuelve al paso de la hora
    const svc = bkService();
    if (!svc || slotsFor(state.bk.date, svc).indexOf(state.bk.time) === -1) {
      e.preventDefault();
      state.bk.time = null;
      sanitizeBooking();
      OF.toast('Ese horario ya no está disponible. Elegí otro.', { tone: 'error' });
      goStep(firstPending());
      return;
    }
    e.currentTarget.href = waLink(bookingMessage());
    // Se redibuja después de que el navegador abra el link
    setTimeout(function () {
      state.bk.sent = true;
      renderBooking({ animate: 1, focus: true });
    }, 60);
  }

  function initBookingNav() {
    $('#bk-back').addEventListener('click', function () {
      if (state.bk.step > 1) goStep(state.bk.step - 1);
    });
    $('#bk-next').addEventListener('click', function () {
      const step = state.bk.step;
      if (step === 5) { submitData(); return; }
      if (stepDone(step)) goStep(firstPending() > step ? firstPending() : step + 1);
    });
  }

  /* ========================================================================
     5. Tienda
     ======================================================================== */
  function productById(id) { return state.products.find(function (p) { return p.id === id; }) || null; }
  function productImages(p) { return (p.images || []).map(OF.resolveImg).filter(Boolean); }

  function renderShop() {
    const root = $('#shop-root'), filters = $('#shop-filters');
    setBusy(root, 'products');
    if (state.ok.products === null) return;
    if (state.ok.products === false) {
      filters.hidden = true;
      mount(root, errorNotice('No pudimos cargar la tienda. Probá de nuevo en un rato o preguntanos por WhatsApp qué hay disponible.', ['products']));
      return;
    }
    if (!state.products.length) {
      filters.hidden = true;
      mount(root, emptyShop());
      observeReveals(root);
      return;
    }

    // Categorías en el orden en que aparecen los productos
    const cats = [];
    state.products.forEach(function (p) {
      const c = (p.category || 'Otros').trim();
      if (cats.indexOf(c) === -1) cats.push(c);
    });
    if (state.shopFilter !== 'Todo' && cats.indexOf(state.shopFilter) === -1) state.shopFilter = 'Todo';
    filters.hidden = cats.length < 2;
    mount(filters, ['Todo'].concat(cats).map(function (c) {
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(state.shopFilter === c),
        onclick: function () { state.shopFilter = c; renderShop(); }
      }, c);
    }));

    const list = state.products.filter(function (p) {
      return state.shopFilter === 'Todo' || (p.category || 'Otros').trim() === state.shopFilter;
    });
    // Con varios productos, el primero se destaca a doble columna en desktop
    const featured = state.shopFilter === 'Todo' && list.length >= 5;
    mount(root, h('div', { class: 'pgrid' + (featured ? ' pgrid--featured' : '') }, list.map(productCard)));
  }

  function emptyShop() {
    return h('div', { class: 'empty-wide', 'data-reveal': '' },
      h('span', { class: 'frame empty-wide__art' },
        h('picture', null,
          h('source', { srcset: 'assets/mascota-sticker.webp', type: 'image/webp' }),
          h('img', { src: 'assets/mascota-sticker.jpg', width: '1200', height: '1200', alt: 'Sticker de la mascota de ORIGINALFADE', loading: 'lazy', decoding: 'async' })
        )
      ),
      h('div', null,
        h('p', { class: 'empty-wide__title', text: 'Nuevo drop en camino' }),
        h('p', { class: 'empty-wide__text', text: 'Enterate primero en Instagram.' }),
        h('a', { class: 'btn btn--primary btn--lg', href: C.INSTAGRAM_URL, target: '_blank', rel: 'noopener' }, icon('ig'), 'Seguinos en Instagram')
      )
    );
  }

  /* Botón con estado "Agregado ✓" (se cruzan dos etiquetas con opacidad) */
  function addButtonContent(label) {
    return h('span', { class: 'btn__swap' },
      h('span', null, icon('plus'), label),
      h('span', { 'aria-hidden': 'true' }, icon('check'), 'Agregado')
    );
  }

  function isNew(p) {
    if (!p.created_at) return false;
    const age = Date.now() - new Date(p.created_at).getTime();
    return age >= 0 && age < 21 * 24 * 60 * 60 * 1000;
  }

  function productCard(p) {
    const imgs = productImages(p);
    const out = !p.in_stock;
    const sizes = p.sizes || [];
    const open = function () { openProduct(p.id); };

    let cta;
    if (out) cta = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--block pcard__cta', disabled: true }, 'Sin stock');
    else if (sizes.length > 1) cta = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--block pcard__cta', onclick: open, 'aria-label': 'Elegir talle de ' + p.name }, 'Elegir talle');
    else cta = h('button', {
      type: 'button', class: 'btn btn--ghost btn--sm btn--block pcard__cta', 'aria-label': 'Agregar ' + p.name + ' al carrito',
      onclick: function (e) { addToCart(p, sizes[0] || '', e.currentTarget); }
    }, addButtonContent('Agregar'));

    const badges = h('div', { class: 'pcard__badges' },
      out ? h('span', { class: 'sticker-badge', text: 'Sin stock' }) : null,
      !out && isNew(p) ? h('span', { class: 'sticker-badge', text: 'Nuevo' }) : null
    );

    let media;
    if (imgs.length) {
      // Mouse: segunda foto en crossfade al pasar por encima. Touch: carrusel deslizable.
      const stack = h('div', { class: 'pcard__stack', onclick: open, 'aria-hidden': 'true' },
        h('img', { src: imgs[0], alt: '', width: '800', height: '1000', loading: 'lazy', decoding: 'async' }),
        imgs[1] ? h('img', { class: 'pcard__alt', src: imgs[1], alt: '', width: '800', height: '1000', loading: 'lazy', decoding: 'async' }) : null
      );
      media = [stack, h('div', { class: 'pcard__carousel' }, carousel(imgs, p.name, open))];
    } else {
      media = [h('div', { class: 'noimg', onclick: open }, icon('image'))];
    }

    return h('article', { class: 'pcard', 'data-out': out ? '' : null },
      h('div', { class: 'pcard__media' }, badges, media),
      h('div', { class: 'pcard__body' },
        p.category ? h('p', { class: 'pcard__cat', text: p.category }) : null,
        h('h3', { class: 'pcard__name' }, h('button', { type: 'button', class: 'pcard__open', onclick: open, text: p.name })),
        h('p', { class: 'pcard__price', text: priceText(p.price) }),
        sizes.length ? h('ul', { class: 'pcard__sizes', 'aria-label': 'Talles disponibles' }, sizes.map(function (s) { return h('li', { text: s }); })) : null,
        cta
      )
    );
  }

  /* Carrusel con scroll-snap + indicadores */
  function carousel(imgs, name, onOpen) {
    const track = h('div', {
      class: 'carousel',
      tabindex: imgs.length > 1 ? '0' : null,
      role: imgs.length > 1 ? 'region' : null,
      'aria-label': imgs.length > 1 ? 'Fotos de ' + name + ' (' + imgs.length + ')' : null,
      onclick: onOpen || null
    }, imgs.map(function (src, i) {
      return h('img', {
        src: src, alt: i === 0 ? name : name + ', foto ' + (i + 1),
        width: '800', height: '1000', loading: 'lazy', decoding: 'async', draggable: 'false'
      });
    }));
    if (imgs.length < 2) return track;
    const dots = h('div', { class: 'dots-nav', 'aria-hidden': 'true' }, imgs.map(function (_, i) { return h('span', { 'data-on': i === 0 ? '' : null }); }));
    let raf = 0;
    track.addEventListener('scroll', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        Array.from(dots.children).forEach(function (d, i) { d.toggleAttribute('data-on', i === idx); });
      });
    }, { passive: true });
    const frag = document.createDocumentFragment();
    frag.append(track, dots);
    return frag;
  }

  /* ---------- Detalle de producto (diálogo nativo) ---------- */
  function openProduct(id) {
    const p = productById(id);
    if (!p) return;
    const dlg = $('#product-dialog');
    const imgs = productImages(p);
    const sizes = p.sizes || [];
    const out = !p.in_stock;
    const errEl = h('p', { class: 'field__error', id: 'pd-size-err' });

    let media;
    if (imgs.length) {
      const track = carousel(imgs, p.name, null);
      media = h('div', { class: 'pdetail__media' }, track);
      if (imgs.length > 1) {
        const tr = media.querySelector('.carousel');
        const move = function (dir) { tr.scrollBy({ left: dir * tr.clientWidth, behavior: OF.reducedMotion.matches ? 'auto' : 'smooth' }); };
        media.append(
          h('button', { type: 'button', class: 'icon-btn pdetail__nav', 'data-dir': 'prev', 'aria-label': 'Foto anterior', onclick: function () { move(-1); } }, icon('chev-l')),
          h('button', { type: 'button', class: 'icon-btn pdetail__nav', 'data-dir': 'next', 'aria-label': 'Foto siguiente', onclick: function () { move(1); } }, icon('chev-r'))
        );
      }
    } else {
      media = h('div', { class: 'pdetail__media' }, h('div', { class: 'noimg' }, icon('image')));
    }

    const sizeField = sizes.length ? h('fieldset', { class: 'sizes', 'aria-describedby': 'pd-size-err' },
      h('legend', { class: 'label', text: 'Elegí tu talle' }),
      h('div', { class: 'sizes__list' }, sizes.map(function (s) {
        return h('label', { class: 'size' },
          h('input', { type: 'radio', name: 'pd-size', value: s, checked: sizes.length === 1, disabled: out,
            onchange: function () { errEl.textContent = ''; } }),
          h('span', { text: s })
        );
      })),
      errEl
    ) : null;

    const addBtn = out
      ? h('button', { type: 'button', class: 'btn btn--ghost btn--lg btn--block', disabled: true }, 'Sin stock')
      : h('button', {
        type: 'button', class: 'btn btn--primary btn--lg btn--block',
        onclick: function (e) {
          let size = '';
          if (sizes.length) {
            const checked = dlg.querySelector('input[name="pd-size"]:checked');
            if (!checked) {
              errEl.textContent = 'Elegí un talle para agregarlo.';
              const first = dlg.querySelector('input[name="pd-size"]');
              if (first) first.focus();
              return;
            }
            size = checked.value;
          }
          const btn = e.currentTarget;
          if (addToCart(p, size, btn)) {
            setTimeout(function () { closeDialog(dlg); }, OF.reducedMotion.matches ? 300 : 650);
          }
        }
      }, addButtonContent('Agregar al carrito'));

    mount($('#pd-root'),
      h('button', { type: 'button', class: 'icon-btn sheet__close', 'aria-label': 'Cerrar', onclick: function () { closeDialog(dlg); } }, icon('close')),
      h('div', { class: 'pdetail' },
        media,
        h('div', { class: 'pdetail__info' },
          p.category ? h('p', { class: 'label', text: p.category }) : null,
          h('h2', { class: 'pdetail__name', id: 'pd-name', text: p.name }),
          h('p', { class: 'pdetail__price', text: priceText(p.price) }),
          p.description ? h('p', { class: 'pdetail__desc', text: p.description }) : null,
          sizeField,
          addBtn,
          h('p', { class: 'fineprint', text: 'El pedido se cierra por WhatsApp: ahí coordinamos pago y entrega.' })
        )
      )
    );
    openDialog(dlg);
  }

  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    document.documentElement.style.overflow = 'hidden';
    updateFloat();
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  function initDialogs() {
    $$('dialog').forEach(function (dlg) {
      dlg.addEventListener('close', function () {
        if (!$$('dialog').some(function (d) { return d.open; }) && !$('#cart').hasAttribute('data-open')) {
          document.documentElement.style.overflow = '';
        }
        updateFloat();
      });
      // Tocar el fondo cierra
      dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDialog(dlg); });
      $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { closeDialog(dlg); }); });
    });
  }

  /* ========================================================================
     6. Carrito
     ======================================================================== */
  function loadCart() {
    try {
      const raw = localStorage.getItem(C.CARRITO_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.items)) {
        state.cart = data.items.filter(function (l) {
          return l && typeof l.id === 'string' && Number(l.qty) > 0;
        }).map(function (l) {
          return {
            id: l.id, size: String(l.size || ''), qty: Math.min(C.MAX_UNIDADES, Math.max(1, parseInt(l.qty, 10) || 1)),
            name: String(l.name || 'Producto'), price: Number(l.price) || 0, image: String(l.image || '')
          };
        });
      }
      // Carritos guardados con las zonas viejas (recoleta, caba…) pasan a "envío a domicilio"
      if (data && data.zoneId) state.zoneId = data.zoneId === 'retiro' ? 'retiro' : 'envio';
    } catch (err) { /* sin localStorage o dato corrupto: carrito vacío */ }
  }

  function saveCart() {
    try {
      localStorage.setItem(C.CARRITO_KEY, JSON.stringify({ v: 1, items: state.cart, zoneId: state.zoneId }));
    } catch (err) { /* modo privado o sin espacio */ }
  }

  /* Al cargar productos: descarta lo que ya no existe o quedó sin stock */
  function revalidateCart() {
    if (!state.cart.length) return;
    const removed = [];
    const next = [];
    state.cart.forEach(function (line) {
      const p = productById(line.id);
      const sizes = p ? (p.sizes || []) : [];
      if (!p || !p.in_stock || (sizes.length && sizes.indexOf(line.size) === -1)) {
        removed.push(line.name + (line.size ? ' (talle ' + line.size + ')' : ''));
        return;
      }
      const size = sizes.length ? line.size : '';
      const dup = next.find(function (l) { return l.id === p.id && l.size === size; });
      const fresh = { id: p.id, size: size, qty: line.qty, name: p.name, price: Number(p.price) || 0, image: productImages(p)[0] || '' };
      if (dup) dup.qty = Math.min(C.MAX_UNIDADES, dup.qty + line.qty);
      else next.push(fresh);
    });
    state.cart = next;
    if (removed.length) {
      state.cartNotice = 'Sacamos del carrito ' + removed.join(', ') + ' porque ya no ' + (removed.length === 1 ? 'está disponible.' : 'están disponibles.');
      OF.toast(removed.length === 1 ? 'Un producto de tu carrito ya no está disponible.' : removed.length + ' productos de tu carrito ya no están disponibles.', {
        actionLabel: 'Ver carrito', onAction: openCart, duration: 6000
      });
    }
    saveCart();
    renderCart();
  }

  function cartCount() { return state.cart.reduce(function (a, l) { return a + l.qty; }, 0); }
  function cartSubtotal() { return state.cart.reduce(function (a, l) { return a + l.qty * l.price; }, 0); }
  function currentZone() { return C.ENTREGAS.find(function (z) { return z.id === state.zoneId; }) || C.ENTREGAS[0]; }

  /* Devuelve true si se agregó. "btn" (opcional) muestra el estado "Agregado ✓" */
  function addToCart(p, size, btn) {
    const line = state.cart.find(function (l) { return l.id === p.id && l.size === size; });
    if (line) {
      if (line.qty >= C.MAX_UNIDADES) { OF.toast('Llegaste al máximo de ' + C.MAX_UNIDADES + ' unidades de este producto.', { tone: 'error' }); return false; }
      line.qty += 1;
    } else {
      state.cart.push({ id: p.id, size: size, qty: 1, name: p.name, price: Number(p.price) || 0, image: productImages(p)[0] || '' });
    }
    state.cartNotice = '';
    saveCart();
    renderCart();
    bumpBadge();
    if (btn) {
      clearTimeout(btn._addedTimer);
      btn.setAttribute('data-added', '');
      btn._addedTimer = setTimeout(function () { btn.removeAttribute('data-added'); }, 1200);
    }
    announce('Agregaste ' + p.name + (size ? ' talle ' + size : '') + ' al carrito. Tenés ' + cartCount() + ' ' + OF.plural(cartCount(), 'producto', 'productos') + '.');
    return true;
  }

  function changeQty(line, delta) {
    line.qty = Math.max(1, Math.min(C.MAX_UNIDADES, line.qty + delta));
    saveCart();
    renderCart();
    bumpBadge();
  }

  function removeLine(line) {
    state.cart = state.cart.filter(function (l) { return l !== line; });
    saveCart();
    renderCart();
    bumpBadge();
    OF.toast('Sacaste ' + line.name + ' del carrito.');
    const focusTarget = $('#cart-body .line__remove') || $('#cart .drawer__head [data-close]');
    if (focusTarget) focusTarget.focus();
  }

  /* Contador: scale 0.9 → 1 con transition (no keyframes: se puede disparar seguido) */
  function bumpBadge() {
    const badge = $('#cart-count');
    if (OF.reducedMotion.matches || badge.hidden) return;
    badge.setAttribute('data-bump', '');
    void badge.offsetWidth; // aplica el estado inicial sin transición
    badge.removeAttribute('data-bump');
  }

  /* El formulario del carrito se arma una sola vez (para no perder lo que se escribe) */
  const cartUI = {};

  function buildCartUI() {
    cartUI.notice = h('div');
    cartUI.lines = h('div');
    cartUI.nameErr = h('p', { class: 'field__error', id: 'buyer-name-err' });
    cartUI.addrErr = h('p', { class: 'field__error', id: 'buyer-addr-err' });
    cartUI.name = h('input', {
      class: 'input', id: 'buyer-name', type: 'text', autocomplete: 'name', 'aria-describedby': 'buyer-name-err', placeholder: 'Nombre y apellido',
      oninput: function (e) { state.buyer.name = e.target.value; clearErr(e.target, cartUI.nameErr); renderTotals(); }
    });
    cartUI.addrLabel = h('label', { class: 'field__label', for: 'buyer-addr' });
    cartUI.addr = h('input', {
      class: 'input', id: 'buyer-addr', type: 'text', autocomplete: 'street-address', 'aria-describedby': 'buyer-addr-err', placeholder: 'Calle, número y localidad',
      oninput: function (e) { state.buyer.address = e.target.value; clearErr(e.target, cartUI.addrErr); renderTotals(); }
    });
    cartUI.zones = h('fieldset', { class: 'zones' },
      h('legend', { class: 'label', text: 'Entrega' }),
      C.ENTREGAS.map(function (z) {
        return h('label', { class: 'zone' },
          h('input', {
            type: 'radio', name: 'zone', value: z.id, checked: state.zoneId === z.id,
            onchange: function () { state.zoneId = z.id; saveCart(); renderTotals(); updateAddrLabel(); }
          }),
          h('span', { class: 'zone__box' },
            h('span', { class: 'zone__radio', 'aria-hidden': 'true' }),
            h('span', { class: 'zone__name', text: z.nombre }),
            h('span', { class: 'zone__cost', text: z.precio }),
            h('span', { class: 'zone__eta', text: z.detalle })
          )
        );
      }),
      h('p', { class: 'fineprint', text: 'El envío se cobra aparte: según el pedido y el destino, te pasamos el costo por WhatsApp.' })
    );
    cartUI.form = h('div', { class: 'form-grid' },
      cartUI.zones,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'buyer-name', text: 'Tu nombre' }), cartUI.name, cartUI.nameErr),
      h('div', { class: 'field' }, cartUI.addrLabel, cartUI.addr, cartUI.addrErr)
    );
    cartUI.totals = h('div', { class: 'totals' });
    cartUI.cta = h('a', { class: 'btn btn--lens btn--lg btn--block', href: '#', target: '_blank', rel: 'noopener', onclick: onOrderClick }, icon('wa'), 'Pedir por WhatsApp');
    cartUI.shopBtn = h('a', { class: 'btn btn--primary btn--lg btn--block', href: '#tienda', onclick: function () { closeCart(); } }, 'Ir a la tienda');
    cartUI.fine = h('p', { class: 'fineprint', text: 'Se abre WhatsApp con tu pedido armado. Ahí coordinamos pago y entrega.' });

    mount($('#cart-body'), cartUI.notice, cartUI.lines, cartUI.form);
    updateAddrLabel();
  }

  function updateAddrLabel() {
    const pickup = !currentZone().envio;
    mount(cartUI.addrLabel, 'Dirección y localidad ', pickup ? h('small', { text: '(opcional si retirás)' }) : null);
    if (pickup) clearErr(cartUI.addr, cartUI.addrErr);
  }

  function renderCart() {
    const count = cartCount();
    const badge = $('#cart-count');
    badge.textContent = String(count);
    badge.hidden = count === 0;
    $('#cart-open').setAttribute('aria-label', count ? 'Abrir carrito, ' + count + ' ' + OF.plural(count, 'producto', 'productos') : 'Abrir carrito, vacío');
    $('#cart-sub').textContent = count ? '(' + count + ')' : '';

    mount(cartUI.notice, state.cartNotice ? h('p', { class: 'cart-alert', role: 'status' }, icon('alert'), state.cartNotice) : null);

    if (!state.cart.length) {
      mount(cartUI.lines, h('div', { class: 'cart-empty' },
        h('span', { class: 'frame' }, h('img', { src: 'assets/mascota-sticker.jpg', width: '1200', height: '1200', alt: '', loading: 'lazy' })),
        h('p', { text: 'Tu carrito está vacío.' })
      ));
      cartUI.form.hidden = true;
      mount($('#cart-foot'), cartUI.shopBtn);
      return;
    }

    cartUI.form.hidden = false;
    mount(cartUI.lines, h('ul', { class: 'lines', 'aria-label': 'Productos en el carrito' }, state.cart.map(function (line) {
      const label = line.name + (line.size ? ', talle ' + line.size : '');
      return h('li', { class: 'line' },
        h('div', { class: 'line__img' }, line.image
          ? h('img', { src: line.image, alt: '', width: '136', height: '170', loading: 'lazy' })
          : h('div', { class: 'noimg' }, icon('image'))),
        h('div', { class: 'line__info' },
          h('p', { class: 'line__name', text: line.name }),
          h('p', { class: 'line__meta', text: (line.size ? 'Talle ' + line.size + ' · ' : '') + priceText(line.price) + ' c/u' }),
          h('div', { class: 'line__row' },
            h('div', { class: 'qty', role: 'group', 'aria-label': 'Cantidad de ' + label },
              h('button', { type: 'button', 'aria-label': 'Restar una unidad de ' + label, disabled: line.qty <= 1, onclick: function () { changeQty(line, -1); } }, icon('minus')),
              h('output', { 'aria-live': 'polite', text: String(line.qty) }),
              h('button', { type: 'button', 'aria-label': 'Sumar una unidad de ' + label, disabled: line.qty >= C.MAX_UNIDADES, onclick: function () { changeQty(line, 1); } }, icon('plus'))
            ),
            h('p', { class: 'line__total', text: money(line.qty * line.price) }),
            h('button', { type: 'button', class: 'line__remove', 'aria-label': 'Quitar ' + label, onclick: function () { removeLine(line); } }, icon('trash'))
          )
        )
      );
    })));
    renderTotals();
  }

  function renderTotals() {
    if (!state.cart.length) return;
    const z = currentZone(), sub = cartSubtotal();
    mount(cartUI.totals,
      h('div', { class: 'totals__row' }, h('span', { text: 'Subtotal' }), h('span', { text: money(sub) })),
      h('div', { class: 'totals__row' }, h('span', { text: z.envio ? 'Envío a domicilio' : 'Retiro en el local' }), h('span', { text: z.envio ? 'Se cotiza por WhatsApp' : 'Sin cargo' })),
      h('div', { class: 'totals__row totals__row--big' }, h('span', { text: z.envio ? 'Total sin envío' : 'Total' }), h('span', { text: money(sub) }))
    );
    cartUI.cta.href = waLink(orderMessage());
    if (!cartUI.totals.isConnected) mount($('#cart-foot'), cartUI.totals, cartUI.cta, cartUI.fine);
  }

  function orderMessage() {
    const z = currentZone(), sub = cartSubtotal();
    const lines = state.cart.map(function (l) {
      return '• ' + l.qty + ' × ' + l.name + (l.size ? ' (talle ' + l.size + ')' : '') + ' — ' + money(l.qty * l.price);
    });
    const address = state.buyer.address.trim();
    return ['Hola ORIGINALFADE! Quiero hacer este pedido 🛒']
      .concat(lines)
      .concat([
        'Subtotal: ' + money(sub),
        z.envio ? 'Entrega: Envío a domicilio (el costo lo coordinamos por WhatsApp)' : 'Entrega: Retiro en el local (' + C.DIRECCION + ')',
        (z.envio ? 'TOTAL sin envío: ' : 'TOTAL: ') + money(sub),
        'Nombre: ' + state.buyer.name.trim()
      ])
      .concat(address ? ['Dirección: ' + address] : [])
      .join('\n');
  }

  function onOrderClick(e) {
    let firstBad = null;
    if (state.buyer.name.trim().length < 2) {
      cartUI.name.setAttribute('aria-invalid', 'true');
      cartUI.nameErr.textContent = 'Escribí tu nombre para el pedido.';
      firstBad = cartUI.name;
    }
    if (currentZone().envio && state.buyer.address.trim().length < 5) {
      cartUI.addr.setAttribute('aria-invalid', 'true');
      cartUI.addrErr.textContent = 'Escribí la dirección y la localidad para el envío.';
      firstBad = firstBad || cartUI.addr;
    }
    if (firstBad) {
      e.preventDefault();
      firstBad.focus();
      return;
    }
    e.currentTarget.href = waLink(orderMessage());
  }

  /* ---------- Panel lateral: abrir / cerrar / arrastrar para cerrar ---------- */
  let cartReturnFocus = null;
  const BACKGROUND = ['#nav', '#mmenu', 'main', '.footer', '.wa-float'];

  function setBackgroundInert(on) {
    BACKGROUND.forEach(function (sel) {
      const el = $(sel);
      if (!el) return;
      if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  function openCart() {
    const drawer = $('#cart');
    if (drawer.hasAttribute('data-open')) return;
    closeMenu(false);
    cartReturnFocus = document.activeElement;
    drawer.setAttribute('data-open', '');
    $('#cart-open').setAttribute('aria-expanded', 'true');
    setBackgroundInert(true);
    document.documentElement.style.overflow = 'hidden';
    updateFloat();
    requestAnimationFrame(function () {
      const target = $('.drawer__head [data-close]', drawer);
      if (target) target.focus({ preventScroll: true });
    });
  }

  function closeCart() {
    const drawer = $('#cart');
    if (!drawer.hasAttribute('data-open')) return;
    drawer.removeAttribute('data-open');
    $('#cart-open').setAttribute('aria-expanded', 'false');
    setBackgroundInert(false);
    document.documentElement.style.overflow = '';
    updateFloat();
    if (cartReturnFocus && document.contains(cartReturnFocus)) cartReturnFocus.focus({ preventScroll: true });
    else $('#cart-open').focus({ preventScroll: true });
  }

  function initCart() {
    loadCart();
    buildCartUI();
    renderCart();
    const drawer = $('#cart');
    $('#cart-open').addEventListener('click', openCart);
    $$('[data-close]', drawer).forEach(function (el) { el.addEventListener('click', closeCart); });
    drawer.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeCart(); return; }
      if (e.key !== 'Tab') return;
      const items = OF.focusables($('#cart-panel'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    initDragToClose(drawer);
  }

  /* Arrastrar a la derecha para cerrar:
     - sigue el dedo 1:1 desde donde se agarró (incluso a mitad de animación)
     - hacia la izquierda, más allá de abierto, resiste de forma progresiva
     - al soltar cierra si va a > 0.5 px/ms hacia la derecha o recorrió > 35%
     - la animación siguiente arranca desde la posición actual en pantalla */
  function initDragToClose(drawer) {
    const panel = $('#cart-panel'), scrim = $('.drawer__scrim', drawer);
    let start = null, decided = false, x = 0, grabX = 0, samples = [], suppressClick = false;

    function rubberband(overshoot, dimension) {
      const c = 0.55;
      return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
    }

    panel.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || !drawer.hasAttribute('data-open') || OF.reducedMotion.matches) return;
      // Posición real en pantalla (por si la animación de entrada todavía corre)
      const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
      grabX = m.m41 || 0;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      decided = false; x = grabX;
      samples = [{ x: e.clientX, t: e.timeStamp }];
    });

    panel.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!decided) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) { start = null; return; } // es un scroll vertical
        decided = true;
        panel.setPointerCapture(e.pointerId);
        drawer.setAttribute('data-dragging', '');
      }
      const W = panel.offsetWidth;
      const raw = grabX + dx;
      x = raw >= 0 ? raw : rubberband(raw, W);
      panel.style.transform = 'translateX(' + x + 'px)';
      scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - Math.max(0, x) / W)));
      samples.push({ x: e.clientX, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
    });

    function end(e) {
      if (!start || (e && e.pointerId !== start.id)) return;
      const wasDragging = decided;
      start = null;
      if (!wasDragging) return;
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      const a = samples[0], b = samples[samples.length - 1];
      const velocity = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms
      const W = panel.offsetWidth;
      const shouldClose = velocity > 0.5 || (x > W * 0.35 && velocity > -0.5);
      // Volver a habilitar la transición y soltar el transform en el mismo cuadro:
      // el navegador anima desde la posición actual hacia el destino.
      drawer.removeAttribute('data-dragging');
      panel.style.transform = '';
      scrim.style.opacity = '';
      if (shouldClose) closeCart();
    }
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
    panel.addEventListener('click', function (e) {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  /* ========================================================================
     7. Barberos
     ======================================================================== */
  function renderBarbers() {
    const root = $('#barbers-root');
    setBusy(root, 'barbers');
    if (state.ok.barbers === null) return;
    if (state.ok.barbers === false) {
      mount(root, errorNotice('No pudimos cargar el equipo. Probá de nuevo en un rato.', ['barbers']));
      return;
    }
    if (!state.barbers.length) {
      mount(root, h('div', { class: 'notice' }, h('p', { text: 'Pronto vas a ver acá al equipo. Mientras tanto, escribinos por WhatsApp.' })));
      return;
    }
    mount(root, h('ul', { class: 'crew' }, state.barbers.map(function (b, i) {
      const photo = h('span', { class: 'frame portrait' });
      const fallback = function () {
        photo.classList.add('portrait--initial');
        mount(photo, h('span', { class: 'portrait__initial', 'aria-hidden': 'true', text: initialOf(b.name) }));
      };
      if (b.photo_url) {
        const img = h('img', { src: OF.resolveImg(b.photo_url), alt: 'Foto de ' + b.name, width: '400', height: '400', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', fallback);
        photo.append(img);
      } else {
        fallback();
      }
      const first = OF.capitalize(String(b.name).toLowerCase());
      return h('li', { class: 'barber', 'data-reveal': '', style: { '--d': i } },
        photo,
        h('div', null,
          h('h3', { class: 'barber__name', text: b.name }),
          b.specialty ? h('p', { class: 'barber__spec', text: b.specialty }) : null,
          h('button', { type: 'button', class: 'link-arrow', onclick: function () { bookFromBarber(b.id); } }, 'Reservar con ' + first, icon('arrow-r'))
        )
      );
    })));
    observeReveals(root);
  }

  /* ========================================================================
     8. Pantallas (una sección por vez), navegación y menú mobile
     ======================================================================== */
  const VIEWS = ['inicio', 'servicios', 'turnos', 'tienda', 'contacto'];
  const ALIASES = { barberos: 'servicios' };
  const TITLES = {
    inicio: 'ORIGINALFADE · Gallery & Barbershop en Recoleta, CABA',
    servicios: 'Servicios y precios · ORIGINALFADE',
    turnos: 'Reservá tu turno · ORIGINALFADE',
    tienda: 'Tienda · ORIGINALFADE',
    contacto: 'Contacto y horarios · ORIGINALFADE'
  };
  let currentView = null;
  let heroPlayed = false;

  function viewFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (VIEWS.indexOf(id) !== -1) return id;
    if (ALIASES[id]) return ALIASES[id];
    return null;
  }

  function goToView(id) {
    if ('#' + id === location.hash) showView(id, { force: true });
    else location.hash = id;
  }

  function showView(id, opts) {
    opts = opts || {};
    const first = currentView === null;
    const changed = id !== currentView;
    const view = document.getElementById(id);
    if (!view) return;

    if (changed) {
      $$('[data-view]').forEach(function (v) { v.hidden = v.id !== id; });
      currentView = id;
      if (id === 'turnos' && sb && !first) loadOne('blocked');
      document.title = TITLES[id] || TITLES.inicio;
    }

    $$('[data-view-link]').forEach(function (a) {
      if (a.getAttribute('data-view-link') === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    moveIndicator(!first);
    closeMenu(false);

    // Sub-ancla (#barberos) o arriba de todo
    const sub = decodeURIComponent(location.hash.slice(1));
    const anchor = sub && sub !== id ? document.getElementById(sub) : null;
    if (anchor && view.contains(anchor)) anchor.scrollIntoView({ block: 'start' });
    else if (changed || opts.force) window.scrollTo(0, 0);

    if (changed && !first && view.animate) {
      view.animate(OF.reducedMotion.matches
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: OF.reducedMotion.matches ? 160 : 220, easing: EASE_OUT });
    }

    // Foco en el título de la pantalla (teclado y lectores de pantalla)
    if (!first && opts.focus !== false) {
      const heading = view.querySelector('h1, h2');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }

    // La entrada del inicio se ve una sola vez
    if (id === 'inicio' && !heroPlayed) {
      heroPlayed = true;
      setTimeout(function () { document.documentElement.classList.add('hero-done'); }, 1400);
    }
    updateFloat();
  }

  /* Subrayado de la sección activa: se desliza con transform (translateX + scaleX) */
  function moveIndicator(animate) {
    const bar = $('#nav-indicator');
    const active = $('.nav__links a[aria-current="page"]');
    if (!bar) return;
    if (!active || !active.offsetParent) { bar.style.transform = 'translateX(0) scaleX(0)'; return; }
    const holder = bar.parentElement.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const inset = 12; // el subrayado no toca los bordes del link
    const left = r.left - holder.left + inset;
    const width = Math.max(0, r.width - inset * 2);
    if (!animate) bar.setAttribute('data-instant', '');
    bar.style.transform = 'translateX(' + left + 'px) scaleX(' + (width / 100) + ')';
    if (!animate) { void bar.offsetWidth; bar.removeAttribute('data-instant'); }
  }

  function initRouter() {
    window.addEventListener('hashchange', function () {
      const hash = location.hash.slice(1);
      if (hash === 'contenido') { $('#contenido').focus(); return; }
      showView(viewFromHash() || 'inicio');
    });
    // Tocar el link de la pantalla actual la lleva arriba
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const target = a.getAttribute('href').slice(1);
      if (target && ('#' + target) === location.hash) {
        const id = VIEWS.indexOf(target) !== -1 ? target : ALIASES[target];
        if (id) { e.preventDefault(); showView(id, { force: true }); }
      }
    });
    window.addEventListener('resize', function () { moveIndicator(false); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveIndicator(false); });

    const initial = viewFromHash();
    showView(initial || 'inicio', { focus: false });
  }

  function openMenu() {
    const root = document.documentElement, burger = $('#burger');
    root.setAttribute('data-menu-open', '');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Cerrar menú');
    ['main', '.footer', '.wa-float'].forEach(function (s) { const el = $(s); if (el) el.setAttribute('inert', ''); });
    document.documentElement.style.overflow = 'hidden';
    updateFloat();
    requestAnimationFrame(function () {
      const first = $('#mmenu a');
      if (first) first.focus({ preventScroll: true });
    });
  }

  function closeMenu(returnFocus) {
    const root = document.documentElement;
    if (!root.hasAttribute('data-menu-open')) return;
    root.removeAttribute('data-menu-open');
    const burger = $('#burger');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Abrir menú');
    if (!$('#cart').hasAttribute('data-open')) {
      ['main', '.footer', '.wa-float'].forEach(function (s) { const el = $(s); if (el) el.removeAttribute('inert'); });
      document.documentElement.style.overflow = '';
    }
    updateFloat();
    if (returnFocus) burger.focus();
  }

  function initNav() {
    const nav = $('#nav'), burger = $('#burger'), menu = $('#mmenu');

    // Más compacta después de 24px de scroll
    let ticking = false;
    const onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        nav.toggleAttribute('data-compact', window.scrollY > 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    burger.addEventListener('click', function () {
      if (document.documentElement.hasAttribute('data-menu-open')) closeMenu(true);
      else openMenu();
    });
    // Tocar el fondo del menú (fuera de los links) lo cierra
    menu.addEventListener('click', function (e) {
      if (e.target === menu || e.target.classList.contains('mmenu__inner')) closeMenu(true);
    });
    document.addEventListener('keydown', function (e) {
      if (!document.documentElement.hasAttribute('data-menu-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      if (e.key !== 'Tab') return;
      // Foco atrapado: botón del menú + links
      const items = [burger].concat(OF.focusables(menu));
      const idx = items.indexOf(document.activeElement);
      if (e.shiftKey && (idx <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && idx === items.length - 1) { e.preventDefault(); items[0].focus(); }
      else if (idx === -1) { e.preventDefault(); items[0].focus(); }
    });
    window.matchMedia('(min-width: 64rem)').addEventListener('change', function () { closeMenu(false); moveIndicator(false); });
  }

  /* ---------- Botón flotante de WhatsApp: se oculta cuando molesta ---------- */
  let footerVisible = false;
  function updateFloat() {
    const float = $('#wa-float');
    if (!float) return;
    // En Turnos y Contacto ya hay un botón de WhatsApp propio: el flotante sobra
    const hide = footerVisible || currentView === 'turnos' || currentView === 'contacto' ||
      $('#cart').hasAttribute('data-open') ||
      document.documentElement.hasAttribute('data-menu-open') ||
      $('#product-dialog').open;
    float.toggleAttribute('data-hidden', !!hide);
  }
  function initFloat() {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      footerVisible = entries[0].isIntersecting;
      updateFloat();
    }).observe($('#footer'));
  }

  /* ---------- Parallax de la joya: solo mouse y sin reduced-motion ---------- */
  function initParallax() {
    const el = $('#hero-jewel'), hero = $('.hero');
    if (!el || !hero) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    function tick() {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.transform = 'translate3d(' + (cx * 8).toFixed(2) + 'px,' + (cy * 8).toFixed(2) + 'px,0) rotate(' + (cx * 2).toFixed(3) + 'deg)';
      if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(tick);
      else raf = 0;
    }
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !FINE_POINTER.matches || OF.reducedMotion.matches) return;
      const r = hero.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
      if (!raf) raf = requestAnimationFrame(tick);
    });
    hero.addEventListener('pointerleave', function () {
      tx = 0; ty = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    });
    OF.reducedMotion.addEventListener('change', function () { tx = ty = cx = cy = 0; el.style.transform = ''; });
  }

  /* ---------- Entradas al hacer scroll (solo la primera vez) ---------- */
  let revealIO = null;
  function observeReveals(root) {
    const els = $$('[data-reveal]:not(.is-in)', root || document);
    if (!revealIO) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    els.forEach(function (el) { revealIO.observe(el); });
  }

  function initReveals() {
    if (!('IntersectionObserver' in window)) return;
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealIO.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    document.documentElement.classList.add('reveal-ready');
    observeReveals(document);
  }

  /* Links de contacto armados desde config.js */
  function initStaticLinks() {
    $$('[data-wa="consulta"]').forEach(function (a) { a.href = waLink(MSG_CONSULTA); });
    $$('[data-cfg-href]').forEach(function (a) { const v = C[a.getAttribute('data-cfg-href')]; if (v) a.href = v; });
    $('#year').textContent = String(OF.arNow().y);
  }

  /* ========================================================================
     9. Arranque
     ======================================================================== */
  function init() {
    initStaticLinks();
    initNav();
    initRouter();
    initReveals();
    initDialogs();
    initCart();
    initBookingNav();
    initFloat();
    initParallax();

    sb = createClient();
    ['hours', 'services', 'barbers', 'products', 'blocked'].forEach(loadOne);

    // Cada minuto: estado abierto/cerrado, día de hoy y horarios que ya pasaron
    setInterval(function () {
      if (!state.week) return;
      renderStatus();
      renderHours();
      const active = document.activeElement;
      const typing = active && (active.id === 'bk-name' || active.id === 'bk-phone');
      if (!typing && !state.bk.sent) {
        if (currentView === 'turnos' && sb) loadOne('blocked');
        else renderBooking();
      }
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

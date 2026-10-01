/* ==========================================================================
   ORIGINALFADE · Panel de administración
   - Ingreso con email y contraseña (Supabase Auth). Solo entran las cuentas
     que figuran en la tabla "admins".
   - Pestañas: Productos · Servicios · Barberos · Horarios.
   - Las fotos se achican en el navegador (máx. 1600 px), se pasan a WEBP y
     se suben al bucket "fotos" con barra de progreso.
   - Los permisos reales los controla Supabase (RLS): esta página solo arma
     la interfaz.
   Regla: todo texto que viene de la base se inserta con textContent.
   ========================================================================== */
(function () {
  'use strict';

  const C = window.OF_CONFIG;
  const OF = window.OF;
  const h = OF.h, mount = OF.mount, icon = OF.icon, money = OF.money;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const MAX_SIDE = 1600;                      // lado mayor de las fotos subidas
  const MAX_BYTES = 5 * 1024 * 1024;          // límite del bucket
  const MAX_INPUT_BYTES = 30 * 1024 * 1024;   // fotos más pesadas ni se intentan
  const TABS = ['turnos', 'productos', 'servicios', 'barberos', 'horarios'];
  // Datos que necesita cada pestaña para mostrarse
  const TAB_NEEDS = { turnos: ['blocked', 'hours', 'barbers'], productos: ['products'], servicios: ['services'], barberos: ['barbers'], horarios: ['hours'] };
  const TABLE = { products: 'products', services: 'services', barbers: 'barbers', hours: 'business_hours', blocked: 'blocked_slots' };
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];    // lunes primero

  let sb = null;

  const A = {
    user: null,
    tab: 'productos',
    data: { products: [], services: [], barbers: [], hours: [], blocked: [] },
    loaded: { products: null, services: null, barbers: null, hours: null, blocked: null }, // null | 'loading' | 'ok' | 'error'
    turnos: { barberId: null, dayKey: null },
    errors: {},
    mode: 'list',      // 'list' | 'form'
    form: null,        // borrador del formulario abierto
    dirty: false,
    filter: { search: '', cat: '' }
  };

  /* ========================================================================
     1. Utilidades de interfaz
     ======================================================================== */
  function showView(name) {
    ['boot', 'login', 'recovery', 'app'].forEach(function (v) { $('#view-' + v).hidden = v !== name; });
  }

  /* Mensajes de error de Supabase / red → castellano claro */
  function errMsg(err) {
    const m = String((err && (err.message || err.error_description || err.error)) || err || '').toLowerCase();
    if (!navigator.onLine || m.indexOf('failed to fetch') !== -1 || m.indexOf('network') !== -1 || m.indexOf('load failed') !== -1) return 'No hay conexión. Revisá internet y probá de nuevo.';
    if (m.indexOf('invalid login') !== -1 || m.indexOf('invalid credentials') !== -1) return 'Email o contraseña incorrectos.';
    if (m.indexOf('email not confirmed') !== -1) return 'Tenés que confirmar tu email antes de entrar. Revisá tu casilla.';
    if (m.indexOf('jwt') !== -1 && m.indexOf('expired') !== -1) return 'Tu sesión venció. Salí y volvé a entrar.';
    if (m.indexOf('row-level security') !== -1 || m.indexOf('permission') !== -1 || m.indexOf('not authorized') !== -1 || m.indexOf('unauthorized') !== -1 || m.indexOf('403') !== -1) return 'No tenés permisos para hacer esto. Salí y volvé a entrar.';
    if (m.indexOf('payload too large') !== -1 || m.indexOf('maximum allowed size') !== -1 || m.indexOf('413') !== -1) return 'La foto pesa más de 5 MB.';
    if (m.indexOf('mime') !== -1) return 'Formato de foto no permitido. Usá JPG, PNG o WEBP.';
    if (m.indexOf('rate limit') !== -1 || m.indexOf('too many') !== -1 || m.indexOf('security purposes') !== -1) return 'Hiciste muchos intentos seguidos. Esperá un minuto y probá de nuevo.';
    if (m.indexOf('password should be') !== -1 || m.indexOf('weak') !== -1) return 'La contraseña es muy débil: usá al menos 8 caracteres.';
    if (m.indexOf('different from the old') !== -1 || m.indexOf('same password') !== -1) return 'La contraseña nueva tiene que ser distinta de la anterior.';
    if (m.indexOf('check constraint') !== -1) return 'Hay un valor que no es válido (revisá precio y duración).';
    if (m.indexOf('duplicate') !== -1) return 'Ya existe un registro igual.';
    if (m.indexOf('timeout') !== -1 || m.indexOf('tardó') !== -1) return 'El servidor tardó demasiado. Probá de nuevo.';
    return 'Algo salió mal. Probá de nuevo en un rato.';
  }

  /* Píldora de estado: "Guardando…", "Guardado ✓" o error */
  let statusTimer = null;
  const status = {
    show: function (text, tone, ms) {
      const el = $('#a-status');
      clearTimeout(statusTimer);
      el.textContent = text;
      el.dataset.tone = tone;
      el.setAttribute('data-show', '');
      if (ms) statusTimer = setTimeout(function () { el.removeAttribute('data-show'); }, ms);
    },
    saving: function (text) { this.show(text || 'Guardando…', 'saving', 0); },
    ok: function (text) { this.show(text || 'Guardado ✓', 'ok', 2200); },
    error: function (text) { this.show(text, 'error', 6000); }
  };

  function setMsg(el, text, tone) {
    el.textContent = text || '';
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  }

  function busy(btn, on, label) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  /* Diálogo de confirmación nativo → Promise<boolean> */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      const d = $('#confirm-dialog');
      $('#confirm-title').textContent = opts.title;
      $('#confirm-text').textContent = opts.text || '';
      const ok = $('#confirm-ok');
      ok.textContent = opts.ok || 'Borrar';
      ok.className = 'btn ' + (opts.danger === false ? 'btn--lens' : 'a-btn-danger');
      d.returnValue = '';
      d.addEventListener('close', function () { resolve(d.returnValue === 'ok'); }, { once: true });
      d.showModal();
      $('#confirm-cancel').focus();
    });
  }

  function setDirty(on) { A.dirty = !!on; }
  async function confirmDiscard() {
    if (!A.dirty) return true;
    return confirmDialog({ title: 'Tenés cambios sin guardar', text: 'Si salís ahora se pierden.', ok: 'Salir sin guardar' });
  }

  /* Campo con etiqueta */
  function field(label, control, opts) {
    opts = opts || {};
    return h('div', { class: 'field' },
      h('label', { class: 'field__label', for: control.id }, label, opts.optional ? h('small', { text: ' (opcional)' }) : null),
      control,
      opts.hint ? (typeof opts.hint === 'string' ? h('p', { class: 'a-hint', id: control.id + '-hint', text: opts.hint }) : opts.hint) : null
    );
  }

  /* Interruptor accesible (checkbox con role=switch) */
  function switchField(id, label, hint, checked, onchange) {
    return h('label', { class: 'a-switch' },
      h('input', { type: 'checkbox', role: 'switch', id: id, checked: checked, onchange: function (e) { onchange(e.target.checked); setDirty(true); } }),
      h('span', { class: 'a-switch__track', 'aria-hidden': 'true' }),
      h('span', { class: 'a-switch__text' }, label, hint ? h('small', { text: hint }) : null)
    );
  }

  function pageHead(title, backLabel, onBack) {
    return h('div', { class: 'a-head' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } },
        backLabel ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: onBack }, icon('chev-l'), backLabel) : null,
        h('h2', { class: 'a-head__title', tabindex: '-1', text: title })
      )
    );
  }

  /* Borrar va al final del formulario, lejos del pulgar y de Guardar */
  function dangerZone(label, text, onDelete) {
    return h('div', { class: 'a-danger' },
      h('p', { class: 'a-hint', text: text }),
      h('button', { type: 'button', class: 'btn a-btn-danger', onclick: onDelete }, icon('trash'), label));
  }

  function focusTitle() {
    const t = $('#panel .a-head__title');
    if (t) t.focus({ preventScroll: false });
  }

  function thumb(url, name) {
    const box = h('span', { class: 'a-row__thumb' });
    if (url) {
      const img = h('img', { src: OF.resolveImg(url), alt: '', width: '112', height: '112', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { mount(box, icon('image')); });
      box.append(img);
    } else if (name) {
      box.append(h('span', { style: { fontFamily: 'var(--f-display)', fontSize: '1.4rem', color: 'var(--texto)' }, text: String(name).trim().charAt(0).toUpperCase() }));
    } else {
      box.append(icon('image'));
    }
    return box;
  }

  function moveButtons(label, index, total, disabled, onMove) {
    return h('div', { class: 'a-row__actions' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir ' + label, disabled: disabled || index === 0, 'data-move': 'up', onclick: function () { onMove(-1); } }, icon('up')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar ' + label, disabled: disabled || index === total - 1, 'data-move': 'down', onclick: function () { onMove(1); } }, icon('down'))
    );
  }

  /* ========================================================================
     2. Ingreso, recuperación y salida
     ======================================================================== */
  async function boot() {
    initPassToggles();
    initAuthForms();
    initTabs();
    window.addEventListener('beforeunload', function (e) { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      showView('login');
      setMsg($('#login-error'), 'No pudimos conectar con el servidor. Revisá internet y recargá la página.');
      $('#login-submit').disabled = true;
      return;
    }

    const recovering = /type=recovery/.test(location.hash + location.search);
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') {
        showView('recovery');
        setTimeout(function () { $('#new-pass').focus(); }, 50);
      } else if (event === 'SIGNED_OUT') {
        A.user = null;
        setDirty(false);
        showView('login');
      }
    });

    let session = null;
    try {
      const res = await OF.withTimeout(sb.auth.getSession(), 12000, 'timeout');
      session = res.data && res.data.session;
    } catch (err) {
      showView('login');
      setMsg($('#login-error'), errMsg(err));
      return;
    }
    if (recovering) { showView('recovery'); $('#new-pass').focus(); return; }
    if (session) await enter(session.user);
    else { showView('login'); $('#login-email').focus(); }
  }

  /* Verifica que la cuenta sea admin antes de mostrar el panel */
  async function enter(user) {
    showView('boot');
    let res;
    try {
      res = await OF.withTimeout(sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle(), 12000, 'timeout');
    } catch (err) {
      res = { error: err };
    }
    if (res.error) {
      showView('login');
      setMsg($('#login-error'), 'No pudimos verificar tus permisos. ' + errMsg(res.error));
      return;
    }
    if (!res.data) {
      await sb.auth.signOut();
      showView('login');
      setMsg($('#login-error'), 'Esta cuenta no tiene permisos.');
      return;
    }
    A.user = user;
    $('#who').textContent = user.email || '';
    showView('app');
    const fromHash = location.hash.slice(1);
    selectTab(TABS.indexOf(fromHash) !== -1 ? fromHash : 'turnos', { force: true, focus: false });
    loadAll();
  }

  function initPassToggles() {
    $$('[data-toggle-pass]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const input = document.getElementById(btn.getAttribute('data-toggle-pass'));
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(show));
        btn.textContent = show ? 'Ocultar' : 'Mostrar';
      });
    });
  }

  function initAuthForms() {
    const loginForm = $('#login-form'), forgotForm = $('#forgot-form');

    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const err = $('#login-error');
      const email = $('#login-email').value.trim(), pass = $('#login-pass').value;
      if (!email || !pass) { setMsg(err, 'Escribí tu email y tu contraseña.'); (email ? $('#login-pass') : $('#login-email')).focus(); return; }
      setMsg(err, '');
      const btn = $('#login-submit');
      busy(btn, true, 'Entrando…');
      try {
        const res = await OF.withTimeout(sb.auth.signInWithPassword({ email: email, password: pass }), 15000, 'timeout');
        if (res.error) { setMsg(err, errMsg(res.error)); $('#login-pass').select(); return; }
        $('#login-pass').value = '';
        await enter(res.data.user);
      } catch (ex) {
        setMsg(err, errMsg(ex));
      } finally {
        busy(btn, false);
      }
    });

    $('#forgot-open').addEventListener('click', function () {
      loginForm.hidden = true;
      $('#forgot-open').hidden = true;
      forgotForm.hidden = false;
      $('#forgot-email').value = $('#login-email').value.trim();
      setMsg($('#forgot-msg'), '');
      $('#forgot-email').focus();
    });
    $('#forgot-back').addEventListener('click', function () {
      forgotForm.hidden = true;
      loginForm.hidden = false;
      $('#forgot-open').hidden = false;
      $('#login-email').focus();
    });

    forgotForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const msg = $('#forgot-msg');
      const email = $('#forgot-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg(msg, 'Escribí un email válido.'); $('#forgot-email').focus(); return; }
      const btn = $('#forgot-submit');
      busy(btn, true, 'Enviando…');
      try {
        const res = await OF.withTimeout(sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('admin.html', location.href).href }), 15000, 'timeout');
        if (res.error) setMsg(msg, errMsg(res.error));
        else setMsg(msg, 'Listo. Si el email está registrado, te llegó un link para crear una contraseña nueva. Revisá también el correo no deseado.', 'ok');
      } catch (ex) {
        setMsg(msg, errMsg(ex));
      } finally {
        busy(btn, false);
      }
    });

    $('#recovery-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const err = $('#recovery-error');
      const p1 = $('#new-pass').value, p2 = $('#new-pass-2').value;
      if (p1.length < 8) { setMsg(err, 'La contraseña tiene que tener al menos 8 caracteres.'); $('#new-pass').focus(); return; }
      if (p1 !== p2) { setMsg(err, 'Las dos contraseñas no coinciden.'); $('#new-pass-2').focus(); return; }
      const btn = $('#recovery-submit');
      busy(btn, true, 'Guardando…');
      try {
        const res = await OF.withTimeout(sb.auth.updateUser({ password: p1 }), 15000, 'timeout');
        if (res.error) { setMsg(err, errMsg(res.error)); return; }
        history.replaceState(null, '', location.pathname);
        $('#new-pass').value = ''; $('#new-pass-2').value = '';
        status.ok('Contraseña actualizada ✓');
        await enter(res.data.user);
      } catch (ex) {
        setMsg(err, errMsg(ex));
      } finally {
        busy(btn, false);
      }
    });

    $('#logout').addEventListener('click', async function () {
      if (!(await confirmDiscard())) return;
      setDirty(false);
      await sb.auth.signOut();
      showView('login');
      $('#login-email').focus();
    });
  }

  /* ========================================================================
     3. Pestañas y datos
     ======================================================================== */
  function initTabs() {
    const list = $('#tabs');
    list.addEventListener('scroll', tabsEdge, { passive: true });
    window.addEventListener('resize', tabsEdge);
    $$('[role="tab"]', list).forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab.dataset.tab); });
    });
    // Flechas, Inicio y Fin para moverse entre pestañas
    list.addEventListener('keydown', function (e) {
      const tabs = $$('[role="tab"]', list);
      const i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      tabs[j].focus();
      selectTab(tabs[j].dataset.tab, { focus: false });
    });
  }

  async function selectTab(tab, opts) {
    opts = opts || {};
    if (!opts.force && tab === A.tab && A.mode === 'list') return;
    if (!(await confirmDiscard())) { syncTabs(); return; }
    setDirty(false);
    A.tab = tab;
    A.mode = 'list';
    A.form = null;
    A.filter = { search: '', cat: '' };
    history.replaceState(null, '', '#' + tab);
    syncTabs();
    render();
    if (opts.focus !== false) focusTitle();
  }

  function syncTabs() {
    $$('#tabs [role="tab"]').forEach(function (t) {
      const on = t.dataset.tab === A.tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $('#panel').setAttribute('aria-labelledby', 'tab-' + A.tab);
    // En el celu las pestañas se deslizan: la elegida siempre queda a la vista
    const list = $('#tabs'), sel = $('#tab-' + A.tab);
    if (sel && list.scrollWidth > list.clientWidth) {
      const left = sel.offsetLeft - list.offsetLeft, right = left + sel.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = left - 16;
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 16;
    }
    tabsEdge();
  }

  /* Difumina el borde derecho mientras haya pestañas escondidas */
  function tabsEdge() {
    const list = $('#tabs');
    const more = list.scrollLeft + list.clientWidth < list.scrollWidth - 2;
    if (more) list.setAttribute('data-more', ''); else list.removeAttribute('data-more');
  }

  const QUERIES = {
    products: function () { return sb.from('products').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }); },
    services: function () { return sb.from('services').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }); },
    barbers: function () { return sb.from('barbers').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }); },
    hours: function () { return sb.from('business_hours').select('*').order('day_of_week', { ascending: true }); },
    blocked: function () {
      return sb.from('blocked_slots').select('*').gte('day', OF.arNow().key)
        .order('day', { ascending: true }).order('start_time', { ascending: true });
    }
  };

  function loadAll() { Object.keys(QUERIES).forEach(load); }

  function tabUses(key) { return TAB_NEEDS[A.tab].indexOf(key) !== -1 && A.mode === 'list'; }

  async function load(key) {
    A.loaded[key] = 'loading';
    if (tabUses(key)) render();
    try {
      const res = await OF.withTimeout(QUERIES[key](), 15000, 'timeout');
      if (res.error) throw res.error;
      A.data[key] = res.data || [];
      A.loaded[key] = 'ok';
    } catch (err) {
      A.loaded[key] = 'error';
      A.errors[key] = errMsg(err);
    }
    if (tabUses(key)) render();
  }

  function render() {
    const panel = $('#panel');
    if (A.mode === 'form') return;
    const needs = TAB_NEEDS[A.tab];
    const failed = needs.find(function (k) { return A.loaded[k] === 'error'; });
    const pending = needs.find(function (k) { return A.loaded[k] !== 'ok'; });
    const key = failed || pending;
    if (key) {
      if (failed) {
        mount(panel, h('div', { class: 'a-empty', role: 'alert' },
          h('p', { text: 'No pudimos cargar los datos. ' + A.errors[key] }),
          h('button', { type: 'button', class: 'btn btn--lens', onclick: function () { needs.forEach(function (k) { if (A.loaded[k] === 'error') load(k); }); } }, 'Reintentar')));
      } else {
        mount(panel, h('div', { 'aria-busy': 'true' },
          h('span', { class: 'skel', style: { height: '2rem', width: '40%' } }),
          h('div', { style: { display: 'grid', gap: '1px', marginTop: '1.5rem' } },
            [0, 1, 2].map(function () { return h('span', { class: 'skel', style: { height: '4.5rem', borderRadius: '0' } }); }))));
      }
      return;
    }
    ({ turnos: turnosView, productos: productsList, servicios: servicesList, barberos: barbersList, horarios: hoursForm })[A.tab]();
  }

  /* Reordenar: intercambia y renumera sort_order (10, 20, 30...) */
  async function move(key, index, dir) {
    const list = A.data[key];
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[index]; list[index] = list[j]; list[j] = tmp;
    const updates = [];
    list.forEach(function (item, i) {
      const so = (i + 1) * 10;
      if (item.sort_order !== so) { item.sort_order = so; updates.push({ id: item.id, sort_order: so }); }
    });
    render();
    // El foco sigue al elemento que se movió
    const rows = $$('#panel .a-row');
    const row = rows[j];
    if (row) {
      const btn = $('[data-move="' + (dir < 0 ? 'up' : 'down') + '"]', row);
      (btn && !btn.disabled ? btn : $('[data-move]:not([disabled])', row) || $('.a-row__open', row)).focus();
    }
    status.saving('Guardando el orden…');
    try {
      const results = await Promise.all(updates.map(function (u) {
        return sb.from(TABLE[key]).update({ sort_order: u.sort_order }).eq('id', u.id);
      }));
      const bad = results.find(function (r) { return r.error; });
      if (bad) throw bad.error;
      status.ok('Orden guardado ✓');
    } catch (err) {
      status.error('No se guardó el orden. ' + errMsg(err));
      load(key);
    }
  }

  /* ========================================================================
     4. Fotos: achicar, pasar a WEBP y subir con progreso
     ======================================================================== */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No pudimos leer esa foto. Probá con JPG o PNG (en iPhone, compartila como "Más compatible").')); };
      img.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  async function processImage(file) {
    if (file.type && file.type.indexOf('image/') !== 0) throw new Error('Ese archivo no es una foto.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('La foto es demasiado pesada (más de 30 MB).');
    const loaded = await loadImage(file);
    const img = loaded.img;
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, hgt);
    URL.revokeObjectURL(loaded.url);

    let type = 'image/webp', ext = 'webp';
    let blob = await canvasBlob(canvas, type, 0.82);
    if (!blob || blob.type !== 'image/webp') {
      // Navegadores viejos que no exportan WEBP: JPG sobre fondo blanco
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = hgt;
      const x2 = c2.getContext('2d');
      x2.fillStyle = '#ffffff'; x2.fillRect(0, 0, w, hgt);
      x2.drawImage(canvas, 0, 0);
      type = 'image/jpeg'; ext = 'jpg';
      blob = await canvasBlob(c2, type, 0.85);
    }
    let q = 0.72;
    while (blob && blob.size > MAX_BYTES && q >= 0.4) {
      blob = await canvasBlob(canvas, type, q);
      q -= 0.12;
    }
    if (!blob) throw new Error('No pudimos preparar la foto. Probá con otra.');
    if (blob.size > MAX_BYTES) throw new Error('La foto pesa más de 5 MB incluso achicada. Probá con otra.');
    return { blob: blob, ext: ext };
  }

  /* Subida directa a Storage con XHR para tener progreso real */
  async function uploadBlob(path, blob, onProgress) {
    const res = await sb.auth.getSession();
    const token = res.data && res.data.session && res.data.session.access_token;
    if (!token) throw new Error('JWT expired');
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', C.SUPABASE_URL + '/storage/v1/object/' + C.BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'));
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', C.SUPABASE_KEY);
      xhr.setRequestHeader('Content-Type', blob.type);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(OF.publicUrl(path)); return; }
        let msg = 'HTTP ' + xhr.status;
        try { const j = JSON.parse(xhr.responseText); msg = (j.message || j.error || msg) + ' ' + xhr.status; } catch (e) { /* sin cuerpo */ }
        reject(new Error(msg));
      };
      xhr.onerror = function () { reject(new Error('network')); };
      xhr.send(blob);
    });
  }

  /* Borra del bucket las fotos que ya no se usan (si falla, no bloquea nada) */
  async function removeFromBucket(urls) {
    const paths = (urls || []).map(OF.bucketPath).filter(Boolean);
    if (!paths.length) return;
    try {
      const res = await sb.storage.from(C.BUCKET).remove(paths);
      if (res.error || (res.data && res.data.length < paths.length)) {
        console.warn('[ORIGINALFADE] No se pudieron borrar todas las fotos del bucket:', paths);
      }
    } catch (err) {
      console.warn('[ORIGINALFADE] Error al borrar fotos del bucket:', err);
    }
  }

  /* Cola de subida para un formulario: procesa de a una foto */
  function enqueueUploads(files, folder, onChange) {
    const form = A.form;
    Array.from(files).forEach(function (file) {
      const item = { id: OF.uuid(), name: file.name, preview: URL.createObjectURL(file), progress: 0, state: 'waiting', error: '', file: file, folder: folder };
      form.uploads.push(item);
    });
    onChange();
    runQueue(onChange);
  }

  let queueRunning = false;
  async function runQueue(onChange) {
    if (queueRunning) return;
    queueRunning = true;
    const form = A.form;
    try {
      let item;
      while (form === A.form && (item = form.uploads.find(function (u) { return u.state === 'waiting'; }))) {
        item.state = 'processing';
        onChange(item);
        try {
          const out = await processImage(item.file);
          item.progress = 0.1; item.state = 'uploading'; onChange(item);
          const path = item.folder + '/' + OF.uuid() + '.' + out.ext;
          const url = await uploadBlob(path, out.blob, function (p) { item.progress = 0.1 + p * 0.9; onChange(item, true); });
          if (form !== A.form) { removeFromBucket([url]); break; } // se cerró el formulario mientras subía
          form.added.push(url);
          form.onUploaded(url);
          URL.revokeObjectURL(item.preview);
          form.uploads = form.uploads.filter(function (u) { return u !== item; });
          setDirty(true);
          onChange();
        } catch (err) {
          item.state = 'error';
          item.error = err && err.message && err.message.indexOf(' ') !== -1 && !/HTTP|network|JWT/i.test(err.message) ? err.message : errMsg(err);
          onChange(item);
        }
      }
    } finally {
      queueRunning = false;
    }
  }

  function uploadItem(item, onRemove) {
    const pct = Math.round(item.progress * 100);
    const label = item.state === 'waiting' ? 'En espera' : item.state === 'processing' ? 'Preparando…' : item.state === 'uploading' ? 'Subiendo ' + pct + '%' : item.error;
    return h('li', { class: 'a-photo', 'data-upload': item.id },
      h('img', { src: item.preview, alt: '', style: { opacity: item.state === 'error' ? '0.35' : '0.6' } }),
      h('div', { style: { padding: '0.4rem 0.5rem', display: 'grid', gap: '0.3rem', background: 'var(--tinta-3)' } },
        item.state === 'error' ? null : h('progress', { class: 'a-progress', max: '100', value: String(pct), 'aria-label': 'Progreso de ' + item.name }),
        h('p', { class: 'a-hint', style: { color: item.state === 'error' ? 'var(--error)' : null }, role: item.state === 'error' ? 'alert' : null, text: label }),
        item.state === 'error' ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: onRemove }, 'Quitar') : null
      )
    );
  }

  /* ========================================================================
     5. Productos
     ======================================================================== */
  function categories() {
    const out = [];
    A.data.products.forEach(function (p) { const c = (p.category || '').trim(); if (c && out.indexOf(c) === -1) out.push(c); });
    return out.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  }

  function productsList() {
    const all = A.data.products;
    const panel = $('#panel');
    const cats = categories();
    const listBox = h('div');

    const search = h('input', {
      class: 'input', type: 'search', id: 'p-search', placeholder: 'Buscar por nombre', 'aria-label': 'Buscar productos', value: A.filter.search,
      oninput: function (e) { A.filter.search = e.target.value; drawRows(); }
    });
    const catSel = h('select', {
      class: 'input', id: 'p-cat', 'aria-label': 'Filtrar por categoría',
      onchange: function (e) { A.filter.cat = e.target.value; drawRows(); }
    }, h('option', { value: '', text: 'Todas las categorías' }), cats.map(function (c) { return h('option', { value: c, text: c, selected: A.filter.cat === c }); }));

    function drawRows() {
      const q = A.filter.search.trim().toLowerCase();
      const filtering = !!(q || A.filter.cat);
      const list = all.filter(function (p) {
        return (!q || String(p.name).toLowerCase().indexOf(q) !== -1 || String(p.category || '').toLowerCase().indexOf(q) !== -1) &&
          (!A.filter.cat || (p.category || '').trim() === A.filter.cat);
      });
      if (!all.length) {
        mount(listBox, h('div', { class: 'a-empty' },
          h('p', { text: 'Todavía no cargaste productos. Cuando cargues el primero, aparece en la tienda de la web.' }),
          h('button', { type: 'button', class: 'btn btn--lens', onclick: function () { openProduct(null); } }, icon('plus'), 'Cargar el primero')));
        return;
      }
      if (!list.length) { mount(listBox, h('div', { class: 'a-empty' }, h('p', { text: 'No hay productos que coincidan con la búsqueda.' }))); return; }
      mount(listBox,
        filtering ? h('p', { class: 'a-hint', style: { marginBottom: '0.5rem' }, text: 'Para cambiar el orden, borrá la búsqueda y el filtro.' }) : null,
        h('ul', { class: 'a-list' }, list.map(function (p) {
          const index = all.indexOf(p);
          return h('li', { class: 'a-row' },
            thumb((p.images || [])[0], null),
            h('div', { class: 'a-row__main' },
              h('button', { type: 'button', class: 'a-row__open', onclick: function () { openProduct(p.id); }, text: p.name }),
              h('p', { class: 'a-row__meta', text: (p.category || 'Otros') + ' · ' + (Number(p.price) > 0 ? money(p.price) : 'Sin precio') }),
              (!p.visible || !p.in_stock) ? h('div', { class: 'a-badges' },
                !p.visible ? h('span', { class: 'a-badge a-badge--warn', text: 'Oculto' }) : null,
                !p.in_stock ? h('span', { class: 'a-badge a-badge--error', text: 'Sin stock' }) : null) : null
            ),
            moveButtons(p.name, index, all.length, filtering, function (dir) { move('products', index, dir); })
          );
        }))
      );
    }

    mount(panel,
      h('div', { class: 'a-head' },
        h('h2', { class: 'a-head__title', tabindex: '-1', text: 'Productos (' + all.length + ')' }),
        h('button', { type: 'button', class: 'btn btn--lens', onclick: function () { openProduct(null); } }, icon('plus'), 'Nuevo producto')
      ),
      all.length ? h('div', { class: 'a-toolbar' }, search, cats.length > 1 ? catSel : null) : null,
      listBox
    );
    drawRows();
  }

  function openProduct(id) {
    const p = id ? A.data.products.find(function (x) { return x.id === id; }) : null;
    A.mode = 'form';
    A.form = {
      kind: 'product',
      id: p ? p.id : null,
      name: p ? p.name : '',
      description: p ? (p.description || '') : '',
      category: p ? (p.category || 'Otros') : (categories()[0] || 'Otros'),
      newCategory: '',
      price: p ? String(p.price || '') : '',
      sizes: p ? (p.sizes || []).slice() : [],
      images: p ? (p.images || []).slice() : [],
      in_stock: p ? p.in_stock : true,
      visible: p ? p.visible : true,
      uploads: [], added: [], removed: [],
      onUploaded: function (url) { A.form.images.push(url); }
    };
    setDirty(false);
    productForm();
    focusTitle();
  }

  function productForm() {
    const f = A.form;
    const panel = $('#panel');
    const err = h('p', { class: 'a-form-error', role: 'alert' });
    const cats = categories();
    if (cats.indexOf('Otros') === -1) cats.push('Otros');
    if (f.category && f.category !== '__new' && cats.indexOf(f.category) === -1) cats.push(f.category);

    const name = h('input', { class: 'input', id: 'pf-name', type: 'text', maxlength: '120', required: true, value: f.name, autocomplete: 'off',
      oninput: function (e) { f.name = e.target.value; setDirty(true); } });
    const desc = h('textarea', { class: 'input', id: 'pf-desc', rows: '4', maxlength: '1200',
      oninput: function (e) { f.description = e.target.value; setDirty(true); } });
    desc.value = f.description;

    const newCat = h('input', { class: 'input', id: 'pf-newcat', type: 'text', maxlength: '40', placeholder: 'Ej: Gorras', value: f.newCategory,
      oninput: function (e) { f.newCategory = e.target.value; setDirty(true); } });
    const newCatField = field('Nombre de la categoría nueva', newCat);
    newCatField.hidden = f.category !== '__new';
    const cat = h('select', { class: 'input', id: 'pf-cat',
      onchange: function (e) { f.category = e.target.value; newCatField.hidden = f.category !== '__new'; setDirty(true); if (f.category === '__new') newCat.focus(); }
    }, cats.map(function (c) { return h('option', { value: c, text: c, selected: f.category === c }); }),
      h('option', { value: '__new', text: '+ Nueva categoría…', selected: f.category === '__new' }));

    const pricePreview = h('p', { class: 'a-hint', id: 'pf-price-hint' });
    const updatePrice = function () { const n = OF.parsePrice(f.price); pricePreview.textContent = n > 0 ? 'Se ve así en la web: ' + money(n) : 'Sin precio: en la web dice "a consultar".'; };
    const price = h('input', { class: 'input', id: 'pf-price', type: 'text', inputmode: 'numeric', placeholder: 'Ej: 25000', value: f.price, 'aria-describedby': 'pf-price-hint',
      oninput: function (e) { f.price = e.target.value; updatePrice(); setDirty(true); } });
    updatePrice();

    /* Talles */
    const sizesBox = h('div');
    const sizeInput = h('input', { class: 'input', id: 'pf-size', type: 'text', maxlength: '12', placeholder: 'Ej: 42 o M', style: { flex: '1 1 8rem' },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); addSize(sizeInput.value); } } });
    function addSize(v) {
      const s = String(v || '').trim();
      if (!s) return;
      if (f.sizes.some(function (x) { return x.toLowerCase() === s.toLowerCase(); })) { sizeInput.value = ''; return; }
      f.sizes.push(s); sizeInput.value = ''; setDirty(true); drawSizes(); sizeInput.focus();
    }
    function drawSizes() {
      mount(sizesBox,
        f.sizes.length
          ? h('ul', { class: 'a-chips', 'aria-label': 'Talles cargados' }, f.sizes.map(function (s, i) {
            return h('li', { class: 'a-chip' }, s,
              h('button', { type: 'button', 'aria-label': 'Quitar talle ' + s, onclick: function () { f.sizes.splice(i, 1); setDirty(true); drawSizes(); sizeInput.focus(); } }, icon('close')));
          }))
          : h('p', { class: 'a-hint', text: 'Sin talles: en la web se agrega directo al carrito.' })
      );
    }
    drawSizes();
    const sizesField = h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'pf-size', text: 'Talles' }),
      sizesBox,
      h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
        sizeInput,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () { addSize(sizeInput.value); } }, 'Agregar')),
      h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
          ['S', 'M', 'L', 'XL', 'XXL'].forEach(function (s) { if (!f.sizes.some(function (x) { return x.toLowerCase() === s.toLowerCase(); })) f.sizes.push(s); });
          setDirty(true); drawSizes();
        } }, 'S M L XL XXL'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () { f.sizes = ['Único']; setDirty(true); drawSizes(); } }, 'Talle único'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () { f.sizes = []; setDirty(true); drawSizes(); } }, 'Sin talles'))
    );

    /* Fotos */
    const photosBox = h('div');
    function drawPhotos(item, onlyProgress) {
      if (onlyProgress && item) {
        const li = $('[data-upload="' + item.id + '"]', photosBox);
        if (li) { li.replaceWith(uploadItem(item, function () { f.uploads = f.uploads.filter(function (u) { return u !== item; }); drawPhotos(); })); return; }
      }
      const total = f.images.length;
      mount(photosBox,
        (total || f.uploads.length) ? h('ul', { class: 'a-photos', 'aria-label': 'Fotos del producto' },
          f.images.map(function (url, i) {
            const label = 'foto ' + (i + 1);
            return h('li', { class: 'a-photo' },
              h('img', { src: OF.resolveImg(url), alt: (i === 0 ? 'Foto principal' : 'Foto ' + (i + 1)) + ' de ' + (f.name || 'el producto'), loading: 'lazy' }),
              i === 0 ? h('span', { class: 'a-photo__main', text: 'Principal' }) : null,
              h('div', { class: 'a-photo__actions' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mover ' + label + ' antes', disabled: i === 0, onclick: function () { swap(i, i - 1); } }, icon('chev-l')),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hacer principal la ' + label, disabled: i === 0, onclick: function () { const u = f.images.splice(i, 1)[0]; f.images.unshift(u); setDirty(true); drawPhotos(); } }, icon('star')),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mover ' + label + ' después', disabled: i === total - 1, onclick: function () { swap(i, i + 1); } }, icon('chev-r')),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar ' + label, onclick: function () {
                  const u = f.images.splice(i, 1)[0];
                  if (f.added.indexOf(u) !== -1) { f.added = f.added.filter(function (x) { return x !== u; }); removeFromBucket([u]); }
                  else f.removed.push(u);
                  setDirty(true); drawPhotos();
                } }, icon('trash'))
              )
            );
          }),
          f.uploads.map(function (item) { return uploadItem(item, function () { f.uploads = f.uploads.filter(function (u) { return u !== item; }); drawPhotos(); }); })
        ) : h('p', { class: 'a-hint', text: 'Todavía no hay fotos. La primera que subas es la principal.' })
      );
    }
    function swap(a, b) { const t = f.images[a]; f.images[a] = f.images[b]; f.images[b] = t; setDirty(true); drawPhotos(); }
    drawPhotos();
    const fileInput = h('input', { type: 'file', id: 'pf-files', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*', multiple: true, class: 'sr-only',
      onchange: function (e) { if (e.target.files.length) enqueueUploads(e.target.files, 'productos', drawPhotos); e.target.value = ''; } });
    const photosField = h('div', { class: 'field' },
      h('span', { class: 'field__label', text: 'Fotos' }),
      photosBox,
      h('div', null,
        h('label', { class: 'btn btn--ghost', for: 'pf-files', tabindex: '0', role: 'button',
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, icon('upload'), 'Agregar fotos'),
        fileInput),
      h('p', { class: 'a-hint', text: 'Podés elegir varias a la vez, desde el celu o la compu. Se achican y se guardan solas.' })
    );

    const form = h('form', { class: 'a-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); saveProduct(err); },
        oninput: function () { if (err.textContent) setMsg(err, ''); } },
      field('Nombre', name),
      field('Descripción', desc, { optional: true }),
      h('div', { class: 'a-form__grid a-form__grid--2' },
        h('div', { class: 'a-stack' }, field('Categoría', cat), newCatField),
        field('Precio (en pesos)', price, { hint: pricePreview })),
      sizesField,
      photosField,
      h('div', { class: 'a-stack' },
        switchField('pf-stock', 'Disponible', 'Si lo apagás, en la web dice "Sin stock" y no se puede agregar al carrito.', f.in_stock, function (v) { f.in_stock = v; }),
        switchField('pf-visible', 'Visible en la web', 'Si lo apagás, el producto no aparece en la tienda.', f.visible, function (v) { f.visible = v; })),
      err,
      h('div', { class: 'a-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: cancelForm }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn--lens', id: 'pf-save' }, 'Guardar')
      )
    );

    mount(panel, pageHead(f.id ? 'Editar producto' : 'Nuevo producto', 'Productos', cancelForm), form,
      f.id ? dangerZone('Borrar producto', 'Se borra de la tienda junto con sus fotos. No se puede deshacer.', function () { deleteProduct(f.id); }) : null);
  }

  async function saveProduct(errEl) {
    const f = A.form;
    const name = f.name.trim();
    const category = f.category === '__new' ? f.newCategory.trim() : f.category;
    setMsg(errEl, '');
    if (name.length < 2) { setMsg(errEl, 'Escribí el nombre del producto.'); $('#pf-name').focus(); return; }
    if (!category) { setMsg(errEl, 'Escribí el nombre de la categoría nueva.'); $('#pf-newcat').focus(); return; }
    if (f.uploads.some(function (u) { return u.state !== 'error'; })) { setMsg(errEl, 'Esperá a que terminen de subir las fotos.'); return; }
    const payload = {
      name: name,
      description: f.description.trim(),
      category: category,
      price: OF.parsePrice(f.price),
      sizes: f.sizes,
      images: f.images,
      in_stock: !!f.in_stock,
      visible: !!f.visible,
      updated_at: new Date().toISOString()
    };
    const btn = $('#pf-save');
    busy(btn, true, 'Guardando…');
    status.saving();
    try {
      let res;
      if (f.id) {
        res = await sb.from('products').update(payload).eq('id', f.id).select().single();
      } else {
        const max = A.data.products.reduce(function (m, p) { return Math.max(m, p.sort_order || 0); }, 0);
        payload.sort_order = max + 10;
        res = await sb.from('products').insert(payload).select().single();
      }
      if (res.error) throw res.error;
      const saved = res.data;
      const i = A.data.products.findIndex(function (p) { return p.id === saved.id; });
      if (i === -1) A.data.products.push(saved); else A.data.products[i] = saved;
      removeFromBucket(f.removed);
      setDirty(false);
      status.ok('Producto guardado ✓');
      backToList(saved.id);
    } catch (err) {
      setMsg(errEl, 'No se guardó. ' + errMsg(err));
      status.error('No se guardó el producto.');
    } finally {
      if (btn.isConnected) busy(btn, false);
    }
  }

  async function deleteProduct(id) {
    const p = A.data.products.find(function (x) { return x.id === id; });
    if (!p) return;
    const ok = await confirmDialog({ title: '¿Borrar "' + p.name + '"?', text: 'Se borra de la tienda junto con sus fotos. No se puede deshacer.' });
    if (!ok) return;
    status.saving('Borrando…');
    const res = await sb.from('products').delete().eq('id', id);
    if (res.error) { status.error('No se borró. ' + errMsg(res.error)); return; }
    removeFromBucket((p.images || []).concat(A.form ? A.form.added : []));
    A.data.products = A.data.products.filter(function (x) { return x.id !== id; });
    setDirty(false);
    status.ok('Producto borrado');
    backToList();
  }

  /* Cancelar: descarta lo subido en este formulario que no se guardó */
  async function cancelForm() {
    if (!(await confirmDiscard())) return;
    if (A.form) {
      removeFromBucket(A.form.added);
      A.form.uploads.forEach(function (u) { URL.revokeObjectURL(u.preview); });
    }
    setDirty(false);
    backToList();
  }

  function backToList(focusId) {
    A.mode = 'list';
    A.form = null;
    render();
    const target = focusId ? $$('#panel .a-row__open').find(function (b) { return b.textContent === ((A.data.products.concat(A.data.services, A.data.barbers).find(function (x) { return x.id === focusId; }) || {}).name); }) : null;
    if (target) target.focus(); else focusTitle();
  }

  /* ========================================================================
     6. Servicios
     ======================================================================== */
  function servicesList() {
    const all = A.data.services;
    mount($('#panel'),
      h('div', { class: 'a-head' },
        h('h2', { class: 'a-head__title', tabindex: '-1', text: 'Servicios (' + all.length + ')' }),
        h('button', { type: 'button', class: 'btn btn--lens', onclick: function () { openService(null); } }, icon('plus'), 'Nuevo servicio')),
      all.length ? h('ul', { class: 'a-list' }, all.map(function (s, index) {
        return h('li', { class: 'a-row' },
          thumb(null, s.name),
          h('div', { class: 'a-row__main' },
            h('button', { type: 'button', class: 'a-row__open', onclick: function () { openService(s.id); }, text: s.name }),
            h('p', { class: 'a-row__meta', text: s.duration_min + ' min · ' + (Number(s.price) > 0 ? money(s.price) : 'Sin precio') }),
            !s.active ? h('div', { class: 'a-badges' }, h('span', { class: 'a-badge a-badge--warn', text: 'Oculto' })) : null),
          moveButtons(s.name, index, all.length, false, function (dir) { move('services', index, dir); }));
      })) : h('div', { class: 'a-empty' }, h('p', { text: 'No hay servicios cargados. Sin servicios, la web no puede tomar turnos.' }))
    );
  }

  function openService(id) {
    const s = id ? A.data.services.find(function (x) { return x.id === id; }) : null;
    A.mode = 'form';
    A.form = {
      kind: 'service', id: s ? s.id : null,
      name: s ? s.name : '', description: s ? (s.description || '') : '',
      duration: s ? String(s.duration_min) : '45', price: s ? String(s.price || '') : '',
      active: s ? s.active : true,
      uploads: [], added: [], removed: []
    };
    setDirty(false);
    serviceForm();
    focusTitle();
  }

  function serviceForm() {
    const f = A.form;
    const err = h('p', { class: 'a-form-error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'sf-name', type: 'text', maxlength: '80', value: f.name, oninput: function (e) { f.name = e.target.value; setDirty(true); } });
    const desc = h('textarea', { class: 'input', id: 'sf-desc', rows: '3', maxlength: '400', oninput: function (e) { f.description = e.target.value; setDirty(true); } });
    desc.value = f.description;
    const dur = h('input', { class: 'input', id: 'sf-dur', type: 'number', inputmode: 'numeric', min: '5', max: '480', step: '5', value: f.duration, oninput: function (e) { f.duration = e.target.value; setDirty(true); } });
    const pricePreview = h('p', { class: 'a-hint', id: 'sf-price-hint' });
    const updatePrice = function () { const n = OF.parsePrice(f.price); pricePreview.textContent = n > 0 ? 'Se ve así en la web: ' + money(n) : 'Sin precio: en la web dice "Consultá".'; };
    const price = h('input', { class: 'input', id: 'sf-price', type: 'text', inputmode: 'numeric', placeholder: 'Ej: 23000', value: f.price, 'aria-describedby': 'sf-price-hint',
      oninput: function (e) { f.price = e.target.value; updatePrice(); setDirty(true); } });
    updatePrice();

    mount($('#panel'),
      pageHead(f.id ? 'Editar servicio' : 'Nuevo servicio', 'Servicios', cancelForm),
      h('form', { class: 'a-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); saveService(err); },
        oninput: function () { if (err.textContent) setMsg(err, ''); } },
        field('Nombre', name),
        field('Descripción', desc, { optional: true }),
        h('div', { class: 'a-form__grid a-form__grid--2' },
          field('Duración (minutos)', dur, { hint: 'Con esto se calculan los horarios libres.' }),
          field('Precio (en pesos)', price, { hint: pricePreview })),
        switchField('sf-active', 'Activo', 'Si lo apagás, no aparece en la web ni en los turnos.', f.active, function (v) { f.active = v; }),
        err,
        h('div', { class: 'a-actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: cancelForm }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn btn--lens', id: 'sf-save' }, 'Guardar'))),
      f.id ? dangerZone('Borrar servicio', 'Si solo querés sacarlo un tiempo, mejor apagá "Activo".', function () { deleteSimple('services', f.id, 'Se borra de la web y deja de aparecer en los turnos.'); }) : null
    );
  }

  async function saveService(errEl) {
    const f = A.form;
    setMsg(errEl, '');
    const name = f.name.trim();
    const duration = parseInt(f.duration, 10);
    if (name.length < 2) { setMsg(errEl, 'Escribí el nombre del servicio.'); $('#sf-name').focus(); return; }
    if (!(duration >= 5 && duration <= 480)) { setMsg(errEl, 'La duración tiene que estar entre 5 y 480 minutos.'); $('#sf-dur').focus(); return; }
    const payload = { name: name, description: f.description.trim(), duration_min: duration, price: OF.parsePrice(f.price), active: !!f.active, updated_at: new Date().toISOString() };
    await saveSimple('services', payload, errEl, '#sf-save', 'Servicio guardado ✓');
  }

  /* Guardado genérico (servicios y barberos) */
  async function saveSimple(key, payload, errEl, btnSel, okText) {
    const f = A.form;
    const btn = $(btnSel);
    busy(btn, true, 'Guardando…');
    status.saving();
    try {
      let res;
      if (f.id) res = await sb.from(TABLE[key]).update(payload).eq('id', f.id).select().single();
      else {
        const max = A.data[key].reduce(function (m, x) { return Math.max(m, x.sort_order || 0); }, 0);
        payload.sort_order = max + 10;
        res = await sb.from(TABLE[key]).insert(payload).select().single();
      }
      if (res.error) throw res.error;
      const saved = res.data;
      const i = A.data[key].findIndex(function (x) { return x.id === saved.id; });
      if (i === -1) A.data[key].push(saved); else A.data[key][i] = saved;
      removeFromBucket(f.removed);
      setDirty(false);
      status.ok(okText);
      backToList(saved.id);
    } catch (err) {
      setMsg(errEl, 'No se guardó. ' + errMsg(err));
      status.error('No se guardó.');
    } finally {
      if (btn && btn.isConnected) busy(btn, false);
    }
  }

  async function deleteSimple(key, id, text) {
    const item = A.data[key].find(function (x) { return x.id === id; });
    if (!item) return;
    const ok = await confirmDialog({ title: '¿Borrar "' + item.name + '"?', text: text + ' No se puede deshacer.' });
    if (!ok) return;
    status.saving('Borrando…');
    const res = await sb.from(TABLE[key]).delete().eq('id', id);
    if (res.error) { status.error('No se borró. ' + errMsg(res.error)); return; }
    if (item.photo_url) removeFromBucket([item.photo_url]);
    if (A.form) removeFromBucket(A.form.added);
    A.data[key] = A.data[key].filter(function (x) { return x.id !== id; });
    setDirty(false);
    status.ok('Borrado');
    backToList();
  }

  /* ========================================================================
     7. Barberos
     ======================================================================== */
  function barbersList() {
    const all = A.data.barbers;
    mount($('#panel'),
      h('div', { class: 'a-head' },
        h('h2', { class: 'a-head__title', tabindex: '-1', text: 'Barberos (' + all.length + ')' }),
        h('button', { type: 'button', class: 'btn btn--lens', onclick: function () { openBarber(null); } }, icon('plus'), 'Nuevo barbero')),
      all.length ? h('ul', { class: 'a-list' }, all.map(function (b, index) {
        return h('li', { class: 'a-row' },
          thumb(b.photo_url, b.name),
          h('div', { class: 'a-row__main' },
            h('button', { type: 'button', class: 'a-row__open', onclick: function () { openBarber(b.id); }, text: b.name }),
            b.specialty ? h('p', { class: 'a-row__meta', text: b.specialty }) : null,
            !b.active ? h('div', { class: 'a-badges' }, h('span', { class: 'a-badge a-badge--warn', text: 'Oculto' })) : null),
          moveButtons(b.name, index, all.length, false, function (dir) { move('barbers', index, dir); }));
      })) : h('div', { class: 'a-empty' }, h('p', { text: 'No hay barberos cargados. Sin barberos, la web no puede tomar turnos.' }))
    );
  }

  function openBarber(id) {
    const b = id ? A.data.barbers.find(function (x) { return x.id === id; }) : null;
    A.mode = 'form';
    A.form = {
      kind: 'barber', id: b ? b.id : null,
      name: b ? b.name : '', specialty: b ? (b.specialty || '') : 'Fade, clásico, diseño y navaja',
      photo: b ? (b.photo_url || '') : '', original: b ? (b.photo_url || '') : '',
      active: b ? b.active : true,
      uploads: [], added: [], removed: [],
      onUploaded: function (url) {
        // una sola foto: la anterior (si se había subido recién) se borra
        if (A.form.photo && A.form.added.indexOf(A.form.photo) !== -1 && A.form.photo !== url) { removeFromBucket([A.form.photo]); A.form.added = A.form.added.filter(function (x) { return x !== A.form.photo; }); }
        A.form.photo = url;
      }
    };
    setDirty(false);
    barberForm();
    focusTitle();
  }

  function barberForm() {
    const f = A.form;
    const err = h('p', { class: 'a-form-error', role: 'alert' });
    const name = h('input', { class: 'input', id: 'bf-name', type: 'text', maxlength: '40', value: f.name, oninput: function (e) { f.name = e.target.value; setDirty(true); } });
    const spec = h('input', { class: 'input', id: 'bf-spec', type: 'text', maxlength: '80', value: f.specialty, oninput: function (e) { f.specialty = e.target.value; setDirty(true); } });

    const photoBox = h('div');
    const fileInput = h('input', { type: 'file', id: 'bf-file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*', class: 'sr-only',
      onchange: function (e) { if (e.target.files.length) { f.uploads = []; enqueueUploads([e.target.files[0]], 'barberos', drawPhoto); } e.target.value = ''; } });
    function drawPhoto(item, onlyProgress) {
      if (onlyProgress && item) {
        const li = $('[data-upload="' + item.id + '"]', photoBox);
        if (li) { li.replaceWith(uploadItem(item, function () { f.uploads = []; drawPhoto(); })); return; }
      }
      mount(photoBox,
        h('ul', { class: 'a-photos', style: { maxWidth: '10rem' } },
          f.uploads.length ? f.uploads.map(function (u) { return uploadItem(u, function () { f.uploads = []; drawPhoto(); }); })
            : f.photo ? h('li', { class: 'a-photo' }, h('img', { src: OF.resolveImg(f.photo), alt: 'Foto de ' + (f.name || 'el barbero') }))
              : h('li', { class: 'a-photo', style: { display: 'grid', placeItems: 'center', aspectRatio: '1', color: 'var(--texto-3)' } }, h('span', { text: 'Sin foto' }))),
        h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' } },
          h('label', { class: 'btn btn--ghost btn--sm', for: 'bf-file', tabindex: '0', role: 'button',
            onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, icon('upload'), f.photo ? 'Cambiar foto' : 'Subir foto'),
          f.photo ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: function () {
            if (f.added.indexOf(f.photo) !== -1) { removeFromBucket([f.photo]); f.added = f.added.filter(function (x) { return x !== f.photo; }); }
            else if (f.photo === f.original) f.removed.push(f.photo);
            f.photo = ''; setDirty(true); drawPhoto();
          } }, 'Quitar foto') : null,
          fileInput)
      );
    }
    drawPhoto();

    mount($('#panel'),
      pageHead(f.id ? 'Editar barbero' : 'Nuevo barbero', 'Barberos', cancelForm),
      h('form', { class: 'a-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); saveBarber(err); },
        oninput: function () { if (err.textContent) setMsg(err, ''); } },
        field('Nombre', name),
        field('Especialidad', spec, { optional: true }),
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Foto' }), photoBox,
          h('p', { class: 'a-hint', text: 'Si no hay foto, en la web se muestra la inicial del nombre.' })),
        switchField('bf-active', 'Activo', 'Si lo apagás, no aparece en la web ni se puede elegir para turnos.', f.active, function (v) { f.active = v; }),
        err,
        h('div', { class: 'a-actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: cancelForm }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn btn--lens', id: 'bf-save' }, 'Guardar'))),
      f.id ? dangerZone('Borrar barbero', 'Si solo no está trabajando por un tiempo, mejor apagá "Activo".', function () { deleteSimple('barbers', f.id, 'Se borra de la web y de los turnos.'); }) : null
    );
  }

  async function saveBarber(errEl) {
    const f = A.form;
    setMsg(errEl, '');
    const name = f.name.trim();
    if (name.length < 2) { setMsg(errEl, 'Escribí el nombre del barbero.'); $('#bf-name').focus(); return; }
    if (f.uploads.some(function (u) { return u.state !== 'error'; })) { setMsg(errEl, 'Esperá a que termine de subir la foto.'); return; }
    // si se cambió la foto original del bucket, se borra al guardar
    if (f.original && f.photo !== f.original && f.removed.indexOf(f.original) === -1) f.removed.push(f.original);
    const payload = { name: name, specialty: f.specialty.trim(), photo_url: f.photo || null, active: !!f.active, updated_at: new Date().toISOString() };
    await saveSimple('barbers', payload, errEl, '#bf-save', 'Barbero guardado ✓');
  }

  /* ========================================================================
     8. Turnos: horarios ocupados por barbero
     Cada turno (INTERVALO_MIN) se puede marcar como ocupado. La web no ofrece
     los horarios que se pisan con un bloque ocupado de ese barbero.
     ======================================================================== */
  const SLOT_MIN = C.INTERVALO_MIN;
  const pendingCells = new Set();

  function turnosDays() {
    const now = OF.arNow();
    const out = [];
    for (let i = 0; i < C.DIAS_A_MOSTRAR; i++) out.push(OF.addDays(now.date, i));
    return out;
  }
  function openHours(dow) {
    const r = A.data.hours.find(function (x) { return x.day_of_week === dow; });
    if (!r || r.closed || !r.open_time || !r.close_time) return null;
    const open = OF.toMinutes(hhmm(r.open_time)), close = OF.toMinutes(hhmm(r.close_time));
    return close > open ? { open: open, close: close } : null;
  }
  function cellsOf(hrs) {
    const out = [];
    for (let m = hrs.open; m + SLOT_MIN <= hrs.close; m += SLOT_MIN) out.push(m);
    return out;
  }
  function blockedRows(barberId, dayKey) {
    return A.data.blocked.filter(function (r) { return r.barber_id === barberId && r.day === dayKey; });
  }
  function rowAt(barberId, dayKey, m) {
    return A.data.blocked.find(function (r) { return r.barber_id === barberId && r.day === dayKey && OF.toMinutes(hhmm(r.start_time)) === m; });
  }
  function cellPast(day, m) {
    const now = OF.arNow();
    return day.key === now.key && m + SLOT_MIN <= now.minutes;
  }

  function turnosView(focusSel) {
    const panel = $('#panel');
    const T = A.turnos;
    const barbers = A.data.barbers.filter(function (b) { return b.active; });
    const days = turnosDays();
    if (!barbers.some(function (b) { return b.id === T.barberId; })) T.barberId = barbers.length ? barbers[0].id : null;
    if (!days.some(function (d) { return d.key === T.dayKey; })) {
      const firstOpen = days.find(function (d) { return openHours(d.dow); });
      T.dayKey = (firstOpen || days[0]).key;
    }

    const head = h('div', { class: 'a-head' }, h('h2', { class: 'a-head__title', tabindex: '-1', text: 'Turnos' }));
    const intro = h('p', { class: 'a-muted a-turnos__intro', text: 'Tocá un horario para marcarlo como ocupado: la web deja de ofrecerlo. Tocalo de nuevo para liberarlo.' });
    if (!barbers.length) {
      mount(panel, head, intro, h('div', { class: 'a-empty' }, h('p', { text: 'No hay barberos activos. Cargá o activá uno en la pestaña Barberos.' })));
      return;
    }
    const barber = barbers.find(function (b) { return b.id === T.barberId; });
    const day = days.find(function (d) { return d.key === T.dayKey; });
    const hrs = openHours(day.dow);

    /* Barbero */
    const barberBar = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Barbero' }, barbers.map(function (b) {
      return h('button', {
        type: 'button', class: 'a-seg__btn', 'aria-pressed': String(b.id === T.barberId),
        onclick: function () { T.barberId = b.id; turnosView('.a-seg__btn[aria-pressed="true"]'); }
      }, b.name);
    }));

    /* Días */
    const dayBar = h('div', { class: 'a-days', role: 'group', 'aria-label': 'Día' }, days.map(function (d, i) {
      const dh = openHours(d.dow);
      const n = dh ? blockedRows(T.barberId, d.key).length : 0;
      const full = dh && n >= cellsOf(dh).length;
      const top = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : OF.capitalize(OF.DIAS_CORTOS[d.dow]);
      const info = !dh ? 'Cerrado' : full ? 'Lleno' : n ? n + ' ocup.' : 'Libre';
      const spoken = !dh ? 'cerrado' : full ? 'todo ocupado' : n ? n + (n === 1 ? ' horario ocupado' : ' horarios ocupados') : 'todo libre';
      return h('button', {
        type: 'button', class: 'a-day', 'data-key': d.key, 'aria-pressed': String(d.key === T.dayKey), disabled: !dh,
        'aria-label': OF.capitalize(OF.DIAS[d.dow]) + ' ' + d.day + '/' + (d.month + 1) + ', ' + spoken,
        onclick: function () { T.dayKey = d.key; turnosView('.a-day[aria-pressed="true"]'); }
      },
        h('span', { class: 'a-day__dow', text: top }),
        h('span', { class: 'a-day__num', text: String(d.day) }),
        h('span', { class: 'a-day__info', 'data-busy': n ? '' : null, text: info })
      );
    }));

    /* Horarios del día elegido */
    let body;
    if (!hrs) {
      body = h('div', { class: 'a-empty' }, h('p', { text: 'Ese día la barbería está cerrada. Lo cambiás en la pestaña Horarios.' }));
    } else {
      const cells = cellsOf(hrs);
      const live = cells.filter(function (m) { return !cellPast(day, m); });
      const nBusy = live.filter(function (m) { return rowAt(T.barberId, day.key, m); }).length;
      const groups = [
        { name: 'Mañana', test: function (m) { return m < 12 * 60; } },
        { name: 'Tarde', test: function (m) { return m >= 12 * 60 && m < 18 * 60; } },
        { name: 'Noche', test: function (m) { return m >= 18 * 60; } }
      ];
      const title = OF.capitalize(OF.DIAS[day.dow]) + ' ' + OF.ddmm(day.date) + ' · ' + barber.name;
      body = h('div', { class: 'a-turnos__day' },
        h('div', { class: 'a-turnos__bar' },
          h('div', null,
            h('h3', { class: 'a-turnos__title', text: title }),
            h('p', { class: 'a-hint', role: 'status', text: live.length ? nBusy + (nBusy === 1 ? ' ocupado' : ' ocupados') + ' · ' + (live.length - nBusy) + (live.length - nBusy === 1 ? ' libre' : ' libres') : 'Ya pasaron todos los horarios de hoy.' })
          ),
          h('div', { class: 'a-turnos__bulk' },
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: nBusy === live.length, onclick: function () { occupyAll(day, cells); } }, 'Ocupar todo el día'),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: blockedRows(T.barberId, day.key).length === 0, onclick: function () { freeAll(day, barber); } }, 'Liberar todo el día'))
        ),
        groups.map(function (g) {
          const list = cells.filter(g.test);
          if (!list.length) return null;
          return h('div', { class: 'a-slot-group', role: 'group', 'aria-label': g.name },
            h('p', { class: 'field__label', text: g.name }),
            h('div', { class: 'a-slots' }, list.map(function (m) {
              const busy = !!rowAt(T.barberId, day.key, m);
              const past = cellPast(day, m);
              return h('button', {
                type: 'button', class: 'a-slot', 'data-min': String(m), 'aria-pressed': String(busy), disabled: past,
                'aria-label': OF.fmtMinutes(m) + (past ? ', ya pasó' : busy ? ', ocupado' : ', libre'),
                onclick: function () { toggleCell(day.key, m); }
              },
                h('span', { class: 'a-slot__time', text: OF.fmtMinutes(m) }),
                h('span', { class: 'a-slot__state', text: past ? 'Pasó' : busy ? 'Ocupado' : 'Libre' })
              );
            }))
          );
        }),
        h('p', { class: 'a-hint a-turnos__note', text: 'Cada horario es un turno de ' + C.INTERVALO_MIN + ' minutos. Cuando confirmes un turno por WhatsApp, marcalo acá.' })
      );
    }

    mount(panel, head, intro,
      h('div', { class: 'a-turnos__pick' },
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Barbero' }), barberBar),
        h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Día' }), dayBar)),
      body);

    const sel = $('.a-day[aria-pressed="true"]', panel);
    if (sel) sel.parentNode.scrollLeft = Math.max(0, sel.offsetLeft - sel.parentNode.clientWidth / 2 + sel.offsetWidth / 2);
    if (focusSel) { const el = $(focusSel, panel); if (el) el.focus({ preventScroll: true }); }
  }

  async function toggleCell(dayKey, m) {
    const T = A.turnos, barberId = T.barberId;
    const ck = barberId + '|' + dayKey + '|' + m;
    if (pendingCells.has(ck)) return;
    pendingCells.add(ck);
    const existing = rowAt(barberId, dayKey, m);
    const focus = '.a-slot[data-min="' + m + '"]';
    status.saving();
    let res;
    try {
      if (existing) {
        A.data.blocked = A.data.blocked.filter(function (r) { return r !== existing; });
        turnosView(focus);
        res = await sb.from('blocked_slots').delete().eq('id', existing.id);
      } else {
        const temp = { id: 'tmp-' + OF.uuid(), barber_id: barberId, day: dayKey, start_time: OF.fmtMinutes(m) + ':00' };
        A.data.blocked.push(temp);
        turnosView(focus);
        res = await sb.from('blocked_slots').insert({ barber_id: barberId, day: dayKey, start_time: OF.fmtMinutes(m) }).select().single();
        if (!res.error && res.data) Object.assign(temp, res.data);
      }
    } catch (err) {
      res = { error: err };
    } finally {
      pendingCells.delete(ck);
    }
    if (res.error) {
      status.error('No se guardó. ' + errMsg(res.error));
      await load('blocked');
      return;
    }
    status.ok(existing ? 'Horario liberado ✓' : 'Horario ocupado ✓');
  }

  async function occupyAll(day, cells) {
    const barberId = A.turnos.barberId;
    const rows = cells.filter(function (m) { return !cellPast(day, m) && !rowAt(barberId, day.key, m); })
      .map(function (m) { return { barber_id: barberId, day: day.key, start_time: OF.fmtMinutes(m) }; });
    if (!rows.length) return;
    status.saving();
    const res = await sb.from('blocked_slots').insert(rows).select();
    if (res.error) { status.error('No se guardó. ' + errMsg(res.error)); await load('blocked'); return; }
    A.data.blocked = A.data.blocked.concat(res.data || []);
    turnosView();
    status.ok('Día completo ocupado ✓');
  }

  async function freeAll(day, barber) {
    const ok = await confirmDialog({
      title: '¿Liberar todo el día?',
      text: 'Todos los horarios de ' + barber.name + ' del ' + OF.DIAS[day.dow] + ' ' + OF.ddmm(day.date) + ' vuelven a estar disponibles en la web.',
      ok: 'Liberar', danger: false
    });
    if (!ok) return;
    status.saving();
    const res = await sb.from('blocked_slots').delete().eq('barber_id', barber.id).eq('day', day.key);
    if (res.error) { status.error('No se guardó. ' + errMsg(res.error)); await load('blocked'); return; }
    A.data.blocked = A.data.blocked.filter(function (r) { return !(r.barber_id === barber.id && r.day === day.key); });
    turnosView();
    status.ok('Día liberado ✓');
  }

  /* ========================================================================
     9. Horarios
     ======================================================================== */
  function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }

  function hoursForm() {
    const rows = {};
    for (let d = 0; d < 7; d++) rows[d] = { day_of_week: d, open: '10:00', close: '20:00', closed: true };
    A.data.hours.forEach(function (r) { rows[r.day_of_week] = { day_of_week: r.day_of_week, open: hhmm(r.open_time) || '10:00', close: hhmm(r.close_time) || '20:00', closed: !!r.closed }; });
    const err = h('p', { class: 'a-form-error', role: 'alert' });

    const list = h('div', { class: 'a-hours', role: 'group', 'aria-label': 'Horarios de la semana' }, DAY_ORDER.map(function (d) {
      const r = rows[d];
      const dayName = OF.capitalize(OF.DIAS[d]);
      const open = h('input', { class: 'input', type: 'time', id: 'hf-open-' + d, value: r.open, step: '900', 'aria-label': 'Apertura del ' + OF.DIAS[d], disabled: r.closed,
        oninput: function (e) { r.open = e.target.value; setDirty(true); } });
      const close = h('input', { class: 'input', type: 'time', id: 'hf-close-' + d, value: r.close, step: '900', 'aria-label': 'Cierre del ' + OF.DIAS[d], disabled: r.closed,
        oninput: function (e) { r.close = e.target.value; setDirty(true); } });
      const times = h('div', { class: 'a-hours__times', hidden: r.closed }, open, h('span', { 'aria-hidden': 'true', text: 'a' }), close);
      const closedText = h('p', { class: 'a-hours__closed', hidden: !r.closed, text: 'Cerrado todo el día' });
      return h('div', { class: 'a-hours__row' },
        h('span', { style: { fontWeight: '600' }, text: dayName }),
        switchField('hf-on-' + d, 'Abierto', null, !r.closed, function (v) {
          r.closed = !v; open.disabled = !v; close.disabled = !v; times.hidden = !v; closedText.hidden = v;
        }),
        h('div', { class: 'a-hours__when' }, times, closedText)
      );
    }));

    mount($('#panel'),
      h('div', { class: 'a-head' }, h('h2', { class: 'a-head__title', tabindex: '-1', text: 'Horarios' })),
      h('p', { class: 'a-muted', style: { marginBottom: '1rem' }, text: 'Con estos horarios la web muestra si está abierto y arma los turnos (cada ' + C.INTERVALO_MIN + ' minutos).' }),
      h('form', { class: 'a-form', novalidate: true, onsubmit: function (e) { e.preventDefault(); saveHours(rows, err); },
        oninput: function () { if (err.textContent) setMsg(err, ''); } },
        list,
        err,
        h('div', { class: 'a-actions' }, h('button', { type: 'submit', class: 'btn btn--lens', id: 'hf-save' }, 'Guardar horarios')))
    );
  }

  async function saveHours(rows, errEl) {
    setMsg(errEl, '');
    for (const d of DAY_ORDER) {
      const r = rows[d];
      if (r.closed) continue;
      if (!r.open || !r.close) { setMsg(errEl, 'Completá la apertura y el cierre del ' + OF.DIAS[d] + '.'); $('#hf-open-' + d).focus(); return; }
      if (OF.toMinutes(r.close) <= OF.toMinutes(r.open)) { setMsg(errEl, 'El ' + OF.DIAS[d] + ' cierra antes de abrir: revisá los horarios.'); $('#hf-close-' + d).focus(); return; }
    }
    const now = new Date().toISOString();
    const payload = DAY_ORDER.map(function (d) {
      const r = rows[d];
      return { day_of_week: d, open_time: r.open || null, close_time: r.close || null, closed: !!r.closed, updated_at: now };
    });
    const btn = $('#hf-save');
    busy(btn, true, 'Guardando…');
    status.saving();
    try {
      const res = await sb.from('business_hours').upsert(payload, { onConflict: 'day_of_week' }).select();
      if (res.error) throw res.error;
      A.data.hours = (res.data || payload).slice().sort(function (a, b) { return a.day_of_week - b.day_of_week; });
      setDirty(false);
      status.ok('Horarios guardados ✓');
    } catch (err) {
      setMsg(errEl, 'No se guardaron. ' + errMsg(err));
      status.error('No se guardaron los horarios.');
    } finally {
      busy(btn, false);
    }
  }

  /* ========================================================================
     10. Arranque
     ======================================================================== */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

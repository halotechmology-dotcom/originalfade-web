/* ==========================================================================
   ORIGINALFADE · Configuración general
   Este es el ÚNICO archivo que hace falta tocar para cambiar datos de
   contacto, la conexión a Supabase o las zonas de envío.
   ========================================================================== */

window.OF_CONFIG = Object.freeze({
  /* --- Supabase ----------------------------------------------------------
     La clave "publishable" es pública: está pensada para ir en el navegador.
     La seguridad real la dan las reglas (RLS) configuradas en Supabase. */
  SUPABASE_URL: 'https://nnlagwtasskctaqllhag.supabase.co',
  SUPABASE_KEY: 'sb_publishable_ry2zNNRVdi1dTid3uMC5cw_MX9_F-W6',
  BUCKET: 'fotos',

  /* --- Negocio ----------------------------------------------------------- */
  NOMBRE: 'ORIGINALFADE',
  NOMBRE_LARGO: 'Original Fade · Gallery & Barber Shop',
  DIRECCION: 'Azcuénaga 1850, Recoleta, CABA',
  WHATSAPP: '5491158485270',            // solo números, con código de país
  WHATSAPP_VISIBLE: '+54 9 11 5848-5270',
  EMAIL: 'originalfade1@gmail.com',
  INSTAGRAM_URL: 'https://www.instagram.com/eloriginalfade/',
  INSTAGRAM_USUARIO: '@eloriginalfade',
  MAPS_EMBED: 'https://www.google.com/maps?q=Azcu%C3%A9naga+1850,+Recoleta,+CABA,+Argentina&output=embed',
  MAPS_COMO_LLEGAR: 'https://www.google.com/maps/dir/?api=1&destination=Azcu%C3%A9naga+1850,+Recoleta,+CABA,+Argentina',
  GOOGLE_RESENA: 'https://www.google.com/maps/search/?api=1&query=Original+Fade+Azcu%C3%A9naga+1850+CABA',
  ZONA_HORARIA: 'America/Argentina/Buenos_Aires',

  /* --- Turnos ------------------------------------------------------------ */
  DIAS_A_MOSTRAR: 21,       // cuántos días hacia adelante se pueden reservar
  INTERVALO_MIN: 30,        // cada cuántos minutos arranca un turno

  /* --- Envíos -------------------------------------------------------------
     Costo = km × PRECIO_POR_KM. Es un estimado: se confirma por WhatsApp. */
  PRECIO_POR_KM: 750,
  ZONAS_ENVIO: Object.freeze([
    { id: 'retiro',   nombre: 'Retiro en el local',     km: 0,  demora: 'Te avisamos cuando esté listo' },
    { id: 'recoleta', nombre: 'Recoleta y alrededores', km: 3,  demora: '24 h' },
    { id: 'caba',     nombre: 'CABA',                   km: 8,  demora: '24-48 h' },
    { id: 'gba',      nombre: 'GBA',                    km: 22, demora: '48-72 h' },
    { id: 'interior', nombre: 'Interior',               km: 60, demora: '3-5 días' }
  ]),

  /* --- Carrito ----------------------------------------------------------- */
  CARRITO_KEY: 'of_cart_v1',
  MAX_UNIDADES: 10          // tope de unidades por producto y talle
});

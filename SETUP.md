# ORIGINALFADE · Guía para el dueño

Esta guía explica cómo manejar la web sin saber programar.
Casi todo se hace desde el **panel** (productos, precios, horarios, barberos). Solo hace falta tocar archivos para cambiar datos fijos como el WhatsApp o la dirección.

---

## 1. Entrar al panel

1. Abrí en el navegador: **`https://tu-dominio/admin.html`**
   (mientras uses la dirección de Vercel: `https://originalfade-web.vercel.app/admin.html`).
2. Escribí tu email y tu contraseña y tocá **Entrar**.
3. La sesión queda abierta en ese celu o esa compu. Para salir, tocá **Salir** arriba a la derecha.

> La web **no tiene ningún link al panel**, a propósito. Guardalo en favoritos o, en el celu, usá "Agregar a pantalla de inicio".

Solo pueden entrar las cuentas que están en la lista de administradores. Si alguien entra con otra cuenta, ve el mensaje "Esta cuenta no tiene permisos".

---

## 1 bis. Turnos: marcar horarios ocupados

El panel abre en la pestaña **Turnos**. Ahí marcás qué horarios ya están tomados, para que nadie más los pueda reservar desde la web.

1. Elegí el **barbero** y el **día** (se muestran los próximos 7 días; los cerrados no se pueden elegir).
2. Tocá un horario para marcarlo **Ocupado**. Tocalo de nuevo para dejarlo **Libre**. Se guarda solo y aparece "Horario ocupado ✓".
3. Atajos: **Ocupar todo el día** (por ejemplo, si ese barbero no viene) y **Liberar todo el día**.

Cómo lo usa la web:
- Cada horario es un turno de 45 minutos (10:00, 10:45, 11:30…). Un horario ocupado no se ofrece para ese barbero.
- Si el cliente elige "Me da igual", el horario se ofrece mientras algún barbero esté libre.
- La web **no ocupa los horarios sola**: cuando confirmás un turno por WhatsApp, marcalo acá.

---

## 2. Cargar un producto con fotos

1. Pestaña **Productos** → botón **Nuevo producto**.
2. Completá:
   - **Nombre** (obligatorio).
   - **Descripción** (opcional): tela, calce, cuidados.
   - **Categoría**: elegí una de la lista o **+ Nueva categoría…** y escribí el nombre (por ejemplo "Gorras").
   - **Precio**: solo el número, con o sin puntos (`25000` o `25.000`). Abajo ves cómo se va a ver en la web.
   - **Talles**: escribí uno y tocá **Agregar**, o usá los atajos **S M L XL XXL** o **Talle único**. Para quitar uno, tocá la ✕. Si no tiene talles, dejalo vacío (en la web se agrega directo al carrito).
3. **Fotos**: tocá **Agregar fotos** y elegí una o varias (desde la galería del celu o desde la compu).
   - Se achican y se guardan solas; ves una barra de progreso en cada una.
   - La **primera** foto es la **principal** (la que se ve en la tienda). Para cambiarla, tocá la ☆ de otra foto.
   - Con las flechas ← → cambiás el orden. Con el tachito la quitás.
   - Si una foto da error, probá con otra. En iPhone, si falla una foto HEIC, compartila como "Más compatible" o sacale captura.
4. Tocá **Guardar**. Arriba de la barra aparece **"Producto guardado ✓"** y ya está en la web.

## 3. Cambiar un precio (o cualquier dato)

1. Pestaña **Productos** (o **Servicios**) → tocá el producto en la lista.
2. Cambiá el precio → **Guardar**.

Los cambios del panel se ven en la web **al instante**. No hay que publicar nada.

## 4. Ocultar un producto o marcarlo sin stock

Dentro del producto hay dos interruptores:

| Interruptor | Apagado significa |
|---|---|
| **Disponible** | Se sigue viendo en la tienda, con la etiqueta "Sin stock", y no se puede agregar al carrito. |
| **Visible en la web** | El producto **no aparece** en la tienda. Queda guardado en el panel con la etiqueta "Oculto" para volver a mostrarlo cuando quieras. |

**Borrar** (abajo de todo en el formulario) lo elimina para siempre junto con sus fotos. Si es temporal, mejor ocultalo.

## 5. Ordenar productos, servicios y barberos

En la lista, cada fila tiene flechas ↑ ↓. El orden del panel es el orden de la web.
(Mientras estés buscando o filtrando por categoría, las flechas se desactivan: borrá la búsqueda para ordenar.)

## 6. Servicios y barberos

- **Servicios**: nombre, descripción, **duración en minutos** (con eso se calculan los turnos libres) y precio. El interruptor **Activo** lo muestra u oculta en la web y en la reserva de turnos.
- **Barberos**: nombre, especialidad y foto (una sola; **Cambiar foto** la reemplaza). Si no tiene foto, la web muestra la inicial del nombre. **Activo** apagado = no aparece ni se puede elegir para turnos.

## 7. Cambiar los horarios

1. Pestaña **Horarios**. Están de lunes a domingo.
2. Para cada día: interruptor **Abierto** y hora de apertura y cierre. Si lo apagás, ese día figura como cerrado.
3. **Guardar horarios**.

Con estos horarios la web dice si el local está abierto ahora y arma los turnos cada 45 minutos.

> Los horarios que lee **Google** están escritos aparte, dentro de `index.html` (buscá `openingHoursSpecification`). Si cambiás el horario de forma permanente, pedí que los actualicen ahí también.

---

## 8. Recuperar la contraseña

1. En la pantalla de ingreso, tocá **¿Olvidaste tu contraseña?**
2. Escribí tu email → **Enviar link**. Te llega un correo (mirá también en spam).
3. Abrí el link: se abre el panel con **"Creá tu contraseña nueva"**. Escribila dos veces (mínimo 8 caracteres) → **Guardar contraseña**.

**Ya está configurado** (1/10/2026): en Supabase → **Authentication → URL Configuration** figuran
`https://originalfade-web.vercel.app` como Site URL y `https://originalfade-web.vercel.app/admin.html` como Redirect URL.
Si algún día cambiás de dominio, agregá ahí la dirección nueva terminada en `/admin.html`; si no, el link del correo lleva a una página equivocada.

---

## 9. Publicar cambios de código (GitHub + Vercel)

Esto **solo** hace falta si cambiás archivos (textos fijos, `config.js`, imágenes del sitio). Lo que cargás en el panel no necesita publicarse.

### La primera vez
1. Subí el contenido de esta carpeta (`index.html`, `admin.html`, `SETUP.md` y las carpetas `css`, `js`, `assets`) al repositorio **github.com/halotechmology-dotcom/originalfade-web**:
   - Desde la web de GitHub: **Add file → Upload files**, arrastrá todo y tocá **Commit changes**.
   - O con **GitHub Desktop**: clonás el repositorio, copiás los archivos adentro, **Commit to main** y **Push origin**.
2. En **vercel.com** → **Add New… → Project** → elegí `originalfade-web` → **Framework Preset: Other**, sin comando de build → **Deploy**.
3. Si tenés dominio propio: en Vercel → el proyecto → **Settings → Domains** → agregalo y seguí las instrucciones.

### Cada vez que cambies algo
Subí el archivo cambiado a GitHub (igual que arriba). Vercel lo publica solo en uno o dos minutos.

### Si usás un dominio propio
En `index.html` reemplazá todas las apariciones de `https://originalfade-web.vercel.app` por tu dominio (están arriba de todo, en las etiquetas para Google, WhatsApp e Instagram).

---

## 10. Datos fijos (archivo `js/config.js`)

Abrilo con cualquier editor de texto. Ahí están, con comentarios:

- **WHATSAPP**: número al que llegan turnos y pedidos (solo números, con 549: `5491158485270`).
- **DIRECCION**, **EMAIL**, **INSTAGRAM_URL**, links de Google Maps y de reseñas.
- **ENTREGAS**: las opciones del carrito (retiro en el local o envío a domicilio). El costo del envío no se carga: lo pasás por WhatsApp según el pedido y el destino.
- **DIAS_A_MOSTRAR**: cuántos días para adelante se pueden reservar.

Después de cambiarlo, publicá (punto 9).

---

## 11. Probar la web en tu compu (opcional)

Con Node instalado, en esta carpeta:

```bash
npx serve .
```

y abrí la dirección que aparece (por ejemplo `http://localhost:3000`). El panel está en `/admin.html`.

---

## 12. Fotos borradas

Cuando quitás una foto o borrás un producto en el panel, el archivo también se borra de Supabase.
(El permiso que lo permite, "admin ve fotos", ya está aplicado desde el 1/10/2026; solo lo tienen las cuentas de administrador.)

---

## 13. Si algo no anda

| Pasa esto | Probá esto |
|---|---|
| "Email o contraseña incorrectos" | Revisá mayúsculas y espacios. Si no te acordás, usá "¿Olvidaste tu contraseña?". |
| "Tu sesión venció" o "No tenés permisos" | Tocá **Salir** y volvé a entrar. |
| "No hay conexión" | Revisá el wifi o los datos y tocá **Reintentar**. |
| Una foto no sube | Probá con JPG o PNG. Las fotos muy grandes (más de 30 MB) no se aceptan. |
| La web no muestra un producto | Fijate que tenga **Visible en la web** prendido. |
| No aparece un servicio o barbero en los turnos | Fijate que esté **Activo**. |
| El link de recuperar contraseña lleva a otra página | Falta la configuración del punto 8. |

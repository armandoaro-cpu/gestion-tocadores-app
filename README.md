# Gestión Tocadores

App web para el control de un negocio de tocadores: separaciones y ventas directas, abonos de clientes, gastos del negocio, cálculo de ganancias y exportación a Excel. Un solo negocio (dueño + trabajadora), en español, funciona en celular y computadora.

## Estructura

```
gestion_tocadores_app/
├── index.html            # Pantalla de login + contenedor de la app
├── css/
│   └── styles.css        # Estilos (mobile-first, responsive)
├── js/
│   ├── config.js         # ← AQUÍ van SUPABASE_URL y SUPABASE_ANON_KEY
│   ├── app.js            # Lógica principal: sesión, roles, vistas
│   ├── db.js             # Capa de datos: modo demo (localStorage) o Supabase
│   ├── auth.js           # (integrado en app.js)
│   ├── ui.js             # Utilidades: formato, modal, compresión de imágenes
│   ├── export.js         # Exportación a Excel (.xlsx) con SheetJS
│   └── crypto.js         # SHA-256 para la contraseña del dueño
├── supabase/
│   └── schema.sql        # Tablas, bucket de Storage y políticas RLS
└── README.md
```

## Modos de funcionamiento

- **Sin credenciales** (`js/config.js` vacío): la app funciona en **modo demostración**. Un banner en pantalla lo indica y los datos se guardan solo en el navegador (localStorage). Sirve para probarla de punta a punta.
- **Con credenciales**: usa Supabase como base de datos + Auth + Storage. Los datos se comparten entre celular y computadora con el mismo inicio de sesión.

## Roles

- **Inicio de sesión general** (Supabase Auth email/contraseña): sin sesión no se ve ningún dato.
- **Trabajadora** (modo por defecto tras el login): registra clientes/ventas con precio de venta, registra abonos con comprobante y busca clientes. No ve costos, ganancias ni gastos.
- **Dueño** (con su contraseña, que crea la primera vez): carga/edita el costo del tocador, modifica datos de ventas, anula separaciones (registra fecha y devolución, no las borra) y borra abonos. El modo dueño se bloquea solo a los 5 minutos.

## Qué falta para desplegar (esbozo; los pasos detallados se darán aparte)

1. Crear un proyecto gratuito en [Supabase](https://supabase.com).
2. En su SQL Editor, ejecutar `supabase/schema.sql` (crea las tablas, el bucket `comprobantes` y las políticas de seguridad).
3. En **Authentication**, crear el usuario (email/contraseña) que usará el negocio.
4. Copiar la **Project URL** y la clave **anon public** (Settings → API) en `js/config.js`.
5. Subir esta carpeta a **Vercel** (importar el repositorio o arrastrar la carpeta): es un sitio estático, sin build step.
6. Probar el login, crear la contraseña de dueño desde la app y verificar que los datos se ven igual en celular y computadora.

> Nota de seguridad: el bucket `comprobantes` se crea público para simplificar la prueba. En producción se recomienda cambiarlo a privado y usar URLs firmadas.

## Lector de comprobantes (OCR) y entrada de imágenes

- El campo de comprobante acepta la imagen por **archivo**, **pegado (Ctrl+V)** o **arrastrar y soltar** (en computadora). En celular se elige de la galería como siempre. La imagen guardada es siempre la captura completa.
- Al subirla, un lector (Tesseract.js por CDN) intenta leer **solo el monto** y lo sugiere en el campo: para transferencias busca el monto con decimales junto a "S/"; para Yape lee la zona de los dígitos. Es una **sugerencia**: la persona puede corregirla o escribir el monto a mano, y si lo escrito difiere de lo leído, la app muestra un aviso (sin bloquear el guardado).
- La primera lectura descarga el lector e idioma desde internet (puede tardar unos segundos); sin conexión, simplemente se escribe el monto como siempre.

# Libreta de Cooperaciones

App web instalable (PWA) para registrar las cooperaciones de los alumnos por grupo. Está pensada para teléfonos Android y también se adapta a tabletas y computadoras.

- Funciona sin internet: todos los datos se guardan en el propio dispositivo (IndexedDB).
- Grupos, alumnos (se pega la lista completa), cooperaciones con cuota opcional y aportaciones que se van sumando.
- Copiar la lista para WhatsApp y descargar un CSV que abre en Excel.
- Respaldo y restauración de datos en un archivo `.json`.

## Publicarla con GitHub Pages

1. Entra a <https://github.com/new> y crea un repositorio público, por ejemplo `cooperaciones`.
2. En el repositorio, elige **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta (incluye la carpeta `icons` y el archivo `.nojekyll`). Pulsa **Commit changes**.
3. Ve a **Settings → Pages**. En **Source** elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y pulsa **Save**.
4. Espera uno o dos minutos. Tu app quedará en `https://TU-USUARIO.github.io/cooperaciones/`.

## Instalarla en Android

1. Abre la dirección anterior en **Chrome** desde el teléfono.
2. Toca el botón **Instalar** que aparece en la app, o el menú ⋮ → **Instalar app** / **Agregar a la pantalla principal**.
3. Ábrela una vez con internet. Desde ese momento funciona sin conexión.

## Cuidar tus datos

Los datos viven sólo en el teléfono donde los capturas. Si borras los datos de Chrome, desinstalas la app o cambias de teléfono, se pierden. Usa el botón de respaldo (arriba a la derecha en *Mis grupos*) cada semana y guarda el archivo en Google Drive o en tu correo. Para pasar tus datos a otro dispositivo, usa **Restaurar un respaldo** ahí.

## Publicar cambios

Cuando modifiques algún archivo, abre `sw.js` y cambia `VERSION` (por ejemplo de `v1.0.0` a `v1.0.1`). Así los teléfonos que ya tienen la app instalada muestran el aviso **Hay una versión nueva → Actualizar**. Los datos guardados no se borran al actualizar.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Página principal |
| `app.js` | Lógica de la app y base de datos local |
| `styles.css` | Diseño para teléfono, tableta y computadora |
| `sw.js` | Hace que funcione sin internet |
| `manifest.webmanifest` | Nombre, ícono y colores para instalarla |
| `icons/` | Íconos de la app |

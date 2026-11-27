# docs-site-lab · portal de documentación

Sitio que junta la documentación de varios repos en un solo portal con login de GitHub. Producción: **https://docs.vanttec.workers.dev** (Worker de Cloudflare), desplegado desde la rama `main`. **No tiene contenido propio**: en cada build trae `openwiki/` y `docs/arch/` de cada repo listado en [`projects.json`](projects.json).

```
projects.json                qué repos se publican
access.config.js             proyectos restringidos (RESTRICTED, isRestricted, canAccess)
worker/index.mjs             Worker de Cloudflare: login, cabeceras, redirecciones y /api/* delante de dist/
wrangler.jsonc               Worker `docs`: assets de dist/, D1 `DB`, R2 `ARCHIVOS`
lib/                         login-core.mjs (login con GitHub), almacen-d1.mjs y almacen-r2.mjs (D1 y R2),
                             y el núcleo de las APIs de comentarios, hardware y archivos
migrations/                  esquema de D1 (0001_almacen.sql, 0002_tokens.sql)
plantillas/                  plantillas de Electrónica y Mecánica
tools/fetch.mjs              paso 1: clona solo openwiki/ y docs/arch/ de cada repo y deja todo en .content/
src/                         paso 2: sitio Astro estático (páginas ya renderizadas, sin fetch en el navegador)
  pages/index.astro          portada multi-proyecto
  pages/[project]/           resumen, páginas de la wiki, grafo y sus JSON (ros.json, paginas.json)
  components/RoboticsGraph   grafo con Sigma.js + React (client:visible): filtros, vecindario y panel lateral
  lib/graph.ts               layout ForceAtlas2 calculado en el build, uno por configuración
tools/postbuild.mjs          paso 3: copia los diagramas de Archify a dist/<id>/arch/
                             paso 4: pagefind indexa dist/ para la búsqueda
.github/workflows/           build.yml (CI) y deploy-cloudflare.yml (despliegue)
docs/                        notify-docs-site.cloudflare.yml.example (aviso desde el repo de código)
```

## Cómo se actualiza
1. Un repo de código cambia `openwiki/` o `docs/arch/` en su rama.
2. Su workflow `notify-docs-site` llama a `POST repos/cyuxSz/docs-site-lab/actions/workflows/deploy-cloudflare.yml/dispatches` (`workflow_dispatch`) con `ref=main`, `inputs[proyecto]` e `inputs[sha]`; `proyecto` es el id de `projects.json`. Esa vía usa el token `DOCS_SITE_DISPATCH_TOKEN` con permiso Actions: Read and write. `deploy-cloudflare.yml` también acepta un `repository_dispatch` (`docs-actualizados`, con `{ proyecto, sha }`) como vía alternativa; esa requiere Contents: write.
3. `deploy-cloudflare.yml` vuelve a traer y construir solo ese proyecto y despliega el Worker. No hay que tocar este repo.

Un push a `main` (p. ej. al mergear un PR) construye todo y despliega.

Para agregar un proyecto, se suma una entrada a `projects.json` y se le da acceso de lectura al token `DOCS_GITHUB_TOKEN`.

## Acceso
Todo pasa por el login del Worker (`lib/login-core.mjs`); los contenidos nunca se sirven sin sesión. Entra quien está en `ALLOWED_USERS` o pertenece a la org `ALLOWED_ORG`.

1. Crea una OAuth App de GitHub con callback `https://docs.vanttec.workers.dev/auth/callback` (en local, `http://localhost:8787/auth/callback`).
2. Guarda `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_ORG` y `ALLOWED_USERS` como **Secrets** del Worker (`npx wrangler secret put <NOMBRE> --name docs`), no como Variables: `wrangler deploy` borra las Variables que no están en `wrangler.jsonc`.
3. **Abrir el acceso a la org:** `npx wrangler secret put ALLOWED_ORG --name docs` (valor: la org, p. ej. `vanttec`). Si la org restringe apps de terceros, solo se ven los miembros con membresía pública; el aviso de «Sin acceso» explica cómo cambiarla, o la org aprueba la OAuth App.
4. **Cerrar el acceso a la org:** `npx wrangler secret delete ALLOWED_ORG --name docs`. Quedan solo los logins de `ALLOWED_USERS`.
   Las sesiones ya iniciadas siguen valiendo hasta que caduca su cookie firmada (7 días), porque `isAllowed` solo se comprueba en el login. Para cortarlas ya, rota `SESSION_SECRET` con un valor aleatorio nuevo: `npx wrangler secret put SESSION_SECRET --name docs`. Esto cierra todas las sesiones de navegador (las cookies); los de `ALLOWED_USERS` vuelven a entrar con login. No afecta a los tokens de dispositivo: ver «Tokens de dispositivo».

`ALLOWED_USERS` son logins de GitHub separados por coma (sin distinguir mayúsculas). La org `vanttec` aprobó la OAuth App el 26 de noviembre de 2026, así que ya se puede configurar `ALLOWED_ORG`. Pon en `ALLOWED_ORG` solo una org que tenga la OAuth App aprobada: si la org la restringe, GitHub puede contestar 404 a un miembro con membresía privada, y el callback lo tomaría como «no es miembro» y borraría sus tokens.

## Cloudflare: Worker, secrets y bindings
El Worker `docs` (`worker/index.mjs`, `wrangler.jsonc`) sirve los assets de `dist/` con `run_worker_first`: primero el login, luego los archivos o `/api/*`.

| Binding | Qué es |
|---|---|
| `DB` | D1 `docs-site`: comentarios, páginas de hardware y metadatos de archivos (`migrations/0001_almacen.sql`, adaptador `lib/almacen-d1.mjs`) y tokens de dispositivo (`migrations/0002_tokens.sql`, `lib/dispositivos-core.mjs`) |
| `ARCHIVOS` | R2 `docs-hardware`, privado: archivos de hardware (`lib/almacen-r2.mjs`) |
| `ASSETS` | Static assets de `dist/` |

**Secrets del Worker** (en Cloudflare con `npx wrangler secret put <NOMBRE> --name docs`; en local, en `.dev.vars`, que no se sube a git):

| Secret | Para qué |
|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App de GitHub |
| `SESSION_SECRET` | 32+ caracteres aleatorios para firmar la cookie `docs_session` |
| `ALLOWED_ORG` | Org cuyos miembros pueden entrar (opcional; ver «Acceso») |
| `ALLOWED_USERS` | Logins con acceso, separados por coma |

**Secrets de GitHub Actions** (*Settings → Secrets and variables → Actions*, los usa `deploy-cloudflare.yml`):

| Secret | Para qué |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Permisos Workers Scripts, D1 y R2 de la cuenta; caduca, renovarlo antes de que venza |
| `CLOUDFLARE_ACCOUNT_ID` | Cuenta de Cloudflare |
| `DOCS_GITHUB_TOKEN` | Token *fine-grained* de solo lectura (Contents: Read) sobre los repos privados de `projects.json`; también lo usa `build.yml` en push a `main` |

La base D1 ya existe (se creó con `npx wrangler d1 create docs-site`) y su `database_id` está en `d1_databases` de `wrangler.jsonc` (no es un secreto). El workflow aplica las migraciones (`d1 migrations apply docs-site --remote`) antes de cada deploy. Para probar en local, `npm run cf:dev` con `.dev.vars` (ver «CI y probar en local»). En local, antes de `wrangler dev`: `npx wrangler d1 migrations apply docs-site --local`.

**Tokens de dispositivo** (para clientes que no son un navegador, como la app de escritorio). La migración `0002_tokens.sql` crea las tablas `tokens` y `codigos_app`; solo guardan el SHA-256 del token y del código.

- `POST /auth/app/canje` con JSON `{ code, verifier }` es la única ruta pública: cambia un código de un solo uso (60 s, ligado a un challenge PKCE S256) por `{ token, expira, login }`. Límite de 10 peticiones por minuto por IP (`CF-Connecting-IP`). Todavía no hay ruta que emita códigos; llega con el consentimiento en el navegador.
- El token (`vtd_…`) va en `Authorization: Bearer <token>`, dura 30 días sin renovación y se consulta en D1 en cada petición, así que borrar su fila lo revoca al momento. Con Bearer los errores son JSON (401, nunca una redirección al login), las escrituras no exigen `Origin` y no hay CORS.
- Una petición lleva una sola credencial: con la cookie `docs_session` y un Bearer a la vez responde 400.
- `GET /auth/app/dispositivos` (solo Bearer) devuelve `{ login, dispositivos: [{ id, nombre, plataforma, creado, ultimoUso, expira, actual }] }` con los dispositivos del login del token. `POST /auth/app/revocar` (solo Bearer) borra el token de la propia petición y responde `{ "ok": true }` (también si el token ya estaba revocado), o 503 si no pudo identificar el token de la petición; no lee cuerpo ni query, así que un token no puede revocar otro dispositivo. Sin Bearer las dos responden 401 JSON `Token requerido`.
- `/auth/dispositivos` (solo con la cookie de sesión) es la página donde cada persona ve sus dispositivos y los revoca. La pinta el Worker, sin JavaScript: cada fila es un formulario que envía `POST /auth/dispositivos/revocar` con el `id` público y un token anti-CSRF ligado a la sesión (HMAC de la cookie con `SESSION_SECRET`); exige `Origin` propio y responde 303 de vuelta a la página.
- Las rutas de navegador (`/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/signed-out`, `/auth/dispositivos` y `/auth/dispositivos/revocar`) responden 400 JSON `Ruta solo para navegador` a una petición con un Bearer válido. `/auth/logout` no revoca un token: para eso está `POST /auth/app/revocar`.
- Cuando alguien intenta entrar y GitHub confirma que ya no tiene acceso, `/auth/callback` borra todos sus tokens antes de responder el 403. Se borran solo cuando GitHub contesta que no es miembro (membresía 404 o no activa, y miembro público 404). Además hace falta el binding `DB` y que D1 no falle: si falta `DB` o D1 falla, no se borra nada y el callback no avisa (responde el mismo 403). No se borra nada con un 403 de GitHub (una restricción de la OAuth App puede darlo), con un error o límite de tasa, ni cuando falta `ALLOWED_ORG`. Por ejemplo, sin `ALLOWED_ORG`, quien se quita de `ALLOWED_USERS` conserva sus tokens. Con `ALLOWED_ORG`, quien se quita de `ALLOWED_USERS` y GitHub confirma que no es miembro de la org sí los pierde. En todos los casos en que no se borra nada, la revocación es a mano con el comando de abajo. Quien pierde el acceso y no vuelve a intentar entrar conserva su token hasta que caduque; para revocarlo a mano (login en minúsculas):

  ```bash
  npx wrangler d1 execute docs-site --remote --command "DELETE FROM tokens WHERE lower(login) = 'login-en-minusculas'"
  ```

  Ojo: si una restricción de la OAuth App hace que GitHub responda 404 a un miembro con membresía privada, el callback sí borra sus tokens (ver «Acceso»).

- Los códigos caducados de `codigos_app` se purgan al crear un código nuevo (como mucho 50 por creación).
- Rotar `SESSION_SECRET` no invalida los tokens de dispositivo: solo cierra las sesiones de navegador.

El Markdown de hardware se renderiza en el navegador con marked + DOMPurify (carga diferida, solo en Electrónica y Mecánica); el servidor devuelve el Markdown tal cual.

## Electrónica y Mecánica (hardware)
Cada proyecto puede documentar disciplinas de hardware con contenido guardado solo en la web (no en el GitHub del proyecto). Se activan con la clave opcional `disciplinas` de `projects.json`: `"disciplinas": { "electronica": { "plantilla": "electronica", "editores": ["login"] } }`. `plantilla` es un archivo de `plantillas/` y `editores` son los únicos logins que pueden escribir; todos los que ven el proyecto leen. No se usa `secciones` (es del grafo).

- **Páginas** (`/api/hardware/`): Markdown con versiones, revisiones y papelera, guardado en D1 (binding `DB`).
- **Archivos** (`/api/archivos/`): se suben directo al Worker (`POST /api/archivos/`, binario) y se guardan en el bucket R2 privado `ARCHIVOS` (`docs-hardware`); sus metadatos van en D1. Sin el binding `ARCHIVOS` responde 503. Se sirven siempre por el portal, con sesión; el bucket no tiene acceso público.
- **Interfaz**: cada disciplina configurada añade una pestaña (`/<proyecto>/electronica/?p=<pagina>`). Los editores ven Editar, Nueva página, Subir/Bajar, Borrar, Historial y Adjuntar; el resto solo lee.
- **PDF y BOM (D1a)**: ```` ```pdf ```` (`archivo: <uuid>`, `titulo:` opcional) muestra el PDF en un `<iframe>` del mismo origen (solo `/api/archivos` de tipo PDF responde con `frame-ancestors 'self'` y `X-Frame-Options: SAMEORIGIN`) y siempre deja el enlace "Abrir PDF". ```` ```bom ```` lleva un CSV en línea (referencia, descripcion, cantidad, costo_unitario; opcionales proveedor y enlace) y se ve como tabla con totales y "Exportar CSV" (celdas neutralizadas contra inyección de fórmulas). El editor los inserta con "Insertar PDF" e "Insertar BOM".
- **Diagramas**: un bloque ```` ```diagrama ```` (`editor: excalidraw|drawio`, `fuente: <uuid>`, `svg: <uuid>`, `titulo:` opcional) muestra un SVG editable; los editores lo crean con "Insertar diagrama" y lo editan desde la lectura (Excalidraw 0.18.0, cargado solo al editar y con sus fuentes en `dist/excalidraw/fonts/`; diagrams.net en un iframe de `embed.diagrams.net`). Cada guardado sube dos archivos nuevos (fuente y SVG). La CSP `<meta>` añade solo `frame-src 'self' https://embed.diagrams.net` (el `'self'` es para el visor de PDF, ver abajo): las cabeceras CSP globales (las del Worker) no deben definir directivas de carga.
- **Editor**: vista previa en vivo (lado a lado en escritorio, por pestañas en móvil), Ctrl/Cmd+S para guardar sin salir, aviso de cambios sin guardar y papelera con interfaz (botón Papelera, solo editores) para restaurar páginas borradas.
- **Probar en un navegador**: `npm run build` y `npm run cf:dev` (ver «CI y probar en local»); D1 y R2 locales viven en `.wrangler/state`.

## Biblioteca de integrados
`tools/integrados.py` genera una biblioteca de diagrams.net y un SVG de vista previa por integrado desde una tabla de pines. Solo usa la biblioteca estándar de Python 3.10 o superior; corre en local o en CI (no en el Worker).

```
python tools/integrados.py --entrada tools/ejemplos/ne555.csv --salida salida/
```

- **Entrada**: un CSV o un `.kicad_sym` de KiCad (la extensión decide el formato). Ejemplos: `tools/ejemplos/ne555.csv` y `tools/ejemplos/ne555.kicad_sym`.
- **CSV**: UTF-8, separado por comas o por «punto y coma» (el que exporta Excel en español; se decide con la cabecera), con cabecera. Columnas obligatorias `integrado`, `pin`, `nombre` y `lado`; opcional `tipo` (entrada, salida, bidireccional, alimentacion, pasivo, sin_conexion). El lado es izquierda, derecha, arriba o abajo. Un archivo puede traer varios integrados.
- **`.kicad_sym`**: un integrado por símbolo; el lado sale del ángulo de cada pin y el dibujo del símbolo se ignora (siempre se pinta una caja).
- **Salida**: `<base>.xml` (la biblioteca) y `<slug>.svg` por integrado. Es determinista; para cambiar un pin se edita la tabla y se regenera sobre la misma carpeta: los archivos que ya existan se reemplazan (si cambia alguno, `aviso:` en stderr). No se versiona.
- **Abrirla**: en diagrams.net, «Archivo › Abrir biblioteca» y elegir el `.xml`. Cada integrado trae un punto de conexión por pin.
- Entrada inválida: sale con código 1 y `error: <archivo>:<línea>: …` sin escribir nada. `--ayuda` lista las opciones.

## Rutas
| Ruta | Qué es |
|---|---|
| `/<id>/` | Resumen del proyecto: estadísticas, configuraciones, paquetes y diagramas |
| `/<id>/<ruta>/` | Una página de la wiki (`openwiki/<ruta>.md`; `index.md` → carpeta) |
| `/<id>/grafo/?config=<id>&node=<id>` | Grafo; los parámetros se pueden compartir |
| `/<id>/arch/<archivo>.html` | Diagrama de Archify |

Los enlaces viejos `/<id>/#/p/<ruta>.md` se redirigen en el navegador; `/<id>/wiki/` y `/<id>/content/*` los redirige el Worker.

## Mini tutoriales
Además de las rutas por rol (`openwiki/rutas.md`, cuyo formato no cambia: es retrocompatible), cada archivo `openwiki/rutas/<slug>.md` es un mini tutorial que el portal muestra en `/<id>/rutas/<slug>/` y lista en `/<id>/rutas/`. El progreso se guarda solo en el navegador.

```markdown
---
type: tutorial
title: Probar un motor desde la Jetson
description: Del launch al motor girando, paso a paso.
disciplina: electronica   # obligatoria: software | electronica | mecanica
rol: electronica          # opcional: id de un "## Rol" de rutas.md
---
# Probar un motor desde la Jetson

## Paso: Ubica el banco de pruebas
Objetivo: saber qué Arduino controla cada motor.
Enlace: [Hardware](../operations/hardware.md#probar-motores)
Hecho cuando: identificas el pin de cada uno de los 6 motores.
```

`Enlace:` admite uno por paso: una página de la wiki (ruta relativa a un `.md` de `openwiki/`, con `#ancla` opcional), `grafo:?node=<id>&config=<id>&seccion=<id>` (solo esos parámetros) o `hardware:<disciplina>/<slug>` (disciplina de `projects.json`, slug `[a-z0-9-]`). Cualquier otro enlace, y los pasos sin `Objetivo:`, `Enlace:` o `Hecho cuando:`, se ignoran con un aviso en el build. Un tutorial sin pasos válidos o sin disciplina válida no sale en la lista ni como checklist, pero su archivo se sigue publicando como página normal de la wiki. El nombre de archivo no puede ser `index` ni llevar `:`.

## Proyectos restringidos
`access.config.js` es la única fuente de verdad (`RESTRICTED`, `isRestricted`, `canAccess`); lo importan el login (`lib/login-core.mjs`), las APIs y el build. Hoy no hay proyectos restringidos: `RESTRICTED = {}`. Para restringir uno, se añade `{ "<id>": ["<login>"] }` (id de `projects.json`, logins de GitHub sin distinguir mayúsculas). Los demás miembros reciben un 403 "Este proyecto es privado", su contenido no entra al índice de Pagefind y su tarjeta en la portada solo muestra nombre e insignia. **Ojo:** esto solo protege el portal; si el repo fuente es público o tiene su propio despliegue, hay que protegerlo aparte.

Limitación aceptada: el usuario autorizado pierde la búsqueda dentro de un proyecto restringido (el índice de Pagefind es público para todos los miembros).

## Grafo
Si el repo tiene `openwiki/.graph/ros.json` (lo genera `tools/ros_graph.py` en el repo de código), el grafo muestra nodos, topics, servicios y hardware. Sin él, muestra cómo se enlazan las páginas de la wiki. En los dos casos hay una tabla con los mismos datos para lectores de pantalla y para la búsqueda.

## Avisos en la portada
- **Sin documentación aún:** la rama de `projects.json` no tiene `openwiki/` ni `docs/arch/`; si hay ramas `docs/*` sin mergear, las nombra.
- **No se pudo construir:** muestra el motivo (rama inexistente, repo privado sin token…). El token nunca aparece en el mensaje.
- **Token:** si `DOCS_GITHUB_TOKEN` caduca en 14 días o menos, o ya no es válido, sale un aviso arriba.

## CI y probar en local
`.github/workflows/build.yml` corre `npm test`, la comprobación de sintaxis y el build (`DOCS_STRICT=1`) en cada PR y en push a `main`. `DOCS_GITHUB_TOKEN` se pasa solo en push a `main`; en un PR los repos privados solo avisan.

```bash
npm ci
cp .dev.vars.example .dev.vars    # rellena los valores; .dev.vars no se sube a git
npm run build                     # o, con repos ya clonados: DOCS_LOCAL_REPOS="uuv=../uuv-lab" npm run build
npx wrangler d1 migrations apply docs-site --local   # crea las tablas de D1 local (una vez; datos en .wrangler/state)
npm run cf:dev                    # o `npx wrangler dev`: http://localhost:8787
npm test
```
El login sí corre en local (es el del Worker); la OAuth App necesita el callback `http://localhost:8787/auth/callback`. Los builds que hacen `git fetch` pueden usar `DOCS_LOCAL_REPOS="<id>=<ruta>,..."` para tomar repos ya clonados. D1 y R2 son locales en `wrangler dev`.

## Despliegue en Cloudflare
`.github/workflows/deploy-cloudflare.yml` construye el portal, aplica las migraciones de D1 y despliega con `wrangler-action`. Solo despliega desde `main`. Se dispara con:
- push a `main` (build completo). Con `concurrency`, un deploy pendiente sustituye al anterior (que aparece como cancelado);
- a mano, por proyecto: `gh workflow run deploy-cloudflare.yml --ref main -f proyecto=uuv`;
- `repository_dispatch` tipo `docs-actualizados` (con `client_payload: { proyecto, sha }`; solo corre desde la rama por defecto).

Necesita los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. Sin ellos el workflow construye, avisa con `::warning::` y termina en verde sin desplegar. `DOCS_GITHUB_TOKEN` se usa para leer los repos privados.

Con un disparo por proyecto, el build corre `tools/fetch.mjs` con `DOCS_SOLO_PROYECTO=<id>`: vuelve a traer solo ese proyecto y conserva los demás del `.content/` restaurado de la caché, pero solo si están completos y su `sha` sigue siendo el HEAD remoto de su rama (`git ls-remote`); si avanzó, falta algo o la consulta falla, lo trae de nuevo. La clave de caché es única por ejecución e intento (`run_id` y `run_attempt`) y `restore-keys` toma la más reciente. Sin la variable (push) se descarga todo.

Quién puede disparar un proyecto lo define `editoresDocs` en `projects.json` (logins de GitHub; sin esa lista nadie puede, se actualiza con el build completo). No llega a `.content/` ni al sitio. El workflow valida proyecto, sha y remitente con `tools/proyecto-valido.mjs` antes de construir.

El repo de código avisa con `docs/notify-docs-site.cloudflare.yml.example` (renombrar a `notify-docs-site.yml` en ese repo), que usa el secret `DOCS_SITE_DISPATCH_TOKEN`: un token fine-grained solo sobre `docs-site-lab` con permiso Actions: Read and write.

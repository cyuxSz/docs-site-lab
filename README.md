# docs-site-lab · portal de documentación (prueba)

Sitio que junta la documentación de varios repos en un solo portal con login de GitHub. Producción: **https://docs.vanttec.workers.dev** (Worker de Cloudflare, rama `cloudflare`). Vercel (rama `main`) queda de respaldo hasta el corte final (M4). **No tiene contenido propio**: en cada build trae `openwiki/` y `docs/arch/` de cada repo listado en [`projects.json`](projects.json).

```
projects.json                qué repos se publican
tools/fetch.mjs              paso 1: clona solo openwiki/ y docs/arch/ de cada repo y deja todo en .content/
src/                         paso 2: sitio Astro estático (páginas ya renderizadas, sin fetch en el navegador)
  pages/index.astro          portada multi-proyecto
  pages/[project]/           resumen, páginas de la wiki, grafo y sus JSON (ros.json, paginas.json)
  components/RoboticsGraph   grafo con Sigma.js + React (client:visible): filtros, vecindario y panel lateral
  lib/graph.ts               layout ForceAtlas2 calculado en el build, uno por configuración
tools/postbuild.mjs          paso 3: copia los diagramas de Archify a dist/<id>/arch/
                             paso 4: pagefind indexa dist/ para la búsqueda
worker/index.mjs             Worker de Cloudflare: login, cabeceras, redirecciones y /api/* delante de dist/
lib/login-core.mjs           login con GitHub compartido (solo miembros de ALLOWED_ORG o ALLOWED_USERS)
middleware.js                envoltorio del login para Vercel (respaldo)
migrations/                  esquema de D1 (comentarios, páginas de hardware y metadatos de archivos)
```

## Cómo se actualiza
1. Un repo de código cambia `openwiki/` o `docs/arch/` en su rama.
2. Su workflow `notify-docs-site` manda un `repository_dispatch` (`docs-actualizados`, con `{ proyecto, sha }`) a este repo.
3. `deploy-cloudflare.yml` vuelve a traer solo ese proyecto, reconstruye y despliega el Worker. No hay que tocar este repo.

Un push a la rama `cloudflare` (p. ej. al mergear un PR) también reconstruye y despliega todo. Mientras dure el respaldo, el repo de código puede seguir llamando además al Deploy Hook de Vercel.

Para agregar un proyecto, se suma una entrada a `projects.json` y se le da acceso de lectura al token `DOCS_GITHUB_TOKEN`.

## Rutas
| Ruta | Qué es |
|---|---|
| `/<id>/` | Resumen del proyecto: estadísticas, configuraciones, paquetes y diagramas |
| `/<id>/<ruta>/` | Una página de la wiki (`openwiki/<ruta>.md`; `index.md` → carpeta) |
| `/<id>/grafo/?config=<id>&node=<id>` | Grafo; los parámetros se pueden compartir |
| `/<id>/arch/<archivo>.html` | Diagrama de Archify |

Los enlaces viejos `/<id>/#/p/<ruta>.md` se redirigen en el navegador; `/<id>/wiki/` y `/<id>/content/*` con `vercel.json`.

## Proyectos restringidos
`access.config.js` es la única fuente de verdad (`RESTRICTED`, `isRestricted`, `canAccess`); lo importan `middleware.js`, las APIs y el build. Hoy no hay proyectos restringidos: `RESTRICTED = {}`. Para restringir uno, se añade `{ "<id>": ["<login>"] }` (id de `projects.json`, logins de GitHub sin distinguir mayúsculas). Los demás miembros reciben un 403 "Este proyecto es privado", su contenido no entra al índice de Pagefind y su tarjeta en la portada solo muestra nombre e insignia. **Ojo:** esto solo protege el portal; si el repo fuente es público o tiene su propio despliegue, hay que protegerlo aparte.

Limitación aceptada: el usuario autorizado pierde la búsqueda dentro de un proyecto restringido (el índice de Pagefind es público para todos los miembros). En Preview los proyectos restringidos responden 403 siempre (no hay login de GitHub), incluso con `PREVIEW_TRUST_VERCEL_AUTH=1`.

## Grafo
Si el repo tiene `openwiki/.graph/ros.json` (lo genera `tools/ros_graph.py` en el repo de código), el grafo muestra nodos, topics, servicios y hardware. Sin él, muestra cómo se enlazan las páginas de la wiki. En los dos casos hay una tabla con los mismos datos para lectores de pantalla y para la búsqueda.

## Variables de entorno en Vercel (respaldo)
| Variable | Para qué |
|---|---|
| `DOCS_GITHUB_TOKEN` | Token *fine-grained* de solo lectura (Contents: Read) sobre los repos privados de `projects.json` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App de GitHub; callback `https://<dominio>/auth/callback` |
| `SESSION_SECRET` | 32+ caracteres aleatorios para firmar la cookie de sesión |
| `ALLOWED_ORG` | Org cuyos miembros pueden entrar (p. ej. `vanttec`) |
| `ALLOWED_USERS` | Opcional: logins separados por coma, como respaldo |
| `BLOB_READ_WRITE_TOKEN` | Lo crea Vercel al conectar un Blob store privado al proyecto; activa la subida de archivos de hardware (`/api/archivos/`) |
| `PREVIEW_TRUST_VERCEL_AUTH` | `1` para que los Preview no pidan login de GitHub. Solo con Vercel Authentication activo en *Deployment Protection*; si no, los Preview responden 403 |

Los Preview no usan la OAuth App: los protege el login de Vercel (ver `PREVIEW_TRUST_VERCEL_AUTH`).

## Electrónica y Mecánica (hardware)
Cada proyecto puede documentar disciplinas de hardware con contenido guardado solo en la web (no en el GitHub del proyecto). Se activan con la clave opcional `disciplinas` de `projects.json`: `"disciplinas": { "electronica": { "plantilla": "electronica", "editores": ["login"] } }`. `plantilla` es un archivo de `plantillas/` y `editores` son los únicos logins que pueden escribir; todos los que ven el proyecto leen. No se usa `secciones` (es del grafo).

- **Páginas** (`/api/hardware/`): Markdown con versiones, revisiones y papelera. Usan el mismo Upstash Redis que los comentarios; no requieren nada más.
- **Archivos** (`/api/archivos/`): suben directo a Vercel Blob y sus metadatos viven en el mismo Upstash Redis (`KV_REST_API_URL`/`KV_REST_API_TOKEN` o `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`); sin él responde 503. Para activarlos: Vercel → Storage → crear un **Blob store privado** y conectarlo al proyecto (esto crea `BLOB_READ_WRITE_TOKEN`); después, volver a desplegar. Con un store público las URLs serían accesibles sin login: debe ser privado. Los archivos se sirven por el portal (con sesión), nunca por la URL del Blob.
- **Interfaz**: cada disciplina configurada añade una pestaña (`/<proyecto>/electronica/?p=<pagina>`). Los editores ven Editar, Nueva página, Subir/Bajar, Borrar, Historial y Adjuntar; el resto solo lee.
- **PDF y BOM (D1a)**: ```` ```pdf ```` (`archivo: <uuid>`, `titulo:` opcional) muestra el PDF en un `<iframe>` del mismo origen (solo `/api/archivos` de tipo PDF responde con `frame-ancestors 'self'` y `X-Frame-Options: SAMEORIGIN`) y siempre deja el enlace "Abrir PDF". ```` ```bom ```` lleva un CSV en línea (referencia, descripcion, cantidad, costo_unitario; opcionales proveedor y enlace) y se ve como tabla con totales y "Exportar CSV" (celdas neutralizadas contra inyección de fórmulas). El editor los inserta con "Insertar PDF" e "Insertar BOM".
- **Diagramas**: un bloque ```` ```diagrama ```` (`editor: excalidraw|drawio`, `fuente: <uuid>`, `svg: <uuid>`, `titulo:` opcional) muestra un SVG editable; los editores lo crean con "Insertar diagrama" y lo editan desde la lectura (Excalidraw 0.18.0, cargado solo al editar y con sus fuentes en `dist/excalidraw/fonts/`; diagrams.net en un iframe de `embed.diagrams.net`). Cada guardado sube dos archivos nuevos (fuente y SVG). La CSP `<meta>` añade solo `frame-src 'self' https://embed.diagrams.net` (el `'self'` es para el visor de PDF, ver abajo): las cabeceras CSP globales (Worker y `vercel.json`) no deben definir directivas de carga.
- **Editor**: vista previa en vivo (lado a lado en escritorio, por pestañas en móvil), Ctrl/Cmd+S para guardar sin salir, aviso de cambios sin guardar y papelera con interfaz (botón Papelera, solo editores) para restaurar páginas borradas.
- **Probar en un navegador**: `npm run build` y `node tests/fixtures/servidor-hardware.mjs` (127.0.0.1:4330, Redis y Blob en memoria; `?como=ana` cambia de usuario). El servidor reescribe la API de Blob a `/__blob`; la subida real solo se puede probar en un preview de Vercel (el SDK sube con stream y Chrome lo exige sobre HTTP/2).

## Avisos en la portada
- **Sin documentación aún:** la rama de `projects.json` no tiene `openwiki/` ni `docs/arch/`; si hay ramas `docs/*` sin mergear, las nombra.
- **No se pudo construir:** muestra el motivo (rama inexistente, repo privado sin token…). El token nunca aparece en el mensaje.
- **Token:** si `DOCS_GITHUB_TOKEN` caduca en 14 días o menos, o ya no es válido, sale un aviso arriba.

## CI
`.github/workflows/build.yml` corre el build en cada PR con `DOCS_STRICT=1`. Para que también construya los repos privados, agrega `DOCS_GITHUB_TOKEN` en *Settings → Secrets and variables → Actions*; sin él, esos repos solo avisan.

## Probar en local
```bash
npm ci
npm run build                     # o, con repos ya clonados: DOCS_LOCAL_REPOS="uuv=../uuv-lab" npm run build
python -m http.server --directory dist
```
En local con `python -m http.server` no corre el login (el login lo hace el Worker); para probarlo usa `npm run cf:dev` (ver la sección de Cloudflare).

## Despliegue en Cloudflare (producción)
Worker `docs` en `https://docs.vanttec.workers.dev` (subdominio de cuenta `vanttec`), con static assets de `dist/` y `run_worker_first`. Bindings: D1 `DB` (base `docs-site`) y R2 `ARCHIVOS` (bucket `docs-hardware`, privado). Todo pasa por el login del Worker; los contenidos nunca se sirven sin sesión.

`.github/workflows/deploy-cloudflare.yml` construye el portal y lo despliega con `wrangler-action`. Se dispara con:
- push a la rama `cloudflare` (build completo; `main` queda comentado hasta M4). Con `concurrency`, un deploy pendiente sustituye al anterior (que aparece como cancelado);
- a mano, por proyecto: `gh workflow run deploy-cloudflare.yml --ref cloudflare -f proyecto=uuv`;
- `repository_dispatch` tipo `docs-actualizados` (con `client_payload: { proyecto, sha }`; solo corre desde la rama por defecto).

Secrets de GitHub Actions: `CLOUDFLARE_API_TOKEN` (permisos Workers Scripts, D1 y R2 de la cuenta; tiene caducidad, renovarlo antes de que venza) y `CLOUDFLARE_ACCOUNT_ID`. El workflow aplica las migraciones de D1 antes de desplegar. Sin ellos el workflow construye, avisa con `::warning::` y termina en verde sin desplegar. `DOCS_GITHUB_TOKEN` se usa para leer los repos privados.

Con un disparo por proyecto, el build corre `tools/fetch.mjs` con `DOCS_SOLO_PROYECTO=<id>`: vuelve a traer solo ese proyecto y conserva los demás del `.content/` restaurado de la caché, pero solo si están completos y su `sha` sigue siendo el HEAD remoto de su rama (`git ls-remote`); si avanzó, falta algo o la consulta falla, lo trae de nuevo. La clave de caché es única por ejecución e intento (`run_id` y `run_attempt`) y `restore-keys` toma la más reciente. Sin la variable (Vercel, push) se descarga todo.

Quién puede disparar un proyecto lo define `editoresDocs` en `projects.json` (logins de GitHub; sin esa lista nadie puede, se actualiza con el build completo). No llega a `.content/` ni al sitio. El workflow valida proyecto, sha y remitente con `tools/proyecto-valido.mjs` antes de construir.

El repo de código avisa con `docs/notify-docs-site.cloudflare.yml.example` (renombrar a `notify-docs-site.yml` en ese repo), que usa el secret `DOCS_SITE_DISPATCH_TOKEN`: un token fine-grained solo sobre `docs-site-lab` con permiso Actions: Read and write.

## Cloudflare: Worker, almacén y entorno local
El Worker (`worker/index.mjs`, `wrangler.jsonc`) usa el mismo login que Vercel (`lib/login-core.mjs`). Para probarlo en local:

```bash
npm run build
cp .dev.vars.example .dev.vars    # rellena los valores; .dev.vars no se sube a git
npx wrangler d1 migrations apply docs-site --local   # crea las tablas de D1 local (una vez; los datos quedan en .wrangler/state)
npm run cf:dev                    # http://localhost:8787
```

Almacén: en el Worker el almacén de comentarios, hardware y metadatos de archivos es **D1** (binding `DB`, base `docs-site`, esquema en `migrations/0001_almacen.sql`; el adaptador es `lib/almacen-d1.mjs`). Con `env.DB` el Worker usa siempre D1, aunque haya credenciales de Upstash. La base remota ya existe (se creó con `npx wrangler d1 create docs-site`) y su `database_id` está en `d1_databases` de `wrangler.jsonc` (no es un secreto). El workflow aplica las migraciones (`d1 migrations apply docs-site --remote`) antes del deploy. Si alguna vez hiciera falta copiar datos de Upstash a D1: `node tools/migrar-upstash-d1.mjs --salida datos.sql` (solo lee Upstash) y `npx wrangler d1 execute docs-site --remote --file=datos.sql`. En el corte no se copió nada: Vercel solo tenía datos de prueba.

Variables (en `.dev.vars` en local; en Cloudflare con `npx wrangler secret put <NOMBRE> --name docs`, desde la carpeta del repo):
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: OAuth App de GitHub (callback `<origen>/auth/callback`).
- `SESSION_SECRET`: 32+ caracteres aleatorios para firmar la cookie `docs_session`.
- `ALLOWED_ORG`: organización con acceso. `ALLOWED_USERS`: logins extra separados por coma (opcional). Hoy solo está `ALLOWED_USERS`; `ALLOWED_ORG=vanttec` se añade cuando la org apruebe la OAuth App.

- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: Upstash Redis (comentarios y metadatos de archivos). Solo hacen falta en Vercel o si el Worker corre sin el binding `DB`; con `DB` el Worker usa D1.

Archivos: el binding R2 `ARCHIVOS` (bucket `docs-hardware`, privado; en `wrangler dev` es local, en `.wrangler/state`). Los archivos se suben directo al Worker (`POST /api/archivos/` binario, `GET ?capacidades=1` anuncia el modo); en Vercel se sigue usando Vercel Blob.

`/api/hardware` ya responde en el Worker (igual que comentarios y archivos). El Markdown de hardware se renderiza en el navegador con marked + DOMPurify (carga diferida, solo en Electrónica y Mecánica), en Vercel y en Cloudflare; el servidor devuelve el Markdown tal cual.

Entorno local con Upstash simulado (sin cuenta): en otra terminal `node tools/upstash-local.mjs --token x` (escucha solo en 127.0.0.1:8079; `--puerto N` lo cambia), y en `.dev.vars`:

```
KV_REST_API_URL=http://127.0.0.1:8079
KV_REST_API_TOKEN=x
```

y luego `npm run cf:dev`. Para medir la CPU de satteri (el dato que motivó renderizar en el navegador): `node tools/medir-render.mjs [--iteraciones N]`.

Las URLs de versión (Preview) se protegen con Cloudflare Access (Zero Trust, equipo `vanttec-docs`), no con el login del Worker.


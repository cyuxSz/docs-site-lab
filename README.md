# docs-site-lab · portal de documentación (prueba)

Sitio que junta la documentación de varios repos en un solo portal con login de GitHub. **No tiene contenido propio**: en cada build trae `openwiki/` y `docs/arch/` de cada repo listado en [`projects.json`](projects.json).

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
middleware.js                login con GitHub (solo miembros de ALLOWED_ORG o ALLOWED_USERS)
```

## Cómo se actualiza
1. Un repo de código cambia `openwiki/` o `docs/arch/` en `main`.
2. Su workflow `notify-docs-site` llama al Deploy Hook de este proyecto en Vercel.
3. Vercel reconstruye el portal. No hay que tocar este repo.

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

## Variables de entorno en Vercel
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
En local no corre el login (el middleware solo se ejecuta en Vercel).

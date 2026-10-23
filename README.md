# docs-site-lab · portal de documentación (prueba)

Sitio que junta la documentación de varios repos en un solo portal con login de GitHub. **No tiene contenido propio**: en cada build trae `openwiki/` y `docs/arch/` de cada repo listado en [`projects.json`](projects.json).

```
projects.json            qué repos se publican
tools/build.mjs          build: clona solo openwiki/ y docs/arch/, exporta el visor de OpenWiki, arma dist/
site/                    portada multi-proyecto y página de cada proyecto
wiki-enhance/            capa sobre el visor de OpenWiki: pestañas en celular, enlaces directos, sin saltos de scroll
middleware.js            login con GitHub (solo miembros de ALLOWED_ORG o ALLOWED_USERS)
```

## Cómo se actualiza
1. Un repo de código cambia `openwiki/` o `docs/arch/` en `main`.
2. Su workflow `notify-docs-site` llama al Deploy Hook de este proyecto en Vercel.
3. Vercel reconstruye el portal. No hay que tocar este repo.

Para agregar un proyecto, se suma una entrada a `projects.json` y se le da acceso de lectura al token `DOCS_GITHUB_TOKEN`.

## Variables de entorno en Vercel
| Variable | Para qué |
|---|---|
| `DOCS_GITHUB_TOKEN` | Token *fine-grained* de solo lectura (Contents: Read) sobre los repos privados de `projects.json` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App de GitHub; callback `https://<dominio>/auth/callback` |
| `SESSION_SECRET` | 32+ caracteres aleatorios para firmar la cookie de sesión |
| `ALLOWED_ORG` | Org cuyos miembros pueden entrar (p. ej. `vanttec`) |
| `ALLOWED_USERS` | Opcional: logins separados por coma, como respaldo |

## Probar en local
```bash
node tools/build.mjs
python -m http.server --directory dist
```
En local no corre el login (el middleware solo se ejecuta en Vercel).

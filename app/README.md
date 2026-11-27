# App de escritorio de VantTec Docs

Una ventana Tauri 2 que muestra el portal. El webview no habla con el servidor: todo lo que
pide pasa por un proxy en Rust que añade el token de dispositivo. El token no sale de Rust.

- `nucleo/`: el proxy, el inicio de sesión, la pantalla de login y la regla de navegación. No
  depende de la ventana, así que sus tests corren en cualquier sistema.
- `src-tauri/`: la ventana. Registra el protocolo `portal` y entrega cada petición al proxy.
  No tiene comandos ni permisos. Su único plugin es `single-instance`, que no añade comandos.

## Iniciar sesión

Sin sesión, la app muestra un botón: «Iniciar sesión».

1. Pulsa el botón. Se abre el navegador del sistema en la página de permiso del portal.
2. Entra con GitHub si hace falta y pulsa «Autorizar».
3. El navegador abre un enlace `vanttec-docs://`. Windows se lo entrega a la app.
4. La app canjea el código del enlace por un token y muestra el portal. No hay que reiniciar.

Cosas que conviene saber:

- La app tiene que estar abierta y hay que empezar desde el botón. Un enlace
  `vanttec-docs://` que llega sin haber pulsado el botón se ignora.
- Un intento dura 10 minutos. Después hay que pulsar el botón otra vez.
- Entre dos aperturas del navegador pasan al menos 5 segundos.
- El token vive en memoria. Al cerrar la app, la sesión se pierde.
- Solo hay una instancia de la app. Abrirla otra vez trae al frente la ventana que ya existe.
- El código, el `verifier` y el token no llegan a la ventana ni a la consola.

### El esquema `vanttec-docs://`

Windows necesita saber qué programa abre los enlaces `vanttec-docs://`. Hoy el esquema se
registra solo en el binario de depuración. Al arrancar, ese binario escribe en
`HKEY_CURRENT_USER\Software\Classes\vanttec-docs` la ruta de su propio ejecutable. No toca
claves de toda la máquina y no necesita permisos de administrador.

El binario release no registra nada: lo hará el instalador. Hasta entonces, un binario release
abre el navegador, pero el enlace no vuelve a la app y el login no termina.

Para quitar el registro, borra esa clave con `regedit`.

El editor de diagrams.net no funciona dentro de la app: el proxy añade a toda respuesta la
cabecera `Content-Security-Policy: frame-src 'self'`, que impide los marcos de otro origen, así
que «Insertar → Diagrama» y «Editar diagrama» no abren el editor. Los diagramas ya guardados se
siguen viendo, y Excalidraw y el visor de PDF funcionan. Un enlace con `target="_blank"` o un
`window.open` hacia el propio portal navega la ventana principal; hacia otro sitio no hace nada.

## Requisitos

Rust (cargo) y Node. En Windows, además, WebView2 (viene con Windows 11) y las Microsoft C++ Build Tools con la carga de trabajo «Desarrollo para el escritorio con C++» (el enlazador de MSVC que usa la toolchain `x86_64-pc-windows-msvc`).

## Tests

```
cargo test --manifest-path app/nucleo/Cargo.toml --locked
```

Las comprobaciones de la configuración (`tests/app-config.test.mjs`) corren con `npm test`
desde la raíz del repo.

## Compilar

Desde `app/`:

```
npm ci
npx tauri build --no-bundle -- --locked
```

El ejecutable queda en `src-tauri/target/release/vanttec-docs.exe`. Para un binario de
depuración, añade `--debug` (queda en `src-tauri/target/debug/`).

## Arrancar el binario de depuración contra un servidor local

Solo el binario de depuración lee estas dos variables de entorno:

| Variable | Qué hace |
|---|---|
| `VANTTEC_DOCS_DESTINO_DEV` | Origen al que reenvía el proxy, por ejemplo `http://localhost:8792`. Acepta `https://host[:puerto]`, y `http://` solo hacia `localhost` o `127.0.0.1`. Si no es válido, la app no arranca. |
| `VANTTEC_DOCS_TOKEN_DEV` | Token de dispositivo que se envía a ese destino. Si no tiene forma de token, se descarta y la app arranca sin sesión. |

En PowerShell:

```
$env:VANTTEC_DOCS_DESTINO_DEV = "http://localhost:8792"
$env:VANTTEC_DOCS_TOKEN_DEV = "<token de un servidor de pruebas>"
.\src-tauri\target\debug\vanttec-docs.exe
```

Sin las variables, el binario de depuración apunta a producción y no tiene token.

No uses un token de producción: el token de desarrollo se envía al destino que indiques.

## El binario release ignora las variables

El binario release no lee el entorno: su destino es siempre
`https://docs.vanttec.workers.dev` y arranca sin token. No hay argumento ni variable que lo
cambie.

## Dependencias

Las versiones van fijadas (`=x.y.z` en Cargo, exactas en npm) y los tres locks se versionan:
`nucleo/Cargo.lock`, `src-tauri/Cargo.lock` y `package-lock.json`. Los dos `Cargo.lock` deben
coincidir en los paquetes que comparten, para que la app compile el núcleo con lo mismo que
se probó.

Los iconos de `src-tauri/icons/` son provisionales.

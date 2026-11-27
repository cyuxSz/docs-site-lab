-- Tokens de dispositivo (lib/dispositivos-core.mjs): credencial opaca para clientes que no son un navegador.
-- wrangler d1 migrations ya envuelve cada migración en una transacción: no lleva control de transacción propio.
-- Nunca se guarda el token ni el código en claro: `hash` es su SHA-256 en hexadecimal. Tiempos en milisegundos.

-- `id` es el identificador público (listar y revocar): el hash no sale del servidor.
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  nombre TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  tipo TEXT NOT NULL,
  alcance TEXT NOT NULL,
  creado INTEGER NOT NULL,
  ultimo_uso INTEGER,
  expira INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_login ON tokens (lower(login));

-- Códigos de un solo uso (60 s) que se canjean por un token en POST /auth/app/canje. El verifier de PKCE no se guarda.
CREATE TABLE IF NOT EXISTS codigos_app (
  hash TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  challenge TEXT NOT NULL,
  nombre TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  expira INTEGER NOT NULL
);

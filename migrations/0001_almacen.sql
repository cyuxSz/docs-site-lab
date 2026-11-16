-- Almacén del Worker sobre D1 (lib/almacen-d1.mjs): imita el subconjunto de Redis que usan los cores.
-- wrangler d1 migrations ya envuelve cada migración en una transacción: no lleva control de transacción propio.
CREATE TABLE IF NOT EXISTS claves (
  k TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('string', 'hash', 'set', 'list')),
  v TEXT,
  exp INTEGER
);
CREATE INDEX IF NOT EXISTS claves_exp ON claves (exp) WHERE exp IS NOT NULL;

-- Con rowid (no WITHOUT ROWID): HGETALL conserva el orden de inserción.
CREATE TABLE IF NOT EXISTS hash (
  k TEXT NOT NULL REFERENCES claves (k) ON DELETE CASCADE,
  campo TEXT NOT NULL,
  v TEXT NOT NULL,
  PRIMARY KEY (k, campo)
);

CREATE TABLE IF NOT EXISTS conjunto (
  k TEXT NOT NULL REFERENCES claves (k) ON DELETE CASCADE,
  m TEXT NOT NULL,
  PRIMARY KEY (k, m)
);

CREATE TABLE IF NOT EXISTS lista (
  k TEXT NOT NULL REFERENCES claves (k) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  v TEXT NOT NULL,
  PRIMARY KEY (k, pos)
);

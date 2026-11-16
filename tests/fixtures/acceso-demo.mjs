// Tabla de proyectos restringidos solo para pruebas. El portal no tiene proyectos restringidos por defecto
// (access.config.js → RESTRICTED = {}), así que los tests de acceso inyectan esta tabla en canAccess/isRestricted,
// crearMiddleware y crearHandler. "restringido-demo" no existe en projects.json (lo comprueba acceso.test.mjs).
export const ID_DEMO = "restringido-demo";
export const ADMIN_DEMO = "cyuxSz";
export const DEMO = Object.freeze({ [ID_DEMO]: Object.freeze([ADMIN_DEMO]) });

// Servidor HTTP local de prueba: devuelve las cabeceras que recibió.
// Sirve para comprobar que Rust añade `Authorization` al reenviar /api/proxy.
import http from 'node:http';

const puerto = Number(process.env.PUERTO || 8799);
http
  .createServer((req, res) => {
    console.log(req.method, req.url, 'authorization =', req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ metodo: req.method, url: req.url, cabeceras: req.headers }));
  })
  .listen(puerto, '127.0.0.1', () => console.log('escuchando en', puerto));

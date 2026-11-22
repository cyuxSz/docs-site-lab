// Servidor HTTP local de prueba.
//   /whoami        devuelve las cabeceras recibidas (prueba B: Rust añade `Authorization`)
//   /visor?t=sch   página con <kicanvas-embed> y un archivo mínimo (sch o pcb), con el KiCanvas del portal
//   /pdf           un PDF mínimo;  /pdf-marco  página que lo muestra en un <iframe>
import http from 'node:http';
import fs from 'node:fs';

const puerto = Number(process.env.PUERTO || 8799);
const KICANVAS = new URL('../../public/vendor/kicanvas/kicanvas.js', import.meta.url);

const SCH = `(kicad_sch (version 20230121) (generator eeschema)
  (uuid 11111111-1111-4111-8111-111111111111)
  (paper "A4")
  (lib_symbols)
  (wire (pts (xy 100 100) (xy 150 100)) (stroke (width 0) (type default)) (uuid 22222222-2222-4222-8222-222222222222))
  (wire (pts (xy 150 100) (xy 150 130)) (stroke (width 0) (type default)) (uuid 33333333-3333-4333-8333-333333333333))
  (text "prueba lote 0" (at 100 95 0) (effects (font (size 2.54 2.54)) (justify left bottom)) (uuid 44444444-4444-4444-8444-444444444444))
  (sheet_instances (path "/" (page "1")))
)`;
const PCB = `(kicad_pcb (version 20221018) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (36 "B.SilkS" user) (37 "F.SilkS" user) (44 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (gr_rect (start 100 100) (end 150 130) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts") (tstamp 55555555-5555-4555-8555-555555555555))
  (gr_line (start 105 105) (end 145 125) (stroke (width 0.3) (type default)) (layer "F.SilkS") (tstamp 66666666-6666-4666-8666-666666666666))
  (segment (start 105 125) (end 145 105) (width 0.5) (layer "F.Cu") (net 0) (tstamp 77777777-7777-4777-8777-777777777777))
)`;

function pdfMinimo() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const flujo = 'BT /F1 24 Tf 40 100 Td (PDF de prueba lote 0) Tj ET';
  objs[3] = `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const pos = [];
  objs.forEach((o, i) => { pos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (tipo, cuerpo, extra = {}) => { res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-store', ...extra }); res.end(cuerpo); };
    if (url.pathname === '/kicanvas.js') return enviar('text/javascript', fs.readFileSync(KICANVAS));
    if (url.pathname === '/visor') {
      const texto = url.searchParams.get('t') === 'pcb' ? PCB : SCH;
      return enviar('text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>KiCanvas local</title>
<style>body{margin:16px;font:14px system-ui;min-height:2000px}kicanvas-embed{display:block;width:100%;height:min(70vh,700px);min-height:320px}</style>
<h1>KiCanvas local (${url.searchParams.get('t') === 'pcb' ? 'PCB' : 'esquemático'})</h1>
<figure class="hw-kicad"><div role="region"><kicanvas-embed controls="basic" controlslist="nodownload nofullscreen noflipview"><kicanvas-source>${texto}</kicanvas-source></kicanvas-embed></div></figure>
<script type="module" src="/kicanvas.js"></script>`);
    }
    if (url.pathname === '/pdf') return enviar('application/pdf', pdfMinimo(), { 'content-disposition': 'inline; filename="prueba.pdf"' });
    if (url.pathname === '/pdf-marco')
      return enviar('text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><title>PDF en iframe</title><h1>PDF en iframe</h1><iframe src="/pdf" style="width:100%;height:500px"></iframe>');
    console.log(req.method, req.url, 'authorization =', req.headers.authorization);
    enviar('application/json', JSON.stringify({ metodo: req.method, url: req.url, cabeceras: req.headers }));
  })
  .listen(puerto, '127.0.0.1', () => console.log('escuchando en', puerto));

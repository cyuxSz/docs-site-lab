#!/usr/bin/env python3
"""Genera una biblioteca de diagrams.net y un SVG por integrado desde un CSV de pines o un .kicad_sym.

Solo usa la biblioteca estándar (Python 3.10+). Ver `--ayuda`.
"""
import csv
import io
import json
import os
import re
import stat
import sys
import unicodedata

LADOS = ("izquierda", "derecha", "arriba", "abajo")
TIPOS = ("entrada", "salida", "bidireccional", "alimentacion", "pasivo", "sin_conexion")
COLUMNAS_OBLIGATORIAS = ("integrado", "pin", "nombre", "lado")
COLUMNAS = COLUMNAS_OBLIGATORIAS + ("tipo",)
MAX_PROFUNDIDAD = 64
ANGULO_A_LADO = {0: "izquierda", 180: "derecha", 270: "arriba", 90: "abajo"}
TIPO_KICAD = {
    "input": "entrada", "output": "salida", "bidirectional": "bidireccional", "power_in": "alimentacion",
    "power_out": "alimentacion", "passive": "pasivo", "no_connect": "sin_conexion",
}
CONTROL = re.compile("[\x00-\x1f\x7f\ufffe\uffff]")
CONTROL_TERMINAL = re.compile("[\x00-\x1f\x7f-\x9f]")

AYUDA = """\
uso: python tools/integrados.py --entrada <archivo.csv|.kicad_sym> --salida <carpeta>

Genera una biblioteca de diagrams.net (<base>.xml) y un SVG de vista previa (<slug>.svg) por integrado.

opciones:
  --entrada ARCHIVO   tabla de pines en CSV (.csv) o símbolos de KiCad (.kicad_sym); la extensión decide el formato
  --salida CARPETA    carpeta donde se escriben los archivos (se crea si falta)
  -h, --ayuda         muestra esta ayuda y termina

CSV: UTF-8, separado por comas o por punto y coma (se decide con la cabecera), primera fila de cabecera. Columnas obligatorias: integrado, pin, nombre, lado
(izquierda, derecha, arriba o abajo). Columna opcional: tipo (entrada, salida, bidireccional, alimentacion,
pasivo, sin_conexion).

Si en la carpeta de salida ya existen archivos con esos nombres, se reemplazan (si cambia el contenido de alguno,
se avisa por stderr).

Códigos de salida: 0 bien, 1 entrada inválida, 2 uso incorrecto.
"""


class Error(Exception):
    """Entrada inválida (código 1)."""

    def __init__(self, mensaje, linea=None, archivo=None):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.linea = linea
        self.archivo = archivo


class Uso(Exception):
    """Uso incorrecto de la línea de comandos (código 2)."""


# ── utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────
def slug(nombre):
    t = unicodedata.normalize("NFKD", nombre)
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"[^a-z0-9._-]", "-", t)
    t = re.sub(r"-+", "-", t)
    return t.strip("-.")


def esc(texto):
    return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def sin_control(texto, que, linea=None):
    if CONTROL.search(texto):
        raise Error(f"{que} lleva caracteres de control o no permitidos", linea)


def decodificar(datos):
    try:
        return datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Error("el archivo no es UTF-8 válido") from None


def n(v):
    return str(int(round(v)))


def n4(v):
    v = round(v, 4)
    return str(int(v)) if v == int(v) else repr(v)


def techo10(v):
    return int(-(-v // 10) * 10)


# ── lectura de CSV ────────────────────────────────────────────────────────────────────────────────────────────────────
MAL_FORMADO = ("CSV mal formado: revisa las comillas (texto pegado a una comilla de cierre, comilla sin cerrar "
               "o un campo demasiado largo)")


def registros(texto, separador, solo_primero=False):
    """Registros no vacíos del CSV como (línea donde empieza, campos)."""
    lector = csv.reader(io.StringIO(texto, newline=""), delimiter=separador, strict=True)
    filas = []
    while True:
        inicio = lector.line_num + 1
        try:
            campos = next(lector)
        except StopIteration:
            break
        except csv.Error:
            raise Error(MAL_FORMADO, inicio) from None
        if any(c.strip() for c in campos):
            filas.append((inicio, campos))
            if solo_primero:
                break
    return filas


def elegir_separador(texto):
    """Decide entre coma y punto y coma mirando solo la cabecera (primer registro no vacío)."""
    lecturas = []  # (separador, línea, celdas) de las lecturas que pudieron leer la cabecera
    error_formato = None  # primer error de formato (el de la coma si falló; si no, el de punto y coma)
    for sep in (",", ";"):
        try:
            filas = registros(texto, sep, True)
        except Error as e:
            if error_formato is None:
                error_formato = e
            continue
        if filas:
            lecturas.append((sep, filas[0][0], [c.strip().lower() for c in filas[0][1]]))
    validas = [sep for sep, _, cab in lecturas if all(c in cab for c in COLUMNAS_OBLIGATORIAS)]
    if len(validas) == 2:
        raise Error("el separador es ambiguo: la cabecera es válida con coma y con punto y coma; "
                    "deja solo uno de los dos en la cabecera", lecturas[0][1])
    if validas:
        return validas[0]
    if error_formato is not None:
        raise error_formato
    if not lecturas:
        return ","
    mejor = max(lecturas, key=lambda t: sum(c in t[2] for c in COLUMNAS_OBLIGATORIAS))  # en empate, la de coma
    faltan = [c for c in COLUMNAS_OBLIGATORIAS if c not in mejor[2]]
    raise Error(f"faltan columnas obligatorias: {', '.join(faltan)} (la cabecera debe llevar "
                f"{', '.join(COLUMNAS_OBLIGATORIAS)}, separadas por coma o por punto y coma)", mejor[1])


def leer_csv(texto):
    filas = registros(texto, elegir_separador(texto))
    if not filas:
        raise Error("el archivo está vacío")
    _, cab = filas[0]
    cab = [c.strip().lower() for c in cab]
    for i, c in enumerate(cab):
        if c not in COLUMNAS:
            raise Error(f"columna desconocida «{c}» (admitidas: {', '.join(COLUMNAS)})", filas[0][0])
        if c in cab[:i]:
            raise Error(f"columna repetida «{c}»", filas[0][0])
    chips = {}
    for linea, campos in filas[1:]:
        if len(campos) != len(cab):
            raise Error(f"se esperaban {len(cab)} columnas y hay {len(campos)}", linea)
        for nombre_col, crudo in zip(cab, campos):
            sin_control(crudo, f"la columna «{nombre_col}»", linea)
        fila = {c: v.strip() for c, v in zip(cab, campos)}
        for c in COLUMNAS_OBLIGATORIAS:
            if not fila[c]:
                raise Error(f"el campo «{c}» está vacío", linea)
        lado = fila["lado"].lower()
        if lado not in LADOS:
            raise Error(f"lado desconocido «{fila['lado']}» (usa: {', '.join(LADOS)})", linea)
        tipo = fila.get("tipo", "").lower()
        if tipo and tipo not in TIPOS:
            raise Error(f"tipo desconocido «{fila['tipo']}» (usa: {', '.join(TIPOS)})", linea)
        chip = chips.setdefault(fila["integrado"], {"nombre": fila["integrado"], "linea": linea, "pines": [], "numeros": set()})
        if fila["pin"] in chip["numeros"]:
            raise Error(f"pin duplicado «{fila['pin']}» en el integrado «{fila['integrado']}»", linea)
        chip["numeros"].add(fila["pin"])
        chip["pines"].append({"numero": fila["pin"], "nombre": fila["nombre"], "lado": lado, "tipo": tipo})
    if not chips:
        raise Error("la tabla no tiene ningún pin")
    resultado = []
    for chip in chips.values():
        pines = sorted(chip["pines"], key=lambda p: LADOS.index(p["lado"]))  # estable: respeta el orden de las filas
        resultado.append((chip["nombre"], pines, chip["linea"]))
    return resultado, []


# ── lectura de .kicad_sym ─────────────────────────────────────────────────────────────────────────────────────────────
TOKEN = re.compile(r'\s+|\(|\)|"[^"\\]*(?:\\.[^"\\]*)*"|[^\s()"]+', re.DOTALL)
ESCAPES = {"n": "\n", "\\": "\\", '"': '"'}


def tokenizar(texto):
    tokens = []
    pos, fin = 0, len(texto)
    while pos < fin:
        m = TOKEN.match(texto, pos)
        if not m:  # solo puede ser una comilla sin cierre
            raise Error("cadena sin cerrar (falta la comilla de cierre)", texto.count("\n", 0, pos) + 1)
        t = m.group()
        pos = m.end()
        if t[0] == "(" or t[0] == ")":
            tokens.append((t, False))
        elif t[0] == '"':
            tokens.append((re.sub(r"\\(.)", lambda mm: ESCAPES.get(mm.group(1), mm.group(1)), t[1:-1], flags=re.DOTALL), True))
        elif not t.isspace():
            tokens.append((t, False))
    return tokens


def parsear_sexp(texto):
    if not texto.strip():
        raise Error("el archivo está vacío")
    tokens = tokenizar(texto)
    pila, raiz = [], None
    for t, es_cadena in tokens:
        if not es_cadena and t == "(":
            if raiz is not None:
                raise Error("hay contenido después de la raíz (kicad_symbol_lib)")
            if len(pila) >= MAX_PROFUNDIDAD:
                raise Error(f"anidamiento excesivo: hay paréntesis anidados a más de {MAX_PROFUNDIDAD} niveles")
            pila.append([])
        elif not es_cadena and t == ")":
            if not pila:
                raise Error("paréntesis de más: hay un «)» sin su «(»")
            lista = pila.pop()
            if pila:
                pila[-1].append(lista)
            else:
                raiz = lista
        else:
            if not pila:
                raise Error("el archivo debe empezar por (kicad_symbol_lib …)")
            pila[-1].append(t)
    if pila:
        raise Error("paréntesis sin cerrar: falta algún «)»")
    if not raiz or raiz[0] != "kicad_symbol_lib":
        raise Error("la raíz debe ser (kicad_symbol_lib …); no parece una biblioteca de símbolos de KiCad")
    return raiz


def hijos(lista, cabeza):
    return [x for x in lista if isinstance(x, list) and x and x[0] == cabeza]


def cadena(lista, cabeza):
    h = hijos(lista, cabeza)
    if h and len(h[0]) > 1 and isinstance(h[0][1], str):
        return h[0][1]
    return None


def numero(texto):
    try:
        return float(texto)
    except (TypeError, ValueError):
        return None


def pines_propios(simbolo, nombre):
    """Pines de un símbolo de primer nivel: los suyos y los de sus unidades (estilo 0 o 1), en orden de archivo."""
    pines = []
    vistos = set()

    def recoger(lista):
        for p in hijos(lista, "pin"):
            numero_pin = cadena(p, "number")
            if numero_pin is None or numero_pin == "":
                raise Error(f"símbolo «{nombre}»: un pin no tiene (number …)")
            nombre_pin = cadena(p, "name")
            if nombre_pin is None:
                raise Error(f"símbolo «{nombre}»: el pin «{numero_pin}» no tiene (name …)")
            at = hijos(p, "at")
            if not at or len(at[0]) < 4:
                raise Error(f"símbolo «{nombre}»: el pin «{numero_pin}» no tiene (at x y ángulo)")
            x, y, ang = numero(at[0][1]), numero(at[0][2]), numero(at[0][3])
            if x is None or y is None or ang is None:
                raise Error(f"símbolo «{nombre}»: el pin «{numero_pin}» tiene una posición no numérica")
            if ang not in (0, 90, 180, 270):
                raise Error(f"símbolo «{nombre}»: el pin «{numero_pin}» tiene el ángulo {at[0][3]}; solo se admiten 0, 90, 180 y 270")
            sin_control(numero_pin, f"el número del pin en «{nombre}»")
            sin_control(nombre_pin, f"el nombre del pin «{numero_pin}» de «{nombre}»")
            if numero_pin in vistos:
                raise Error(f"pin duplicado «{numero_pin}» en el símbolo «{nombre}»")
            vistos.add(numero_pin)
            tipo = p[1] if len(p) > 1 and isinstance(p[1], str) else ""
            pines.append({"numero": numero_pin, "nombre": nombre_pin, "lado": ANGULO_A_LADO[int(ang)],
                          "tipo": TIPO_KICAD.get(tipo, ""), "x": x, "y": y})

    recoger(simbolo)
    for unidad in hijos(simbolo, "symbol"):
        m = re.search(r"_(\d+)_(\d+)$", unidad[1]) if len(unidad) > 1 and isinstance(unidad[1], str) else None
        if m and int(m.group(2)) >= 2:
            continue
        recoger(unidad)

    def clave(p):
        i = LADOS.index(p["lado"])
        return (i, -p["y"]) if i < 2 else (i, p["x"])

    pines.sort(key=clave)
    return pines


def leer_kicad(texto):
    raiz = parsear_sexp(texto)
    simbolos = {}
    for s in hijos(raiz, "symbol"):
        if len(s) < 2 or not isinstance(s[1], str):
            continue
        nombre = s[1]
        if not nombre:
            raise Error("hay un símbolo sin nombre")
        sin_control(nombre, f"el nombre del símbolo «{nombre}»")
        if nombre in simbolos:
            raise Error(f"símbolo duplicado «{nombre}»")
        simbolos[nombre] = {"pines": pines_propios(s, nombre), "extends": cadena(s, "extends")}
    for nombre, s in simbolos.items():
        if s["extends"] is not None and s["extends"] not in simbolos:
            raise Error(f"el símbolo «{nombre}» extiende a «{s['extends']}», que no está en el archivo")
    chips, avisos = [], []
    for nombre, s in simbolos.items():
        pines, actual, visitados = s["pines"], s, {nombre}
        while not pines and actual["extends"] is not None:
            if actual["extends"] in visitados:
                raise Error(f"el símbolo «{nombre}» tiene una cadena de `extends` circular")
            visitados.add(actual["extends"])
            actual = simbolos[actual["extends"]]
            pines = actual["pines"]
        if pines:
            chips.append((nombre, [{k: p[k] for k in ("numero", "nombre", "lado", "tipo")} for p in pines], None))
        else:
            avisos.append(f"el símbolo «{nombre}» no tiene pines y se omite")
    if not chips:
        raise Error("la biblioteca no tiene ningún símbolo con pines")
    return chips, avisos


# ── biblioteca de diagrams.net ────────────────────────────────────────────────────────────────────────────────────────
def por_lado(pines):
    g = {lado: [] for lado in LADOS}
    for p in pines:
        g[p["lado"]].append(p)
    return g


def ancho_col(ps, campo, cw, margen):
    return max(len(p[campo]) for p in ps) * cw + margen if ps else 0


def modelo_drawio(nombre, pines):
    CH, FILA, PAD = 7, 20, 6
    g = por_lado(pines)
    nl, nr, nt, nb = (len(g[x]) for x in LADOS)
    nuL, noL = ancho_col(g["izquierda"], "numero", CH, PAD), ancho_col(g["izquierda"], "nombre", CH, PAD)
    nuR, noR = ancho_col(g["derecha"], "numero", CH, PAD), ancho_col(g["derecha"], "nombre", CH, PAD)
    nuT, noT = ancho_col(g["arriba"], "numero", CH, PAD), ancho_col(g["arriba"], "nombre", CH, PAD)
    nuB, noB = ancho_col(g["abajo"], "numero", CH, PAD), ancho_col(g["abajo"], "nombre", CH, PAD)
    res_arriba = 2 + nuT + noT + PAD if nt else 0
    res_abajo = 2 + nuB + noB + PAD if nb else 0
    banda = 20 if nt or nb else 0  # franja propia para el nombre del integrado, bajo los rótulos de arriba
    y0 = res_arriba + banda + 10
    filas = max(nl, nr) * FILA
    h = max(40, techo10(y0 + filas + res_abajo + 10))
    w = max(40, techo10(max(nuL + noL + nuR + noR + len(nombre) * CH + 16, max(nt, nb) * FILA + FILA)))

    puntos, celdas, contador = [], [], {x: 0 for x in LADOS}

    def etiqueta(i, sufijo, valor, x, y, ancho, alineacion, rotada=False):
        estilo = f"text;strokeColor=none;fillColor=none;fontSize=10;fontColor=#000000;verticalAlign=middle;align={alineacion};spacing=0"
        if rotada:
            estilo += ";rotation=270"
        celdas.append(
            f'<mxCell id="{sufijo}{i}" value="{esc(valor)}" style="{estilo}" vertex="1" connectable="0" parent="cuerpo">'
            f'<mxGeometry x="{n(x)}" y="{n(y)}" width="{n(ancho)}" height="14" as="geometry"/></mxCell>')

    for i, p in enumerate(pines):
        lado = p["lado"]
        k = contador[lado]
        contador[lado] += 1
        if lado in ("izquierda", "derecha"):
            cy = y0 + 10 + k * FILA
            puntos.append(f"[{0 if lado == 'izquierda' else 1},{n4(cy / h)},0]")
            if lado == "izquierda":
                etiqueta(i, "n", p["numero"], 2, cy - 7, nuL, "left")
                etiqueta(i, "m", p["nombre"], 2 + nuL, cy - 7, noL, "left")
            else:
                etiqueta(i, "n", p["numero"], w - 2 - nuR, cy - 7, nuR, "right")
                etiqueta(i, "m", p["nombre"], w - 2 - nuR - noR, cy - 7, noR, "right")
        else:
            cantidad = nt if lado == "arriba" else nb
            fx = (k + 1) / (cantidad + 1)
            px = w * fx
            puntos.append(f"[{n4(fx)},{0 if lado == 'arriba' else 1},0]")
            if lado == "arriba":
                cn, cm, ln, lm = 2 + nuT / 2, 2 + nuT + noT / 2, nuT, noT
            else:
                cn, cm, ln, lm = h - 2 - nuB / 2, h - 2 - nuB - noB / 2, nuB, noB
            etiqueta(i, "n", p["numero"], px - ln / 2, cn - 7, ln, "center", True)
            etiqueta(i, "m", p["nombre"], px - lm / 2, cm - 7, lm, "center", True)

    # Sin franja propia, el nombre va centrado en el hueco entre las columnas de rótulos (solo si son de distinto ancho).
    desplazo = ""
    if not banda:
        izq_libre = 2 + nuL + noL if nl else 0
        der_libre = w - 2 - nuR - noR if nr else w
        d = izq_libre + der_libre - w
        if d:
            desplazo = f";spacingLeft={n(d)}" if d > 0 else f";spacingRight={n(-d)}"
    estilo = ("rounded=0;whiteSpace=wrap;fillColor=#FFFFFF;strokeColor=#000000;fontColor=#000000;fontSize=11;fontStyle=1;"
              f"{f'verticalAlign=top;spacingTop={n(res_arriba)}' if banda else 'verticalAlign=middle'};"
              f"align=center{desplazo};points=[{','.join(puntos)}]")
    xml = (
        '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
        f'<mxCell id="cuerpo" value="{esc(nombre)}" style="{estilo}" vertex="1" parent="1">'
        f'<mxGeometry x="0" y="0" width="{w}" height="{h}" as="geometry"/></mxCell>'
        + "".join(celdas) + "</root></mxGraphModel>")
    return {"xml": xml, "w": w, "h": h, "aspect": "fixed", "title": nombre}


def biblioteca(entradas):
    texto = json.dumps(entradas, ensure_ascii=False, separators=(",", ":"))
    texto = texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"<mxlibrary>{texto}</mxlibrary>\n"


# ── SVG de vista previa ───────────────────────────────────────────────────────────────────────────────────────────────
COLOR_TIPO = {
    "entrada": "#1d6fdc", "salida": "#d9480f", "bidireccional": "#7048e8", "alimentacion": "#c92a2a",
    "pasivo": "#868e96", "sin_conexion": "#adb5bd", "": "#495057",
}


def svg_integrado(nombre, pines):
    CW, FILA, PAD, M = 8, 24, 8, 12
    g = por_lado(pines)
    nl, nr, nt, nb = (len(g[x]) for x in LADOS)
    numeros_lr = [len(p["numero"]) for p in g["izquierda"] + g["derecha"]]
    numeros_tb = [len(p["numero"]) for p in g["arriba"] + g["abajo"]]
    stub = max(24, (max(numeros_lr) if numeros_lr else 0) * CW + 8)
    noL = ancho_col(g["izquierda"], "nombre", CW, 2 * PAD)
    noR = ancho_col(g["derecha"], "nombre", CW, 2 * PAD)
    res_arriba = ancho_col(g["arriba"], "nombre", CW, 2 * PAD)
    res_abajo = ancho_col(g["abajo"], "nombre", CW, 2 * PAD)
    paso = max(28, (max(numeros_tb) if numeros_tb else 0) * CW + 12)
    banda = 18 if nt or nb else 0  # franja propia para el título, bajo los rótulos de arriba
    y0 = res_arriba + banda + M
    filas = max(nl, nr) * FILA
    h = max(60, y0 + filas + res_abajo + M)
    w = max(60, noL + noR + len(nombre) * CW + 3 * PAD, (max(nt, nb) + 1) * paso)
    ox = oy = M + stub
    W, H = w + 2 * ox, h + 2 * oy

    titulo_x = ox + w / 2
    if not banda and noL != noR:  # nombre centrado en el hueco libre entre los rótulos laterales
        titulo_x = ox + ((noL - PAD if nl else 0) + (w - (noR - PAD) if nr else w)) / 2

    def texto(x, y, valor, ancla, extra=""):
        return f'<text x="{n(x)}" y="{n(y)}" text-anchor="{ancla}" fill="#111111"{extra}>{esc(valor)}</text>'

    sal = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="sans-serif" font-size="12">',
        f"<title>{esc(nombre)}</title>",
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>',
        f'<rect x="{ox}" y="{oy}" width="{w}" height="{h}" fill="#fff8dc" stroke="#333333" stroke-width="2"/>',
        texto(titulo_x, oy + (res_arriba + 14 if banda else (y0 + filas / 2 if filas else h / 2) + 4), nombre, "middle", ' font-weight="bold" font-size="14"'),
    ]
    contador = {x: 0 for x in LADOS}
    for p in pines:
        lado = p["lado"]
        k = contador[lado]
        contador[lado] += 1
        color = COLOR_TIPO.get(p["tipo"], COLOR_TIPO[""])
        cabecera = (f'<g class="pin" data-numero="{esc(p["numero"])}" data-nombre="{esc(p["nombre"])}" '
                    f'data-lado="{lado}" data-tipo="{p["tipo"]}">')
        if lado in ("izquierda", "derecha"):
            cy = oy + y0 + FILA / 2 + k * FILA
            izq = lado == "izquierda"
            x1, x2 = (ox - stub, ox) if izq else (ox + w, ox + w + stub)
            partes = [
                f'<line x1="{n(x1)}" y1="{n(cy)}" x2="{n(x2)}" y2="{n(cy)}" stroke="#333333" stroke-width="2"/>',
                f'<circle cx="{n(x1 if izq else x2)}" cy="{n(cy)}" r="3" fill="{color}"/>',
                texto((x1 + x2) / 2, cy - 5, p["numero"], "middle", ' font-size="11"'),
                texto(ox + PAD if izq else ox + w - PAD, cy + 4, p["nombre"], "start" if izq else "end"),
            ]
        else:
            cantidad = nt if lado == "arriba" else nb
            px = ox + w * (k + 1) / (cantidad + 1)
            arriba = lado == "arriba"
            y1, y2 = (oy - stub, oy) if arriba else (oy + h, oy + h + stub)
            ry = oy + PAD if arriba else oy + h - PAD
            partes = [
                f'<line x1="{n(px)}" y1="{n(y1)}" x2="{n(px)}" y2="{n(y2)}" stroke="#333333" stroke-width="2"/>',
                f'<circle cx="{n(px)}" cy="{n(y1 if arriba else y2)}" r="3" fill="{color}"/>',
                texto(px + 5, (y1 + y2) / 2 + 4, p["numero"], "start", ' font-size="11"'),
                texto(px + 4, ry, p["nombre"], "end" if arriba else "start",
                      f' transform="rotate(-90 {n(px + 4)} {n(ry)})"'),
            ]
        sal.append(cabecera + "".join(partes) + "</g>")
    sal.append("</svg>")
    return "\n".join(sal) + "\n"


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
def parsear_args(argv):
    if any(a in ("-h", "--ayuda") for a in argv):
        return None
    valores, i = {}, 0
    while i < len(argv):
        a = argv[i]
        nombre, igual, valor = a.partition("=")
        if nombre not in ("--entrada", "--salida"):
            raise Uso(f"opción desconocida «{a}»")
        if nombre in valores:
            raise Uso(f"{nombre} se indicó más de una vez")
        if not igual:
            i += 1
            if i >= len(argv):
                raise Uso(f"{nombre} necesita un valor")
            valor = argv[i]
        valores[nombre] = valor
        i += 1
    for obligatoria in ("--entrada", "--salida"):
        if obligatoria not in valores:
            raise Uso(f"falta {obligatoria}")
    return valores["--entrada"], valores["--salida"]


def procesar(entrada, salida):
    if not os.path.exists(entrada):
        raise Error("el archivo no existe")
    if os.path.isdir(entrada):
        raise Error("es una carpeta, no un archivo")
    nombre_archivo = os.path.basename(entrada)
    ext = next((e for e in (".csv", ".kicad_sym") if nombre_archivo.lower().endswith(e)), None)
    if ext is None:
        raise Error("extensión no admitida: la entrada debe ser .csv o .kicad_sym")
    base = nombre_archivo[: -len(ext)]
    try:
        with open(entrada, "rb") as f:
            datos = f.read()
    except OSError as e:
        raise Error(f"no se pudo leer el archivo ({motivo(e)})") from None
    texto = decodificar(datos)
    chips, avisos = leer_csv(texto) if ext == ".csv" else leer_kicad(texto)
    vistos = {}
    for nombre, pines, linea in chips:
        sin_control(nombre, f"el nombre del integrado «{nombre}»", linea)
        s = slug(nombre)
        if not s:
            raise Error(f"el integrado «{nombre}» no da un nombre de archivo válido (necesita letras o números)", linea)
        if s in vistos:
            raise Error(f"los integrados «{vistos[s]}» y «{nombre}» darían el mismo archivo {s}.svg", linea)
        vistos[s] = nombre
    archivos = {f"{base}.xml": biblioteca([modelo_drawio(nom, pines) for nom, pines, _ in chips])}
    for nombre, pines, _ in chips:
        archivos[f"{slug(nombre)}.svg"] = svg_integrado(nombre, pines)
    reemplazados = escribir(salida, archivos)
    return len(chips), avisos, reemplazados


def motivo(e):
    if isinstance(e, PermissionError):
        return "sin permiso"
    if isinstance(e, FileNotFoundError):
        return "no se encuentra la ruta"
    return "error del sistema"


def escribir(salida, archivos):
    """Escribe los archivos de forma atómica por archivo (temporal en la carpeta de salida + os.replace).

    Devuelve cuántos archivos que ya existían cambiaron de contenido."""
    if os.path.exists(salida) and not os.path.isdir(salida):
        raise Error("la salida existe y no es una carpeta", archivo=salida)
    for nombre_salida in archivos:
        if os.path.isdir(os.path.join(salida, nombre_salida)):
            raise Error(f"{nombre_salida} es una carpeta y no se puede reemplazar por un archivo", archivo=salida)
    try:
        os.makedirs(salida, exist_ok=True)
    except OSError as e:
        raise Error(f"no se pudo crear la carpeta de salida ({motivo(e)})", archivo=salida) from None
    temporales = {}  # nombre de salida -> ruta del temporal que aún no se colocó
    reemplazados = 0
    umask = os.umask(0)  # lectura sin carrera: se fija 0 y se restaura enseguida (el generador es de un solo hilo)
    os.umask(umask)
    try:
        for i, (nombre_salida, contenido) in enumerate(archivos.items()):
            datos = contenido.encode("utf-8")
            try:
                with open(os.path.join(salida, nombre_salida), "rb") as f:
                    if f.read() != datos:
                        reemplazados += 1
            except OSError:
                pass  # no existía (o no se puede leer): no cuenta como reemplazo
            try:
                temporales[nombre_salida] = crear_temporal(salida, i, datos)
                destino = os.path.join(salida, nombre_salida)
                try:
                    modo = stat.S_IMODE(os.stat(destino).st_mode)  # ya existía: conserva su modo
                except FileNotFoundError:
                    modo = 0o666 & ~umask  # nueva: como una creación normal
                os.chmod(temporales[nombre_salida], modo)  # antes del os.replace
            except OSError as e:
                raise Error(f"no se pudo escribir {nombre_salida} ({motivo(e)})", archivo=salida) from None
        for nombre_salida in list(temporales):
            try:
                os.replace(temporales[nombre_salida], os.path.join(salida, nombre_salida))
            except OSError as e:
                raise Error(f"no se pudo colocar {nombre_salida} en la carpeta de salida ({motivo(e)})", archivo=salida) from None
            del temporales[nombre_salida]
    finally:
        for ruta in temporales.values():
            try:
                os.chmod(ruta, 0o600)  # el temporal pudo heredar el solo lectura: sin esto no se borra en Windows
                os.remove(ruta)
            except OSError:
                pass
    return reemplazados


def crear_temporal(salida, indice, datos):
    """Crea un temporal nuevo (nombre que no acaba en .xml ni .svg) en la carpeta de salida y lo llena."""
    intento = 0
    banderas = os.O_WRONLY | os.O_CREAT | os.O_EXCL | (os.O_BINARY if os.name == "nt" else 0)
    while True:
        ruta = os.path.join(salida, f".integrados-{os.getpid()}-{indice}-{intento}.tmp")
        try:
            fd = os.open(ruta, banderas, 0o600)
            break
        except FileExistsError:
            intento += 1
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(datos)
    except BaseException:
        try:
            os.remove(ruta)
        except OSError:
            pass
        raise
    return ruta


def neutralizar(texto):
    """Escribe cada carácter de control (C0, DEL y C1) como \\xNN para que no llegue a la terminal ni a los logs."""
    return CONTROL_TERMINAL.sub(lambda m: f"\\x{ord(m.group()):02x}", texto)


def emitir(flujo, linea):
    """Único punto de salida de mensajes: una línea, sin caracteres de control."""
    flujo.write(neutralizar(linea) + "\n")


def main(argv):
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        args = parsear_args(argv)
    except Uso as e:
        emitir(sys.stderr, f"error: {e}. Usa --ayuda para ver las opciones.")
        return 2
    if args is None:
        sys.stdout.write(AYUDA)
        return 0
    entrada, salida = args
    try:
        cantidad, avisos, reemplazados = procesar(entrada, salida)
    except Error as e:
        lugar = e.archivo or entrada
        if e.linea is not None:
            lugar += f":{e.linea}"
        emitir(sys.stderr, f"error: {lugar}: {e.mensaje}")
        return 1
    except RecursionError:
        emitir(sys.stderr, f"error: {entrada}: anidamiento excesivo (paréntesis anidados en exceso)")
        return 1
    for aviso in avisos:
        emitir(sys.stderr, f"aviso: {entrada}: {aviso}")
    if reemplazados:
        emitir(sys.stderr, f"aviso: {salida}: se reemplazaron {reemplazados} archivo(s) que ya existían con otro contenido")
    emitir(sys.stdout, f"{cantidad} integrado(s) generado(s) en la carpeta de salida")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

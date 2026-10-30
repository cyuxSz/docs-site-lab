// Interfaz de comentarios: pide la lista al entrar en vista y pinta con nodos DOM (nunca HTML del usuario).
import { acciones, armarHilos, contador, fechaRelativa, mensajeError, opcionesEscritura, textoValido, tipoInfo, urlComentarios, type Comentario, type Hilo } from "../lib/comentarios";

const raiz = document.querySelector<HTMLElement>("section.comentarios[data-pagina]");
if (raiz) iniciar(raiz);

function iniciar(root: HTMLElement) {
  const pagina = root.dataset.pagina ?? "";
  const estado = root.querySelector<HTMLElement>("[data-comentarios-estado]")!;
  const lista = root.querySelector<HTMLElement>("[data-comentarios-lista]")!;
  const form = root.querySelector<HTMLFormElement>("[data-comentarios-form]")!;
  const tipo = form.querySelector<HTMLSelectElement>("select[name=tipo]")!;
  const texto = form.querySelector<HTMLTextAreaElement>("textarea")!;
  const cont = form.querySelector<HTMLElement>("#comentario-contador")!;
  const errorForm = form.querySelector<HTMLElement>("[data-comentarios-error]")!;
  const enviar = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const dlg = root.querySelector<HTMLDialogElement>("dialog#comentarios-borrar")!;

  let yo: string | null = null;
  let comentarios: Comentario[] = [];
  let aBorrar: { id: string; volver: HTMLElement | null } | null = null;
  // Tras repintar, el botón que abrió una acción ya no existe: se recupera por id y acción.
  let volverA: { id: string; accion: string } | null = null;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, clase?: string, txt?: string) => {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const boton = (txt: string, accion: string, id: string) => {
    const b = document.createElement("button");
    b.textContent = txt;
    b.type = "button";
    b.dataset.accion = accion;
    b.dataset.id = id;
    return b;
  };

  async function pedir(metodo: string, cuerpo: unknown): Promise<{ ok: boolean; data?: any; mensaje?: string }> {
    let res: Response;
    try {
      res = await fetch("/api/comentarios/", opcionesEscritura(metodo, cuerpo));
    } catch {
      return { ok: false, mensaje: mensajeError("red") };
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* sin cuerpo JSON */
    }
    if (res.ok) return { ok: true, data };
    return { ok: false, mensaje: mensajeError(res.status, { retryAfter: res.headers.get("Retry-After"), servidor: data?.error }) };
  }

  async function cargar() {
    let res: Response;
    try {
      res = await fetch(urlComentarios(pagina), { cache: "no-store", credentials: "same-origin" });
    } catch {
      estado.textContent = mensajeError("red");
      return;
    }
    if (!res.ok) {
      let servidor: unknown;
      try {
        servidor = (await res.json())?.error;
      } catch {
        /* sin cuerpo */
      }
      estado.textContent = mensajeError(res.status, { retryAfter: res.headers.get("Retry-After"), servidor });
      return;
    }
    let data: any;
    try {
      data = await res.json();
    } catch {
      estado.textContent = mensajeError("red");
      return;
    }
    yo = typeof data?.yo === "string" ? data.yo : null;
    comentarios = Array.isArray(data?.comentarios) ? data.comentarios : [];
    pintar();
  }

  function pintar() {
    const hilos = armarHilos(comentarios);
    lista.replaceChildren(...hilos.map((h) => pintarHilo(h)));
    estado.textContent = hilos.length ? "" : "Aún no hay comentarios. Sé el primero.";
    if (volverA) {
      const b = [...lista.querySelectorAll<HTMLElement>("button[data-accion]")].find((x) => x.dataset.id === volverA!.id && x.dataset.accion === volverA!.accion);
      b?.focus();
      volverA = null;
    }
  }

  function pintarHilo(h: Hilo) {
    const li = pintarComentario(h);
    if (h.respuestas.length) {
      const ol = el("ol", "comentarios-respuestas");
      for (const r of h.respuestas) ol.append(pintarComentario(r));
      li.append(ol);
    }
    return li;
  }

  function pintarComentario(c: Comentario) {
    const li = el("li", "comentario");
    li.id = `comentario-${c.id}`;
    if (c.resuelto && !c.padre) li.classList.add("resuelto");
    if (c.borrado) {
      li.classList.add("borrado");
      li.append(el("p", "comentario-texto", "Comentario borrado"));
      return li;
    }
    const t = tipoInfo(c.tipo);
    const cab = el("div", "comentario-cab");
    const time = document.createElement("time");
    time.textContent = fechaRelativa(c.creado);
    time.dateTime = c.creado;
    cab.append(el("span", `chip ${t.clase}`, t.etiqueta), el("span", "comentario-autor", c.autor ?? ""), time);
    if (c.editado) cab.append(el("span", undefined, "(editado)"));
    if (c.resuelto && !c.padre) cab.append(el("span", undefined, c.resueltoPor ? `Resuelto por ${c.resueltoPor}` : "Resuelto"));
    li.append(cab, el("p", "comentario-texto", c.texto));

    const a = acciones(c, yo);
    const barra = el("div", "comentario-acciones");
    if (a.responder) barra.append(boton("Responder", "responder", c.id));
    if (a.editar) barra.append(boton("Editar", "editar", c.id));
    if (a.borrar) barra.append(boton("Borrar", "borrar", c.id));
    if (a.resolver) barra.append(boton(a.resolver, "resolver", c.id));
    if (barra.childElementCount) li.append(barra);
    return li;
  }

  // Formulario de respuesta o edición debajo del comentario, con foco en su textarea.
  function abrirFormulario(c: Comentario, accion: "responder" | "editar", opener: HTMLElement) {
    const li = opener.closest("li")!;
    li.querySelector(":scope > form.comentarios-form-inline")?.remove();
    const f = el("form", "comentarios-form-inline");
    const ta = el("textarea");
    ta.maxLength = 2000;
    ta.rows = 3;
    ta.setAttribute("aria-label", accion === "editar" ? "Editar comentario" : "Escribir respuesta");
    if (accion === "editar") ta.value = c.texto;
    const cnt = el("span", "comentarios-contador", contador(ta.value));
    ta.addEventListener("input", () => (cnt.textContent = contador(ta.value)));
    const err = el("p", "comentarios-error");
    err.setAttribute("role", "alert");
    err.hidden = true;
    const ok = el("button", "btn btn-primary", accion === "editar" ? "Guardar" : "Enviar respuesta");
    ok.type = "submit";
    const cancelar = el("button", "btn", "Cancelar");
    cancelar.type = "button";
    const fila = el("div", "comentario-acciones");
    fila.append(ok, cancelar);
    f.append(ta, cnt, err, fila);
    cancelar.addEventListener("click", () => {
      f.remove();
      opener.focus();
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!textoValido(ta.value)) {
        err.textContent = "Escribe un texto de 1 a 2000 caracteres.";
        err.hidden = false;
        ta.focus();
        return;
      }
      ok.disabled = true;
      const r = await pedir(accion === "editar" ? "PATCH" : "POST", accion === "editar" ? { pagina, id: c.id, texto: ta.value } : { pagina, padre: c.id, tipo: c.tipo, texto: ta.value });
      if (!r.ok) {
        ok.disabled = false;
        err.textContent = r.mensaje ?? "";
        err.hidden = false;
        return;
      }
      volverA = { id: c.id, accion };
      await cargar();
    });
    li.append(f);
    ta.focus();
  }

  lista.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-accion]");
    if (!b) return;
    const c = comentarios.find((x) => x.id === b.dataset.id);
    if (!c) return;
    const accion = b.dataset.accion;
    if (accion === "responder" || accion === "editar") abrirFormulario(c, accion, b);
    else if (accion === "borrar") {
      aBorrar = { id: c.id, volver: b };
      dlg.showModal();
    } else if (accion === "resolver") {
      b.disabled = true;
      const r = await pedir("PATCH", { pagina, id: c.id, resuelto: !c.resuelto });
      if (!r.ok) {
        b.disabled = false;
        estado.textContent = r.mensaje ?? "";
        return;
      }
      volverA = { id: c.id, accion: "resolver" };
      await cargar();
    }
  });

  dlg.querySelector("[data-borrar-cancelar]")?.addEventListener("click", () => {
    dlg.close();
    aBorrar?.volver?.focus();
    aBorrar = null;
  });
  dlg.querySelector<HTMLButtonElement>("[data-borrar-ok]")?.addEventListener("click", async (e) => {
    const ok = e.currentTarget as HTMLButtonElement;
    if (!aBorrar) return dlg.close();
    const { id } = aBorrar;
    ok.disabled = true;
    const r = await pedir("DELETE", { pagina, id });
    ok.disabled = false;
    dlg.close();
    aBorrar = null;
    if (!r.ok) {
      estado.textContent = r.mensaje ?? "";
      return;
    }
    estado.focus?.();
    await cargar();
    (form.querySelector("textarea") as HTMLElement | null)?.focus();
  });

  texto.addEventListener("input", () => (cont.textContent = contador(texto.value)));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorForm.hidden = true;
    if (!textoValido(texto.value)) {
      errorForm.textContent = "Escribe un texto de 1 a 2000 caracteres.";
      errorForm.hidden = false;
      texto.focus();
      return;
    }
    enviar.disabled = true;
    const r = await pedir("POST", { pagina, tipo: tipo.value, texto: texto.value });
    enviar.disabled = false;
    if (!r.ok) {
      errorForm.textContent = r.mensaje ?? "";
      errorForm.hidden = false;
      return;
    }
    texto.value = "";
    cont.textContent = contador("");
    await cargar();
    enviar.focus();
  });

  // Carga perezosa: una sola petición cuando la sección entra en vista.
  if (typeof IntersectionObserver === "undefined") void cargar();
  else {
    const io = new IntersectionObserver((entradas) => {
      if (!entradas.some((x) => x.isIntersecting)) return;
      io.disconnect();
      void cargar();
    });
    io.observe(root);
  }
}

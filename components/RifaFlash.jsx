"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Check,
  AlertCircle,
  Search,
  Lock,
  LockOpen,
  Plus,
  X,
  Trash2,
  Dices,
  CalendarPlus,
  ListChecks,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  aISO,
  lunesDe,
  desdeISO,
  diaLegible,
  diaCorto,
  normalizar,
} from "@/lib/semanas";
import Encabezado from "@/components/Encabezado";
import NuevaRifaFlash from "@/components/NuevaRifaFlash";

const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// El módulo Rifa Flash: rifas de un solo día que el admin arma cuando
// conviene, cada una con sus propias opciones para marcar. Los encargados
// marcan a sus clientes igual que en Cashmana; el admin además crea las
// rifas, maneja las opciones y las cierra.
export default function RifaFlash({ email, userId, esAdmin = false }) {
  const supabase = createClient();

  const [rifas, setRifas] = useState([]);
  const [rifaId, setRifaId] = useState(null);
  const [opciones, setOpciones] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [rifasListas, setRifasListas] = useState(false);
  // Arranca en true: entre que llega la lista de rifas y que llegan los
  // clientes de la elegida hay un render, y sin esto mostraría por un
  // instante "no tiene opciones".
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");

  // Descarta respuestas viejas: si se cambia de rifa antes de que llegue la
  // lista anterior, esa no pisa a la nueva.
  const pedido = useRef(0);

  // Lo que había en el campo antes de tocarlo: sirve para no ir a guardar
  // algo que no cambió, y para avisar si el día nuevo cae en otra semana.
  const valorPrevio = useRef(null);

  const rifa = rifas.find((r) => r.id === rifaId) || null;
  const abierta = Boolean(rifa && !rifa.cerrada);
  const rifaFecha = rifa?.fecha;

  // `seleccionar` es el id de una rifa recién creada, para abrirla. Si no
  // viene, se queda en la que estaba, y si no había ninguna, en la abierta
  // más reciente: es la que se está marcando ahora.
  const cargarRifas = useCallback(
    async (seleccionar = null) => {
      const { data, error } = await supabase
        .from("flash_rifas")
        .select("id, nombre, fecha, hora_sorteo, cerrada")
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        setError("No se pudieron cargar las rifas flash. Recargá la página.");
      } else {
        const lista = data || [];
        setRifas(lista);
        setRifaId((actual) => {
          if (seleccionar) return seleccionar;
          if (actual && lista.some((r) => r.id === actual)) return actual;
          return (lista.find((r) => !r.cerrada) || lista[0])?.id ?? null;
        });
        setError("");
      }
      setRifasListas(true);
    },
    [supabase]
  );

  useEffect(() => {
    cargarRifas();
  }, [cargarRifas]);

  // Los clientes vigentes la semana de la rifa, con sus marcas de esta
  // rifa. Es la misma consulta que Cashmana con `flash_marcas` en lugar de
  // `marcas`: el padrón es uno solo para los dos módulos.
  //
  // El admin ve los de todos y, a diferencia de Cashmana, también los puede
  // marcar: si un encargado falta o se olvida, alguien tiene que poder
  // hacerlo por él.
  const cargar = useCallback(async () => {
    const este = ++pedido.current;

    if (!rifaId || !rifaFecha) {
      setClientes([]);
      setOpciones([]);
      return;
    }

    setCargando(true);
    const lunes = aISO(lunesDe(desdeISO(rifaFecha)));

    let consulta = supabase
      .from("clientes")
      .select("id, nombre, telefono, user_id, flash_marcas(opcion_id)")
      .lte("desde", lunes)
      .or(`hasta.is.null,hasta.gt.${lunes}`)
      .eq("flash_marcas.flash_id", rifaId)
      .order("created_at", { ascending: true });

    if (!esAdmin) consulta = consulta.eq("user_id", userId);

    const [cl, op, pe] = await Promise.all([
      consulta,
      supabase
        .from("flash_opciones")
        .select("id, nombre, orden")
        .eq("flash_id", rifaId)
        .order("orden", { ascending: true })
        .order("created_at", { ascending: true }),
      esAdmin
        ? supabase.from("perfiles").select("id, email")
        : Promise.resolve({ data: [] }),
    ]);

    if (este !== pedido.current) return;

    if (cl.error || op.error) {
      setError("No se pudo cargar la rifa. Recargá la página.");
    } else {
      const correos = Object.fromEntries(
        (pe.data || []).map((p) => [p.id, p.email])
      );

      setOpciones(op.data || []);
      setClientes(
        (cl.data || []).map((c) => ({
          id: c.id,
          nombre: c.nombre,
          telefono: c.telefono ?? "",
          esMio: c.user_id === userId,
          duenio: correos[c.user_id] || "",
          marcadas: new Set((c.flash_marcas || []).map((m) => m.opcion_id)),
        }))
      );
      setError("");
    }
    setCargando(false);
  }, [supabase, rifaId, rifaFecha, esAdmin, userId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Califica quien tiene todas las opciones. Sin opciones no califica
  // nadie: una rifa vacía no puede dar por buena a toda la lista. La misma
  // regla vive en `flash_calificados` en Postgres, que es la que reparte.
  const califica = (c) =>
    opciones.length > 0 && opciones.every((o) => c.marcadas.has(o.id));

  // El encargado marca a los suyos; el admin, a cualquiera. Las policies de
  // Postgres dicen lo mismo: esto es para que la pantalla no ofrezca lo que
  // la base va a rechazar.
  const puedeMarcar = (c) => (esAdmin || c.esMio) && abierta;

  async function marcar(cliente, opcionId) {
    const estaba = cliente.marcadas.has(opcionId);

    setClientes((prev) =>
      prev.map((c) => {
        if (c.id !== cliente.id) return c;
        const marcadas = new Set(c.marcadas);
        if (estaba) marcadas.delete(opcionId);
        else marcadas.add(opcionId);
        return { ...c, marcadas };
      })
    );

    // Marcar es crear la fila y desmarcar es borrarla. Al borrar se pide
    // de vuelta lo borrado, porque un delete que las policies no dejan
    // pasar (la rifa se cerró mientras tanto) no da error: borra cero filas.
    const { data, error } = estaba
      ? await supabase
          .from("flash_marcas")
          .delete()
          .eq("opcion_id", opcionId)
          .eq("cliente_id", cliente.id)
          .select("opcion_id")
      : await supabase
          .from("flash_marcas")
          .insert({ opcion_id: opcionId, cliente_id: cliente.id, flash_id: rifaId });

    // 23505 es la marca que ya estaba: un doble click, no un problema.
    const fallo = error
      ? error.code !== "23505"
      : estaba && (data?.length ?? 0) === 0;

    if (fallo) {
      setError(
        "No se pudo guardar el cambio. Si el admin cerró la rifa, ya no se puede marcar."
      );
      cargarRifas();
      cargar();
    }
  }

  function rifaCreada(id) {
    setCreando(false);
    cargarRifas(id);
  }

  async function agregarOpcion() {
    const califican = clientes.filter(califica).length;

    if (
      califican > 0 &&
      !window.confirm(
        `Hoy ${califican === 1 ? "califica 1 cliente" : `califican ${califican} clientes`}. ` +
          "Con una opción más, dejan de calificar hasta que se la marquen."
      )
    ) {
      return;
    }

    const orden = opciones.reduce((max, o) => Math.max(max, o.orden), 0) + 1;
    const { data, error } = await supabase
      .from("flash_opciones")
      .insert({ flash_id: rifaId, nombre: `Sorteo ${opciones.length + 1}`, orden })
      .select("id, nombre, orden")
      .single();

    if (error) setError("No se pudo agregar la opción. Probá de nuevo.");
    else {
      setOpciones((prev) => [...prev, data]);
      setError("");
    }
  }

  function editarOpcion(id, nombre) {
    setOpciones((prev) => prev.map((o) => (o.id === id ? { ...o, nombre } : o)));
  }

  async function guardarOpcion(opcion) {
    const nombre = opcion.nombre.trim();

    if (!nombre) {
      setError("Cada opción necesita un nombre.");
      cargar();
      return;
    }

    const { error } = await supabase
      .from("flash_opciones")
      .update({ nombre })
      .eq("id", opcion.id);

    if (error) {
      setError("No se pudo guardar el nombre. Probá de nuevo.");
      cargar();
    } else {
      setError("");
    }
  }

  async function borrarOpcion(opcion) {
    const marcados = clientes.filter((c) => c.marcadas.has(opcion.id)).length;
    const quedan = opciones.length - 1;

    const aviso =
      `Borrar la opción "${opcion.nombre}".` +
      (marcados > 0
        ? ` Se pierden las marcas de ${marcados} ${marcados === 1 ? "cliente" : "clientes"}.`
        : "") +
      (quedan > 0
        ? " Desde ahora califica quien tenga todas las que quedan."
        : " La rifa se queda sin opciones y no califica nadie hasta que agregues otra.");

    if (!window.confirm(aviso)) return;

    const { error } = await supabase
      .from("flash_opciones")
      .delete()
      .eq("id", opcion.id);

    if (error) setError("No se pudo borrar la opción. Probá de nuevo.");
    else {
      setOpciones((prev) => prev.filter((o) => o.id !== opcion.id));
      setError("");
    }
  }

  function guardarPrevio(e) {
    valorPrevio.current = e.target.value;
  }

  function editarRifa(campo, valor) {
    setRifas((prev) =>
      prev.map((r) => (r.id === rifaId ? { ...r, [campo]: valor } : r))
    );
  }

  // El nombre y la hora son lo que sale en la imagen, y el día decide qué
  // clientes entran, así que los tres se pueden corregir después de crear
  // la rifa. Se guarda al salir del campo, como el padrón de Cashmana.
  async function guardarRifa(campo) {
    const valor = (rifa[campo] ?? "").trim();
    const previo = valorPrevio.current;

    if (previo !== null && valor === previo.trim()) return;

    if (!valor && campo !== "hora_sorteo") {
      setError(
        campo === "nombre"
          ? "La rifa necesita un nombre."
          : "La rifa necesita un día."
      );
      cargarRifas();
      return;
    }

    // Cambiar de semana cambia la lista: el padrón muestra a los que
    // estaban vigentes esa semana, así que puede entrar o salir gente, y
    // alguien que ya tenía número puede dejar de aparecer.
    if (campo === "fecha" && previo) {
      const otraSemana =
        aISO(lunesDe(desdeISO(valor))) !== aISO(lunesDe(desdeISO(previo)));

      if (
        otraSemana &&
        !window.confirm(
          "El día nuevo cae en otra semana. La lista muestra a los clientes " +
            "que estaban vigentes esa semana, así que puede cambiar quién " +
            "aparece y quién califica. ¿Lo cambio igual?"
        )
      ) {
        cargarRifas();
        return;
      }
    }

    const { data, error } = await supabase
      .from("flash_rifas")
      .update({ [campo]: campo === "hora_sorteo" ? valor || null : valor })
      .eq("id", rifa.id)
      .select("id");

    if (error || !data?.length) {
      setError("No se pudo guardar el cambio. Probá de nuevo.");
      cargarRifas();
    } else {
      editarRifa(campo, valor);
      setError("");
    }
  }

  async function cambiarCierre(cerrar) {
    const aviso = cerrar
      ? `Cerrar "${rifa.nombre}". Nadie va a poder marcar ni cambiar opciones, ` +
        "ni agregar o quitar gente de la rifa, hasta que la reabras."
      : `Reabrir "${rifa.nombre}". Los encargados vuelven a poder marcar.`;

    if (!window.confirm(aviso)) return;

    // Un update que las policies no dejan pasar no da error, cambia cero
    // filas: por eso se pide de vuelta lo que cambió.
    const { data, error } = await supabase
      .from("flash_rifas")
      .update({ cerrada: cerrar })
      .eq("id", rifa.id)
      .select("id");

    if (error || !data?.length) {
      setError("No se pudo cambiar el estado de la rifa. Probá de nuevo.");
      return;
    }

    setRifas((prev) =>
      prev.map((r) => (r.id === rifa.id ? { ...r, cerrada: cerrar } : r))
    );
    setError("");
  }

  async function eliminarRifa() {
    const aviso =
      `Eliminar "${rifa.nombre}" con sus opciones, sus marcas y los números ` +
      "que ya se hayan sorteado. No se puede deshacer.";

    if (!window.confirm(aviso)) return;

    const { data, error } = await supabase
      .from("flash_rifas")
      .delete()
      .eq("id", rifa.id)
      .select("id");

    if (error || !data?.length) {
      setError("No se pudo eliminar la rifa. Probá de nuevo.");
      return;
    }
    cargarRifas();
  }

  const califican = clientes.filter(califica);

  const filtro = normalizar(busqueda.trim());
  const visibles = filtro
    ? clientes.filter(
        (c) =>
          normalizar(c.nombre).includes(filtro) ||
          (c.telefono || "").includes(filtro)
      )
    : clientes;

  const botonAccion =
    "flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm bg-white transition";

  const campoRifa =
    "mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-stone-50 disabled:text-stone-500";

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Encabezado
        esAdmin={esAdmin}
        subtitulo="Marcá las opciones de cada cliente. Califica quien las tiene todas."
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {!rifasListas ? (
        <div className="text-center text-stone-400 text-sm py-16">Cargando…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {rifas.length > 0 && (
              <select
                value={rifaId ?? ""}
                onChange={(e) => setRifaId(e.target.value)}
                aria-label="Rifa flash"
                className="flex-1 min-w-[220px] border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {rifas.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre} · {diaCorto(desdeISO(r.fecha))}
                    {r.cerrada ? " · cerrada" : ""}
                  </option>
                ))}
              </select>
            )}
            {esAdmin && (
              <button
                onClick={() => setCreando((abierto) => !abierto)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
                  creando
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white border-amber-300 text-amber-800 hover:bg-amber-50"
                }`}
              >
                <CalendarPlus size={15} />
                Nueva rifa flash
              </button>
            )}
          </div>

          {creando && (
            <NuevaRifaFlash
              supabase={supabase}
              onCreada={rifaCreada}
              onCerrar={() => setCreando(false)}
            />
          )}

          {!rifa ? (
            <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
              Todavía no hay rifas flash.{" "}
              {esAdmin
                ? "Creá la primera con el botón de arriba."
                : "Cuando el admin arme una, aparece acá para marcar."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 text-sm">
                <span className="font-medium">
                  {mayuscula(diaLegible(desdeISO(rifa.fecha)))}
                </span>
                {rifa.hora_sorteo && (
                  <span className="text-stone-500">
                    Sorteo {rifa.hora_sorteo}
                  </span>
                )}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    abierta
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-200 text-stone-600"
                  }`}
                >
                  {abierta ? "Abierta" : "Cerrada"}
                </span>
                <span className="text-xs text-stone-400 ml-auto truncate">
                  {email}
                </span>
              </div>

              {!abierta && (
                <div className="mb-4 flex items-start gap-2 text-sm text-stone-600 bg-stone-100 border border-stone-300 rounded-lg px-3 py-2">
                  <Lock size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Esta rifa está cerrada y quedó como histórico.{" "}
                    {esAdmin
                      ? "Si hace falta corregir algo, podés reabrirla abajo."
                      : "Solo el admin puede reabrirla."}
                  </span>
                </div>
              )}

              {esAdmin && (
                <div className="mb-5 bg-white border border-stone-200 rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <ListChecks size={16} className="text-stone-500" />
                    <h2 className="text-sm font-medium flex-1">
                      Ajustes de la rifa
                    </h2>
                    <Link
                      href={`/admin?flash=${rifa.id}`}
                      className="flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-900 transition"
                    >
                      <Dices size={15} />
                      Números e imagen
                    </Link>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] mb-4 pb-4 border-b border-stone-100">
                    <label className="text-xs text-stone-500">
                      Nombre
                      <input
                        type="text"
                        value={rifa.nombre}
                        onChange={(e) => editarRifa("nombre", e.target.value)}
                        onFocus={guardarPrevio}
                        onBlur={() => guardarRifa("nombre")}
                        disabled={!abierta}
                        className={campoRifa}
                      />
                    </label>
                    <label className="text-xs text-stone-500">
                      Día
                      <input
                        type="date"
                        value={rifa.fecha}
                        // Un día vacío no se guarda ni se muestra: dejaría la
                        // rifa sin fecha, que es de donde sale la semana del
                        // padrón. Para cambiarlo se elige otro.
                        onChange={(e) =>
                          e.target.value && editarRifa("fecha", e.target.value)
                        }
                        onFocus={guardarPrevio}
                        onBlur={() => guardarRifa("fecha")}
                        disabled={!abierta}
                        className={campoRifa}
                      />
                    </label>
                    <label className="text-xs text-stone-500">
                      Hora del sorteo
                      <input
                        type="text"
                        value={rifa.hora_sorteo ?? ""}
                        onChange={(e) =>
                          editarRifa("hora_sorteo", e.target.value)
                        }
                        onFocus={guardarPrevio}
                        onBlur={() => guardarRifa("hora_sorteo")}
                        disabled={!abierta}
                        placeholder="Opcional"
                        className={`${campoRifa} sm:w-32`}
                      />
                    </label>
                  </div>

                  <div className="text-xs text-stone-500 mb-2">
                    Opciones para calificar
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {opciones.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center border border-stone-300 rounded-lg bg-stone-50 focus-within:ring-2 focus-within:ring-amber-400"
                      >
                        <input
                          type="text"
                          value={o.nombre}
                          onChange={(e) => editarOpcion(o.id, e.target.value)}
                          onBlur={() => guardarOpcion(o)}
                          readOnly={!abierta}
                          aria-label={`Nombre de la opción ${o.nombre}`}
                          className={`w-28 bg-transparent text-sm px-3 py-1.5 focus:outline-none ${
                            abierta ? "" : "cursor-default text-stone-500"
                          }`}
                        />
                        {abierta && (
                          <button
                            onClick={() => borrarOpcion(o)}
                            className="pr-2 text-stone-400 hover:text-red-500 transition"
                            aria-label={`Borrar la opción ${o.nombre}`}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {abierta && (
                      <button
                        onClick={agregarOpcion}
                        className="flex items-center gap-1 px-3 py-1.5 border border-dashed border-stone-300 rounded-lg text-sm text-stone-600 hover:bg-stone-50 transition"
                      >
                        <Plus size={14} />
                        Opción
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-stone-500 mt-3">
                    {opciones.length === 0
                      ? "Sin opciones no califica nadie."
                      : opciones.length === 1
                        ? "Con una sola opción, califica quien la tenga marcada."
                        : `Con ${opciones.length} opciones, califica quien tenga las ${opciones.length} marcadas.`}
                  </p>

                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-stone-100">
                    <button
                      onClick={() => cambiarCierre(abierta)}
                      className={`${botonAccion} border-stone-300 hover:bg-stone-100`}
                    >
                      {abierta ? <Lock size={15} /> : <LockOpen size={15} />}
                      {abierta ? "Cerrar rifa" : "Reabrir rifa"}
                    </button>
                    {abierta && (
                      <button
                        onClick={eliminarRifa}
                        className={`${botonAccion} border-red-200 text-red-700 hover:bg-red-50`}
                      >
                        <Trash2 size={15} />
                        Eliminar rifa
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="relative mb-4">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
                />
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar cliente por nombre o teléfono"
                  className="w-full border border-stone-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              {cargando ? (
                <div className="text-center text-stone-400 text-sm py-16">
                  Cargando lista...
                </div>
              ) : opciones.length === 0 ? (
                <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
                  Esta rifa todavía no tiene opciones para marcar.
                  {esAdmin && abierta && " Agregá al menos una arriba."}
                </div>
              ) : clientes.length === 0 ? (
                <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
                  {esAdmin
                    ? "Nadie tiene clientes en la semana de esta rifa."
                    : "No tenés clientes en la semana de esta rifa. Los clientes se dan de alta en Cashmana y sirven para los dos módulos."}
                </div>
              ) : visibles.length === 0 ? (
                <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
                  Ningún cliente coincide con “{busqueda}”.
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-stone-100 text-stone-600 text-xs uppercase tracking-wide">
                          <th className="text-left px-4 py-3 font-medium min-w-[150px]">
                            Cliente
                          </th>
                          <th className="text-left px-3 py-3 font-medium">
                            Teléfono
                          </th>
                          {esAdmin && (
                            <th className="text-left px-3 py-3 font-medium">
                              Encargado
                            </th>
                          )}
                          {opciones.map((o) => (
                            <th
                              key={o.id}
                              className="px-2 py-3 font-medium text-center min-w-[72px]"
                            >
                              {o.nombre}
                            </th>
                          ))}
                          <th className="px-3 py-3 font-medium text-center w-20">
                            Rifa
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibles.map((cliente) => (
                          <tr
                            key={cliente.id}
                            className="border-t border-stone-100 hover:bg-stone-50"
                          >
                            <td className="px-4 py-2.5 font-medium">
                              {cliente.nombre}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-stone-500">
                              {cliente.telefono || (
                                <span className="text-stone-300">—</span>
                              )}
                            </td>
                            {esAdmin && (
                              <td className="px-3 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                                {cliente.duenio}
                              </td>
                            )}
                            {opciones.map((o) => {
                              const marcada = cliente.marcadas.has(o.id);
                              const editable = puedeMarcar(cliente);
                              return (
                                <td key={o.id} className="px-2 py-2.5 text-center">
                                  <button
                                    onClick={() => marcar(cliente, o.id)}
                                    disabled={!editable}
                                    className={`w-6 h-6 rounded-md border flex items-center justify-center mx-auto transition ${
                                      marcada
                                        ? editable
                                          ? "bg-emerald-500 border-emerald-500"
                                          : "bg-emerald-200 border-emerald-200"
                                        : editable
                                          ? "border-stone-300 hover:border-stone-400"
                                          : "border-stone-200"
                                    } ${editable ? "" : "cursor-default"}`}
                                    aria-label={`${o.nombre} - ${cliente.nombre}`}
                                  >
                                    {marcada && (
                                      <Check
                                        size={14}
                                        className={
                                          editable ? "text-white" : "text-emerald-700"
                                        }
                                      />
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="px-3 py-2.5 text-center">
                              {califica(cliente) ? (
                                <span className="inline-block bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded-full">
                                  Califica
                                </span>
                              ) : (
                                <span className="text-stone-300 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!cargando && opciones.length > 0 && clientes.length > 0 && (
                <div className="mt-4 text-sm text-stone-500">
                  {califican.length} de {clientes.length} clientes califican
                  {filtro && ` · mostrando ${visibles.length}`}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

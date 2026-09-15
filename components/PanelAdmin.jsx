"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Users,
  Ticket,
  FileSpreadsheet,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Dices,
  Search,
  ImageDown,
  UserPlus,
  Trash2,
  Lock,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  lunesDe,
  aISO,
  desdeISO,
  rangoLegible,
  cierreLegible,
  diaLegible,
  diaCorto,
  normalizar,
  semanaEditable,
} from "@/lib/semanas";
import { descargarExcel } from "@/lib/descargas";
import { descargarAficheRifa } from "@/lib/afiche";
import AgregarARifa from "@/components/AgregarARifa";

// Las dos rifas, la de la semana y la flash, se ven y se manejan igual en
// este panel: la misma tabla, los mismos órdenes, el mismo Excel, la misma
// imagen y el mismo agregar a mano. Lo que cambia es de dónde salen los
// números y hasta cuándo se pueden tocar.
export default function PanelAdmin({ email, flashInicial = null }) {
  const supabase = createClient();

  const [vista, setVista] = useState(flashInicial ? "flash" : "padron");
  const [padron, setPadron] = useState([]);
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [flashes, setFlashes] = useState([]);
  const [flashesListas, setFlashesListas] = useState(false);
  const [flashId, setFlashId] = useState(flashInicial);
  const [rifa, setRifa] = useState([]);
  const [orden, setOrden] = useState("nombre");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [sorteando, setSorteando] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState("");

  // Cuenta los pedidos de números para descartar respuestas viejas: si se
  // cambia de semana, de rifa o de pestaña antes de que llegue la anterior,
  // esa no pisa a la nueva.
  const pedido = useRef(0);

  const semanaISO = aISO(semana);

  // Desde el domingo a las 00:00 de Costa Rica la semana es histórico y la
  // rifa ya se jugó. La misma regla la vuelven a chequear las funciones de
  // Postgres; esto es para que la pantalla no ofrezca lo que la base va a
  // rechazar.
  const semanaAbierta = semanaEditable(semana);

  const esRifa = vista === "rifa" || vista === "flash";
  const flash = flashes.find((f) => f.id === flashId) || null;

  // Hasta cuándo se puede agregar o quitar gente: la semana de Cashmana
  // hasta el sábado a medianoche, la rifa flash hasta que el admin la
  // cierra a mano.
  const rifaAbierta =
    vista === "flash" ? Boolean(flash && !flash.cerrada) : semanaAbierta;

  // La semana del padrón que ofrece el buscador de agregar a mano: la de la
  // rifa que se está mirando.
  const vigencia =
    vista === "flash"
      ? flash && aISO(lunesDe(desdeISO(flash.fecha)))
      : semanaISO;

  const cargarPadron = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase.rpc("admin_padron");

    if (error) setError("No se pudo cargar el padrón. Recargá la página.");
    else {
      setPadron(data || []);
      setError("");
    }
    setCargando(false);
  }, [supabase]);

  useEffect(() => {
    cargarPadron();
  }, [cargarPadron]);

  // Se queda en la rifa que estaba elegida (o la que vino en la URL) si
  // sigue existiendo; si no, en la abierta más reciente.
  const cargarFlashes = useCallback(async () => {
    const { data, error } = await supabase
      .from("flash_rifas")
      .select("id, nombre, fecha, hora_sorteo, cerrada")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setError("No se pudieron cargar las rifas flash. Recargá la página.");
    } else {
      const lista = data || [];
      setFlashes(lista);
      setFlashId((actual) =>
        actual && lista.some((f) => f.id === actual)
          ? actual
          : ((lista.find((f) => !f.cerrada) || lista[0])?.id ?? null)
      );
    }
    setFlashesListas(true);
  }, [supabase]);

  useEffect(() => {
    if (vista === "flash") cargarFlashes();
  }, [vista, cargarFlashes]);

  // Un mismo RPC sortea lo que falta y devuelve la lista completa. Como los
  // numeros ya dados nunca se tocan, llamarlo de nuevo no cambia nada: sirve
  // igual para generar por primera vez que para volver a consultar. Cada
  // rifa tiene el suyo, con la misma forma de fila.
  const cargarRifa = useCallback(async () => {
    const este = ++pedido.current;

    if (vista !== "rifa" && vista !== "flash") return;

    if (vista === "flash" && !flashId) {
      setRifa([]);
      setSorteando(false);
      return;
    }

    setSorteando(true);
    const { data, error } =
      vista === "flash"
        ? await supabase.rpc("asignar_numeros_flash", { p_flash_id: flashId })
        : await supabase.rpc("asignar_numeros_rifa", { p_semana: semanaISO });

    if (este !== pedido.current) return;

    if (error) setError("No se pudieron generar los números. Probá de nuevo.");
    else {
      setRifa(data || []);
      setError("");
    }
    setSorteando(false);
  }, [supabase, vista, semanaISO, flashId]);

  useEffect(() => {
    cargarRifa();
  }, [cargarRifa]);

  // El formulario de agregar es de una rifa y de una vista: si se cambia
  // cualquiera de las dos, lo que quedó escrito ya no corresponde.
  useEffect(() => {
    setAgregando(false);
  }, [semanaISO, vista, flashId]);

  function moverSemana(offset) {
    const nueva = new Date(semana);
    nueva.setDate(nueva.getDate() + offset * 7);
    setSemana(nueva);
  }

  function agregarEnRifa({ clienteId, nombre, telefono }) {
    const persona = {
      p_cliente_id: clienteId,
      p_nombre: nombre,
      p_telefono: telefono,
    };
    return vista === "flash"
      ? supabase.rpc("admin_agregar_a_flash", { p_flash_id: flashId, ...persona })
      : supabase.rpc("admin_agregar_a_rifa", { p_semana: semanaISO, ...persona });
  }

  function agregadoARifa(fila) {
    setRifa((prev) => [...prev, fila]);
    setError("");
  }

  // Solo alcanza a los agregados a mano; la función de Postgres rechaza
  // cualquier otro. Sirve para deshacer un nombre mal escrito o una persona
  // confundida, no para sacar a alguien que salió sorteado.
  async function quitarDeRifa(cliente) {
    const aviso =
      `Quitar a ${cliente.nombre} de la rifa. Pierde el número ` +
      `${cliente.numero_rifa}, y si lo volvés a agregar le va a tocar otro.`;

    if (!window.confirm(aviso)) return;

    const previos = rifa;
    setRifa(rifa.filter((c) => c.cliente_id !== cliente.cliente_id));

    const { error } =
      vista === "flash"
        ? await supabase.rpc("admin_quitar_de_flash", {
            p_flash_id: flashId,
            p_cliente_id: cliente.cliente_id,
          })
        : await supabase.rpc("admin_quitar_de_rifa", {
            p_semana: semanaISO,
            p_cliente_id: cliente.cliente_id,
          });

    if (error) {
      setError(error.message || "No se pudo quitar de la rifa. Probá de nuevo.");
      setRifa(previos);
    }
  }

  function exportarPadron() {
    descargarExcel(
      padron.map((c) => ({
        Cliente: c.nombre,
        Teléfono: c.telefono || "",
        Estado: c.hasta ? `Archivado el ${c.hasta}` : "Activo",
      })),
      [26, 16, 22],
      "Padrón",
      `padron-completo-${aISO(new Date())}.xlsx`
    );
  }

  // Tres ordenes, cada uno para algo distinto: por numero se busca al
  // ganador, por nombre se reparte, y por alta se comprueba que el sorteo
  // fue al azar (contra ese orden los numeros tienen que salir salteados).
  const porAlta = (a, b) =>
    new Date(a.creado) - new Date(b.creado) ||
    a.nombre.localeCompare(b.nombre, "es");

  const rifaOrdenada = [...rifa].sort((a, b) => {
    if (orden === "nombre") return a.nombre.localeCompare(b.nombre, "es");
    if (orden === "alta") return porAlta(a, b);
    return a.numero - b.numero;
  });

  // Posicion de cada cliente en el orden de alta, para mostrarla como #.
  const posicionAlta = new Map(
    [...rifa].sort(porAlta).map((c, i) => [c.cliente_id, i + 1])
  );

  // Para que el buscador del formulario no ofrezca a alguien que ya tiene
  // número: la funcion lo rechazaria igual, pero es mejor no ofrecerlo.
  const yaEnRifa = new Set(rifa.map((c) => c.cliente_id));

  // El buscador filtra lo que se ve en pantalla, no lo que se exporta: el
  // Excel de la rifa y el del padron son documentos que se reparten, y bajar
  // media lista por tener texto olvidado en el buscador seria un problema.
  const filtro = normalizar(busqueda.trim());
  const coincide = (c) => !filtro || normalizar(c.nombre).includes(filtro);

  const padronVisible = padron.filter(coincide);
  const rifaVisible = rifaOrdenada.filter(coincide);

  // El Excel de la rifa sale siempre por numero, sin importar como este
  // ordenada la pantalla: es el papel con el que se busca al ganador.
  // Se ordena por el numero que se canta y no por el interno, para que la
  // columna quede de verdad de menor a mayor (el interno salta a 150 en la
  // segunda vuelta). Los dos que comparten numero caen juntos, y adelante
  // va el de la primera vuelta.
  const rifaPorNumero = [...rifa].sort(
    (a, b) =>
      Number(a.numero_rifa) - Number(b.numero_rifa) || a.numero - b.numero
  );

  // Mientras llegan los números de otra rifa, la lista en pantalla todavía
  // es la anterior: no se exporta hasta que termine.
  const puedeExportar =
    rifa.length > 0 && !sorteando && (vista !== "flash" || Boolean(flash));

  const archivoRifa =
    vista === "flash" && flash ? `rifa-flash-${flash.fecha}` : `rifa-${semanaISO}`;

  function exportarRifa() {
    descargarExcel(
      // Solo lo que se le canta al cliente. El orden de alta, el encargado y
      // el numero interno siguen visibles en pantalla para auditar el sorteo,
      // pero no tienen por que viajar en el archivo que se reparte.
      rifaPorNumero.map((c) => ({
        Número: c.numero_rifa,
        Cliente: c.nombre,
      })),
      [10, 30],
      "Rifa",
      `${archivoRifa}.xlsx`
    );
  }

  // La imagen no reemplaza al Excel: es la misma lista y el mismo orden, pero
  // en algo que se manda por chat y se lee en el teléfono sin abrir nada.
  // La de la semana lleva la hora de siempre, la documentada arriba de
  // `cierreDeSemana` en lib/semanas.js; la flash, la que se cargó al crearla.
  function exportarImagenRifa() {
    const textos =
      vista === "flash"
        ? {
            titulo: "RIFA FLASH",
            rango: flash.nombre,
            sorteo:
              `Sorteo el ${diaLegible(desdeISO(flash.fecha))}` +
              (flash.hora_sorteo ? `, ${flash.hora_sorteo}` : ""),
          }
        : {
            rango: rangoLegible(semana),
            sorteo: `Sorteo el sábado ${cierreLegible(semana)}, 7:30 p.m.`,
          };

    descargarAficheRifa(
      rifaPorNumero.map((c) => ({ numero: c.numero_rifa, nombre: c.nombre })),
      textos,
      `${archivoRifa}.png`
    );
  }

  // Cuando pasan de 100 participantes, el numero interno sigue subiendo
  // (100, 101...) pero el que se canta es el modulo, asi que se repite.
  const repetidos = rifa.filter((c) => c.numero >= 100).length;

  const aMano = rifa.filter((c) => c.agregado_por).length;

  const pestana = (activa) =>
    `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
      activa
        ? "bg-stone-800 text-white border-stone-800"
        : "bg-white border-stone-300 hover:bg-stone-100"
    }`;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-1">
        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Ticket size={18} className="text-amber-700" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Panel de administración</h1>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 text-sm transition"
        >
          <ArrowLeft size={15} />
          Volver
        </Link>
      </div>

      <p className="text-sm text-stone-500 mb-5 ml-12">{email}</p>

      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setVista("padron")} className={pestana(vista === "padron")}>
          <Users size={15} />
          Todos los clientes
        </button>
        <button onClick={() => setVista("rifa")} className={pestana(vista === "rifa")}>
          <Dices size={15} />
          Rifa de la semana
        </button>
        <button onClick={() => setVista("flash")} className={pestana(vista === "flash")}>
          <Zap size={15} />
          Rifa flash
        </button>

        {esRifa && rifaAbierta && (
          <button
            onClick={() => setAgregando((abierto) => !abierto)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
              agregando
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-white border-amber-300 text-amber-800 hover:bg-amber-50"
            }`}
          >
            <UserPlus size={15} />
            Agregar a la rifa
          </button>
        )}

        <button
          onClick={vista === "padron" ? exportarPadron : exportarRifa}
          disabled={vista === "padron" ? padron.length === 0 : !puedeExportar}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white hover:bg-stone-100 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <FileSpreadsheet size={15} />
          {vista === "padron" ? "Excel de todos los clientes" : "Excel de la rifa"}
        </button>

        {esRifa && (
          <button
            onClick={exportarImagenRifa}
            disabled={!puedeExportar}
            className="flex items-center gap-1.5 px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white hover:bg-stone-100 transition disabled:opacity-40 disabled:hover:bg-white"
          >
            <ImageDown size={15} />
            Imagen para clientes
          </button>
        )}
      </div>

      <div className="relative mb-5">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
        />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente por nombre"
          className="w-full border border-stone-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {vista === "padron" ? (
        <>
          {cargando ? (
            <div className="text-center text-stone-400 text-sm py-16">
              Cargando…
            </div>
          ) : padron.length === 0 ? (
            <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
              Todavía no hay clientes cargados por ningún usuario.
            </div>
          ) : (
            <>
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-stone-100 text-stone-600 text-xs uppercase tracking-wide">
                        <th className="text-left px-4 py-3 font-medium">
                          Cliente
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          Teléfono
                        </th>
                        <th className="text-left px-4 py-3 font-medium">
                          Encargado
                        </th>
                        <th className="text-left px-4 py-3 font-medium">Alta</th>
                        <th className="text-left px-4 py-3 font-medium">
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {padronVisible.map((c, i) => (
                        <tr
                          key={`${c.duenio}-${c.nombre}-${i}`}
                          className="border-t border-stone-100 hover:bg-stone-50"
                        >
                          <td className="px-4 py-2.5 font-medium">{c.nombre}</td>
                          <td className="px-4 py-2.5 text-stone-600">
                            {c.telefono || (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-stone-500 text-xs">
                            {c.duenio}
                          </td>
                          <td className="px-4 py-2.5 text-stone-500 text-xs">
                            {c.desde}
                          </td>
                          <td className="px-4 py-2.5">
                            {c.hasta ? (
                              <span className="text-xs text-stone-400">
                                Archivado
                              </span>
                            ) : (
                              <span className="inline-block bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full">
                                Activo
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 text-sm text-stone-500">
                {padron.filter((c) => !c.hasta).length} activos de{" "}
                {padron.length} en total
                {filtro &&
                  ` · mostrando ${padronVisible.length}, el Excel baja todos`}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {vista === "rifa" ? (
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => moverSemana(-1)}
                className="p-2 border border-stone-300 rounded-lg bg-white hover:bg-stone-100 transition"
                aria-label="Semana anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="text-sm font-medium px-2 min-w-[150px] text-center">
                {rangoLegible(semana)}
              </div>
              <button
                onClick={() => moverSemana(1)}
                className="p-2 border border-stone-300 rounded-lg bg-white hover:bg-stone-100 transition"
                aria-label="Semana siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : !flashesListas ? (
            <div className="text-center text-stone-400 text-sm py-16">
              Cargando…
            </div>
          ) : flashes.length === 0 ? (
            <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
              Todavía no hay rifas flash.{" "}
              <Link href="/flash" className="text-amber-700 hover:text-amber-900 underline">
                Se crean desde el módulo Rifa Flash
              </Link>
              .
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <select
                value={flashId ?? ""}
                onChange={(e) => setFlashId(e.target.value)}
                aria-label="Rifa flash"
                className="flex-1 min-w-[220px] max-w-md border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {flashes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre} · {diaCorto(desdeISO(f.fecha))}
                    {f.cerrada ? " · cerrada" : ""}
                  </option>
                ))}
              </select>
              <Link
                href="/flash"
                className="text-sm text-stone-500 hover:text-stone-800 transition"
              >
                Opciones y marcas
              </Link>
            </div>
          )}

          {(vista === "rifa" || flash) && (
            <>
              {!rifaAbierta && (
                <div className="mb-4 flex items-start gap-2 text-sm text-stone-600 bg-stone-100 border border-stone-300 rounded-lg px-3 py-2">
                  <Lock size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {vista === "flash"
                      ? "Esta rifa flash está cerrada y quedó como histórico. Para agregar o quitar gente, reabrila desde el módulo Rifa Flash."
                      : `Esta semana ya cerró y la rifa quedó como histórico. Se podía agregar gente hasta la medianoche del sábado ${cierreLegible(semana)}.`}
                  </span>
                </div>
              )}

              {agregando && vigencia && (
                <AgregarARifa
                  supabase={supabase}
                  semanaISO={vigencia}
                  yaEnRifa={yaEnRifa}
                  agregar={agregarEnRifa}
                  onAgregado={agregadoARifa}
                  onCerrar={() => setAgregando(false)}
                />
              )}

              {sorteando ? (
                <div className="text-center text-stone-400 text-sm py-16">
                  Sorteando…
                </div>
              ) : rifa.length === 0 ? (
                <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
                  {vista === "flash"
                    ? "Ningún cliente tiene marcadas todas las opciones de esta rifa."
                    : "Ningún cliente completó los seis días en esta semana."}
                  {rifaAbierta &&
                    " Podés meter a alguien a mano con el botón de arriba."}
                </div>
              ) : (
                <>
                  {repetidos > 0 && (
                    <div className="mb-4 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                      <span>
                        Son {rifa.length} participantes, más de los 100 números
                        únicos, así que {repetidos}{" "}
                        {repetidos === 1
                          ? "cliente entró en la segunda vuelta y comparte"
                          : "clientes entraron en la segunda vuelta y comparten"}{" "}
                        su número con alguien de la primera. Los de segunda
                        vuelta salen sorteados entre el 50 y el 99, y cada
                        número se repite una sola vez. Están marcados con el
                        número interno al lado.
                      </span>
                    </div>
                  )}

                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-stone-100 text-stone-600 text-xs uppercase tracking-wide">
                            <th className="text-left px-4 py-3 font-medium w-24">
                              <button
                                onClick={() => setOrden("numero")}
                                className={`uppercase tracking-wide hover:text-stone-900 ${
                                  orden === "numero" ? "text-stone-900 underline" : ""
                                }`}
                              >
                                Número
                              </button>
                            </th>
                            <th className="text-left px-4 py-3 font-medium">
                              <button
                                onClick={() => setOrden("nombre")}
                                className={`uppercase tracking-wide hover:text-stone-900 ${
                                  orden === "nombre" ? "text-stone-900 underline" : ""
                                }`}
                              >
                                Cliente
                              </button>
                            </th>
                            <th className="text-left px-4 py-3 font-medium w-28">
                              <button
                                onClick={() => setOrden("alta")}
                                className={`uppercase tracking-wide hover:text-stone-900 ${
                                  orden === "alta" ? "text-stone-900 underline" : ""
                                }`}
                              >
                                Orden alta
                              </button>
                            </th>
                            <th className="text-left px-4 py-3 font-medium">
                              Teléfono
                            </th>
                            <th className="text-left px-4 py-3 font-medium">
                              Encargado
                            </th>
                            <th className="w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {rifaVisible.map((c) => (
                            <tr
                              key={c.cliente_id}
                              className="border-t border-stone-100 hover:bg-stone-50"
                            >
                              <td className="px-4 py-2.5">
                                <span className="font-mono font-semibold text-base bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                                  {c.numero_rifa}
                                </span>
                                {c.numero >= 100 && (
                                  <span className="ml-2 text-xs text-stone-400">
                                    ({c.numero})
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-medium">
                                {c.nombre}
                                {c.agregado_por && (
                                  <span
                                    title={`Agregado a mano por ${c.agregado_por}`}
                                    className="ml-2 align-middle bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                                  >
                                    A mano
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-stone-400 text-xs font-mono">
                                #{posicionAlta.get(c.cliente_id)}
                              </td>
                              <td className="px-4 py-2.5 text-stone-600">
                                {c.telefono || (
                                  <span className="text-stone-300">—</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-stone-500 text-xs">
                                {c.duenio}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                {c.agregado_por && rifaAbierta && (
                                  <button
                                    onClick={() => quitarDeRifa(c)}
                                    className="text-stone-300 hover:text-red-500 transition"
                                    aria-label={`Quitar a ${c.nombre} de la rifa`}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-stone-500">
                    {rifa.length} participantes con número asignado
                    {aMano > 0 &&
                      ` · ${aMano} ${aMano === 1 ? "agregado" : "agregados"} a mano`}
                    {filtro &&
                      ` · mostrando ${rifaVisible.length}, el Excel baja todos`}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

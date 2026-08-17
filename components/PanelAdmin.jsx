"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { lunesDe, aISO, rangoLegible, normalizar } from "@/lib/semanas";
import { descargarExcel } from "@/lib/descargas";

export default function PanelAdmin({ email }) {
  const supabase = createClient();

  const [vista, setVista] = useState("padron");
  const [padron, setPadron] = useState([]);
  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [rifa, setRifa] = useState([]);
  const [orden, setOrden] = useState("nombre");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [sorteando, setSorteando] = useState(false);
  const [error, setError] = useState("");

  const semanaISO = aISO(semana);

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

  // Un mismo RPC sortea lo que falta y devuelve la lista completa. Como los
  // numeros ya dados nunca se tocan, llamarlo de nuevo no cambia nada: sirve
  // igual para generar por primera vez que para volver a consultar.
  const cargarRifa = useCallback(async () => {
    setSorteando(true);
    const { data, error } = await supabase.rpc("asignar_numeros_rifa", {
      p_semana: semanaISO,
    });

    if (error) setError("No se pudieron generar los números. Probá de nuevo.");
    else {
      setRifa(data || []);
      setError("");
    }
    setSorteando(false);
  }, [supabase, semanaISO]);

  useEffect(() => {
    if (vista === "rifa") cargarRifa();
  }, [vista, cargarRifa]);

  function moverSemana(offset) {
    const nueva = new Date(semana);
    nueva.setDate(nueva.getDate() + offset * 7);
    setSemana(nueva);
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
    [...rifa].sort(porAlta).map((c, i) => [c.nombre, i + 1])
  );

  // El buscador filtra lo que se ve en pantalla, no lo que se exporta: el
  // Excel de la rifa y el del padron son documentos que se reparten, y bajar
  // media lista por tener texto olvidado en el buscador seria un problema.
  const filtro = normalizar(busqueda.trim());
  const coincide = (c) => !filtro || normalizar(c.nombre).includes(filtro);

  const padronVisible = padron.filter(coincide);
  const rifaVisible = rifaOrdenada.filter(coincide);

  function exportarRifa() {
    descargarExcel(
      // Solo lo que se le canta al cliente. El orden de alta, el encargado y
      // el numero interno siguen visibles en pantalla para auditar el sorteo,
      // pero no tienen por que viajar en el archivo que se reparte.
      rifaOrdenada.map((c) => ({
        Número: c.numero_rifa,
        Cliente: c.nombre,
      })),
      [10, 30],
      "Rifa",
      `rifa-${semanaISO}.xlsx`
    );
  }

  // Cuando pasan de 100 participantes, el numero interno sigue subiendo
  // (100, 101...) pero el que se canta es el modulo, asi que se repite.
  const repetidos = rifa.filter((c) => c.numero >= 100).length;

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

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setVista("padron")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
            vista === "padron"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white border-stone-300 hover:bg-stone-100"
          }`}
        >
          <Users size={15} />
          Todos los clientes
        </button>
        <button
          onClick={() => setVista("rifa")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition ${
            vista === "rifa"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white border-stone-300 hover:bg-stone-100"
          }`}
        >
          <Dices size={15} />
          Rifa de la semana
        </button>

        <button
          onClick={vista === "padron" ? exportarPadron : exportarRifa}
          disabled={vista === "padron" ? padron.length === 0 : rifa.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white hover:bg-stone-100 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <FileSpreadsheet size={15} />
          {vista === "padron" ? "Excel de todos los clientes" : "Excel de la rifa"}
        </button>
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

          {sorteando ? (
            <div className="text-center text-stone-400 text-sm py-16">
              Sorteando…
            </div>
          ) : rifa.length === 0 ? (
            <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
              Ningún cliente completó los seis días en esta semana.
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
                    su número con alguien de la primera. Los de segunda vuelta
                    salen sorteados entre el 50 y el 99, y cada número se
                    repite una sola vez. Están marcados con el número interno
                    al lado.
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
                      </tr>
                    </thead>
                    <tbody>
                      {rifaVisible.map((c) => (
                        <tr
                          key={c.numero}
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
                          <td className="px-4 py-2.5 font-medium">{c.nombre}</td>
                          <td className="px-4 py-2.5 text-stone-400 text-xs font-mono">
                            #{posicionAlta.get(c.nombre)}
                          </td>
                          <td className="px-4 py-2.5 text-stone-600">
                            {c.telefono || (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-stone-500 text-xs">
                            {c.duenio}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 text-sm text-stone-500">
                {rifa.length} participantes con número asignado
                {filtro &&
                  ` · mostrando ${rifaVisible.length}, el Excel baja todos`}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

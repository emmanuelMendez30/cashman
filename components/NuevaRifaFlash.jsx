"use client";

import { useState } from "react";
import { CalendarPlus, Plus, X, AlertCircle } from "lucide-react";
import { aISO } from "@/lib/semanas";

// Con qué arranca el formulario: dos sorteos, que es el caso más común, y
// la misma hora que la rifa de la semana. Todo se puede cambiar.
const OPCIONES_INICIALES = ["Sorteo 1", "Sorteo 2"];
const HORA_INICIAL = "7:30 p.m.";

export default function NuevaRifaFlash({ supabase, onCreada, onCerrar }) {
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState(() => aISO(new Date()));
  const [hora, setHora] = useState(HORA_INICIAL);
  const [opciones, setOpciones] = useState(OPCIONES_INICIALES);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const limpias = opciones.map((o) => o.trim()).filter(Boolean);

  function cambiarOpcion(i, texto) {
    setOpciones((prev) => prev.map((o, j) => (j === i ? texto : o)));
  }

  function sumarOpcion() {
    setOpciones((prev) => [...prev, `Sorteo ${prev.length + 1}`]);
  }

  function quitarOpcion(i) {
    setOpciones((prev) => prev.filter((_, j) => j !== i));
  }

  async function crear() {
    if (guardando) return;

    if (!nombre.trim()) {
      setError("Ponele un nombre a la rifa: es lo que sale en la imagen.");
      return;
    }
    if (!fecha) {
      setError("Elegí el día de la rifa.");
      return;
    }
    if (limpias.length === 0) {
      setError("La rifa necesita al menos una opción para marcar.");
      return;
    }

    // La rifa y sus opciones se crean en una sola llamada, así no puede
    // quedar una rifa a medio armar si algo falla en el medio.
    setGuardando(true);
    const { data, error } = await supabase.rpc("admin_crear_flash", {
      p_nombre: nombre.trim(),
      p_fecha: fecha,
      p_hora_sorteo: hora.trim() || null,
      p_opciones: limpias,
    });
    setGuardando(false);

    if (error || !data) {
      setError(error?.message || "No se pudo crear la rifa. Probá de nuevo.");
      return;
    }
    onCreada(data);
  }

  return (
    <div className="mb-5 bg-white border border-stone-300 rounded-xl p-4">
      <div className="flex items-start gap-2 mb-4">
        <CalendarPlus size={16} className="text-stone-500 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-sm font-medium">Nueva rifa flash</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Califica quien tenga marcadas todas las opciones.
          </p>
        </div>
        <button
          onClick={onCerrar}
          className="text-stone-400 hover:text-stone-700 transition"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="text-xs text-stone-500">
          Nombre
          <input
            type="text"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setError("");
            }}
            autoFocus
            placeholder="Ej: Feriado 15 de septiembre"
            className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        <label className="text-xs text-stone-500">
          Día
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
        <label className="text-xs text-stone-500">
          Hora del sorteo
          <input
            type="text"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            placeholder="Opcional"
            className="mt-1 w-full sm:w-32 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
      </div>

      <div className="mt-4">
        <div className="text-xs text-stone-500 mb-1">Opciones para marcar</div>
        <div className="flex flex-wrap gap-2">
          {opciones.map((opcion, i) => (
            <div
              key={i}
              className="flex items-center border border-stone-300 rounded-lg bg-stone-50 focus-within:ring-2 focus-within:ring-amber-400"
            >
              <input
                type="text"
                value={opcion}
                onChange={(e) => cambiarOpcion(i, e.target.value)}
                aria-label={`Opción ${i + 1}`}
                className="w-28 bg-transparent text-sm px-3 py-1.5 focus:outline-none"
              />
              {opciones.length > 1 && (
                <button
                  onClick={() => quitarOpcion(i)}
                  className="pr-2 text-stone-400 hover:text-red-500 transition"
                  aria-label={`Quitar ${opcion || `opción ${i + 1}`}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={sumarOpcion}
            className="flex items-center gap-1 px-3 py-1.5 border border-dashed border-stone-300 rounded-lg text-sm text-stone-600 hover:bg-stone-50 transition"
          >
            <Plus size={14} />
            Opción
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-stone-500">
          {limpias.length === 1
            ? "Con una sola opción, califica quien la tenga marcada."
            : `Con ${limpias.length} opciones, califica quien tenga las ${limpias.length} marcadas.`}
        </p>
        <button
          onClick={crear}
          disabled={guardando}
          className="flex items-center gap-1 bg-stone-800 hover:bg-stone-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-40"
        >
          <CalendarPlus size={15} />
          Crear rifa
        </button>
      </div>
    </div>
  );
}

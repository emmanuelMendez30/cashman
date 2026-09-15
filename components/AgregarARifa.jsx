"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, Plus, X, AlertCircle, Check } from "lucide-react";
import {
  normalizar,
  soloDigitos,
  telefonoValido,
  TELEFONO_LARGO,
} from "@/lib/semanas";

// Cuántos resultados del padrón se muestran mientras se escribe. Con la
// lista entera abajo del campo no se elige a nadie; con estos alcanza
// para reconocer a la persona y seguir.
const MAX_RESULTADOS = 6;

// Busca en el padrón de la semana y mete al elegido en la rifa. Si la
// persona no está en ningún lado, la crea y la mete en el mismo paso.
//
// Sirve para las dos rifas: `semanaISO` es la semana del padrón que se
// ofrece (la de la rifa) y `agregar` hace la llamada a la función de
// Postgres que corresponde. Recibe { clienteId, nombre, telefono } y
// devuelve lo mismo que `supabase.rpc`.
export default function AgregarARifa({
  supabase,
  semanaISO,
  yaEnRifa,
  agregar: agregarEnRifa,
  onAgregado,
  onCerrar,
}) {
  const [padron, setPadron] = useState([]);
  const [correos, setCorreos] = useState({});
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [ultimo, setUltimo] = useState(null);

  // Los clientes vigentes en esta semana, con el mismo criterio de `desde`
  // y `hasta` que usa la pantalla de los encargados. El admin los ve todos
  // porque su policy de lectura no filtra por usuario.
  const cargarPadron = useCallback(async () => {
    const [{ data, error }, perfiles] = await Promise.all([
      supabase
        .from("clientes")
        .select("id, nombre, telefono, user_id")
        .lte("desde", semanaISO)
        .or(`hasta.is.null,hasta.gt.${semanaISO}`)
        .order("nombre"),
      supabase.from("perfiles").select("id, email"),
    ]);

    if (error) {
      setError("No se pudo cargar el padrón. Cerrá y volvé a abrir.");
      return;
    }

    setPadron(data || []);
    setCorreos(
      Object.fromEntries((perfiles.data || []).map((p) => [p.id, p.email]))
    );
  }, [supabase, semanaISO]);

  useEffect(() => {
    cargarPadron();
  }, [cargarPadron]);

  // El recién creado ya trae el correo del encargado; el resto sale del
  // mapa de perfiles que se cargó junto con el padrón.
  const encargado = (c) => c.duenio || correos[c.user_id] || "";

  const buscado = nombre.trim();
  const filtro = normalizar(buscado);

  const resultados = filtro
    ? padron
        .filter(
          (c) =>
            normalizar(c.nombre).includes(filtro) ||
            (c.telefono || "").includes(filtro)
        )
        .slice(0, MAX_RESULTADOS)
    : [];

  // Solo se ofrece crear a alguien cuando el nombre escrito no es igual al
  // de nadie del padrón. Con coincidencia exacta la persona ya existe y hay
  // que elegirla de la lista, o el padrón termina con dos filas iguales.
  const existeIgual = padron.some((c) => normalizar(c.nombre) === filtro);
  const puedeCrear = buscado.length > 0 && !existeIgual;

  async function agregar({ clienteId = null } = {}) {
    if (guardando) return;

    if (!clienteId && !telefonoValido(telefono)) {
      setError(`El teléfono tiene que ser de ${TELEFONO_LARGO} dígitos.`);
      return;
    }

    setGuardando(true);
    const { data, error } = await agregarEnRifa({
      clienteId,
      nombre: clienteId ? null : buscado,
      telefono: clienteId ? null : telefono.trim() || null,
    });
    setGuardando(false);

    // Los mensajes de la función están escritos para que los lea la dueña
    // del negocio, así que se muestran tal cual en vez de taparlos con uno
    // genérico. El fallback es por si el que falla es el propio Supabase.
    if (error || !data?.[0]) {
      setError(error?.message || "No se pudo agregar. Probá de nuevo.");
      return;
    }

    const fila = data[0];
    onAgregado(fila);
    setUltimo(fila);
    setNombre("");
    setTelefono("");
    setError("");

    // El recién creado tiene que aparecer en el buscador, si no el próximo
    // intento de agregarlo ofrecería crearlo otra vez.
    if (!clienteId) {
      setPadron((prev) =>
        [
          ...prev,
          {
            id: fila.cliente_id,
            nombre: fila.nombre,
            telefono: fila.telefono,
            duenio: fila.duenio,
          },
        ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      );
    }
  }

  return (
    <div className="mb-5 bg-white border border-stone-300 rounded-xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <UserPlus size={16} className="text-stone-500 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-sm font-medium">Agregar a la rifa</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Le sale un número del mismo pozo, sin tocar lo que marcó el
            encargado. Queda marcado como agregado a mano.
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

      <input
        type="text"
        value={nombre}
        onChange={(e) => {
          setNombre(e.target.value);
          setError("");
        }}
        autoFocus
        placeholder="Nombre del cliente"
        className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
      />

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {ultimo && !error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <Check size={16} className="flex-shrink-0" />
          <span>
            {ultimo.nombre} entró con el número{" "}
            <span className="font-mono font-semibold">{ultimo.numero_rifa}</span>
            .
          </span>
        </div>
      )}

      {resultados.length > 0 && (
        <ul className="mt-3 border border-stone-200 rounded-lg divide-y divide-stone-100 overflow-hidden">
          {resultados.map((c) => {
            const dentro = yaEnRifa.has(c.id);
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-stone-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.nombre}</div>
                  <div className="text-xs text-stone-500 truncate">
                    {c.telefono || "sin teléfono"}
                    {encargado(c) ? ` · ${encargado(c)}` : ""}
                  </div>
                </div>
                {dentro ? (
                  <span className="text-xs text-stone-400 flex-shrink-0">
                    Ya tiene número
                  </span>
                ) : (
                  <button
                    onClick={() => agregar({ clienteId: c.id })}
                    disabled={guardando}
                    className="flex items-center gap-1 bg-stone-800 hover:bg-stone-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-40"
                  >
                    <Plus size={14} />
                    Agregar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {puedeCrear && (
        <div className="mt-3 border border-dashed border-stone-300 rounded-lg p-3">
          <p className="text-xs text-stone-500 mb-2">
            {resultados.length === 0
              ? `Nadie en el padrón se llama “${buscado}”.`
              : `Si ninguno de arriba es, dalo de alta como “${buscado}”.`}{" "}
            Queda a tu nombre en el padrón, desde la semana de esta rifa.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="tel"
              inputMode="numeric"
              value={telefono}
              onChange={(e) => setTelefono(soloDigitos(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && agregar()}
              placeholder={`Teléfono (${TELEFONO_LARGO} dígitos, opcional)`}
              className="flex-1 min-w-[180px] border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={() => agregar()}
              disabled={guardando}
              className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-40"
            >
              <UserPlus size={15} />
              Crear y agregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

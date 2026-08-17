"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Ticket,
  Check,
  AlertCircle,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Search,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  DIAS,
  lunesDe,
  aISO,
  rangoLegible,
  califica,
  soloDigitos,
  telefonoValido,
  TELEFONO_LARGO,
  semanaEditable,
  cierreLegible,
} from "@/lib/semanas";
import { descargarExcel, descargarTxt } from "@/lib/descargas";

const ACENTOS = /[̀-ͯ]/g;

export default function ControlCashmana({ email, userId, esAdmin = false }) {
  const supabase = createClient();
  const router = useRouter();

  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [clientes, setClientes] = useState([]);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const semanaISO = aISO(semana);

  const cargar = useCallback(async () => {
    setCargando(true);

    // El padron vive en `clientes` y las cruces de cada semana en `marcas`.
    // Traemos los clientes vigentes en esta semana con su fila de marcas
    // (si todavia no existe viene vacia) y los aplanamos a un solo objeto,
    // que es la forma que consume el resto del componente.
    //
    // El admin ve los de todos: el RLS ya se lo permite, pero solo para
    // leer, asi que los ajenos se muestran sin controles.
    let consulta = supabase
      .from("clientes")
      .select(
        "id, nombre, telefono, user_id, marcas(semana, lun, mar, mie, jue, vie, sab, nota)"
      )
      .lte("desde", semanaISO)
      .or(`hasta.is.null,hasta.gt.${semanaISO}`)
      .eq("marcas.semana", semanaISO)
      .order("created_at", { ascending: true });

    if (!esAdmin) consulta = consulta.eq("user_id", userId);

    const [{ data, error }, perfiles] = await Promise.all([
      consulta,
      esAdmin
        ? supabase.from("perfiles").select("id, email")
        : Promise.resolve({ data: [] }),
    ]);

    if (error) setError("No se pudo cargar la lista. Recargá la página.");
    else {
      const correos = Object.fromEntries(
        (perfiles.data || []).map((p) => [p.id, p.email])
      );

      setClientes(
        (data || []).map((c) => {
          const marca = c.marcas?.[0];
          return {
            id: c.id,
            nombre: c.nombre,
            telefono: c.telefono ?? "",
            nota: marca?.nota ?? "",
            esMio: c.user_id === userId,
            duenio: correos[c.user_id] || "",
            ...Object.fromEntries(DIAS.map((d) => [d.key, marca?.[d.key] ?? false])),
          };
        })
      );
      setError("");
    }
    setCargando(false);
  }, [semanaISO, supabase, userId, esAdmin]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function moverSemana(offset) {
    const nueva = new Date(semana);
    nueva.setDate(nueva.getDate() + offset * 7);
    setSemana(nueva);
  }

  async function agregarCliente() {
    const limpio = nombre.trim();
    if (!limpio) return;

    if (!telefonoValido(telefono)) {
      setError(`El teléfono tiene que ser de ${TELEFONO_LARGO} dígitos.`);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Tu sesión expiró. Volvé a iniciar sesión.");
      router.push("/login");
      return;
    }

    // Alta en el padron: queda registrado desde esta semana en adelante.
    const { data, error } = await supabase
      .from("clientes")
      .insert({
        nombre: limpio,
        telefono: telefono.trim() || null,
        desde: semanaISO,
        user_id: user.id,
      })
      .select("id, nombre, telefono")
      .single();

    if (error) {
      setError(
        error.code === "23505"
          ? "Ese cliente ya está en tu lista."
          : "No se pudo agregar el cliente. Probá de nuevo."
      );
      return;
    }
    setClientes([
      ...clientes,
      {
        id: data.id,
        nombre: data.nombre,
        telefono: data.telefono ?? "",
        nota: "",
        esMio: true,
        duenio: email,
        ...Object.fromEntries(DIAS.map((d) => [d.key, false])),
      },
    ]);
    setNombre("");
    setTelefono("");
    setError("");
  }

  // Nombre y telefono viven en el padron, asi que el cambio vale para todas
  // las semanas. Cualquier usuario puede corregir los suyos, no solo el admin.
  function editarCliente(id, campo, texto) {
    setClientes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [campo]: texto } : c))
    );
  }

  async function guardarCliente(cliente, campo) {
    const valor = (cliente[campo] || "").trim();

    if (campo === "nombre" && !valor) {
      setError("El nombre no puede quedar vacío.");
      cargar();
      return;
    }

    // No se guarda un telefono a medias: se avisa y el campo queda editable
    // con lo que la persona escribio, para que lo complete.
    if (campo === "telefono" && !telefonoValido(valor)) {
      setError(`El teléfono tiene que ser de ${TELEFONO_LARGO} dígitos.`);
      return;
    }

    const { error } = await supabase
      .from("clientes")
      .update({ [campo]: valor || null })
      .eq("id", cliente.id);

    if (error) {
      setError(
        error.code === "23505"
          ? "Ya tenés otro cliente con ese nombre."
          : "No se pudo guardar el cambio. Probá de nuevo."
      );
      cargar();
    } else {
      setError("");
    }
  }

  async function toggleDia(cliente, diaKey) {
    const nuevoValor = !cliente[diaKey];
    setClientes((prev) =>
      prev.map((c) => (c.id === cliente.id ? { ...c, [diaKey]: nuevoValor } : c))
    );

    // La fila de marcas de esta semana puede no existir todavia: el upsert
    // la crea con el resto de los dias en false, o actualiza solo este dia.
    const { error } = await supabase.from("marcas").upsert(
      {
        cliente_id: cliente.id,
        user_id: userId,
        semana: semanaISO,
        [diaKey]: nuevoValor,
      },
      { onConflict: "cliente_id,semana" }
    );

    if (error) {
      setError("No se pudo guardar el cambio. Probá de nuevo.");
      cargar();
    }
  }

  function editarNota(id, texto) {
    setClientes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, nota: texto } : c))
    );
  }

  async function guardarNota(cliente) {
    const { error } = await supabase.from("marcas").upsert(
      {
        cliente_id: cliente.id,
        user_id: userId,
        semana: semanaISO,
        nota: cliente.nota,
      },
      { onConflict: "cliente_id,semana" }
    );

    if (error) setError("No se pudo guardar la nota. Probá de nuevo.");
  }

  async function eliminarCliente(id) {
    const previos = clientes;
    setClientes(clientes.filter((c) => c.id !== id));

    // Archivar en vez de borrar: el cliente desaparece de esta semana y de
    // las siguientes, pero las semanas ya cerradas lo siguen mostrando con
    // lo que habia comprado.
    const { error } = await supabase
      .from("clientes")
      .update({ hasta: semanaISO })
      .eq("id", id);

    if (error) {
      setError("No se pudo eliminar el cliente. Probá de nuevo.");
      setClientes(previos);
    }
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const califican = clientes.filter(califica);

  // Desde el domingo a las 00:00 de Costa Rica la semana queda cerrada.
  // La misma regla vive en las policies de Postgres; esto es para que la
  // pantalla no ofrezca lo que la base va a rechazar.
  const semanaAbierta = semanaEditable(semana);
  const puedeEditar = (c) => c.esMio && semanaAbierta;

  // Sin acentos y sin distinguir mayusculas, para que "jose" encuentre a José.
  // NFD separa la letra de su tilde y el rango U+0300-U+036F son justamente
  // esas tildes sueltas, asi que borrarlas deja la letra pelada.
  const normalizar = (t) =>
    (t || "")
      .normalize("NFD")
      .replace(ACENTOS, "")
      .toLowerCase();

  const filtro = normalizar(busqueda.trim());
  const visibles = filtro
    ? clientes.filter(
        (c) =>
          normalizar(c.nombre).includes(filtro) ||
          (c.telefono || "").includes(filtro)
      )
    : clientes;

  function exportarExcel() {
    const filas = clientes.map((c) => {
      const fila = { Cliente: c.nombre, Teléfono: c.telefono || "" };
      if (esAdmin) fila["Encargado"] = c.duenio;
      DIAS.forEach((d) => (fila[d.label] = c[d.key] ? "Sí" : ""));
      fila["Califica"] = califica(c) ? "Sí" : "No";
      fila["Notas"] = c.nota || "";
      return fila;
    });

    descargarExcel(
      filas,
      [24, 16, ...(esAdmin ? [26] : []), ...DIAS.map(() => 6), 10, 34],
      "Control",
      `control-cashmana-${semanaISO}.xlsx`
    );
  }

  function exportarTxt() {
    descargarTxt(
      califican.map((c) => c.nombre).join("\n"),
      `califican-${semanaISO}.txt`
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-1">
        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Ticket size={18} className="text-amber-700" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Control Cashmana</h1>
        </div>
        {esAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-amber-700 hover:text-amber-900 text-sm transition mr-3"
          >
            <Ticket size={15} />
            Panel admin
          </Link>
        )}
        <button
          onClick={cerrarSesion}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 text-sm transition"
        >
          <LogOut size={15} />
          Salir
        </button>
      </div>

      <p className="text-sm text-stone-500 mb-5 ml-12">
        Marcá los días que cada cliente compró.
      </p>

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
        <span className="text-xs text-stone-400 ml-2 truncate">{email}</span>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!semanaAbierta && (
        <div className="mb-4 flex items-start gap-2 text-sm text-stone-600 bg-stone-100 border border-stone-300 rounded-lg px-3 py-2">
          <Lock size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            Esta semana ya cerró y quedó como histórico. Se podía editar hasta
            la medianoche del sábado {cierreLegible(semana)}.{" "}
            {esAdmin
              ? "Como admin la ves completa, pero nadie puede modificarla."
              : "Para cargar movimientos, pasá a la semana siguiente con la flecha."}
          </span>
        </div>
      )}

      <div
        className={`flex gap-2 mb-4 ${semanaAbierta ? "" : "hidden"}`}
      >
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
          placeholder="Nombre del cliente"
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <input
          type="tel"
          inputMode="numeric"
          value={telefono}
          onChange={(e) => setTelefono(soloDigitos(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
          placeholder={`Teléfono (${TELEFONO_LARGO} dígitos, opcional)`}
          className="w-52 border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={agregarCliente}
          className="flex items-center gap-1 bg-stone-800 hover:bg-stone-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} />
          Agregar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
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
        <button
          onClick={exportarExcel}
          disabled={clientes.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white hover:bg-stone-100 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <FileSpreadsheet size={15} />
          Excel de la semana
        </button>
        <button
          onClick={exportarTxt}
          disabled={califican.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 border border-stone-300 rounded-lg text-sm bg-white hover:bg-stone-100 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <FileText size={15} />
          Txt de los que califican
        </button>
      </div>

      {cargando ? (
        <div className="text-center text-stone-400 text-sm py-16">
          Cargando lista...
        </div>
      ) : clientes.length === 0 ? (
        <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
          {esAdmin
            ? "Ningún usuario tiene clientes en esta semana."
            : "Todavía no cargaste clientes. Los que agregues quedan registrados para todas las semanas siguientes."}
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
                  <th className="text-left px-3 py-3 font-medium min-w-[120px]">
                    Teléfono
                  </th>
                  {esAdmin && (
                    <th className="text-left px-3 py-3 font-medium">
                      Encargado
                    </th>
                  )}
                  {DIAS.map((d) => (
                    <th
                      key={d.key}
                      className="px-2 py-3 font-medium text-center w-12"
                    >
                      {d.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-medium text-center w-20">
                    Rifa
                  </th>
                  <th className="text-left px-4 py-3 font-medium min-w-[160px]">
                    Notas
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((cliente) => (
                  <tr
                    key={cliente.id}
                    className="border-t border-stone-100 hover:bg-stone-50"
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={cliente.nombre}
                        onChange={(e) =>
                          editarCliente(cliente.id, "nombre", e.target.value)
                        }
                        onBlur={() => guardarCliente(cliente, "nombre")}
                        readOnly={!puedeEditar(cliente)}
                        aria-label={`Nombre de ${cliente.nombre}`}
                        className={`w-full font-medium bg-transparent border border-transparent rounded-md px-2 py-1 focus:outline-none ${
                          puedeEditar(cliente)
                            ? "hover:border-stone-200 focus:bg-white focus:border-stone-300 focus:ring-1 focus:ring-amber-400"
                            : "cursor-default text-stone-600"
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="tel"
                        inputMode="numeric"
                        value={cliente.telefono || ""}
                        onChange={(e) =>
                          editarCliente(
                            cliente.id,
                            "telefono",
                            soloDigitos(e.target.value)
                          )
                        }
                        onBlur={() => guardarCliente(cliente, "telefono")}
                        readOnly={!puedeEditar(cliente)}
                        placeholder="—"
                        aria-label={`Teléfono de ${cliente.nombre}`}
                        className={`w-full text-xs bg-transparent border rounded-md px-2 py-1 focus:outline-none ${
                          !telefonoValido(cliente.telefono)
                            ? "border-red-300 bg-red-50"
                            : puedeEditar(cliente)
                              ? "border-transparent hover:border-stone-200 focus:bg-white focus:border-stone-300 focus:ring-1 focus:ring-amber-400"
                              : "border-transparent cursor-default text-stone-500"
                        }`}
                      />
                    </td>
                    {esAdmin && (
                      <td className="px-3 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                        {cliente.duenio}
                      </td>
                    )}
                    {DIAS.map((d) => (
                      <td key={d.key} className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => toggleDia(cliente, d.key)}
                          disabled={!puedeEditar(cliente)}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center mx-auto transition ${
                            cliente[d.key]
                              ? puedeEditar(cliente)
                                ? "bg-emerald-500 border-emerald-500"
                                : "bg-emerald-200 border-emerald-200"
                              : puedeEditar(cliente)
                                ? "border-stone-300 hover:border-stone-400"
                                : "border-stone-200"
                          } ${puedeEditar(cliente) ? "" : "cursor-default"}`}
                          aria-label={`${d.label} - ${cliente.nombre}`}
                        >
                          {cliente[d.key] && (
                            <Check
                              size={14}
                              className={
                                puedeEditar(cliente)
                                  ? "text-white"
                                  : "text-emerald-700"
                              }
                            />
                          )}
                        </button>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center">
                      {califica(cliente) ? (
                        <span className="inline-block bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded-full">
                          Califica
                        </span>
                      ) : (
                        <span className="text-stone-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={cliente.nota || ""}
                        onChange={(e) => editarNota(cliente.id, e.target.value)}
                        onBlur={() => guardarNota(cliente)}
                        readOnly={!puedeEditar(cliente)}
                        placeholder={puedeEditar(cliente) ? "Ej: martes no completó cuota" : ""}
                        className={`w-full text-xs border rounded-md px-2 py-1.5 focus:outline-none ${
                          puedeEditar(cliente)
                            ? "border-stone-200 focus:ring-1 focus:ring-amber-400"
                            : "border-transparent cursor-default text-stone-500"
                        }`}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {puedeEditar(cliente) && (
                        <button
                          onClick={() => eliminarCliente(cliente.id)}
                          className="text-stone-300 hover:text-red-500 transition"
                          aria-label={`Eliminar ${cliente.nombre}`}
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
      )}

      {clientes.length > 0 && (
        <div className="mt-4 text-sm text-stone-500">
          {califican.length} de {clientes.length} clientes califican
          {filtro && ` · mostrando ${visibles.length}`}
        </div>
      )}
    </div>
  );
}

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
} from "lucide-react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

const DIAS = [
  { key: "lun", label: "Lun" },
  { key: "mar", label: "Mar" },
  { key: "mie", label: "Mié" },
  { key: "jue", label: "Jue" },
  { key: "vie", label: "Vie" },
  { key: "sab", label: "Sáb" },
];

function lunesDe(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function aISO(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rangoLegible(lunes) {
  const sabado = new Date(lunes);
  sabado.setDate(sabado.getDate() + 5);
  const fmt = (f) =>
    f.toLocaleDateString("es", { day: "numeric", month: "short" });
  return `${fmt(lunes)} — ${fmt(sabado)}`;
}

export default function ControlCashmana({ email, userId }) {
  const supabase = createClient();
  const router = useRouter();

  const [semana, setSemana] = useState(() => lunesDe(new Date()));
  const [clientes, setClientes] = useState([]);
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const semanaISO = aISO(semana);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("user_id", userId)
      .eq("semana", semanaISO)
      .order("created_at", { ascending: true });

    if (error) setError("No se pudo cargar la lista. Recargá la página.");
    else {
      setClientes(data || []);
      setError("");
    }
    setCargando(false);
  }, [semanaISO, supabase, userId]);

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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Tu sesión expiró. Volvé a iniciar sesión.");
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("clientes")
      .insert({ nombre: limpio, semana: semanaISO, user_id: user.id })
      .select()
      .single();

    if (error) {
      setError(
        error.code === "23505"
          ? "Ese cliente ya está en esta semana."
          : "No se pudo agregar el cliente. Probá de nuevo."
      );
      return;
    }
    setClientes([...clientes, data]);
    setNombre("");
    setError("");
  }

  async function toggleDia(cliente, diaKey) {
    const nuevoValor = !cliente[diaKey];
    setClientes((prev) =>
      prev.map((c) => (c.id === cliente.id ? { ...c, [diaKey]: nuevoValor } : c))
    );

    const { error } = await supabase
      .from("clientes")
      .update({ [diaKey]: nuevoValor })
      .eq("id", cliente.id);

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
    const { error } = await supabase
      .from("clientes")
      .update({ nota: cliente.nota })
      .eq("id", cliente.id);

    if (error) setError("No se pudo guardar la nota. Probá de nuevo.");
  }

  async function eliminarCliente(id) {
    const previos = clientes;
    setClientes(clientes.filter((c) => c.id !== id));

    const { error } = await supabase.from("clientes").delete().eq("id", id);
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

  const califica = (c) => DIAS.every((d) => c[d.key]);
  const califican = clientes.filter(califica);

  function descargar(blob, nombreArchivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportarExcel() {
    const filas = clientes.map((c) => {
      const fila = { Cliente: c.nombre };
      DIAS.forEach((d) => (fila[d.label] = c[d.key] ? "Sí" : ""));
      fila["Califica"] = califica(c) ? "Sí" : "No";
      fila["Notas"] = c.nota || "";
      return fila;
    });

    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [
      { wch: 24 },
      ...DIAS.map(() => ({ wch: 6 })),
      { wch: 10 },
      { wch: 34 },
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Control");
    const buffer = XLSX.write(libro, { bookType: "xlsx", type: "array" });

    descargar(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `control-cashmana-${semanaISO}.xlsx`
    );
  }

  function exportarTxt() {
    const texto = califican.map((c) => c.nombre).join("\n");
    descargar(
      new Blob([texto], { type: "text/plain;charset=utf-8" }),
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

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
          placeholder="Nombre del cliente"
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={agregarCliente}
          className="flex items-center gap-1 bg-stone-800 hover:bg-stone-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} />
          Agregar
        </button>
      </div>

      {cargando ? (
        <div className="text-center text-stone-400 text-sm py-16">
          Cargando lista...
        </div>
      ) : clientes.length === 0 ? (
        <div className="text-center text-stone-400 text-sm py-16 border border-dashed border-stone-300 rounded-xl">
          Todavía no cargaste clientes en esta semana.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-100 text-stone-600 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Cliente</th>
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
                {clientes.map((cliente) => (
                  <tr
                    key={cliente.id}
                    className="border-t border-stone-100 hover:bg-stone-50"
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {cliente.nombre}
                    </td>
                    {DIAS.map((d) => (
                      <td key={d.key} className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => toggleDia(cliente, d.key)}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center mx-auto transition ${
                            cliente[d.key]
                              ? "bg-emerald-500 border-emerald-500"
                              : "border-stone-300 hover:border-stone-400"
                          }`}
                          aria-label={`${d.label} - ${cliente.nombre}`}
                        >
                          {cliente[d.key] && (
                            <Check size={14} className="text-white" />
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
                        placeholder="Ej: martes no completó cuota"
                        className="w-full text-xs border border-stone-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button
                        onClick={() => eliminarCliente(cliente.id)}
                        className="text-stone-300 hover:text-red-500 transition"
                        aria-label={`Eliminar ${cliente.nombre}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clientes.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-stone-500">
            {califican.length} de {clientes.length} clientes califican
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={exportarExcel}
              className="flex items-center gap-1.5 border border-stone-300 bg-white hover:bg-stone-100 text-sm px-3 py-2 rounded-lg transition"
            >
              <FileSpreadsheet size={15} />
              Exportar a Excel
            </button>
            <button
              onClick={exportarTxt}
              disabled={califican.length === 0}
              className="flex items-center gap-1.5 border border-stone-300 bg-white hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-white text-sm px-3 py-2 rounded-lg transition"
            >
              <FileText size={15} />
              Descargar lista .txt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

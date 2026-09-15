"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Ticket, LogOut, CalendarDays, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Los módulos de la app. Comparten el padrón de clientes; cada uno tiene su
// propia forma de marcar quién califica y su propia rifa. Cashmana va
// primero y es la dirección de siempre, así quien solo usa la rifa de la
// semana entra exactamente a lo mismo que antes.
const MODULOS = [
  { href: "/", etiqueta: "Cashmana", Icono: CalendarDays },
  { href: "/flash", etiqueta: "Rifa Flash", Icono: Zap },
];

export default function Encabezado({ esAdmin = false, subtitulo }) {
  const supabase = createClient();
  const router = useRouter();
  const ruta = usePathname();

  async function cerrarSesion() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Ticket size={18} className="text-amber-700" />
        </div>

        <nav className="flex gap-1 bg-stone-100 border border-stone-200 p-1 rounded-lg">
          {MODULOS.map(({ href, etiqueta, Icono }) => {
            const activo = ruta === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={activo ? "page" : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  activo
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-800"
                }`}
              >
                <Icono size={15} />
                {etiqueta}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {esAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 text-amber-700 hover:text-amber-900 text-sm transition"
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
      </div>

      {subtitulo && (
        <p className="text-sm text-stone-500 mb-5 ml-12">{subtitulo}</p>
      )}
    </>
  );
}

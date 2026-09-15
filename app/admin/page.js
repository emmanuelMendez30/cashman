import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PanelAdmin from "@/components/PanelAdmin";

// Un id de rifa flash en la URL (/admin?flash=...) abre el panel directo en
// los números de esa rifa: es a donde lleva el enlace del módulo Rifa Flash.
// Se valida la forma para no mandarle a Postgres cualquier texto.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Admin({ searchParams }) {
  const { flash } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Primera barrera: si no es admin no ve la pagina. La segunda, y la que
  // de verdad importa, esta en Postgres: las funciones admin_padron() y
  // asignar_numeros_rifa() vuelven a chequear el rol antes de devolver nada,
  // asi que entrar a mano por la URL no sirve de nada.
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  if (perfil?.rol !== "admin") redirect("/");

  return (
    <PanelAdmin
      email={user.email}
      flashInicial={typeof flash === "string" && UUID.test(flash) ? flash : null}
    />
  );
}

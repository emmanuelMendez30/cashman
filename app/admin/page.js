import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PanelAdmin from "@/components/PanelAdmin";

export default async function Admin() {
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

  return <PanelAdmin email={user.email} />;
}

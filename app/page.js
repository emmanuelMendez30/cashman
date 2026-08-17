import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ControlCashmana from "@/components/ControlCashmana";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Si la tabla `perfiles` todavia no existe, el error se ignora y el
  // usuario entra como uno comun: la app sigue andando sin el panel.
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <ControlCashmana
      email={user.email}
      userId={user.id}
      esAdmin={perfil?.rol === "admin"}
    />
  );
}

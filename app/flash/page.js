import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RifaFlash from "@/components/RifaFlash";

export default async function Flash() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <RifaFlash
      email={user.email}
      userId={user.id}
      esAdmin={perfil?.rol === "admin"}
    />
  );
}

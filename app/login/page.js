"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function iniciarSesion(e) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Completá tu correo y contraseña.");
      return;
    }
    setCargando(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
            <Ticket size={18} className="text-amber-700" />
          </div>
          <h1 className="text-xl font-semibold">Control Cashmana</h1>
        </div>

        <form
          onSubmit={iniciarSesion}
          className="bg-white border border-stone-200 rounded-xl p-5"
        >
          <label className="block text-sm font-medium mb-1">Correo</label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            placeholder="nombre@correo.com"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />

          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 mb-4">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="w-full bg-stone-800 hover:bg-stone-900 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
          >
            {cargando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

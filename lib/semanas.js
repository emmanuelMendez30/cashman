// Los días que cuentan para la rifa. Si la semana no va de lunes a sábado,
// editá este arreglo. Las claves tienen que coincidir con las columnas
// booleanas de la tabla `marcas` en Supabase.
export const DIAS = [
  { key: "lun", label: "Lun" },
  { key: "mar", label: "Mar" },
  { key: "mie", label: "Mié" },
  { key: "jue", label: "Jue" },
  { key: "vie", label: "Vie" },
  { key: "sab", label: "Sáb" },
];

// Toda semana se identifica por su lunes, que es lo que se guarda en la
// columna `semana`. Domingo cuenta como parte de la semana que termina.
export function lunesDe(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Con getters locales a propósito: toISOString() convierte a UTC y en
// nuestro huso adelantaría o atrasaría un día.
export function aISO(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function rangoLegible(lunes) {
  const sabado = new Date(lunes);
  sabado.setDate(sabado.getDate() + 5);
  const fmt = (f) =>
    f.toLocaleDateString("es", { day: "numeric", month: "short" });
  return `${fmt(lunes)} — ${fmt(sabado)}`;
}

// Un cliente califica cuando compró los seis días.
export const califica = (c) => DIAS.every((d) => c[d.key]);

// El teléfono es opcional, pero si está tiene que ser 8 dígitos exactos.
// La misma regla vive como CHECK en Postgres: esto es para avisar antes.
export const TELEFONO_LARGO = 8;

export const soloDigitos = (texto) =>
  (texto || "").replace(/\D/g, "").slice(0, TELEFONO_LARGO);

export const telefonoValido = (texto) =>
  !texto || new RegExp(`^\\d{${TELEFONO_LARGO}}$`).test(texto);

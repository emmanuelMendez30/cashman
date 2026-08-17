# Control Cashmana

Control de compras diarias para la rifa semanal. Cada usuario ve solo sus propios clientes.

## 1. Preparar Supabase

**Crear la tabla:** entrá a tu proyecto en Supabase → **SQL Editor** → pegá todo el contenido de `supabase/schema.sql` y ejecutalo. Eso crea la tabla `clientes` y activa Row Level Security, que es lo que garantiza que cada usuario solo pueda ver y editar lo suyo.

**Crear los 2 usuarios:** andá a **Authentication → Users → Add user → Create new user**. Poné correo y contraseña de cada uno y marcá *Auto Confirm User* (así no tienen que confirmar por email). Repetilo para el segundo usuario.

No hay registro público: los usuarios se crean solo desde el panel de Supabase.

**Copiar las llaves:** en **Project Settings → API** vas a encontrar la *Project URL* y la *anon public key*. Las necesitás en el siguiente paso.

## 2. Correr en tu máquina

```bash
npm install
cp .env.local.example .env.local
```

Editá `.env.local` con la URL y la anon key de tu proyecto, y arrancá:

```bash
npm run dev
```

Abrí http://localhost:3000 — te va a mandar al login.

## 3. Subir a Vercel

Subí el proyecto a un repo de GitHub e importalo desde vercel.com. Cuando te pida las variables de entorno, cargá las mismas dos:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Vercel detecta Next.js solo, no hay que configurar nada más. También podés hacerlo desde la terminal con `npx vercel`.

## Cómo funciona

Cada fila de la tabla `clientes` guarda un cliente para una semana puntual (la columna `semana` guarda el lunes de esa semana). Al cambiar de semana con las flechas, la lista arranca vacía y la semana anterior queda guardada como histórico.

Un cliente "califica" cuando tiene marcados los seis días, de lunes a sábado. La exportación a Excel baja la semana completa con todas las columnas; la exportación a txt baja solo los nombres que califican, uno por línea.

## Cambiar los días que cuentan

Si la semana no va de lunes a sábado, editá el arreglo `DIAS` al inicio de `components/ControlCashmana.jsx`. Si sacás o agregás días, acordate de ajustar también las columnas de la tabla en Supabase.

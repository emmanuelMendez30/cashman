# Control Cashmana

Control de compras diarias para la rifa semanal. Cada usuario ve solo sus propios clientes.

## 1. Preparar Supabase

**Crear la tabla:** entrá a tu proyecto en Supabase → **SQL Editor** → pegá todo el contenido de `supabase/schema.sql` y ejecutalo. Eso crea la tabla `clientes` y activa Row Level Security, que es lo que garantiza que cada usuario solo pueda ver y editar lo suyo.

**Crear los 2 usuarios:** andá a **Authentication → Users → Add user → Create new user**. Poné correo y contraseña de cada uno y marcá *Auto Confirm User* (así no tienen que confirmar por email). Repetilo para el segundo usuario.

No hay registro público: los usuarios se crean solo desde el panel de Supabase.

**Copiar las llaves:** en **Project Settings → API** vas a encontrar la *Project URL* y la *publishable key* (empieza con `sb_publishable_`). Las necesitás en el siguiente paso. Es una llave pública, pensada para viajar en el bundle del navegador: lo que protege los datos es el Row Level Security, no esconderla.

## 2. Correr en tu máquina

```bash
npm install
cp .env.local.example .env.local
```

Editá `.env.local` con la URL y la publishable key de tu proyecto, y arrancá:

```bash
npm run dev
```

Abrí http://localhost:3000 — te va a mandar al login.

## 3. Subir a Vercel

Subí el proyecto a un repo de GitHub e importalo desde vercel.com. Cuando te pida las variables de entorno, cargá las mismas dos:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Vercel detecta Next.js solo, no hay que configurar nada más. También podés hacerlo desde la terminal con `npx vercel`.

## Cómo funciona

Hay dos tablas. `clientes` es el padrón: una fila por persona, que das de alta una sola vez. `marcas` guarda los seis días de cada semana, con una fila por cliente y por semana (la columna `semana` guarda el lunes).

Eso significa que **el cliente queda registrado**: al cambiar de semana con las flechas la lista sigue mostrando a las mismas personas, con los días en blanco, y vos solo marcás quién compró. La fila de marcas se crea sola la primera vez que tocás un día o escribís una nota.

Dos columnas del padrón controlan desde cuándo y hasta cuándo aparece cada cliente. `desde` se completa al darlo de alta, así que no aparece en semanas anteriores a su alta. `hasta` se completa al eliminarlo: en vez de borrarse, el cliente se archiva, desaparece de esa semana en adelante y las semanas ya cerradas lo siguen mostrando con lo que había comprado. Por eso el histórico y las exportaciones viejas nunca cambian.

Un cliente "califica" cuando tiene marcados los seis días, de lunes a sábado. La exportación a Excel baja la semana completa con todas las columnas; la exportación a txt baja solo los nombres que califican, uno por línea.

## Cambiar los días que cuentan

Si la semana no va de lunes a sábado, editá el arreglo `DIAS` al inicio de `lib/semanas.js`. Si sacás o agregás días, acordate de ajustar también las columnas de la tabla `marcas` en Supabase y la condición de la función `asignar_numeros_rifa`, que chequea los seis días a mano.

## El panel de administración

Un usuario con `rol = 'admin'` en la tabla `perfiles` ve un enlace extra al panel, en `/admin`. Ahí puede mirar el padrón de clientes de todos los usuarios con su teléfono y bajarlo a Excel, y generar los números de la rifa de cada semana.

Los números salen de la función `asignar_numeros_rifa`, que reparte al azar entre los clientes que completaron los seis días, **juntando los de todos los usuarios en una sola rifa**. Se sortean una sola vez y quedan guardados en `rifa_numeros`, así que volver a abrir el panel o bajar el Excel de nuevo devuelve siempre los mismos números.

El pozo tiene dos vueltas. La primera son los cien números del 00 al 99, uno por cliente. Cuando se agota, los que sobran entran en una segunda vuelta que se sortea **entre el 50 y el 99**, y cada uno de esos números se repite una sola vez: dos clientes pueden compartir el 76, pero nunca tres. Eso pone un tope de 150 participantes por semana, y si se pasa, la función falla con un mensaje claro en vez de dejar gente sin número.

Internamente la segunda vuelta se guarda como 150-199 para que la columna `numero` siga siendo única dentro de la semana; el número que se le canta al cliente es `numero % 100`. El panel marca cuáles son de segunda vuelta.

Para hacer admin a alguien, en el SQL Editor:

```sql
update public.perfiles set rol = 'admin' where email = 'correo@ejemplo.com';
```

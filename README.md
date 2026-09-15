# Control Cashmana

Control de compras para las rifas del negocio, en dos módulos que comparten el mismo padrón de clientes:

- **Cashmana**, la rifa de todas las semanas: califica quien compró los seis días, de lunes a sábado.
- **Rifa Flash**, la que se arma cuando conviene, un feriado o un día especial: el admin la crea con las opciones que quiera y califica quien las tiene todas marcadas.

Se pasa de uno a otro con las pestañas de arriba. Cada encargado ve y marca solo a sus propios clientes; el admin ve a todos.

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

Un usuario con `rol = 'admin'` en la tabla `perfiles` ve un enlace extra al panel, en `/admin`. Ahí puede mirar el padrón de clientes de todos los usuarios con su teléfono y bajarlo a Excel, y generar los números de la rifa de cada semana y de cada rifa flash.

Los números salen de la función `asignar_numeros_rifa`, que reparte al azar entre los clientes que completaron los seis días, **juntando los de todos los usuarios en una sola rifa**. Se sortean una sola vez y quedan guardados en `rifa_numeros`, así que volver a abrir el panel o bajar el Excel de nuevo devuelve siempre los mismos números.

El pozo tiene dos vueltas. La primera son los cien números del 00 al 99, uno por cliente. Cuando se agota, los que sobran entran en una segunda vuelta que se sortea **entre el 50 y el 99**, y cada uno de esos números se repite una sola vez: dos clientes pueden compartir el 76, pero nunca tres. Eso pone un tope de 150 participantes por semana, y si se pasa, la función falla con un mensaje claro en vez de dejar gente sin número.

Internamente la segunda vuelta se guarda como 150-199 para que la columna `numero` siga siendo única dentro de la semana; el número que se le canta al cliente es `numero % 100`. El panel marca cuáles son de segunda vuelta.

### Meter a alguien a mano

Necesita `supabase/migracion-rifa-manual.sql` corrido en el SQL Editor.

A veces una persona compró los seis días y queda afuera de la lista: el encargado se olvidó de marcar un día, o la persona nunca se dio de alta. El botón **Agregar a la rifa**, en la pestaña de la rifa, lo resuelve sin tener que pedirle nada al encargado.

Se escribe el nombre y el buscador muestra a los clientes del padrón de esa semana, de todos los encargados. Se elige el que corresponde y listo: le toca un número del mismo pozo, con las mismas dos vueltas. Si la persona no aparece porque nadie la había cargado, ahí mismo se la crea con nombre y teléfono, queda en el padrón a nombre del admin desde esa semana, y entra a la rifa en el mismo paso.

**Los días de la semana no se tocan.** El agregado a mano no marca lun-sáb ni pisa lo que cargó el encargado: entra directo a `rifa_numeros`, así que la planilla del encargado sigue diciendo lo que él vio. Por eso tampoco depende de las marcas para aparecer en la lista.

Queda firmado con el correo del admin en la columna `agregado_por`, la tabla lo muestra con la etiqueta **A mano** y el pie cuenta cuántos hay. Eso es a propósito: el resto de la lista se puede auditar contra el orden de alta, y estos no salieron del azar, así que tienen que verse distintos.

El tacho al final de la fila lo saca de la rifa y devuelve su número al pozo. Solo aparece en los agregados a mano: un número que salió del sorteo no se quita, porque sacarlo sería elegir a dedo quién no participa. Si el cliente además se creó por error, se archiva desde la pantalla principal como cualquier otro.

Todo esto vale hasta la medianoche del sábado, igual que para los encargados. Desde el domingo la semana es histórico y ni el admin la modifica: la rifa ya se jugó y las listas ya se repartieron.

Para hacer admin a alguien, en el SQL Editor:

```sql
update public.perfiles set rol = 'admin' where email = 'correo@ejemplo.com';
```

## Rifa Flash

Necesita `supabase/migracion-rifa-flash.sql` corrido en el SQL Editor. No toca nada de Cashmana.

Es la rifa que se arma cuando conviene, en vez de todas las semanas. Se entra con la pestaña **Rifa Flash** de arriba; la dirección de siempre sigue abriendo Cashmana.

**Crear una rifa.** El admin toca *Nueva rifa flash* y pone el nombre (es lo que sale en la imagen), el día, la hora del sorteo y las opciones que hay que marcar. Arranca con "Sorteo 1" y "Sorteo 2", pero pueden llamarse como sea y ser cuantas sean.

**Calificar.** Cada encargado elige la rifa en la lista y marca a sus clientes, igual que en Cashmana. Califica quien tiene marcadas **todas** las opciones de esa rifa: si son dos hacen falta las dos, si son tres las tres. Los clientes son los del padrón de siempre: el que se da de alta en Cashmana aparece acá sin cargarlo dos veces, siempre que esté vigente la semana de la rifa.

Mientras la rifa está abierta, el admin puede renombrar, agregar y borrar opciones. Eso cambia quién califica: con una opción nueva, los que tenían todas dejan de calificar hasta que se la marquen, y al borrar una se pierden sus marcas. La pantalla avisa antes de hacerlo.

**Cerrar.** A diferencia de la semana de Cashmana, la rifa flash no se cierra sola con la hora: queda abierta hasta que el admin toca *Cerrar rifa*. Cerrada, nadie marca ni cambia opciones, y no se agrega ni se quita gente de la rifa. Si se cerró antes de tiempo, *Reabrir rifa* la vuelve a abrir. Una rifa abierta se puede eliminar entera; una cerrada no, porque ya se jugó.

**Números e imagen.** En el panel de administración, pestaña *Rifa flash*, o con el enlace *Números e imagen* del módulo. Funciona exactamente igual que la rifa de la semana: el mismo pozo de dos vueltas y el mismo tope de 150, los números se sortean una sola vez y quedan guardados en `flash_numeros`, el Excel sale por número y el admin puede meter a alguien a mano. La imagen dice *Rifa Flash*, el nombre de la rifa, y el día y la hora del sorteo.

Las tablas son cuatro: `flash_rifas` (la rifa), `flash_opciones` (lo que hay que marcar), `flash_marcas` (una fila por opción marcada; desmarcar es borrarla) y `flash_numeros`. La regla de quién califica vive en la función `flash_calificados`.

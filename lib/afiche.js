// Afiche PNG de la rifa: la misma lista que baja el Excel, pero armada para
// mandarla por WhatsApp. El Excel sigue siendo el documento de trabajo del
// negocio; esto es lo que ve el cliente, así que solo lleva número y nombre.
//
// Se dibuja a mano en un canvas en vez de sumar una librería de imágenes o de
// PDF: son cuatro formas y dos tipografías, y el proyecto se queda sin
// dependencias nuevas.

import { descargar } from "@/lib/descargas";

const NEGOCIO = "CASHMANA";

// Todo lo que sigue está en píxeles "lógicos". El canvas se crea al doble y
// se escala, para que la imagen no salga borrosa cuando WhatsApp la abre a
// pantalla completa ni cuando alguien la imprime.
const ESCALA = 2;

const COLUMNAS = 3;
// Da para un nombre completo de unos 26 caracteres, que es lo que miden los
// nombres largos de verdad ("Flor de María Obando", "Óscar Villalobos
// Camacho"). Lo que pase de ahí se recorta.
const ANCHO_COLUMNA = 384;
const SEPARACION = 24;
const MARGEN = 48;
const ANCHO =
  MARGEN * 2 + ANCHO_COLUMNA * COLUMNAS + SEPARACION * (COLUMNAS - 1);

const ALTO_FILA = 58;
const ALTO_ENCABEZADO = 236;
const ALTO_PIE = 128;

const CHIP_ANCHO = 64;
const CHIP_ALTO = 40;
const SANGRIA_NOMBRE = CHIP_ANCHO + 18;

// Los mismos colores de la tabla del panel (los stone y amber de Tailwind),
// para que el afiche y la app se vean de la misma familia.
const COLOR = {
  papel: "#ffffff",
  franja: "#f5f5f4",
  linea: "#e7e5e4",
  texto: "#292524",
  suave: "#78716c",
  acento: "#b45309",
  chipFondo: "#fef3c7",
  chipTexto: "#78350f",
};

const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `ui-monospace, "Segoe UI Mono", Consolas, monospace`;

const FUENTE_NOMBRE = `500 25px ${SANS}`;

// Las cuatro esquinas a mano: `roundRect` todavía no está en todos los
// navegadores y no vale la pena que el afiche dependa de eso.
function rectRedondeado(ctx, x, y, ancho, alto, radio) {
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, radio);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, radio);
  ctx.arcTo(x, y + alto, x, y, radio);
  ctx.arcTo(x, y, x + ancho, y, radio);
  ctx.closePath();
  ctx.fill();
}

// Un nombre largo se corta con puntos suspensivos antes de meterse en la
// columna de al lado. Espera que `ctx.font` ya sea la fuente con la que se
// va a dibujar, porque si no mide contra otra cosa.
function recortar(ctx, contenido, anchoMaximo) {
  if (ctx.measureText(contenido).width <= anchoMaximo) return contenido;

  let corto = contenido;
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > anchoMaximo) {
    corto = corto.slice(0, -1);
  }
  return `${corto}…`;
}

// `letterSpacing` no existe en todos los navegadores; donde no existe, la
// asignación se ignora sola y el título sale junto, que tampoco está mal.
function escribir(ctx, contenido, x, y, opciones) {
  const { fuente, color, espaciado = "0px", alineacion = "center" } = opciones;

  ctx.font = fuente;
  ctx.fillStyle = color;
  ctx.textAlign = alineacion;
  ctx.letterSpacing = espaciado;
  ctx.fillText(contenido, x, y);
  ctx.letterSpacing = "0px";
}

// `filas` es [{ numero, nombre }] ya en el orden en que se quiere leer. Se
// reparten por columna y no por renglón: la primera columna se llena entera
// de arriba abajo, después la segunda y después la tercera, que es como se
// busca un número en una lista pegada en la pared.
//
// `titulo` es la línea de color debajo del nombre del negocio, la que dice
// qué rifa es; `rango` la línea gris debajo (la semana, o el nombre de la
// rifa flash) y `sorteo` el renglón final con el día y la hora.
export function descargarAficheRifa(
  filas,
  { titulo = "RIFA DE LA SEMANA", rango, sorteo },
  nombreArchivo
) {
  const porColumna = Math.ceil(filas.length / COLUMNAS);
  const alto = ALTO_ENCABEZADO + porColumna * ALTO_FILA + ALTO_PIE;

  const canvas = document.createElement("canvas");
  canvas.width = ANCHO * ESCALA;
  canvas.height = alto * ESCALA;

  const ctx = canvas.getContext("2d");
  ctx.scale(ESCALA, ESCALA);
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.papel;
  ctx.fillRect(0, 0, ANCHO, alto);

  // Franja de color arriba, para reconocer la imagen de un vistazo entre
  // todas las que se mandan por chat.
  ctx.fillStyle = COLOR.acento;
  ctx.fillRect(0, 0, ANCHO, 10);

  const centro = ANCHO / 2;

  escribir(ctx, NEGOCIO, centro, 86, {
    fuente: `700 46px ${SANS}`,
    color: COLOR.texto,
    espaciado: "8px",
  });
  escribir(ctx, titulo, centro, 128, {
    fuente: `600 19px ${SANS}`,
    color: COLOR.acento,
    espaciado: "5px",
  });
  escribir(ctx, rango, centro, 168, {
    fuente: `400 27px ${SANS}`,
    color: COLOR.suave,
  });

  ctx.fillStyle = COLOR.linea;
  ctx.fillRect(MARGEN, 204, ANCHO - MARGEN * 2, 1);

  for (let fila = 0; fila < porColumna; fila++) {
    const y = ALTO_ENCABEZADO + fila * ALTO_FILA;
    const medio = y + ALTO_FILA / 2;

    // El rayado va de punta a punta y no por celda: con tres columnas es lo
    // que mantiene el ojo en el mismo renglón.
    if (fila % 2 === 1) {
      ctx.fillStyle = COLOR.franja;
      ctx.fillRect(0, y, ANCHO, ALTO_FILA);
    }

    for (let columna = 0; columna < COLUMNAS; columna++) {
      const item = filas[columna * porColumna + fila];
      if (!item) continue;

      const x = MARGEN + columna * (ANCHO_COLUMNA + SEPARACION);

      ctx.fillStyle = COLOR.chipFondo;
      rectRedondeado(ctx, x, medio - CHIP_ALTO / 2, CHIP_ANCHO, CHIP_ALTO, 8);

      escribir(ctx, item.numero, x + CHIP_ANCHO / 2, medio + 1, {
        fuente: `700 26px ${MONO}`,
        color: COLOR.chipTexto,
      });

      ctx.font = FUENTE_NOMBRE;
      const nombre = recortar(ctx, item.nombre, ANCHO_COLUMNA - SANGRIA_NOMBRE);

      escribir(ctx, nombre, x + SANGRIA_NOMBRE, medio + 1, {
        fuente: FUENTE_NOMBRE,
        color: COLOR.texto,
        alineacion: "left",
      });
    }
  }

  const yPie = ALTO_ENCABEZADO + porColumna * ALTO_FILA;

  ctx.fillStyle = COLOR.linea;
  ctx.fillRect(MARGEN, yPie + 28, ANCHO - MARGEN * 2, 1);

  escribir(ctx, `${filas.length} participantes`, centro, yPie + 66, {
    fuente: `400 23px ${SANS}`,
    color: COLOR.suave,
  });
  escribir(ctx, sorteo, centro, yPie + 100, {
    fuente: `600 25px ${SANS}`,
    color: COLOR.texto,
  });

  canvas.toBlob((blob) => descargar(blob, nombreArchivo), "image/png");
}

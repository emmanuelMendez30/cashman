import * as XLSX from "xlsx";

function descargar(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// `filas` es un arreglo de objetos planos: las claves son los encabezados.
// `anchos` son los caracteres de ancho de cada columna, en el mismo orden.
export function descargarExcel(filas, anchos, nombreHoja, nombreArchivo) {
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = anchos.map((wch) => ({ wch }));

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  const buffer = XLSX.write(libro, { bookType: "xlsx", type: "array" });

  descargar(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    nombreArchivo
  );
}

export function descargarTxt(texto, nombreArchivo) {
  descargar(
    new Blob([texto], { type: "text/plain;charset=utf-8" }),
    nombreArchivo
  );
}

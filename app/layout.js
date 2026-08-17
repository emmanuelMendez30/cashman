import "./globals.css";

export const metadata = {
  title: "Control Cashmana",
  description: "Control de compras diarias para la rifa semanal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="antialiased text-stone-800">{children}</body>
    </html>
  );
}

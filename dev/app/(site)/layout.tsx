import type React from "react";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui", maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
        <nav style={{ display: "flex", gap: 16 }}>
          <a href="/">Accueil</a>
          <a href="/about">À propos</a>
          <a href="/en">EN</a>
          <a href="/admin">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}

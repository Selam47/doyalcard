"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0B2B1B",
          color: "#ffffff",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "420px" }}>
          <div style={{ fontSize: "56px", lineHeight: 1 }}>🫓</div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, marginTop: "20px" }}>
            Sistem şu anda yanıt vermiyor
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#A7D7BC",
              marginTop: "8px",
              lineHeight: 1.5,
            }}
          >
            Lütfen birkaç saniye sonra tekrar deneyin. Sorun sürerse sayfayı
            yenileyin.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "24px",
              padding: "12px 24px",
              fontSize: "15px",
              fontWeight: 600,
              color: "#0B2B1B",
              backgroundColor: "#4ADE80",
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
            }}
          >
            Tekrar Dene
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "20px",
                fontSize: "11px",
                fontFamily: "monospace",
                color: "#6B9080",
              }}
            >
              Hata kodu: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

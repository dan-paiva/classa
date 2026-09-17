import { useQuery } from "@tanstack/react-query";

type Health = { status: string; env: string };

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<Health> => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`API respondeu ${res.status}`);
      return res.json();
    },
  });

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Classa</h1>
      <p>
        API:{" "}
        {health.isPending ? "verificando…" : health.isError ? `indisponível (${health.error.message})` : `${health.data.status} · ${health.data.env}`}
      </p>
    </main>
  );
}

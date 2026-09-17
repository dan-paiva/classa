import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";
import { ActionError, LoadError, Loading } from "../ui.tsx";

const PROFILE = { admin: "administração", colaborador: "equipe", prestador: "professor", aluno: "aluno" } as const;

/** Aceite de convite: cria a conta (ou entra) com o e-mail convidado e liga à escola. */
export function Invitation() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const invite = useQuery({ queryKey: ["invitation", token], queryFn: () => api.invitation(token), retry: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token),
    onSuccess: async ({ slug }) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/e/$slug", params: { slug } });
    },
  });

  if (invite.isPending || session.isPending) return <div className="auth"><Loading /></div>;
  if (invite.isError) {
    return (
      <div className="auth stack">
        <div className="brand">Classa</div>
        <div className="panel stack">
          <h1>Convite indisponível</h1>
          <LoadError error={invite.error} />
        </div>
      </div>
    );
  }
  const inv = invite.data;
  const loggedAs = session.data?.user.email?.toLowerCase();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = inv.hasAccount
      ? await authClient.signIn.email({ email: inv.email, password })
      : await authClient.signUp.email({ email: inv.email, password, name });
    setBusy(false);
    if (res.error) {
      setError(inv.hasAccount ? "Senha incorreta." : (res.error.message ?? "Não foi possível criar a conta."));
      return;
    }
    accept.mutate();
  }

  return (
    <div className="auth stack">
      <div className="brand">Classa</div>
      <div className="panel stack">
        <h1>Convite para {inv.schoolName}</h1>
        <p className="muted">
          Acesso de {PROFILE[inv.profileType]} para <strong>{inv.email}</strong>. O convite vale até {new Date(inv.expiresAt).toLocaleString("pt-BR")}.
        </p>
        {loggedAs === inv.email ? (
          <button type="button" className="btn btn-primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
            Aceitar convite
          </button>
        ) : loggedAs ? (
          <>
            <p className="error">Você está conectado como {loggedAs}. Saia e entre com {inv.email} para aceitar.</p>
            <button type="button" className="btn" onClick={() => authClient.signOut().then(() => qc.clear())}>
              Sair
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            {!inv.hasAccount && (
              <div className="field">
                <label htmlFor="inv-name">Seu nome</label>
                <input id="inv-name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label htmlFor="inv-password">{inv.hasAccount ? "Sua senha" : "Crie uma senha"}</label>
              <input id="inv-password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={inv.hasAccount ? "current-password" : "new-password"} />
              {!inv.hasAccount && <small>Mínimo de 10 caracteres.</small>}
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy || accept.isPending}>
              {inv.hasAccount ? "Entrar e aceitar" : "Criar conta e aceitar"}
            </button>
          </form>
        )}
        <ActionError error={accept.error} />
      </div>
    </div>
  );
}

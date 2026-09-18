import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LEVEL_LABELS } from "@classa/domain";
import { api, issuesOf, type Membership } from "../api.ts";
import { authClient } from "../auth-client.ts";
import { Field, FormError } from "../ui.tsx";

/**
 * Como a pessoa entra nesta escola. Estava escrito "administrador" para todo
 * mundo — o aluno lia que era administrador da escola.
 */
function perfilLabel(m: Membership) {
  if (m.profileType === "aluno") return "aluno";
  if (m.profileType === "prestador") return "professor";
  if (m.profileType === "admin") return "administrador";
  return LEVEL_LABELS[m.level as 1].toLowerCase();
}

export function Schools() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  if (me.isPending) return <div className="auth">Carregando…</div>;
  if (me.isError) return <div className="auth error">Não foi possível carregar seus dados.</div>;

  const { user, memberships } = me.data;
  const showForm = creating || memberships.length === 0;

  return (
    <div className="auth">
      <div className="brand">Classa</div>
      <div className="panel stack">
        <div className="row muted">
          <span>
            {user.name} · {user.email}
          </span>
          <button
            type="button"
            className="btn-link"
            onClick={async () => {
              await authClient.signOut();
              queryClient.clear();
            }}
          >
            Sair
          </button>
        </div>
        {memberships.length > 0 && (
          <>
            <h1>Suas escolas</h1>
            <ul className="list">
              {memberships.map((m) => (
                <li key={m.tenantId}>
                  <Link to="/e/$slug" params={{ slug: m.slug }} className="list-link">
                    <strong>{m.name}</strong>
                    <span>{perfilLabel(m)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {showForm ? (
          <CreateSchool first={memberships.length === 0} />
        ) : (
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            Criar outra escola
          </button>
        )}
      </div>
    </div>
  );
}

function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function CreateSchool({ first }: { first: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const create = useMutation({
    mutationFn: api.createTenant,
    onSuccess: async ({ tenant }) => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/e/$slug", params: { slug: tenant.slug } });
    },
  });
  const issues = issuesOf(create.error);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ name, slug });
      }}
    >
      <h2>{first ? "Criar sua escola" : "Nova escola"}</h2>
      <p className="muted">Você será o administrador.</p>
      <Field label="Nome da escola" htmlFor="tenant-name" errors={issues.name}>
        <input
          id="tenant-name"
          value={name}
          required
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field
        label="Link da escola"
        htmlFor="tenant-slug"
        errors={issues.slug}
        hint="É o identificador da escola no endereço do site. Só letras minúsculas, números e hífen."
      >
        <div className="prefixed">
          <span>classa/</span>
          <input
            id="tenant-slug"
            value={slug}
            required
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
        </div>
      </Field>
      <FormError error={create.error} />
      <button type="submit" className="btn btn-primary" disabled={create.isPending}>
        {create.isPending ? "Criando…" : "Criar escola"}
      </button>
    </form>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { AREA_LABELS, AREAS, LEVEL_LABELS, ROLE_PRESETS, type Area } from "@classa/domain";
import { useState } from "react";
import { issuesOf } from "../api.ts";
import { school, type Member } from "../api-school.ts";
import { fmtDate } from "../lib/format.ts";
import { ActionError, Badge, Field, FormError, Loading } from "../ui.tsx";

const PROFILE_LABELS = { admin: "Administrador", colaborador: "Equipe", prestador: "Professor", aluno: "Aluno" } as const;

function accessSummary(m: { profileType: Member["profileType"]; level: number; areas: Record<string, string> }) {
  if (m.profileType !== "colaborador") return PROFILE_LABELS[m.profileType];
  const areas = Object.entries(m.areas).map(([k, v]) => `${AREA_LABELS[k as Area]}${v === "restrito" ? " (ver)" : ""}`);
  return `${LEVEL_LABELS[m.level as 1]} · ${areas.join(", ")}`;
}

/** Equipe e convites. A conta nasce do convite: a pessoa recebe o link e cria a senha. */
export function Team() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users", slug], queryFn: () => school.users(slug) });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["users", slug] });
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  return (
    <section className="panel stack">
      <div className="row">
        <h2>Equipe e acessos</h2>
        {!inviting && (
          <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
            Convidar
          </button>
        )}
      </div>
      <p className="muted small">O nível diz o que a pessoa pode fazer; as áreas dizem onde. Ninguém altera o próprio acesso, e a escola mantém pelo menos um administrador.</p>
      {inviting && <AccessForm slug={slug} onDone={() => setInviting(false)} onSaved={refresh} />}
      {editing && <AccessForm slug={slug} member={editing} onDone={() => setEditing(null)} onSaved={refresh} />}
      <ActionError error={act.error} />
      {q.isPending ? (
        <Loading />
      ) : (
        <>
          <table className="compact">
            <tbody>
              {q.data?.members.map((m) => (
                <tr key={m.id} className={m.status === "bloqueado" ? "is-off" : undefined}>
                  <td>
                    <strong>{m.name}</strong>
                    <div className="muted small">
                      {m.email}
                      {m.personName && ` · ${m.personName}`}
                    </div>
                  </td>
                  <td className="small">{accessSummary(m)}</td>
                  <td className="small muted">{m.lastSeenAt ? `último acesso ${fmtDate(m.lastSeenAt)}` : "nunca acessou"}</td>
                  <td className="right">
                    <span className="cell-actions">
                      {m.status === "bloqueado" && <Badge tone="danger">Bloqueado</Badge>}
                      <button type="button" className="btn-link" onClick={() => setEditing(m)}>
                        Editar acesso
                      </button>
                      <button
                        type="button"
                        className={m.status === "bloqueado" ? "btn-link" : "btn-link danger"}
                        onClick={() => (m.status === "bloqueado" || confirm(`Bloquear ${m.name}? As sessões param de funcionar nesta escola.`)) && act.mutate(() => school.setMemberBlocked(slug, m.id, m.status !== "bloqueado"))}
                      >
                        {m.status === "bloqueado" ? "Desbloquear" : "Bloquear"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(q.data?.invites.length ?? 0) > 0 && (
            <>
              <h3>Convites pendentes</h3>
              <table className="compact">
                <tbody>
                  {q.data!.invites.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.email}
                        {i.personName && <div className="muted small">{i.personName}</div>}
                      </td>
                      <td className="small">{accessSummary(i)}</td>
                      <td className="small">{i.expired ? <Badge tone="warn">Expirado</Badge> : `vale até ${fmtDate(i.expiresAt)}`}</td>
                      <td className="right">
                        <button type="button" className="btn-link danger" onClick={() => act.mutate(() => school.revokeInvite(slug, i.id))}>
                          Cancelar convite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}

function AccessForm({ slug, member, onDone, onSaved }: { slug: string; member?: Member; onDone: () => void; onSaved: () => Promise<unknown> }) {
  const teachers = useQuery({ queryKey: ["teachers", slug], queryFn: () => school.teachers(slug), enabled: !member });
  const students = useQuery({ queryKey: ["students", slug], queryFn: () => school.students(slug), enabled: !member });
  const [profileType, setProfileType] = useState<Member["profileType"]>(member?.profileType ?? "colaborador");
  const [level, setLevel] = useState(member?.level ?? 4);
  const [areas, setAreas] = useState<Record<string, "total" | "restrito">>(member?.areas ?? {});
  const [email, setEmail] = useState("");
  const [personId, setPersonId] = useState("");
  const [link, setLink] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const access = { profileType, level, areas };
      if (member) return school.updateMember(slug, member.id, access);
      const res = await school.invite(slug, { ...access, email: email || null, personId: personId || null });
      setLink(res.link);
      return res;
    },
    onSuccess: async () => {
      await onSaved();
      if (member) onDone();
    },
  });
  const issues = issuesOf(save.error);
  const people =
    profileType === "prestador"
      ? (teachers.data?.teachers ?? []).filter((t) => !t.deactivatedAt).map((t) => ({ id: t.person.id, label: `${t.person.name}${t.person.email ? ` · ${t.person.email}` : " · sem e-mail"}` }))
      : (students.data?.students ?? []).filter((s) => !["cancelado", "inativo"].includes(s.status)).map((s) => ({ id: s.person.id, label: `${s.person.name}${s.person.email ? ` · ${s.person.email}` : " · sem e-mail"}` }));

  if (link) {
    return (
      <div className="subpanel stack">
        <h3>Convite criado</h3>
        <p className="small">Envie este link para a pessoa. Ele vale 48 horas e só funciona para o e-mail convidado.</p>
        <div className="inline-form">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
          <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link)}>
            Copiar
          </button>
        </div>
        <button type="button" className="btn-link" onClick={onDone}>
          Fechar
        </button>
      </div>
    );
  }

  return (
    <form
      className="subpanel stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3>{member ? `Acesso de ${member.name}` : "Novo convite"}</h3>
      {!member && (
        <Field label="Começar de um cargo" htmlFor="preset" hint="Preenche tipo, nível e áreas; dá para ajustar depois">
          <select
            id="preset"
            defaultValue=""
            onChange={(e) => {
              const p = ROLE_PRESETS.find((r) => r.key === e.target.value);
              if (!p) return;
              setProfileType(p.profile.profileType);
              setLevel(p.profile.level);
              setAreas(p.profile.areas as Record<string, "total" | "restrito">);
            }}
          >
            <option value="">Escolha…</option>
            {ROLE_PRESETS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid-fields">
        <Field label="Tipo de perfil" htmlFor="ptype" errors={issues.profileType}>
          <select id="ptype" value={profileType} onChange={(e) => setProfileType(e.target.value as Member["profileType"])}>
            {Object.entries(PROFILE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {profileType === "colaborador" && (
          <Field label="Nível" htmlFor="plevel" errors={issues.level}>
            <select id="plevel" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {Object.entries(LEVEL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} · {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!member && (profileType === "prestador" || profileType === "aluno") && (
          <Field label={profileType === "prestador" ? "Professor cadastrado" : "Aluno cadastrado"} htmlFor="pperson" errors={issues.personId}>
            <select id="pperson" required value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Escolha…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!member && (
          <Field label="E-mail" htmlFor="pemail" errors={issues.email} hint={profileType === "prestador" || profileType === "aluno" ? "Vazio = e-mail do cadastro" : undefined}>
            <input id="pemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required={profileType === "admin" || profileType === "colaborador"} />
          </Field>
        )}
      </div>
      {profileType === "colaborador" && (
        <fieldset className="field">
          <legend>Áreas</legend>
          <div className="areas-grid">
            {AREAS.map((a) => (
              <label key={a} className="area-choice" htmlFor={`area-${a}`}>
                <span>{AREA_LABELS[a]}</span>
                <select
                  id={`area-${a}`}
                  value={areas[a] ?? ""}
                  onChange={(e) => {
                    const next = { ...areas };
                    if (e.target.value) next[a] = e.target.value as "total" | "restrito";
                    else delete next[a];
                    setAreas(next);
                  }}
                >
                  <option value="">Sem acesso</option>
                  <option value="restrito">Só ver</option>
                  <option value="total">Ver e agir</option>
                </select>
              </label>
            ))}
          </div>
          {issues.areas?.[0] && <small className="error">{issues.areas[0]}</small>}
        </fieldset>
      )}
      <FormError error={save.error} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {member ? "Salvar acesso" : "Criar convite"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { issuesOf } from "../api.ts";
import { ROOM_KIND_LABELS, school, type Room } from "../api-school.ts";
import { fmtIsoDate, todayIso } from "../lib/format.ts";
import { Badge, Field, FormError, Loading, PageHead } from "../ui.tsx";

export function Settings() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  return (
    <div className="stack-lg">
      <PageHead title="Configurações" subtitle="Salas e calendário da escola." />
      <div className="grid-2">
        <Rooms slug={slug} />
        <Holidays slug={slug} />
      </div>
    </div>
  );
}

function Rooms({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rooms", slug], queryFn: () => school.rooms(slug) });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Room["kind"]>("virtual");
  const [link, setLink] = useState("");
  const [capacity, setCapacity] = useState("");
  const create = useMutation({
    mutationFn: () => school.createRoom(slug, { name, kind, link: link || null, capacity: capacity ? Number(capacity) : null }),
    onSuccess: async () => {
      setName("");
      setLink("");
      setCapacity("");
      await qc.invalidateQueries({ queryKey: ["rooms", slug] });
    },
  });
  const issues = issuesOf(create.error);
  return (
    <section className="panel stack">
      <h2>Salas</h2>
      {q.isPending ? (
        <Loading />
      ) : (
        <table className="compact">
          <tbody>
            {q.data?.rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  <Badge tone={r.kind === "virtual" ? "info" : "neutral"}>{ROOM_KIND_LABELS[r.kind]}</Badge>
                </td>
                <td className="small">
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noreferrer">
                      link
                    </a>
                  ) : r.capacity ? (
                    `${r.capacity} pessoas`
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid-fields">
          <Field label="Nome" htmlFor="room-name" errors={issues.name}>
            <input id="room-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tipo" htmlFor="room-kind" errors={issues.kind}>
            <select id="room-kind" value={kind} onChange={(e) => setKind(e.target.value as Room["kind"])}>
              {Object.entries(ROOM_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {kind === "virtual" ? (
            <Field label="Link da reunião" htmlFor="room-link" errors={issues.link}>
              <input id="room-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
            </Field>
          ) : (
            <Field label="Capacidade" htmlFor="room-cap" errors={issues.capacity}>
              <input id="room-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          )}
        </div>
        <FormError error={create.error} />
        <button type="submit" className="btn" disabled={create.isPending}>
          Adicionar sala
        </button>
      </form>
    </section>
  );
}

function Holidays({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const q = useQuery({ queryKey: ["holidays", slug, year], queryFn: () => school.holidays(slug, year) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState("Recesso");
  const refresh = () => qc.invalidateQueries({ queryKey: ["holidays", slug] });
  const importYear = useMutation({ mutationFn: () => school.importHolidays(slug, year), onSuccess: refresh });
  const recess = useMutation({ mutationFn: () => school.addRecess(slug, { from, to, name }), onSuccess: refresh });
  const issues = issuesOf(recess.error);
  const nacionais = q.data?.holidays.filter((h) => h.kind === "nacional").length ?? 0;
  return (
    <section className="panel stack">
      <div className="row">
        <h2>Feriados e recessos</h2>
        <span className="actions">
          <button type="button" className="btn-link" onClick={() => setYear(year - 1)}>
            ←
          </button>
          <strong>{year}</strong>
          <button type="button" className="btn-link" onClick={() => setYear(year + 1)}>
            →
          </button>
        </span>
      </div>
      {!q.isPending && nacionais === 0 && (
        <p className="warn-box small">
          {year} não tem feriados nacionais importados: a agenda gera aula nesses dias.{" "}
          <button type="button" className="btn-link" onClick={() => importYear.mutate()}>
            Importar feriados de {year}
          </button>
        </p>
      )}
      <ul className="plain small holiday-list">
        {q.data?.holidays.map((h) => (
          <li key={h.id}>
            {fmtIsoDate(h.date)} · {h.name} <Badge tone={h.kind === "recesso" ? "warn" : "muted"}>{h.kind}</Badge>
          </li>
        ))}
      </ul>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          recess.mutate();
        }}
      >
        <div className="grid-fields">
          <Field label="Recesso de" htmlFor="rec-from" errors={issues.from}>
            <input id="rec-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="até" htmlFor="rec-to" errors={issues.to}>
            <input id="rec-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Nome" htmlFor="rec-name" errors={issues.name}>
            <input id="rec-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <FormError error={recess.error} />
        <button type="submit" className="btn" disabled={recess.isPending}>
          Adicionar recesso
        </button>
        <p className="muted small">Aulas já geradas nesses dias não são removidas automaticamente; cancele-as pela agenda.</p>
      </form>
    </section>
  );
}

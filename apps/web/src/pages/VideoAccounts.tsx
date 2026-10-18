import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { school, type VideoLesson, type VideoOccupancy } from "../api-school.ts";
import { addDaysIso, fmtIsoDate, fmtTime, isoDay, mondayOf, plural, todayIso, WEEKDAYS_SHORT } from "../lib/format.ts";
import { useCan } from "../lib/permissions.ts";
import { ActionError, Badge, Empty, Field, FormError, LoadError, Loading, PageHead, Stat } from "../ui.tsx";

const minutesOf = (d: string) => {
  const [h, m] = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" })
    .format(new Date(d))
    .split(":")
    .map(Number);
  return h! * 60 + m!;
};

/** A régua do dia: só as horas que têm aula, com uma hora de margem e no mínimo seis horas. */
function ruler(lessons: VideoLesson[]) {
  if (!lessons.length) return { start: 7, end: 23 };
  let start = Math.floor(Math.min(...lessons.map((l) => minutesOf(l.startsAt))) / 60) - 1;
  let end = Math.ceil(Math.max(...lessons.map((l) => minutesOf(l.endsAt))) / 60) + 1;
  if (end - start < 6) end = start + 6;
  start = Math.max(0, start);
  end = Math.min(24, end);
  return { start, end };
}
type Ruler = ReturnType<typeof ruler>;

/** A semana de trabalho em vista: no domingo, a que começa amanhã (não há aula no domingo). */
const currentWeek = () => {
  const today = todayIso();
  const monday = mondayOf(addDaysIso(today, 1));
  return { monday, day: today >= monday ? today : monday };
};
const pctOf = (r: Ruler, min: number) => `${((min - r.start * 60) / ((r.end - r.start) * 60)) * 100}%`;

/** Distribui as aulas em faixas: cada faixa é uma reunião aberta na conta ao mesmo tempo. */
function lanes(lessons: VideoLesson[]) {
  const ends: number[] = [];
  return lessons.map((l) => {
    const start = new Date(l.startsAt).getTime();
    let lane = ends.findIndex((e) => e <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = new Date(l.endsAt).getTime();
    return { lesson: l, lane };
  });
}

export function VideoAccounts() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const canEdit = useCan("videoconferencia", "editar");
  const [monday, setMonday] = useState(() => currentWeek().monday);
  const [day, setDay] = useState(() => currentWeek().day);
  const range = { from: `${monday}T00:00:00-03:00`, to: `${addDaysIso(monday, 7)}T00:00:00-03:00` };
  const q = useQuery({ queryKey: ["video-occupancy", slug, monday], queryFn: () => school.videoOccupancy(slug, range) });

  const moveWeek = (delta: number) => {
    const m = addDaysIso(monday, 7 * delta);
    setMonday(m);
    setDay(m);
  };
  const days = Array.from({ length: 6 }, (_, i) => addDaysIso(monday, i));

  return (
    <div className="stack-lg">
      <PageHead
        title="Contas Zoom"
        subtitle={`Semana de ${fmtIsoDate(monday)} a ${fmtIsoDate(addDaysIso(monday, 5))}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => moveWeek(-1)}>
              ← Anterior
            </button>
            <button type="button" className="btn" onClick={() => { const w = currentWeek(); setMonday(w.monday); setDay(w.day); }}>
              Esta semana
            </button>
            <button type="button" className="btn" onClick={() => moveWeek(1)}>
              Próxima →
            </button>
          </>
        }
      />
      <p className="muted">
        Cada conta segura um número de reuniões ao mesmo tempo, e abrir mais uma derruba a mais antiga. O sistema escolhe a sala de cada
        aula online contando o que a conta já tem naquele horário, com a folga antes e depois de cada aula.
      </p>
      {q.isPending ? <Loading /> : q.isError ? <LoadError error={q.error} /> : <Week data={q.data} days={days} day={day} setDay={setDay} slug={slug} />}
      <Accounts slug={slug} canEdit={canEdit} />
    </div>
  );
}

function Week({ data, days, day, setDay, slug }: { data: VideoOccupancy; days: string[]; day: string; setDay: (d: string) => void; slug: string }) {
  const lessonsTotal = data.accounts.reduce((s, a) => s + a.lessons.length, 0);
  const overloads = data.accounts.reduce((s, a) => s + a.overloads.length, 0);
  const onDay = (l: VideoLesson) => isoDay(l.startsAt) === day;
  const missing = data.withoutRoom.filter(onDay);
  const r = ruler(data.accounts.flatMap((a) => a.lessons.filter(onDay)));
  const pct = (min: number) => pctOf(r, min);

  return (
    <>
      <div className="stats">
        <Stat label="Contas ativas" value={data.accounts.filter((a) => !a.deactivatedAt).length} />
        <Stat label="Aulas na semana" value={lessonsTotal} />
        <Stat label="Aulas sem sala" value={data.withoutRoom.length} tone={data.withoutRoom.length ? "danger" : undefined} hint="nenhuma conta comportou" />
        <Stat label="Acima do limite" value={overloads} tone={overloads ? "danger" : undefined} hint="trechos com reunião demais" />
      </div>

      <div className="vgrid-days" role="tablist" aria-label="Dia da semana">
        {days.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === day} className={d === day ? "btn btn-primary" : "btn"} onClick={() => setDay(d)}>
            {WEEKDAYS_SHORT[new Date(`${d}T12:00:00Z`).getUTCDay()]} {fmtIsoDate(d).slice(0, 5)}
          </button>
        ))}
      </div>

      <section className="panel stack" aria-label="Ocupação das contas no dia">
        <div className="vgrid-head" aria-hidden>
          <span />
          <div className="vgrid-hours">
            {Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i).filter((h) => r.end - r.start <= 10 || h % 2 === 1).map((h) => (
              <span key={h} style={{ left: pct(h * 60) }}>
                {h}h
              </span>
            ))}
          </div>
        </div>
        {data.accounts.filter((a) => !a.deactivatedAt).length === 0 && <Empty>Nenhuma conta cadastrada. Cadastre abaixo.</Empty>}
        {data.accounts
          .filter((a) => !a.deactivatedAt)
          .map((a) => {
            const today = a.lessons.filter(onDay);
            const over = new Set(a.overloads.flatMap((o) => o.lessonIds));
            const placed = lanes(today);
            const laneCount = Math.max(a.maxConcurrent, ...placed.map((p) => p.lane + 1));
            return (
              <div key={a.id} className="vgrid-row">
                <div className="vgrid-label">
                  <strong>{a.name}</strong>
                  <span className="muted small">
                    até {a.maxConcurrent} ao mesmo tempo · folga {a.bufferMinutes} min
                  </span>
                </div>
                <div className="vgrid-track" style={{ height: `${laneCount * 30 + 6}px` }}>
                  {Array.from({ length: laneCount }, (_, i) => (
                    <div key={i} className={i >= a.maxConcurrent ? "vgrid-lane vgrid-lane-over" : "vgrid-lane"} style={{ top: `${i * 30 + 3}px` }} />
                  ))}
                  {placed.map(({ lesson: l, lane }) => (
                    <Link
                      key={l.id}
                      to="/e/$slug/aulas/$lessonId"
                      params={{ slug, lessonId: l.id }}
                      className={["vgrid-lesson", over.has(l.id) && "vgrid-lesson-over", l.avulsa && "vgrid-lesson-avulsa"].filter(Boolean).join(" ")}
                      style={{
                        left: pct(minutesOf(l.startsAt)),
                        width: `calc(${pct(minutesOf(l.endsAt))} - ${pct(minutesOf(l.startsAt))})`,
                        top: `${lane * 30 + 4}px`,
                        borderLeftColor: l.courseColor,
                      }}
                      title={`${fmtTime(l.startsAt)}–${fmtTime(l.endsAt)} · ${l.courseName} · ${l.className}\n${l.teacherName ?? "professor a definir"} · ${l.roomName ?? ""}${l.avulsa ? " (sala só desta aula)" : ""}`}
                    >
                      {fmtTime(l.startsAt)} {l.className}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        <p className="muted small">
          Cada linha de uma conta é uma reunião aberta ao mesmo tempo. Aula em vermelho está num trecho em que a conta passa do limite,
          contando a folga — é a que pode cair. Aula com borda tracejada saiu da sala da turma só naquela data, porque a conta dela não
          tinha vaga: o link dela é outro.
        </p>
      </section>

      {(missing.length > 0 || data.outsideAccounts.some(onDay)) && (
        <section className="panel stack" aria-label="Aulas que precisam de atenção">
          <h2>Precisam de atenção neste dia</h2>
          <ul className="lesson-list">
            {missing.map((l) => (
              <li key={l.id} className="lesson-link">
                <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="row-link">
                  <span className="lesson-time">{fmtTime(l.startsAt)}</span> {l.courseName} · {l.className} · {l.teacherName ?? "professor a definir"}{" "}
                  <Badge tone="danger">sem sala: nenhuma conta com vaga</Badge>
                </Link>
              </li>
            ))}
            {data.outsideAccounts.filter(onDay).map((l) => (
              <li key={l.id} className="lesson-link">
                <Link to="/e/$slug/aulas/$lessonId" params={{ slug, lessonId: l.id }} className="row-link">
                  <span className="lesson-time">{fmtTime(l.startsAt)}</span> {l.courseName} · {l.className} · {l.roomName}{" "}
                  <Badge tone="warn">sala fora das contas: o sistema não confere</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">{plural(data.withoutRoom.length, "aula online sem sala", "aulas online sem sala")} na semana.</p>
    </>
  );
}

function Accounts({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["video-accounts", slug], queryFn: () => school.videoAccounts(slug) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["video-accounts", slug] }), qc.invalidateQueries({ queryKey: ["video-occupancy", slug] })]);
  const create = useMutation({ mutationFn: (input: Parameters<typeof school.createVideoAccount>[1]) => school.createVideoAccount(slug, input), onSuccess: refresh });
  const attach = useMutation({ mutationFn: (v: { roomId: string; accountId: string | null }) => school.setRoomAccount(slug, v.roomId, v.accountId), onSuccess: refresh });
  const [form, setForm] = useState({ name: "", login: "", maxConcurrent: "2", bufferMinutes: "10" });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name: form.name, login: form.login || null, maxConcurrent: Number(form.maxConcurrent), bufferMinutes: Number(form.bufferMinutes) },
      { onSuccess: () => setForm({ name: "", login: "", maxConcurrent: "2", bufferMinutes: "10" }) },
    );
  };

  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} />;
  const { accounts, unassignedRooms } = q.data;

  return (
    <section className="panel stack" aria-label="Contas e salas">
      <h2>Contas e salas</h2>
      <p className="muted small">
        A sala virtual é a reunião recorrente de uma turma, com o link que o professor e os alunos usam. Ela fica dentro de uma conta, e é a
        conta que tem o limite.
      </p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Login</th>
              <th className="num">Ao mesmo tempo</th>
              <th className="num">Folga</th>
              <th>Salas</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.name} {a.deactivatedAt && <Badge tone="muted">inativa</Badge>}
                </td>
                <td className="small">{a.login ?? "—"}</td>
                <td className="num">{a.maxConcurrent}</td>
                <td className="num">{a.bufferMinutes} min</td>
                <td className="small">
                  {a.rooms.length ? a.rooms.map((r) => r.name).join(", ") : <span className="muted">nenhuma</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && unassignedRooms.length > 0 && (
        <div className="stack-sm">
          <h3>Salas virtuais fora das contas</h3>
          <p className="muted small">O sistema não confere o limite delas. Escolha a conta Zoom em que cada reunião está.</p>
          <ActionError error={attach.error} />
          <ul className="plain stack-sm">
            {unassignedRooms.map((r) => (
              <li key={r.id} className="row">
                <span>{r.name}</span>
                <span className="muted small">{r.link}</span>
                <label className="small">
                  <span className="sr-only">Conta de {r.name}</span>
                  <select defaultValue="" onChange={(e) => e.target.value && attach.mutate({ roomId: r.id, accountId: e.target.value })}>
                    <option value="">Escolher conta…</option>
                    {accounts.filter((a) => !a.deactivatedAt).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && (
        <form onSubmit={submit} className="stack-sm" aria-label="Nova conta">
          <h3>Nova conta</h3>
          <div className="grid-fields">
            <Field label="Nome" htmlFor="va-name">
              <input id="va-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Conta 1" />
            </Field>
            <Field label="Login (e-mail do usuário Zoom)" htmlFor="va-login">
              <input id="va-login" type="email" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
            </Field>
            <Field label="Reuniões ao mesmo tempo" htmlFor="va-max">
              <input id="va-max" type="number" min={1} max={10} value={form.maxConcurrent} onChange={(e) => setForm({ ...form, maxConcurrent: e.target.value })} />
            </Field>
            <Field label="Folga antes e depois (min)" htmlFor="va-buffer">
              <input id="va-buffer" type="number" min={0} max={60} value={form.bufferMinutes} onChange={(e) => setForm({ ...form, bufferMinutes: e.target.value })} />
            </Field>
          </div>
          <FormError error={create.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              Cadastrar conta
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

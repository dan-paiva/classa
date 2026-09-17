import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { INSTALLMENT_STATUS_LABELS, school, type InstallmentStatus } from "../api-school.ts";
import { addDaysIso, money, todayIso } from "../lib/format.ts";
import { LoadError, Loading, PageHead, Stat } from "../ui.tsx";
import { InstallmentsTable } from "./Students.tsx";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function Finance() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const qc = useQueryClient();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [status, setStatus] = useState<InstallmentStatus | "mes">("vencida");
  const summary = useQuery({ queryKey: ["finance", slug, month], queryFn: () => school.financeSummary(slug, month) });
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;
  const installments = useQuery({
    queryKey: ["installments", slug, status, month],
    queryFn: () => (status === "mes" ? school.installments(slug, { from, to }) : status === "vencida" ? school.installments(slug, { status }) : school.installments(slug, { status, from, to })),
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["installments", slug] }), qc.invalidateQueries({ queryKey: ["finance", slug] })]);
  const s = summary.data?.summary;
  const [y, m] = month.split("-").map(Number);

  return (
    <div className="stack-lg">
      <PageHead
        title="Financeiro"
        subtitle={`Competência de ${MONTHS[m! - 1]} de ${y}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, -1))}>
              ← Mês anterior
            </button>
            <button type="button" className="btn" onClick={() => setMonth(todayIso().slice(0, 7))}>
              Mês atual
            </button>
            <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, 1))}>
              Próximo →
            </button>
          </>
        }
      />
      {summary.isError && <LoadError error={summary.error} />}
      <div className="stats">
        <Stat label="Recebido no mês" value={s ? money(s.receivedCents) : "…"} tone="ok" hint="pagamentos com data no mês, menos estornos" />
        <Stat label="A receber no mês" value={s ? money(s.dueThisMonthOpenCents) : "…"} hint={s ? `de ${money(s.dueThisMonthCents)} com vencimento no mês` : undefined} />
        <Stat label="Vencido em aberto" value={s ? money(s.overdueCents) : "…"} tone={s?.overdueCents ? "danger" : undefined} hint={s ? `${s.overdueCount} parcelas · ${s.overdueStudents} alunos` : undefined} />
        <Stat label="Receita reconhecida" value={s ? money(s.recognizedCents) : "…"} hint={s ? `${s.concludedLessons} aulas concluídas` : undefined} />
        <Stat label="Carteira a reconhecer" value={s ? money(s.portfolioCents) : "…"} hint="saldo de aulas × valor da aula" />
      </div>

      <section className="panel stack">
        <div className="tabs" role="tablist">
          {(["vencida", "mes", "a_vencer", "paga"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={status === k} className={status === k ? "tab on" : "tab"} onClick={() => setStatus(k)}>
              {k === "mes" ? "Vencem no mês" : k === "vencida" ? "Vencidas (todas)" : `${INSTALLMENT_STATUS_LABELS[k]} no mês`}
            </button>
          ))}
        </div>
        {installments.isPending ? (
          <Loading />
        ) : installments.isError ? (
          <LoadError error={installments.error} />
        ) : installments.data.installments.length === 0 ? (
          <p className="muted">Nenhuma parcela.</p>
        ) : (
          <>
            <p className="muted small">
              {installments.data.installments.length} parcelas · {money(installments.data.installments.reduce((n, i) => n + i.amountCents - i.paidCents, 0))} em aberto
            </p>
            <InstallmentsTable slug={slug} installments={installments.data.installments} onChange={refresh} />
          </>
        )}
      </section>
      <p className="muted small">Aluno com parcela vencida há mais de 15 dias fica inadimplente automaticamente e volta a ativo quando quita. Última atualização: hoje, {addDaysIso(todayIso(), 0).split("-").reverse().join("/")}.</p>
    </div>
  );
}

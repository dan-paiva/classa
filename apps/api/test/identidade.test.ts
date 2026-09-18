import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./harness.ts";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Awaited<ReturnType<Awaited<ReturnType<typeof createTestApp>>["adminOf"]>>;

const body = async <T>(res: Response) => {
  const b = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(b)}`);
  return b;
};

/** Aceita o convite criando a conta com aquele e-mail; devolve o cookie. */
async function joinByInvite(link: string, email: string, name: string) {
  const token = link.split("/convite/")[1]!;
  const cookie = await t.signUp(email, name);
  const res = await t.call(`/api/invitations/${token}/accept`, { method: "POST", cookie });
  expect(res.status).toBe(200);
  return cookie;
}

const me = (cookie: string) => t.call("/api/me", { cookie });

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminOf("identidade");
});

describe("identidade da pessoa", () => {
  it("colaborador que também é aluno: uma pessoa, dois acessos", async () => {
    // a pessoa entra como aluna, pelo e-mail pessoal
    const { student } = await body<{ student: { id: string; personId: string } }>(
      await admin.json("/students", "POST", { person: { name: "Helena Duarte", email: "helena.pessoal@exemplo.com", cpf: "39053344705" } }),
    );

    const alunoInvite = await body<{ link: string }>(
      await admin.json("/invitations", "POST", { personId: student.personId, profileType: "aluno" }),
    );
    const alunoCookie = await joinByInvite(alunoInvite.link, "helena.pessoal@exemplo.com", "Helena Duarte");

    // a mesma pessoa ganha acesso de trabalho, pelo corporativo
    const trabalhoInvite = await body<{ link: string }>(
      await admin.json("/invitations", "POST", {
        personId: student.personId,
        email: "helena@escola.com.br",
        profileType: "colaborador",
        level: 3,
        areas: { fin: "total" },
      }),
    );
    const trabalhoCookie = await joinByInvite(trabalhoInvite.link, "helena@escola.com.br", "Helena Duarte");

    // dois logins, dois perfis, a mesma pessoa
    const comoAluno = await body<{ memberships: { profileType: string }[] }>(await me(alunoCookie));
    const comoTrabalho = await body<{ memberships: { profileType: string }[] }>(await me(trabalhoCookie));
    expect(comoAluno.memberships[0]!.profileType).toBe("aluno");
    expect(comoTrabalho.memberships[0]!.profileType).toBe("colaborador");

    // os dois vínculos são da mesma pessoa
    const { members } = await body<{ members: { email: string; personId: string | null; profileType: string }[] }>(await admin.json("/users"));
    const dela = members.filter((m) => m.personId === student.personId);
    expect(dela.map((m) => m.email).sort()).toEqual(["helena.pessoal@exemplo.com", "helena@escola.com.br"]);
    expect(dela.map((m) => m.profileType).sort()).toEqual(["aluno", "colaborador"]);

    // e cada acesso enxerga só o que é dele
    expect((await t.call("/api/t/identidade/installments", { cookie: trabalhoCookie })).status).toBe(200);
    expect((await t.call("/api/t/identidade/installments", { cookie: alunoCookie })).status).toBe(403);
    expect((await t.call("/api/t/identidade/minha-area", { cookie: alunoCookie })).status).toBe(200);
    expect((await t.call("/api/t/identidade/minha-area", { cookie: trabalhoCookie })).status).toBe(404);

    // os dois e-mails são da mesma ficha: o pessoal continua achando a pessoa
    const busca = await body<{ students: { person: { id: string; email: string } }[] }>(await admin.json("/students?q=helena.pessoal"));
    expect(busca.students).toHaveLength(1);
    expect(busca.students[0]!.person.id).toBe(student.personId);
  });

  it("o mesmo CPF é a mesma pessoa, venha de onde vier", async () => {
    const lead = await body<{ lead: { id: string; personId: string; name: string } }>(
      await admin.json("/leads", "POST", { name: "Rafael Nunes", cpf: "111.444.777-35", email: "rafael@exemplo.com", origin: "Site" }),
    );
    expect(lead.lead.name).toBe("Rafael Nunes");

    // cadastrar aluno com o mesmo CPF não duplica: aponta a pessoa que já existe
    const res = await admin.json("/students", "POST", { person: { name: "Rafael N.", cpf: "11144477735" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ issues: { existingPersonId: [lead.lead.personId] } });
  });

  it("e-mail de outra pessoa é recusado", async () => {
    await body(await admin.json("/students", "POST", { person: { name: "Primeira", email: "disputado@exemplo.com" } }));
    const res = await admin.json("/students", "POST", { person: { name: "Segunda", email: "disputado@exemplo.com" } });
    expect(res.status).toBe(409);
  });
});

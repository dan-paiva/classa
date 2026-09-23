-- Quem reserva a vaga open-entry: o próprio aluno ou só a secretaria (DOMINIO.md §4.1 e §5.9).
-- Vinha do protótipo e ainda faltava. Padrão: o aluno agenda sozinho.
ALTER TABLE "course" ADD COLUMN "auto_agenda" boolean DEFAULT true NOT NULL;

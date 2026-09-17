import { z } from "zod";

export const uuid = z.uuid("Identificador inválido");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
export const cents = z.number({ error: "Informe um valor" }).int("Valor em centavos").min(0, "Valor não pode ser negativo");

function checkDigit(digits: number[], weightStart: number): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (weightStart - i), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

export const onlyDigits = (value: string) => value.replace(/\D/g, "");

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const nums = cpf.split("").map(Number);
  return checkDigit(nums.slice(0, 9), 10) === nums[9] && checkDigit(nums.slice(0, 10), 11) === nums[10];
}

/** CPF válido a partir de 9 dígitos base. Uso: dados de teste e demonstração. */
export function cpfFromBase(base9: string): string {
  const nums = onlyDigits(base9).padStart(9, "0").slice(0, 9).split("").map(Number);
  const d1 = checkDigit(nums, 10);
  const d2 = checkDigit([...nums, d1], 11);
  return [...nums, d1, d2].join("");
}

export function formatCpf(cpf: string): string {
  const d = onlyDigits(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}

import { WEEKDAYS_SHORT } from "../lib/format.ts";

const DAYS = [1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);
const key = (d: number, h: number) => d * 100 + h;

/** Grade de disponibilidade: segunda a sábado, 7h às 21h. Clique na hora, no dia ou na linha para alternar. */
export function AvailabilityGrid({ value, onChange, readOnly }: { value: number[]; onChange?: (next: number[]) => void; readOnly?: boolean }) {
  const set = new Set(value);
  const toggle = (keys: number[]) => {
    if (readOnly || !onChange) return;
    const allOn = keys.every((k) => set.has(k));
    const next = new Set(set);
    for (const k of keys) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <div className="avail-wrap">
      <table className={`avail${readOnly ? " avail-readonly" : ""}`}>
        <thead>
          <tr>
            <th />
            {DAYS.map((d) => (
              <th key={d}>
                <button type="button" className="avail-head" disabled={readOnly} onClick={() => toggle(HOURS.map((h) => key(d, h)))}>
                  {WEEKDAYS_SHORT[d]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((h) => (
            <tr key={h}>
              <th>
                <button type="button" className="avail-head" disabled={readOnly} onClick={() => toggle(DAYS.map((d) => key(d, h)))}>
                  {String(h).padStart(2, "0")}h
                </button>
              </th>
              {DAYS.map((d) => {
                const on = set.has(key(d, h));
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className={`avail-cell${on ? " on" : ""}`}
                      aria-pressed={on}
                      aria-label={`${WEEKDAYS_SHORT[d]} ${h}h ${on ? "disponível" : "indisponível"}`}
                      disabled={readOnly}
                      onClick={() => toggle([key(d, h)])}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{value.length} horas disponíveis por semana</p>
    </div>
  );
}

// Valores originais (padrão) das flags que o Helper já alterou, por processo do Roblox.
// Ficam SÓ na memória desta aba (nada é gravado). Servem para quando o Helper é
// fechado e aberto de novo com o Roblox ainda alterado: o Helper novo não sabe o
// valor padrão, então o site devolve o que o Helper anterior tinha capturado.

export interface FlagOriginal { rva: number; type: string; name: string; raw: string }

const MAX_SESSIONS = 3;
const MAX_ITEMS = 5000;

export function parseOriginals(v: unknown): FlagOriginal[] {
  if (!Array.isArray(v)) return [];
  const out: FlagOriginal[] = [];
  for (const it of v.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (typeof o.rva !== 'number' || !Number.isInteger(o.rva) || typeof o.type !== 'string' || typeof o.raw !== 'string' || !/^[0-9a-f]{2,64}$/i.test(o.raw)) continue;
    out.push({ rva: o.rva, type: o.type, name: typeof o.name === 'string' ? o.name : '', raw: o.raw });
  }
  return out;
}

export class OriginalsMemory {
  private sessions = new Map<string, Map<number, FlagOriginal>>();

  /** Guarda o que o Helper informou. O PRIMEIRO original visto por endereço vence (é o mais antigo = o padrão). */
  record(session: string | null | undefined, items: FlagOriginal[]) {
    if (!session || !items.length) return;
    let m = this.sessions.get(session);
    if (!m) {
      m = new Map();
      this.sessions.set(session, m);
      while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
    }
    for (const it of items) if (!m.has(it.rva) && m.size < MAX_ITEMS) m.set(it.rva, it);
  }

  /** Corpo do POST /set-originals (vazio = nada a devolver). */
  payload(): { session: string; items: FlagOriginal[] }[] {
    return [...this.sessions.entries()].map(([session, m]) => ({ session, items: [...m.values()] }));
  }
}

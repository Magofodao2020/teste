import { type TimingValues, MAX_MS, RETRIGGERS, type Retrigger } from '../core/macros';

/** Campo numérico (ms, vezes…). Sem mínimo artificial: 0 é aceito onde faz sentido. */
export function NumField({ label, value, onChange, min = 0, max, step = 1, suffix, hint, ariaLabel }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; hint?: string; ariaLabel?: string;
}) {
  return (
    <label className="col num-field">
      <span className="field-label">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => { const v = Number(e.target.value); onChange(Number.isFinite(v) ? Math.max(min, max != null ? Math.min(max, v) : v) : min); }}
          aria-label={ariaLabel ?? label}
        />
        {suffix && <span className="faint" style={{ fontSize: 12 }}>{suffix}</span>}
      </span>
      {hint && <span className="faint" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
}

/** Campo de inteiro com sinal (dx, dy, x, y, scroll). */
export function IntField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="col num-field">
      <span className="field-label">{label}</span>
      <input className="input" type="number" step={1} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))} aria-label={label} />
      {hint && <span className="faint" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
}

/** Os controles de temporização/comportamento (editor, presets e edição em lote usam os mesmos). */
export function TimingInputs({ value, onChange, prefix = '' }: { value: TimingValues; onChange: (v: TimingValues) => void; prefix?: string }) {
  const set = <K extends keyof TimingValues>(k: K, v: TimingValues[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="form-grid">
      <NumField ariaLabel={`${prefix}Delay inicial`} label="Delay inicial" suffix="ms" max={MAX_MS} value={value.startDelay} onChange={(v) => set('startDelay', v)} hint="Antes da 1ª etapa. 0 = começa na hora." />
      <NumField ariaLabel={`${prefix}Delay entre etapas`} label="Delay entre etapas" suffix="ms" max={MAX_MS} value={value.stepGap} onChange={(v) => set('stepGap', v)} hint="Somado à espera de cada etapa. 0 = etapas seguidas." />
      <NumField ariaLabel={`${prefix}Delay entre repetições`} label="Delay entre repetições" suffix="ms" max={MAX_MS} value={value.loopDelay} onChange={(v) => set('loopDelay', v)} />
      <NumField ariaLabel={`${prefix}Delay final`} label="Delay final" suffix="ms" max={MAX_MS} value={value.endDelay} onChange={(v) => set('endDelay', v)} hint="Depois da última etapa (a ação continua “rodando”)." />
      <NumField ariaLabel={`${prefix}Velocidade`} label="Velocidade" suffix="×" step={0.1} min={0.05} max={50} value={value.speed} onChange={(v) => set('speed', Math.min(50, Math.max(0.05, v || 1)))} hint="2× = metade do tempo de todas as esperas." />
      <NumField ariaLabel={`${prefix}Trava anti-repetição`} label="Trava anti-repetição" suffix="ms" max={5000} value={value.debounce} onChange={(v) => set('debounce', Math.round(v))} hint="Ignora outro aperto nesse intervalo (botão que “quica”). 0 = sem trava." />
      <label className="col">
        <span className="field-label">Apertar de novo enquanto roda</span>
        <select className="select" value={value.onRetrigger} onChange={(e) => set('onRetrigger', e.target.value as Retrigger)} aria-label={`${prefix}Apertar de novo enquanto roda`}>
          {RETRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="faint" style={{ fontSize: 11.5 }}>Modo “Uma vez”: parar, reiniciar do começo ou ignorar.</span>
      </label>
    </div>
  );
}

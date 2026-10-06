import {
  CircleAlert, CircleCheck, Info, Keyboard, Mouse, TriangleAlert, X,
} from 'lucide-react';
import {
  type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState,
} from 'react';
import { triggerLabel } from '../core/macros';
import { store, useApp } from '../state/store';
import logoUrl from './bope.png';

export function Logo({ className, alt = 'BOPE' }: { className?: string; alt?: string }) {
  return <img src={logoUrl} className={className} alt={alt} draggable={false} />;
}

type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';
export function Button({
  variant = 'default', size, icon, busy, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; icon?: ReactNode; busy?: boolean }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export type Tone = 'ok' | 'warn' | 'err' | 'busy' | 'gold' | 'neutral';
export function Chip({ tone = 'neutral', children, title, onClick }: { tone?: Tone; children: ReactNode; title?: string; onClick?: () => void }) {
  const cls = `chip ${tone}`;
  const inner = (<><span className="dot" />{children}</>);
  return onClick ? <button type="button" className={cls} title={title} onClick={onClick}>{inner}</button> : <span className={cls} title={title}>{inner}</span>;
}

export function Card({ title, icon, actions, children, className = '' }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="card-title">{icon}{title}</h2>}
          <div className="spacer" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone, children, action }: { tone?: 'ok' | 'warn' | 'err'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'err' ? CircleAlert : tone === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`notice ${tone ?? ''}`} role={tone === 'err' ? 'alert' : undefined}>
      <Icon />
      <div>{children}</div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" icon={<X />} onClick={onClose} aria-label="Fechar" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, children, confirmLabel, danger, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }} autoFocus>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}

const MOUSE_BUTTONS: Record<number, string> = { 0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight', 3: 'MouseBack', 4: 'MouseForward' };

export function isMouseCode(code: string | null | undefined) {
  return !!code && /^(Mouse|Scroll)/.test(code);
}

/**
 * Captura uma tecla ou botão do mouse (inclusive laterais e scroll) no formato
 * que o Helper entende (KeyboardEvent.code / MouseBack / ScrollUp…). Esc cancela.
 */
export function KeyCapture({ value, onChange, allowScroll = true, keyboardOnly = false, placeholder = 'Definir botão', label }: {
  value: string | null; onChange: (code: string) => void; allowScroll?: boolean; keyboardOnly?: boolean; placeholder?: string; label: string;
}) {
  const [capturing, setCapturing] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!capturing) return;
    let armed = false;
    const arm = setTimeout(() => { armed = true; }, 150); // ignora o próprio clique que abriu a captura
    const finish = (code: string | null) => {
      setCapturing(false);
      if (code) onChangeRef.current(code);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') finish(null);
      else if (e.code) finish(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      if (!armed || keyboardOnly) return;
      e.preventDefault(); e.stopPropagation();
      const code = MOUSE_BUTTONS[e.button];
      if (code) finish(code);
    };
    const onWheel = (e: WheelEvent) => {
      if (!armed || keyboardOnly || !allowScroll || !e.deltaY) return;
      e.preventDefault();
      finish(e.deltaY < 0 ? 'ScrollUp' : 'ScrollDown');
    };
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', block, true);
    return () => {
      clearTimeout(arm);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('contextmenu', block, true);
    };
  }, [capturing, allowScroll, keyboardOnly]);

  const Icon = isMouseCode(value) ? Mouse : Keyboard;
  return (
    <button
      type="button"
      className={`keycap ${capturing ? 'capturing' : ''} ${!value && !capturing ? 'is-empty' : ''}`}
      onClick={() => setCapturing(true)}
      aria-label={label}
      title={capturing ? 'Pressione uma tecla ou botão do mouse — Esc cancela' : `${label}: clique para trocar`}
    >
      {capturing ? 'Pressione…' : <><Icon />{value ? triggerLabel(value) : placeholder}</>}
    </button>
  );
}

export function KeyBadge({ code }: { code: string | null }) {
  const Icon = isMouseCode(code) ? Mouse : Keyboard;
  return <span className={`keycap ${code ? '' : 'is-empty'}`}><Icon />{triggerLabel(code)}</span>;
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'error' ? CircleAlert : Info;
        return (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon />
            <span>{t.text}</span>
            <button type="button" onClick={() => store.dismissToast(t.id)} aria-label="Fechar aviso"><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}

/** "agora", "há 3 min", "há 2 h", ou data. Atualiza sozinho a cada 30 s. */
export function Ago({ at }: { at: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!at) return <>—</>;
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return <>agora</>;
  const m = Math.round(s / 60);
  if (m < 60) return <>há {m} min</>;
  const h = Math.round(m / 60);
  if (h < 24) return <>há {h} h</>;
  return <>{new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>;
}

export function shortVersion(v: string | null | undefined) {
  return v ? v.replace(/^version-/, '') : '—';
}

export function formatNumber(n: number) {
  return n.toLocaleString('pt-BR');
}

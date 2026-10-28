export default function StatusBadge({ value, active }) {
  const text = active !== undefined ? (active ? 'Activo' : 'Inactivo') : String(value || '—').replaceAll('_',' ');
  const normalized = String(value || '').toLowerCase();
  const cls = active === true || ['finalizada','confirmada','atendida'].some(x=>normalized.includes(x)) ? 'good'
    : active === false || ['cancelada','anulada'].some(x=>normalized.includes(x)) ? 'bad'
    : ['en_proceso','reservada'].some(x=>normalized.includes(x)) ? 'info' : 'warn';
  return <span className={`status-badge ${cls}`}>{text}</span>;
}

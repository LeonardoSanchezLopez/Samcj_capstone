export const money = (value) => value == null ? 'Por evaluar' : new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 0 }).format(Number(value));
export const shortDate = (value) => value ? new Intl.DateTimeFormat('es-PE').format(new Date(`${value}T00:00:00`)) : '—';
export const dateTime = (value) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
export const labelEnum = (value = '') => String(value).replaceAll('_',' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

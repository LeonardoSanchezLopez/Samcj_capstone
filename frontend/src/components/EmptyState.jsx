import { SearchX } from 'lucide-react';
export default function EmptyState({ text='No se encontraron registros.' }) { return <div className="empty-state"><SearchX size={34}/><p>{text}</p></div>; }

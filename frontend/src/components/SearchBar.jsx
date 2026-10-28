import { Search } from 'lucide-react';
export default function SearchBar({ value, onChange, placeholder='Buscar...', children }) {
  return <div className="toolbar">
    <label className="search-box"><Search size={18}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></label>
    {children}
  </div>;
}

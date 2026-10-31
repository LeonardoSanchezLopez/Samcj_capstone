import { X } from 'lucide-react';

export default function Modal({ open, title, children, onClose, wide = false }) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className={`modal-card ${wide ? 'wide' : ''}`} onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">GESTIÓN</span><h3>{title}</h3></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}

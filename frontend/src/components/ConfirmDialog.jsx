import Modal from './Modal';
export default function ConfirmDialog({ open, title='Confirmar acción', message, onCancel, onConfirm, confirmText='Confirmar', danger=true }) {
  return <Modal open={open} title={title} onClose={onCancel}>
    <p className="muted" style={{marginTop:0}}>{message}</p>
    <div className="modal-actions"><button className="btn ghost" onClick={onCancel}>Cancelar</button><button className={`btn ${danger?'danger':'primary'}`} onClick={onConfirm}>{confirmText}</button></div>
  </Modal>;
}

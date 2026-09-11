import { createContext, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const show = (message, type = 'success') => {
    const id = Date.now() + Math.random();
    setItems(v => [...v, { id, message, type }]);
    setTimeout(() => setItems(v => v.filter(x => x.id !== id)), 3500);
  };
  const remove = id => setItems(v => v.filter(x => x.id !== id));

  return <ToastContext.Provider value={{ show }}>
    {children}
    <div className="toast-stack">
      {items.map(item => <div key={item.id} className={`toast ${item.type}`}>
        {item.type === 'error' ? <AlertCircle size={19}/> : <CheckCircle2 size={19}/>}<span>{item.message}</span>
        <button onClick={() => remove(item.id)}><X size={16}/></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

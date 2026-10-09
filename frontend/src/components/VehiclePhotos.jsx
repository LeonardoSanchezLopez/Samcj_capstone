import {Camera,CheckCircle2,RefreshCw} from 'lucide-react';
import {useState} from 'react';
import api from '../services/api';
const ANGLES=[['FRONTAL','Frontal'],['POSTERIOR','Posterior'],['IZQUIERDO','Lateral izquierdo'],['DERECHO','Lateral derecho']];
async function jpegData(file){
 if(!file.type.startsWith('image/'))throw new Error('Selecciona una imagen válida');
 if(file.size>16000000)throw new Error('La fotografía pesa demasiado (máximo 16 MB antes de optimizar)');
 const url=URL.createObjectURL(file);
 try{const img=new Image();img.src=url;await img.decode();const w=img.naturalWidth,h=img.naturalHeight,scale=Math.min(1,1400/Math.max(w,h));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
 const data=canvas.toDataURL('image/jpeg',.76);if(data.length>3950000)throw new Error('Imagen demasiado grande, usa una de menor resolución');return data;
 }finally{URL.revokeObjectURL(url)}
}
export default function VehiclePhotos({token,photos={},onUploaded,title='Fotografías de recepción'}){
 const [busy,setBusy]=useState('');const[error,setError]=useState('');
 const handle=async(angulo,file)=>{if(!file)return;setBusy(angulo);setError('');try{
  const data=await jpegData(file);await api.post('/admin/inspections/stage',{token,angulo,base64:data.split(',')[1]});onUploaded(angulo,data);
 }catch(e){setError(e.response?.data?.message||e.message||'Error al subir imagen')}finally{setBusy('')}};
 return <section className="vehicle-photos"><div className="photo-heading"><div><h3>{title}</h3><p>Cuatro fotografías obligatorias por vehículo. Usa la cámara trasera de tu celular.</p></div><strong>{Object.keys(photos).length} / 4</strong></div>
  <div className="photos-grid">{ANGLES.map(([angle,name])=><article className="photo-slot" key={angle}><strong>{name}</strong>{photos[angle]?<img src={photos[angle]} alt={`${name} registrada`}/>:<div className="photo-placeholder"><Camera size={29}/><span>Sin fotografía</span></div>}
  <label className="btn ghost photo-take">{photos[angle]?<RefreshCw size={15}/>:<Camera size={15}/>} {busy===angle?'Subiendo...':photos[angle]?'Repetir foto':'Tomar foto'}<input type="file" accept="image/*" capture="environment" disabled={Boolean(busy)} onChange={e=>{handle(angle,e.target.files?.[0]);e.target.value=''}}/></label>{photos[angle]&&<small className="photo-confirm"><CheckCircle2 size={14}/> Guardada</small>}</article>)}</div>
  {error&&<p className="availability-warning" role="alert">{error}</p>}
  
 </section>;
}

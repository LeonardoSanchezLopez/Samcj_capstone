// Generación local de PDF: el servidor entrega datos validados y aislados por concesionario.
// Una hoja A4 en orientación horizontal para facilitar el detalle de la liquidación.
const cp1252={'€':128,'‘':145,'’':146,'“':147,'”':148,'–':150,'—':151,'•':149,'…':133};
function latin(str){const result=[];for(const c of String(str??'')){const n=c.charCodeAt(0);result.push(n<=255?n:(cp1252[c]||63));}return new Uint8Array(result);}
const ascii=str=>new TextEncoder().encode(str);
function join(parts){const size=parts.reduce((a,v)=>a+v.length,0);const out=new Uint8Array(size);let i=0;for(const b of parts){out.set(b,i);i+=b.length;}return out;}
function escape(s){const out=[];for(const n of latin(s)) {if(n===40||n===41||n===92)out.push(92);out.push(n);}return new Uint8Array(out);}
function text(s,x,y,size=10,bold=false){return join([ascii(`BT /${bold?'F2':'F1'} ${size} Tf ${x} ${y} Td (`),escape(s),ascii(') Tj ET\n')]);}
const line=(x,y,x2,y2)=>ascii(`${x} ${y} m ${x2} ${y2} l S\n`);
const box=(x,y,w,h)=>ascii(`${x} ${y} ${w} ${h} re f\n`);
const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
const truncate=(s,n)=>compact(s).length>n?compact(s).slice(0,n-1)+'…':compact(s);
const money=v=>v==null?'SIN PRECIO':`S/ ${Number(v).toFixed(2)}`;
const datePE=iso=>iso?new Date(iso).toLocaleDateString('es-PE',{timeZone:'America/Lima',day:'2-digit',month:'2-digit',year:'numeric'}):'';
function pdfObject(i,body){return join([ascii(`${i} 0 obj\n`),body,ascii('\nendobj\n')]);}
export function downloadDealerWeeklyPdf(report){
 if(!report||!report.concesionario||!Array.isArray(report.items))throw new Error('Reporte no disponible');
 const perPage=27,pages=Math.max(1,Math.ceil(report.items.length/perPage));
 const objects={};const pageIds=[],font1=3,font2=4;let next=5;
 for(let pg=0;pg<pages;pg++){
   const pageId=next++,contentId=next++;pageIds.push(pageId);
   const cmds=[];
   cmds.push(ascii('0.10 0.18 0.32 rg\n'));cmds.push(box(30,524,782,46));cmds.push(ascii('1 1 1 rg\n'));
   cmds.push(text('SAMCJ S.A.C.  |  REPORTE SEMANAL DE SERVICIOS',45,541,17,true));
   cmds.push(ascii('0.15 0.2 0.3 rg\n'));
   cmds.push(text(`Concesionario: ${truncate(report.concesionario.nombre,64)}`,40,501,12,true));
   cmds.push(text(`Período: ${report.desde} al ${report.hasta}   |   OT finalizadas: ${report.cantidad}   |   Página ${pg+1}/${pages}`,40,481,10));
   cmds.push(ascii('0.90 0.93 0.97 rg\n'));cmds.push(box(35,441,772,29));cmds.push(ascii('0.16 0.22 0.32 rg\n'));
   const cols=[43,124,202,306,484,681];
   ['FECHA','OT','SERIE','VEHÍCULO','SERVICIO / LÁMINA','PRECIO'].forEach((v,i)=>cmds.push(text(v,cols[i],451,9,true)));
   const slice=report.items.slice(pg*perPage,(pg+1)*perPage);
   slice.forEach((x,i)=>{
      const y=426-i*13.7;
      if(i%2===0){cmds.push(ascii('0.97 0.98 0.99 rg\n'));cmds.push(box(35,y-4,772,14));cmds.push(ascii('0.13 0.2 0.31 rg\n'));}
      [datePE(x.fecha_fin),truncate(x.codigo,13),truncate(x.serie_interna||'—',16),truncate(x.vehiculo,28),truncate(`${x.servicio} / ${x.lamina} ${x.opacidad??''}%`,30),money(x.precio_final)].forEach((v,k)=>cmds.push(text(v,cols[k],y,8.2,k===5)));
   });
   cmds.push(ascii('0.13 0.24 0.4 RG\n'));cmds.push(line(35,49,807,49));
   cmds.push(ascii('0.11 0.18 0.3 rg\n'));cmds.push(text(`TOTAL SEMANAL: ${money(report.total)}`,510,30,14,true));
   if(report.sinPrecio)cmds.push(text(`Atención: ${report.sinPrecio} OT sin precio registrado (no sumadas).`,40,30,9));
   else cmds.push(text('Se incluyen únicamente servicios finalizados durante la semana indicada.',40,30,9));
   const stream=join(cmds);
   objects[contentId]=pdfObject(contentId,join([ascii(`<< /Length ${stream.length} >>\nstream\n`),stream,ascii('endstream')]));
   objects[pageId]=pdfObject(pageId,ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentId} 0 R >>`));
 }
 objects[1]=pdfObject(1,ascii('<< /Type /Catalog /Pages 2 0 R >>'));
 objects[2]=pdfObject(2,ascii(`<< /Type /Pages /Kids [${pageIds.map(i=>`${i} 0 R`).join(' ')}] /Count ${pages} >>`));
 objects[font1]=pdfObject(font1,ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
 objects[font2]=pdfObject(font2,ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
 const header=ascii('%PDF-1.4\n');const chunks=[header],offsets=[0];let offset=header.length;
 for(let i=1;i<next;i++){offsets[i]=offset;chunks.push(objects[i]);offset+=objects[i].length;}
 const xref=[`xref\n0 ${next}\n`,'0000000000 65535 f \n'];
 for(let i=1;i<next;i++)xref.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
 chunks.push(ascii(xref.join('')));chunks.push(ascii(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
 const blob=new Blob(chunks,{type:'application/pdf'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=`SAMCJ_${report.concesionario.nombre.replace(/[^a-z0-9]+/gi,'_')}_${report.desde}_${report.hasta}.pdf`;
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

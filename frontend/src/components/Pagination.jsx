import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function usePagedRows(rows, resetKey='', pageSize=7){
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[resetKey]);
  const count=rows.length;
  const totalPages=Math.max(1,Math.ceil(count/pageSize));
  const current=Math.min(page,totalPages);
  return {visible:rows.slice((current-1)*pageSize,current*pageSize),page:current,setPage,totalPages,count,pageSize};
}
export default function Pagination({paging}){
  if(paging.count<=paging.pageSize)return null;
  const from=(paging.page-1)*paging.pageSize+1;
  const to=Math.min(paging.count,paging.page*paging.pageSize);
  return <div className="table-pagination"><span>Mostrando {from}–{to} de {paging.count} registros</span><div className="pagination-buttons"><button type="button" aria-label="Página anterior" disabled={paging.page<=1} onClick={()=>paging.setPage(p=>Math.max(1,p-1))}><ChevronLeft size={17}/></button><span>Página {paging.page} de {paging.totalPages}</span><button type="button" aria-label="Página siguiente" disabled={paging.page>=paging.totalPages} onClick={()=>paging.setPage(p=>Math.min(paging.totalPages,p+1))}><ChevronRight size={17}/></button></div></div>;
}

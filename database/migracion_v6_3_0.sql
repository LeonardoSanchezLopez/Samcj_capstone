-- SAMCJ V6.3.0 — Ejecutar en SQL Editor de Supabase sobre V6.2.1, previo respaldo.
-- Aditiva: no altera órdenes históricas, consumo por categoría ni movimientos previos.
create table if not exists public.configuracion_reposicion (
  inventario_id uuid primary key references public.inventario(id),
  plazo_normal_dias integer not null default 20 check(plazo_normal_dias between 1 and 365),
  plazo_escasez_dias integer not null default 45 check(plazo_escasez_dias between 1 and 365),
  stock_seguridad_metros numeric(8,2) not null default 5 check(stock_seguridad_metros >= 0),
  costo_rollo numeric(12,2) check(costo_rollo >= 0),
  actualizado_en timestamptz not null default now()
);
create table if not exists public.planes_compra (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(120) not null,
  horizonte_dias integer not null check(horizonte_dias in (30,60,90)),
  estado varchar(15) not null default 'BORRADOR' check(estado in ('BORRADOR','REVISADO')),
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now()
);
create table if not exists public.planes_compra_detalles (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planes_compra(id) on delete cascade,
  inventario_id uuid not null references public.inventario(id),
  rollos_sugeridos integer not null check(rollos_sugeridos >= 0),
  rollos_aprobados integer not null check(rollos_aprobados >= 0),
  fecha_pedido_sugerida date,
  unique(plan_id,inventario_id)
);
-- Inspecciones para OT nuevas de concesionario. Fotos históricas no obligatorias.
create table if not exists public.inspecciones_ot (
  id uuid primary key default gen_random_uuid(),
  orden_trabajo_id uuid not null references public.ordenes_trabajo(id) on delete cascade,
  tipo varchar(12) not null check(tipo in ('RECEPCION','ENTREGA')),
  estado varchar(18) not null default 'PENDIENTE' check(estado in ('PENDIENTE','COMPLETA','REVISADA')),
  revisado_por uuid references public.perfiles(id),
  revisado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique(orden_trabajo_id,tipo)
);
create table if not exists public.fotografias_ot (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid references public.inspecciones_ot(id) on delete cascade,
  borrador_token uuid,
  usuario_id uuid not null references public.perfiles(id),
  angulo varchar(20) not null check(angulo in ('FRONTAL','POSTERIOR','IZQUIERDO','DERECHO')),
  ruta_storage text not null unique,
  creado_en timestamptz not null default now(),
  check(inspeccion_id is not null or borrador_token is not null)
);
create unique index if not exists ux_foto_inspeccion_angulo on public.fotografias_ot(inspeccion_id,angulo) where inspeccion_id is not null;
create index if not exists ix_foto_borrador on public.fotografias_ot(borrador_token,usuario_id);
create table if not exists public.hallazgos_inspeccion (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones_ot(id) on delete cascade,
  angulo varchar(20) not null check(angulo in ('FRONTAL','POSTERIOR','IZQUIERDO','DERECHO')),
  descripcion_ia text not null,
  estado_revision varchar(12) not null default 'PENDIENTE' check(estado_revision in ('PENDIENTE','CONFIRMADO','DESCARTADO')),
  observacion_admin text,
  revisado_por uuid references public.perfiles(id),
  revisado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists ix_inspecciones_ot on public.inspecciones_ot(orden_trabajo_id);
create index if not exists ix_hallazgos_inspeccion on public.hallazgos_inspeccion(inspeccion_id);
-- No permitir consultas anónimas directas: la app usa el backend autenticado.
alter table public.configuracion_reposicion enable row level security;
alter table public.planes_compra enable row level security;
alter table public.planes_compra_detalles enable row level security;
alter table public.inspecciones_ot enable row level security;
alter table public.fotografias_ot enable row level security;
alter table public.hallazgos_inspeccion enable row level security;
revoke all on public.configuracion_reposicion,public.planes_compra,public.planes_compra_detalles,public.inspecciones_ot,public.fotografias_ot,public.hallazgos_inspeccion from anon,authenticated;
grant all on public.configuracion_reposicion,public.planes_compra,public.planes_compra_detalles,public.inspecciones_ot,public.fotografias_ot,public.hallazgos_inspeccion to service_role;
-- Storage privado. El backend sube/lee fotos con service role; nunca exponer su clave al navegador.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('inspecciones-ot','inspecciones-ot',false,3145728,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false;

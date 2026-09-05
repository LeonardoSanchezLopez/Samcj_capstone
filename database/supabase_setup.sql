-- =============================================================
-- SAMCJ S.A.C. - Sistema de citas y servicios de polarizado
-- Supabase / PostgreSQL
-- Script único: esquema + datos iniciales + funciones + triggers
-- =============================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- =========================
-- 1. TIPOS ENUMERADOS
-- =========================

do $$ begin
  create type public.tipo_cliente_enum as enum ('NATURAL', 'CONCESIONARIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lugar_servicio_enum as enum ('LOCAL', 'DOMICILIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_cita_enum as enum ('RESERVADA', 'CONFIRMADA', 'CANCELADA', 'ATENDIDA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_cotizacion_enum as enum ('PRELIMINAR', 'CONFIRMADA', 'ANULADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_ot_enum as enum ('CLIENTE_NATURAL', 'CONCESIONARIO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_ot_enum as enum ('PENDIENTE_VALIDACION', 'EN_PROCESO', 'FINALIZADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_movimiento_inventario_enum as enum ('CONSUMO', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_notificacion_enum as enum ('INFO', 'CITA', 'STOCK', 'ORDEN');
exception when duplicate_object then null; end $$;

-- =========================
-- 2. SECUENCIAS
-- =========================
create sequence if not exists public.seq_citas start 1;
create sequence if not exists public.seq_cotizaciones start 1;
create sequence if not exists public.seq_ordenes_trabajo start 1;

-- =========================
-- 3. TABLAS DE SEGURIDAD
-- =========================
create table if not exists public.roles (
  id smallserial primary key,
  codigo varchar(30) not null unique,
  nombre varchar(80) not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rol_id smallint references public.roles(id),
  nombres varchar(100),
  apellidos varchar(100),
  telefono varchar(20),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 4. CONFIGURACIÓN GENERAL
-- =========================
create table if not exists public.configuracion_empresa (
  id smallint primary key default 1 check (id = 1),
  razon_social varchar(150) not null,
  ruc varchar(11) not null,
  direccion_local text not null,
  zona_horaria varchar(60) not null default 'America/Lima',
  duracion_servicio_minutos integer not null default 120 check (duracion_servicio_minutos > 0),
  max_servicios_dia integer not null default 5 check (max_servicios_dia > 0),
  turno_manana_inicio time not null default '08:00',
  turno_manana_fin time not null default '13:00',
  turno_tarde_inicio time not null default '14:00',
  turno_tarde_fin time not null default '18:00',
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 5. CATÁLOGOS PRINCIPALES
-- =========================
create table if not exists public.categorias_vehiculo (
  id smallserial primary key,
  codigo varchar(40) not null unique,
  nombre varchar(120) not null,
  metraje_estimado numeric(6,2) not null check (metraje_estimado > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.tipos_vehiculo_especial (
  id smallserial primary key,
  codigo varchar(40) not null unique,
  nombre varchar(120) not null,
  categoria_vehiculo_id smallint not null references public.categorias_vehiculo(id),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.calidades_lamina (
  id smallserial primary key,
  codigo varchar(30) not null unique,
  nombre varchar(80) not null,
  metros_por_rollo numeric(6,2) not null check (metros_por_rollo > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.marcas_lamina (
  id smallserial primary key,
  nombre varchar(100) not null unique,
  calidad_lamina_id smallint not null references public.calidades_lamina(id),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.tonalidades (
  id smallserial primary key,
  porcentaje smallint not null unique check (porcentaje between 0 and 100),
  nombre varchar(80) not null,
  descripcion varchar(200),
  orden smallint not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.servicios (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(120) not null unique,
  descripcion text,
  cotizacion_automatica boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 6. CLIENTES / CONCESIONARIOS
-- =========================
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombres varchar(100) not null,
  apellidos varchar(100) not null,
  dni varchar(15) not null unique,
  telefono varchar(20) not null,
  correo varchar(150),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.concesionarios (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(150) not null unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 7. TARIFARIO
-- La opacidad NO cambia el precio.
-- =========================
create table if not exists public.tarifas (
  id bigserial primary key,
  tipo_cliente public.tipo_cliente_enum not null,
  servicio_id uuid not null references public.servicios(id),
  categoria_vehiculo_id smallint not null references public.categorias_vehiculo(id),
  tipo_vehiculo_especial_id smallint references public.tipos_vehiculo_especial(id),
  marca_lamina_id smallint not null references public.marcas_lamina(id),
  precio numeric(10,2) not null check (precio >= 0),
  activo boolean not null default true,
  vigente_desde date not null default current_date,
  vigente_hasta date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

create unique index if not exists ux_tarifas_regla
on public.tarifas (
  tipo_cliente,
  servicio_id,
  categoria_vehiculo_id,
  coalesce(tipo_vehiculo_especial_id, 0),
  marca_lamina_id,
  vigente_desde
);

-- =========================
-- 8. INVENTARIO
-- No hay compras/proveedores. El stock se ajusta manualmente y se descuenta al finalizar OT.
-- Una fila = marca + tonalidad.
-- =========================
create table if not exists public.inventario (
  id uuid primary key default gen_random_uuid(),
  marca_lamina_id smallint not null references public.marcas_lamina(id),
  tonalidad_id smallint not null references public.tonalidades(id),
  metros_actuales numeric(8,2) not null default 0 check (metros_actuales >= 0),
  metros_minimos numeric(8,2) not null default 5 check (metros_minimos >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (marca_lamina_id, tonalidad_id)
);

-- =========================
-- 9. AGENDA / CITAS
-- =========================
create table if not exists public.bloqueos_agenda (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  todo_el_dia boolean not null default false,
  hora_inicio time,
  hora_fin time,
  motivo varchar(250),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (
    todo_el_dia = true
    or (hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)
  )
);

create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(30) not null unique,
  cliente_id uuid not null references public.clientes(id),
  servicio_id uuid references public.servicios(id),
  fecha date not null,
  hora time not null,
  lugar_servicio public.lugar_servicio_enum not null,
  distrito varchar(100),
  calle_avenida varchar(180),
  numero_direccion varchar(30),
  referencia varchar(250),
  direccion_local_snapshot text,
  categoria_vehiculo_id smallint not null references public.categorias_vehiculo(id),
  tipo_vehiculo_especial_id smallint references public.tipos_vehiculo_especial(id),
  marca_vehiculo varchar(80),
  modelo_vehiculo varchar(100),
  anio_vehiculo smallint,
  placa varchar(20),
  estado public.estado_cita_enum not null default 'RESERVADA',
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (
    lugar_servicio = 'LOCAL'
    or (distrito is not null and calle_avenida is not null)
  )
);

-- =========================
-- 10. CUESTIONARIO DE CITA
-- =========================
create table if not exists public.preguntas_cita (
  id smallserial primary key,
  codigo varchar(50) not null unique,
  texto varchar(300) not null,
  orden smallint not null,
  requerido boolean not null default true,
  condicional boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.opciones_pregunta (
  id bigserial primary key,
  pregunta_id smallint not null references public.preguntas_cita(id) on delete cascade,
  codigo varchar(50) not null,
  texto varchar(200) not null,
  orden smallint not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (pregunta_id, codigo)
);

create table if not exists public.respuestas_cita (
  id bigserial primary key,
  cita_id uuid not null references public.citas(id) on delete cascade,
  pregunta_id smallint not null references public.preguntas_cita(id),
  opcion_id bigint not null references public.opciones_pregunta(id),
  creado_en timestamptz not null default now(),
  unique (cita_id, pregunta_id)
);

create table if not exists public.recomendaciones_cita (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid not null unique references public.citas(id) on delete cascade,
  calidad_lamina_id smallint references public.calidades_lamina(id),
  marca_lamina_id smallint references public.marcas_lamina(id),
  tonalidad_id smallint references public.tonalidades(id),
  explicacion text,
  generado_por varchar(30) not null default 'REGLAS',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 11. COTIZACIONES
-- =========================
create table if not exists public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(30) not null unique,
  cita_id uuid references public.citas(id),
  cliente_id uuid not null references public.clientes(id),
  servicio_id uuid not null references public.servicios(id),
  categoria_vehiculo_id smallint not null references public.categorias_vehiculo(id),
  tipo_vehiculo_especial_id smallint references public.tipos_vehiculo_especial(id),
  marca_lamina_id smallint not null references public.marcas_lamina(id),
  tonalidad_id smallint not null references public.tonalidades(id),
  monto numeric(10,2),
  estado public.estado_cotizacion_enum not null default 'PRELIMINAR',
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- =========================
-- 12. ÓRDENES DE TRABAJO
-- Cliente natural: PENDIENTE_VALIDACION -> EN_PROCESO -> FINALIZADA
-- Concesionario: EN_PROCESO -> FINALIZADA
-- =========================
create table if not exists public.ordenes_trabajo (
  id uuid primary key default gen_random_uuid(),
  codigo varchar(30) not null unique,
  tipo_ot public.tipo_ot_enum not null,
  cliente_id uuid references public.clientes(id),
  concesionario_id uuid references public.concesionarios(id),
  cita_id uuid references public.citas(id),
  cotizacion_id uuid references public.cotizaciones(id),
  servicio_id uuid not null references public.servicios(id),
  categoria_vehiculo_id smallint not null references public.categorias_vehiculo(id),
  tipo_vehiculo_especial_id smallint references public.tipos_vehiculo_especial(id),
  marca_vehiculo varchar(80),
  modelo_vehiculo varchar(100),
  anio_vehiculo smallint,
  placa varchar(20),
  marca_lamina_id smallint not null references public.marcas_lamina(id),
  tonalidad_id smallint not null references public.tonalidades(id),
  asesor_concesionario varchar(150),
  referencia_documento_concesionario varchar(120),
  estado public.estado_ot_enum not null,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  precio_final numeric(10,2),
  metraje_estimado numeric(6,2) not null default 0,
  stock_descontado boolean not null default false,
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (
    (tipo_ot = 'CLIENTE_NATURAL' and cliente_id is not null and concesionario_id is null)
    or
    (tipo_ot = 'CONCESIONARIO' and concesionario_id is not null)
  )
);

create table if not exists public.orden_trabajo_realizadores (
  orden_trabajo_id uuid not null references public.ordenes_trabajo(id) on delete cascade,
  perfil_id uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  primary key (orden_trabajo_id, perfil_id)
);

create table if not exists public.movimientos_inventario (
  id bigserial primary key,
  inventario_id uuid not null references public.inventario(id),
  orden_trabajo_id uuid references public.ordenes_trabajo(id),
  tipo_movimiento public.tipo_movimiento_inventario_enum not null,
  metros numeric(8,2) not null check (metros > 0),
  metros_antes numeric(8,2) not null,
  metros_despues numeric(8,2) not null,
  motivo varchar(250),
  creado_por uuid references public.perfiles(id),
  creado_en timestamptz not null default now()
);

create unique index if not exists ux_movimiento_consumo_ot
on public.movimientos_inventario(orden_trabajo_id)
where tipo_movimiento = 'CONSUMO' and orden_trabajo_id is not null;

-- =========================
-- 13. NOTIFICACIONES
-- =========================
create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid references public.perfiles(id),
  tipo public.tipo_notificacion_enum not null default 'INFO',
  titulo varchar(150) not null,
  mensaje text not null,
  leida boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- =========================
-- 14. FUNCIONES GENERALES
-- =========================
create or replace function public.fn_set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

-- Triggers updated_at
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'perfiles','categorias_vehiculo','tipos_vehiculo_especial','calidades_lamina',
    'marcas_lamina','tonalidades','servicios','clientes','concesionarios','tarifas',
    'inventario','bloqueos_agenda','citas','preguntas_cita','recomendaciones_cita',
    'cotizaciones','ordenes_trabajo'
  ]
  LOOP
    EXECUTE format('drop trigger if exists trg_%I_actualizado_en on public.%I', t, t);
    EXECUTE format(
      'create trigger trg_%I_actualizado_en before update on public.%I for each row execute function public.fn_set_actualizado_en()',
      t, t
    );
  END LOOP;
END $$;

-- Códigos consecutivos
create or replace function public.fn_generar_codigo_cita()
returns trigger language plpgsql as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := 'CIT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.seq_citas')::text, 6, '0');
  end if;
  return new;
end; $$;

drop trigger if exists trg_codigo_cita on public.citas;
create trigger trg_codigo_cita
before insert on public.citas
for each row execute function public.fn_generar_codigo_cita();

create or replace function public.fn_generar_codigo_cotizacion()
returns trigger language plpgsql as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := 'COT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.seq_cotizaciones')::text, 6, '0');
  end if;
  return new;
end; $$;

drop trigger if exists trg_codigo_cotizacion on public.cotizaciones;
create trigger trg_codigo_cotizacion
before insert on public.cotizaciones
for each row execute function public.fn_generar_codigo_cotizacion();

create or replace function public.fn_generar_codigo_ot()
returns trigger language plpgsql as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := 'OT-' || to_char(current_date,'YYYY') || '-' || lpad(nextval('public.seq_ordenes_trabajo')::text, 6, '0');
  end if;
  return new;
end; $$;

drop trigger if exists trg_codigo_ot on public.ordenes_trabajo;
create trigger trg_codigo_ot
before insert on public.ordenes_trabajo
for each row execute function public.fn_generar_codigo_ot();

-- Autocompletar dirección del local cuando la cita es LOCAL
create or replace function public.fn_cita_direccion_local()
returns trigger language plpgsql as $$
declare
  v_direccion text;
begin
  if new.lugar_servicio = 'LOCAL' then
    select direccion_local into v_direccion from public.configuracion_empresa where id = 1;
    new.direccion_local_snapshot := v_direccion;
    new.distrito := null;
    new.calle_avenida := null;
    new.numero_direccion := null;
    new.referencia := null;
  else
    new.direccion_local_snapshot := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_cita_direccion_local on public.citas;
create trigger trg_cita_direccion_local
before insert or update of lugar_servicio on public.citas
for each row execute function public.fn_cita_direccion_local();

-- Validación de cupo diario y bloqueos de agenda
create or replace function public.fn_validar_cupo_cita()
returns trigger language plpgsql as $$
declare
  v_max integer;
  v_total integer;
  v_bloqueada boolean;
begin
  if new.estado in ('RESERVADA','CONFIRMADA') and new.activo = true then
    select max_servicios_dia into v_max
    from public.configuracion_empresa where id = 1;

    select count(*) into v_total
    from public.citas c
    where c.fecha = new.fecha
      and c.activo = true
      and c.estado in ('RESERVADA','CONFIRMADA')
      and (tg_op = 'INSERT' or c.id <> new.id);

    if v_total >= v_max then
      raise exception 'No hay cupos disponibles para la fecha %', new.fecha;
    end if;

    select exists(
      select 1
      from public.bloqueos_agenda b
      where b.fecha = new.fecha
        and b.activo = true
        and (
          b.todo_el_dia = true
          or (b.hora_inicio is not null and b.hora_fin is not null and new.hora >= b.hora_inicio and new.hora < b.hora_fin)
        )
    ) into v_bloqueada;

    if v_bloqueada then
      raise exception 'La fecha/hora seleccionada está bloqueada por el administrador';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_validar_cupo_cita on public.citas;
create trigger trg_validar_cupo_cita
before insert or update of fecha, hora, estado, activo on public.citas
for each row execute function public.fn_validar_cupo_cita();

-- Calcular precio según cliente + categoría + marca + caso especial.
create or replace function public.fn_calcular_precio(
  p_tipo_cliente public.tipo_cliente_enum,
  p_servicio_id uuid,
  p_categoria_vehiculo_id smallint,
  p_marca_lamina_id smallint,
  p_tipo_vehiculo_especial_id smallint default null
)
returns numeric
language sql
stable
as $$
  select t.precio
  from public.tarifas t
  where t.tipo_cliente = p_tipo_cliente
    and t.servicio_id = p_servicio_id
    and t.categoria_vehiculo_id = p_categoria_vehiculo_id
    and t.marca_lamina_id = p_marca_lamina_id
    and t.activo = true
    and current_date >= t.vigente_desde
    and (t.vigente_hasta is null or current_date <= t.vigente_hasta)
    and (
      (p_tipo_vehiculo_especial_id is null and t.tipo_vehiculo_especial_id is null)
      or
      (p_tipo_vehiculo_especial_id is not null and t.tipo_vehiculo_especial_id = p_tipo_vehiculo_especial_id)
    )
  order by t.vigente_desde desc
  limit 1;
$$;

-- Completar metraje estimado de OT desde la categoría de vehículo
create or replace function public.fn_ot_set_metraje()
returns trigger language plpgsql as $$
begin
  select metraje_estimado into new.metraje_estimado
  from public.categorias_vehiculo
  where id = new.categoria_vehiculo_id;
  return new;
end; $$;

drop trigger if exists trg_ot_set_metraje on public.ordenes_trabajo;
create trigger trg_ot_set_metraje
before insert or update of categoria_vehiculo_id on public.ordenes_trabajo
for each row execute function public.fn_ot_set_metraje();

-- Control de estados de OT
create or replace function public.fn_validar_estado_ot()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo_ot = 'CLIENTE_NATURAL' and new.estado <> 'PENDIENTE_VALIDACION' then
      raise exception 'Una OT de cliente natural debe iniciar en PENDIENTE_VALIDACION';
    end if;

    if new.tipo_ot = 'CONCESIONARIO' and new.estado <> 'EN_PROCESO' then
      raise exception 'Una OT de concesionario debe iniciar en EN_PROCESO';
    end if;

    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'FINALIZADA' then
      raise exception 'Una OT FINALIZADA no puede cambiar de estado';
    end if;

    if new.tipo_ot = 'CLIENTE_NATURAL' then
      if old.estado = 'PENDIENTE_VALIDACION' and new.estado = 'EN_PROCESO' then
        new.fecha_inicio := coalesce(new.fecha_inicio, now());
      elsif old.estado = 'EN_PROCESO' and new.estado = 'FINALIZADA' then
        new.fecha_fin := coalesce(new.fecha_fin, now());
      else
        raise exception 'Transición inválida para OT de cliente natural: % -> %', old.estado, new.estado;
      end if;
    else
      if old.estado = 'EN_PROCESO' and new.estado = 'FINALIZADA' then
        if new.fecha_inicio is null then
          raise exception 'La OT de concesionario debe tener fecha_inicio antes de finalizar';
        end if;
        new.fecha_fin := coalesce(new.fecha_fin, now());
      else
        raise exception 'Transición inválida para OT de concesionario: % -> %', old.estado, new.estado;
      end if;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_validar_estado_ot on public.ordenes_trabajo;
create trigger trg_validar_estado_ot
before insert or update of estado on public.ordenes_trabajo
for each row execute function public.fn_validar_estado_ot();

-- Descontar stock al pasar OT a FINALIZADA.
create or replace function public.fn_descontar_stock_al_finalizar_ot()
returns trigger language plpgsql as $$
declare
  v_inv_id uuid;
  v_stock numeric(8,2);
  v_nuevo numeric(8,2);
begin
  if new.estado = 'FINALIZADA'
     and old.estado is distinct from 'FINALIZADA'
     and new.stock_descontado = false then

    select i.id, i.metros_actuales
      into v_inv_id, v_stock
    from public.inventario i
    where i.marca_lamina_id = new.marca_lamina_id
      and i.tonalidad_id = new.tonalidad_id
      and i.activo = true
    for update;

    if v_inv_id is null then
      raise exception 'No existe inventario activo para la marca/tonalidad seleccionada';
    end if;

    if v_stock < new.metraje_estimado then
      raise exception 'Stock insuficiente. Disponible: % m, requerido: % m', v_stock, new.metraje_estimado;
    end if;

    v_nuevo := v_stock - new.metraje_estimado;

    update public.inventario
    set metros_actuales = v_nuevo,
        actualizado_en = now()
    where id = v_inv_id;

    insert into public.movimientos_inventario(
      inventario_id, orden_trabajo_id, tipo_movimiento,
      metros, metros_antes, metros_despues, motivo
    ) values (
      v_inv_id, new.id, 'CONSUMO',
      new.metraje_estimado, v_stock, v_nuevo,
      'Consumo automático por finalización de ' || new.codigo
    );

    update public.ordenes_trabajo
    set stock_descontado = true,
        actualizado_en = now()
    where id = new.id;

    if v_nuevo <= (select metros_minimos from public.inventario where id = v_inv_id) then
      insert into public.notificaciones(tipo, titulo, mensaje)
      values (
        'STOCK',
        'Stock bajo',
        'El stock llegó a ' || v_nuevo || ' m después de finalizar ' || new.codigo
      );
    end if;
  end if;

  return null;
end; $$;

drop trigger if exists trg_descontar_stock_ot on public.ordenes_trabajo;
create trigger trg_descontar_stock_ot
after update of estado on public.ordenes_trabajo
for each row
when (new.estado = 'FINALIZADA' and old.estado is distinct from 'FINALIZADA')
execute function public.fn_descontar_stock_al_finalizar_ot();

-- Crear perfil automáticamente al crear un usuario en Supabase Auth
create or replace function public.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_id smallint;
begin
  select id into v_rol_id from public.roles where codigo = 'ADMIN' limit 1;

  insert into public.perfiles(id, rol_id, nombres, apellidos)
  values (
    new.id,
    v_rol_id,
    coalesce(new.raw_user_meta_data->>'nombres', ''),
    coalesce(new.raw_user_meta_data->>'apellidos', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.fn_handle_new_auth_user();

-- =========================
-- 15. ÍNDICES PARA txtBuscar / FILTROS
-- =========================
create index if not exists idx_clientes_dni on public.clientes(dni);
create index if not exists idx_clientes_telefono on public.clientes(telefono);
create index if not exists idx_clientes_nombre_trgm
  on public.clientes using gin ((nombres || ' ' || apellidos) gin_trgm_ops);

create index if not exists idx_concesionarios_nombre_trgm
  on public.concesionarios using gin (nombre gin_trgm_ops);

create index if not exists idx_citas_fecha on public.citas(fecha);
create index if not exists idx_citas_cliente on public.citas(cliente_id);
create index if not exists idx_cotizaciones_codigo on public.cotizaciones(codigo);
create index if not exists idx_ot_codigo on public.ordenes_trabajo(codigo);
create index if not exists idx_ot_cliente on public.ordenes_trabajo(cliente_id);
create index if not exists idx_ot_concesionario on public.ordenes_trabajo(concesionario_id);
create index if not exists idx_ot_placa on public.ordenes_trabajo(placa);
create index if not exists idx_inventario_marca_tonalidad on public.inventario(marca_lamina_id, tonalidad_id);

-- =========================
-- 16. VISTAS ÚTILES PARA EL ADMIN
-- =========================
create or replace view public.v_inventario
with (security_invoker = true) as
select
  i.id,
  m.nombre as marca,
  c.nombre as calidad,
  t.porcentaje as tonalidad_porcentaje,
  t.nombre as tonalidad,
  c.metros_por_rollo,
  i.metros_actuales,
  i.metros_minimos,
  case when i.metros_actuales <= i.metros_minimos then 'BAJO' else 'OK' end as estado_stock,
  i.activo
from public.inventario i
join public.marcas_lamina m on m.id = i.marca_lamina_id
join public.calidades_lamina c on c.id = m.calidad_lamina_id
join public.tonalidades t on t.id = i.tonalidad_id;

create or replace view public.v_tarifario
with (security_invoker = true) as
select
  tf.id,
  tf.tipo_cliente,
  s.nombre as servicio,
  cv.nombre as categoria_vehiculo,
  tve.nombre as tipo_especial,
  ml.nombre as marca_lamina,
  cl.nombre as calidad,
  tf.precio,
  tf.activo
from public.tarifas tf
join public.servicios s on s.id = tf.servicio_id
join public.categorias_vehiculo cv on cv.id = tf.categoria_vehiculo_id
left join public.tipos_vehiculo_especial tve on tve.id = tf.tipo_vehiculo_especial_id
join public.marcas_lamina ml on ml.id = tf.marca_lamina_id
join public.calidades_lamina cl on cl.id = ml.calidad_lamina_id;

create or replace view public.v_ordenes_trabajo
with (security_invoker = true) as
select
  ot.id,
  ot.codigo,
  ot.tipo_ot,
  coalesce(c.nombres || ' ' || c.apellidos, con.nombre) as cliente_o_concesionario,
  c.dni,
  ot.placa,
  cv.nombre as categoria_vehiculo,
  tve.nombre as tipo_especial,
  ml.nombre as marca_lamina,
  t.porcentaje as tonalidad_porcentaje,
  t.nombre as tonalidad,
  ot.estado,
  ot.fecha_inicio,
  ot.fecha_fin,
  ot.precio_final,
  ot.metraje_estimado,
  ot.stock_descontado,
  ot.activo,
  ot.creado_en
from public.ordenes_trabajo ot
left join public.clientes c on c.id = ot.cliente_id
left join public.concesionarios con on con.id = ot.concesionario_id
join public.categorias_vehiculo cv on cv.id = ot.categoria_vehiculo_id
left join public.tipos_vehiculo_especial tve on tve.id = ot.tipo_vehiculo_especial_id
join public.marcas_lamina ml on ml.id = ot.marca_lamina_id
join public.tonalidades t on t.id = ot.tonalidad_id;

-- =========================
-- 17. RLS
-- Frontend -> Express -> Supabase service_role.
-- No se exponen tablas directamente al cliente web.
-- =========================
alter table public.roles enable row level security;
alter table public.perfiles enable row level security;
alter table public.configuracion_empresa enable row level security;
alter table public.categorias_vehiculo enable row level security;
alter table public.tipos_vehiculo_especial enable row level security;
alter table public.calidades_lamina enable row level security;
alter table public.marcas_lamina enable row level security;
alter table public.tonalidades enable row level security;
alter table public.servicios enable row level security;
alter table public.clientes enable row level security;
alter table public.concesionarios enable row level security;
alter table public.tarifas enable row level security;
alter table public.inventario enable row level security;
alter table public.bloqueos_agenda enable row level security;
alter table public.citas enable row level security;
alter table public.preguntas_cita enable row level security;
alter table public.opciones_pregunta enable row level security;
alter table public.respuestas_cita enable row level security;
alter table public.recomendaciones_cita enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.ordenes_trabajo enable row level security;
alter table public.orden_trabajo_realizadores enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.notificaciones enable row level security;

-- El usuario autenticado puede leer su propio perfil.
drop policy if exists perfiles_select_propio on public.perfiles;
create policy perfiles_select_propio
on public.perfiles
for select
to authenticated
using (id = auth.uid());

-- Las vistas administrativas se consumen únicamente desde Express con service_role.
revoke all on table public.v_inventario from anon, authenticated;
revoke all on table public.v_tarifario from anon, authenticated;
revoke all on table public.v_ordenes_trabajo from anon, authenticated;
grant select on table public.v_inventario to service_role;
grant select on table public.v_tarifario to service_role;
grant select on table public.v_ordenes_trabajo to service_role;

-- =========================
-- 18. DATOS INICIALES
-- =========================

-- Roles
insert into public.roles(codigo, nombre)
values
  ('ADMIN', 'Administrador')
on conflict (codigo) do update set nombre = excluded.nombre, activo = true;

-- Si ya existían usuarios en Supabase Auth antes de ejecutar este script, crear sus perfiles.
insert into public.perfiles(id, rol_id, nombres, apellidos)
select
  u.id,
  (select id from public.roles where codigo = 'ADMIN' limit 1),
  coalesce(u.raw_user_meta_data->>'nombres', ''),
  coalesce(u.raw_user_meta_data->>'apellidos', '')
from auth.users u
where not exists (select 1 from public.perfiles p where p.id = u.id);

-- Configuración empresa
insert into public.configuracion_empresa(
  id, razon_social, ruc, direccion_local,
  duracion_servicio_minutos, max_servicios_dia,
  turno_manana_inicio, turno_manana_fin,
  turno_tarde_inicio, turno_tarde_fin
)
values (
  1,
  'SAMCJ S.A.C.',
  '20610660151',
  'Cal. 03 de Octubre Nro. 847, Florencia de Mora, Trujillo, La Libertad',
  120,
  5,
  '08:00', '13:00', '14:00', '18:00'
)
on conflict (id) do update set
  razon_social = excluded.razon_social,
  ruc = excluded.ruc,
  direccion_local = excluded.direccion_local,
  duracion_servicio_minutos = excluded.duracion_servicio_minutos,
  max_servicios_dia = excluded.max_servicios_dia,
  turno_manana_inicio = excluded.turno_manana_inicio,
  turno_manana_fin = excluded.turno_manana_fin,
  turno_tarde_inicio = excluded.turno_tarde_inicio,
  turno_tarde_fin = excluded.turno_tarde_fin,
  actualizado_en = now();

-- Categorías de vehículo
insert into public.categorias_vehiculo(codigo, nombre, metraje_estimado)
values
  ('SEDAN', 'Sedán', 2.30),
  ('SUV_HATCHBACK', 'SUV / Hatchback', 2.30),
  ('CAMIONETA_PICKUP', 'Camioneta cerrada / Pickup', 3.20)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  metraje_estimado = excluded.metraje_estimado,
  activo = true;

-- Casos especiales
insert into public.tipos_vehiculo_especial(codigo, nombre, categoria_vehiculo_id)
select 'FORD_PICKUP', 'Ford Pickup', id
from public.categorias_vehiculo where codigo = 'CAMIONETA_PICKUP'
on conflict (codigo) do update set nombre = excluded.nombre, categoria_vehiculo_id = excluded.categoria_vehiculo_id, activo = true;

insert into public.tipos_vehiculo_especial(codigo, nombre, categoria_vehiculo_id)
select 'SUBURBAN', 'Suburban', id
from public.categorias_vehiculo where codigo = 'CAMIONETA_PICKUP'
on conflict (codigo) do update set nombre = excluded.nombre, categoria_vehiculo_id = excluded.categoria_vehiculo_id, activo = true;

-- Calidad de láminas
insert into public.calidades_lamina(codigo, nombre, metros_por_rollo)
values
  ('ESTANDAR', 'Estándar', 45.00),
  ('PREMIUM', 'Premium', 35.00)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  metros_por_rollo = excluded.metros_por_rollo,
  activo = true;

-- Marcas
insert into public.marcas_lamina(nombre, calidad_lamina_id)
select 'Nexfil USA', id from public.calidades_lamina where codigo = 'ESTANDAR'
on conflict (nombre) do update set calidad_lamina_id = excluded.calidad_lamina_id, activo = true;

insert into public.marcas_lamina(nombre, calidad_lamina_id)
select 'Stek', id from public.calidades_lamina where codigo = 'ESTANDAR'
on conflict (nombre) do update set calidad_lamina_id = excluded.calidad_lamina_id, activo = true;

insert into public.marcas_lamina(nombre, calidad_lamina_id)
select 'Llumar', id from public.calidades_lamina where codigo = 'PREMIUM'
on conflict (nombre) do update set calidad_lamina_id = excluded.calidad_lamina_id, activo = true;

insert into public.marcas_lamina(nombre, calidad_lamina_id)
select '3M', id from public.calidades_lamina where codigo = 'PREMIUM'
on conflict (nombre) do update set calidad_lamina_id = excluded.calidad_lamina_id, activo = true;

-- Tonalidades
insert into public.tonalidades(porcentaje, nombre, descripcion, orden)
values
  (100, 'Transparente', 'Vista prácticamente transparente', 1),
  (70,  'Ahumada', 'Tonalidad ahumada', 2),
  (50,  'Intermedio', 'Nivel intermedio', 3),
  (35,  'Casi negro', 'Tonalidad casi negra', 4),
  (5,   'Negro', 'Tonalidad negra / muy oscura', 5)
on conflict (porcentaje) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  orden = excluded.orden,
  activo = true;

-- Servicios
insert into public.servicios(nombre, descripcion, cotizacion_automatica)
values
  ('Polarizado completo', 'Polarizado completo del vehículo', true),
  ('Cambio de lámina existente', 'Retiro/cambio de lámina existente; precio sujeto a evaluación', false),
  ('Retiro de lámina', 'Retiro de lámina sin nueva instalación; precio sujeto a evaluación', false)
on conflict (nombre) do update set
  descripcion = excluded.descripcion,
  cotizacion_automatica = excluded.cotizacion_automatica,
  activo = true;

-- Concesionarios
insert into public.concesionarios(nombre)
values
  ('Autonort'),
  ('Automotores Inka'),
  ('Intermotors'),
  ('B Motors')
on conflict (nombre) do update set activo = true;

-- =========================
-- 19. TARIFAS INICIALES
-- Precios de concesionario proporcionados por la empresa.
-- Cliente natural = S/ 50 menos.
-- =========================
DO $$
DECLARE
  v_servicio uuid;
  v_sedan smallint;
  v_suv smallint;
  v_pickup smallint;
  v_ford smallint;
  v_suburban smallint;
  v_nexfil smallint;
  v_stek smallint;
  v_llumar smallint;
  v_3m smallint;
BEGIN
  select id into v_servicio from public.servicios where nombre = 'Polarizado completo';
  select id into v_sedan from public.categorias_vehiculo where codigo = 'SEDAN';
  select id into v_suv from public.categorias_vehiculo where codigo = 'SUV_HATCHBACK';
  select id into v_pickup from public.categorias_vehiculo where codigo = 'CAMIONETA_PICKUP';
  select id into v_ford from public.tipos_vehiculo_especial where codigo = 'FORD_PICKUP';
  select id into v_suburban from public.tipos_vehiculo_especial where codigo = 'SUBURBAN';
  select id into v_nexfil from public.marcas_lamina where nombre = 'Nexfil USA';
  select id into v_stek from public.marcas_lamina where nombre = 'Stek';
  select id into v_llumar from public.marcas_lamina where nombre = 'Llumar';
  select id into v_3m from public.marcas_lamina where nombre = '3M';

  -- General: concesionarios
  insert into public.tarifas(tipo_cliente, servicio_id, categoria_vehiculo_id, marca_lamina_id, precio)
  values
    ('CONCESIONARIO', v_servicio, v_sedan, v_nexfil, 350),
    ('CONCESIONARIO', v_servicio, v_sedan, v_stek, 550),
    ('CONCESIONARIO', v_servicio, v_sedan, v_llumar, 600),
    ('CONCESIONARIO', v_servicio, v_sedan, v_3m, 900),

    ('CONCESIONARIO', v_servicio, v_suv, v_nexfil, 500),
    ('CONCESIONARIO', v_servicio, v_suv, v_stek, 650),
    ('CONCESIONARIO', v_servicio, v_suv, v_llumar, 800),
    ('CONCESIONARIO', v_servicio, v_suv, v_3m, 1100),

    ('CONCESIONARIO', v_servicio, v_pickup, v_nexfil, 650),
    ('CONCESIONARIO', v_servicio, v_pickup, v_stek, 750),
    ('CONCESIONARIO', v_servicio, v_pickup, v_llumar, 950),
    ('CONCESIONARIO', v_servicio, v_pickup, v_3m, 1500)
  on conflict do nothing;

  -- General: particulares = 50 menos
  insert into public.tarifas(tipo_cliente, servicio_id, categoria_vehiculo_id, marca_lamina_id, precio)
  values
    ('NATURAL', v_servicio, v_sedan, v_nexfil, 300),
    ('NATURAL', v_servicio, v_sedan, v_stek, 500),
    ('NATURAL', v_servicio, v_sedan, v_llumar, 550),
    ('NATURAL', v_servicio, v_sedan, v_3m, 850),

    ('NATURAL', v_servicio, v_suv, v_nexfil, 450),
    ('NATURAL', v_servicio, v_suv, v_stek, 600),
    ('NATURAL', v_servicio, v_suv, v_llumar, 750),
    ('NATURAL', v_servicio, v_suv, v_3m, 1050),

    ('NATURAL', v_servicio, v_pickup, v_nexfil, 600),
    ('NATURAL', v_servicio, v_pickup, v_stek, 700),
    ('NATURAL', v_servicio, v_pickup, v_llumar, 900),
    ('NATURAL', v_servicio, v_pickup, v_3m, 1450)
  on conflict do nothing;

  -- Ford Pickup: solo Llumar y 3M
  insert into public.tarifas(tipo_cliente, servicio_id, categoria_vehiculo_id, tipo_vehiculo_especial_id, marca_lamina_id, precio)
  values
    ('CONCESIONARIO', v_servicio, v_pickup, v_ford, v_llumar, 1500),
    ('CONCESIONARIO', v_servicio, v_pickup, v_ford, v_3m, 1800),
    ('NATURAL', v_servicio, v_pickup, v_ford, v_llumar, 1450),
    ('NATURAL', v_servicio, v_pickup, v_ford, v_3m, 1750)
  on conflict do nothing;

  -- Suburban: solo Llumar y 3M
  insert into public.tarifas(tipo_cliente, servicio_id, categoria_vehiculo_id, tipo_vehiculo_especial_id, marca_lamina_id, precio)
  values
    ('CONCESIONARIO', v_servicio, v_pickup, v_suburban, v_llumar, 1700),
    ('CONCESIONARIO', v_servicio, v_pickup, v_suburban, v_3m, 2000),
    ('NATURAL', v_servicio, v_pickup, v_suburban, v_llumar, 1650),
    ('NATURAL', v_servicio, v_pickup, v_suburban, v_3m, 1950)
  on conflict do nothing;
END $$;

-- =========================
-- 20. INVENTARIO INICIAL DEMO
-- Se registra 1 rollo completo por marca + tonalidad.
-- Ajusta estos valores al stock físico real antes de producción.
-- =========================
insert into public.inventario(marca_lamina_id, tonalidad_id, metros_actuales, metros_minimos)
select
  m.id,
  t.id,
  c.metros_por_rollo,
  5.00
from public.marcas_lamina m
join public.calidades_lamina c on c.id = m.calidad_lamina_id
cross join public.tonalidades t
where m.activo = true and t.activo = true
on conflict (marca_lamina_id, tonalidad_id) do nothing;

-- =========================
-- 21. PREGUNTAS Y OPCIONES RÁPIDAS
-- 8 principales + 1 complementaria/condicional sobre visibilidad.
-- =========================
insert into public.preguntas_cita(codigo, texto, orden, requerido, condicional)
values
  ('SERVICIO_DESEADO', '¿Qué servicio deseas realizar?', 1, true, false),
  ('OBJETIVO_POLARIZADO', '¿Qué buscas principalmente con el polarizado?', 2, true, false),
  ('NIVEL_PRIVACIDAD', '¿Qué nivel de privacidad prefieres?', 3, true, false),
  ('CONDUCCION_NOCTURNA', '¿Conduces frecuentemente de noche?', 4, true, false),
  ('IMPORTANCIA_VISIBILIDAD', '¿Qué tan importante es para ti mantener una buena visibilidad hacia el exterior?', 5, true, false),
  ('PROTECCION_CALOR', '¿Qué nivel de protección contra el calor buscas?', 6, true, false),
  ('PRESUPUESTO', '¿Qué rango de presupuesto tienes pensado?', 7, true, false),
  ('LAMINA_EXISTENTE', '¿Tu vehículo ya tiene una lámina instalada?', 8, true, false),
  ('DIFICULTAD_POCA_LUZ', '¿Tienes dificultad para ver con poca iluminación?', 9, false, true)
on conflict (codigo) do update set
  texto = excluded.texto,
  orden = excluded.orden,
  requerido = excluded.requerido,
  condicional = excluded.condicional,
  activo = true;

DO $$
DECLARE
  q smallint;
BEGIN
  -- 1
  select id into q from public.preguntas_cita where codigo = 'SERVICIO_DESEADO';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'POLARIZADO_COMPLETO','Polarizado completo',1),
    (q,'CAMBIAR_POLARIZADO','Cambiar polarizado actual',2),
    (q,'RETIRAR_LAMINA','Retirar lámina',3),
    (q,'NO_SEGURO','No estoy seguro',4)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 2
  select id into q from public.preguntas_cita where codigo = 'OBJETIVO_POLARIZADO';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'PRIVACIDAD','Más privacidad',1),
    (q,'CALOR','Reducir calor',2),
    (q,'UV','Protección solar / UV',3),
    (q,'ESTETICA','Mejor apariencia',4),
    (q,'EQUILIBRIO','Equilibrio',5)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 3
  select id into q from public.preguntas_cita where codigo = 'NIVEL_PRIVACIDAD';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'BAJA','Baja',1),(q,'MEDIA','Media',2),(q,'ALTA','Alta',3),(q,'MAXIMA','Máxima',4)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 4
  select id into q from public.preguntas_cita where codigo = 'CONDUCCION_NOCTURNA';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'CASI_NUNCA','Casi nunca',1),(q,'A_VECES','A veces',2),(q,'FRECUENTEMENTE','Frecuentemente',3)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 5
  select id into q from public.preguntas_cita where codigo = 'IMPORTANCIA_VISIBILIDAD';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'MUY_IMPORTANTE','Muy importante',1),(q,'IMPORTANTE','Importante',2),(q,'INDIFERENTE','Me es indiferente',3)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 6
  select id into q from public.preguntas_cita where codigo = 'PROTECCION_CALOR';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'BASICO','Básico',1),(q,'MEDIO','Medio',2),(q,'ALTO','Alto',3)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 7
  select id into q from public.preguntas_cita where codigo = 'PRESUPUESTO';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'ECONOMICO','Económico',1),(q,'INTERMEDIO','Intermedio',2),(q,'PREMIUM','Premium',3),(q,'COMPARAR','Quiero comparar',4)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- 8
  select id into q from public.preguntas_cita where codigo = 'LAMINA_EXISTENTE';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'NO','No',1),(q,'CONSERVAR','Sí, quiero conservarla',2),(q,'REEMPLAZAR','Sí, quiero reemplazarla',3),(q,'NO_SEGURO','No estoy seguro',4)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;

  -- Complementaria
  select id into q from public.preguntas_cita where codigo = 'DIFICULTAD_POCA_LUZ';
  insert into public.opciones_pregunta(pregunta_id,codigo,texto,orden) values
    (q,'SI','Sí',1),(q,'NO','No',2),(q,'PREFIERO_NO_INDICAR','Prefiero no indicarlo',3)
  on conflict (pregunta_id,codigo) do update set texto=excluded.texto, orden=excluded.orden, activo=true;
END $$;

-- =========================
-- 22. DATOS DEMO OPERATIVOS
-- Sirven para probar listados, búsquedas, cotización y OT.
-- =========================
DO $$
DECLARE
  v_cliente uuid;
  v_cita uuid;
  v_cot uuid;
  v_servicio uuid;
  v_sedan smallint;
  v_llumar smallint;
  v_t50 smallint;
  v_precio numeric;
  v_concesionario uuid;
  v_pickup smallint;
  v_3m smallint;
  v_t35 smallint;
  v_ford smallint;
BEGIN
  insert into public.clientes(nombres, apellidos, dni, telefono, correo)
  values ('Cliente', 'Demo', '70000001', '999111222', 'cliente.demo@example.com')
  on conflict (dni) do update set telefono = excluded.telefono, correo = excluded.correo, activo = true
  returning id into v_cliente;

  if v_cliente is null then
    select id into v_cliente from public.clientes where dni = '70000001';
  end if;

  select id into v_servicio from public.servicios where nombre = 'Polarizado completo';
  select id into v_sedan from public.categorias_vehiculo where codigo = 'SEDAN';
  select id into v_llumar from public.marcas_lamina where nombre = 'Llumar';
  select id into v_t50 from public.tonalidades where porcentaje = 50;

  select public.fn_calcular_precio('NATURAL', v_servicio, v_sedan, v_llumar, null)
  into v_precio;

  if not exists (select 1 from public.citas where cliente_id = v_cliente and fecha = current_date + 3) then
    insert into public.citas(
      codigo, cliente_id, servicio_id, fecha, hora, lugar_servicio,
      categoria_vehiculo_id, marca_vehiculo, modelo_vehiculo, anio_vehiculo,
      placa, estado
    ) values (
      '', v_cliente, v_servicio, current_date + 3, '10:00', 'LOCAL',
      v_sedan, 'Toyota', 'Corolla', 2024,
      'DEMO-01', 'RESERVADA'
    ) returning id into v_cita;
  else
    select id into v_cita from public.citas where cliente_id = v_cliente and fecha = current_date + 3 limit 1;
  end if;

  if not exists (select 1 from public.cotizaciones where cita_id = v_cita) then
    insert into public.cotizaciones(
      codigo, cita_id, cliente_id, servicio_id, categoria_vehiculo_id,
      marca_lamina_id, tonalidad_id, monto, estado
    ) values (
      '', v_cita, v_cliente, v_servicio, v_sedan,
      v_llumar, v_t50, v_precio, 'PRELIMINAR'
    ) returning id into v_cot;
  else
    select id into v_cot from public.cotizaciones where cita_id = v_cita limit 1;
  end if;

  if not exists (select 1 from public.ordenes_trabajo where cita_id = v_cita) then
    insert into public.ordenes_trabajo(
      codigo, tipo_ot, cliente_id, cita_id, cotizacion_id, servicio_id,
      categoria_vehiculo_id, marca_vehiculo, modelo_vehiculo, anio_vehiculo,
      placa, marca_lamina_id, tonalidad_id, estado, precio_final
    ) values (
      '', 'CLIENTE_NATURAL', v_cliente, v_cita, v_cot, v_servicio,
      v_sedan, 'Toyota', 'Corolla', 2024,
      'DEMO-01', v_llumar, v_t50, 'PENDIENTE_VALIDACION', v_precio
    );
  end if;

  -- OT demo de concesionario
  select id into v_concesionario from public.concesionarios where nombre = 'Autonort';
  select id into v_pickup from public.categorias_vehiculo where codigo = 'CAMIONETA_PICKUP';
  select id into v_3m from public.marcas_lamina where nombre = '3M';
  select id into v_t35 from public.tonalidades where porcentaje = 35;
  select id into v_ford from public.tipos_vehiculo_especial where codigo = 'FORD_PICKUP';

  if not exists (select 1 from public.ordenes_trabajo where tipo_ot='CONCESIONARIO' and placa='DEMO-C1') then
    insert into public.ordenes_trabajo(
      codigo, tipo_ot, concesionario_id, servicio_id, categoria_vehiculo_id, tipo_vehiculo_especial_id,
      marca_vehiculo, modelo_vehiculo, placa, marca_lamina_id, tonalidad_id,
      asesor_concesionario, referencia_documento_concesionario,
      estado, fecha_inicio, precio_final
    ) values (
      '', 'CONCESIONARIO', v_concesionario, v_servicio, v_pickup, v_ford,
      'Ford', 'Pickup Demo', 'DEMO-C1', v_3m, v_t35,
      'Asesor Demo', 'FICHA-DEMO-001',
      'EN_PROCESO', now(), 1800
    );
  end if;
END $$;

-- Notificaciones demo
insert into public.notificaciones(tipo, titulo, mensaje)
select 'INFO', 'Base de datos lista', 'Los catálogos, tarifas, inventario demo y registros de prueba fueron cargados correctamente.'
where not exists (
  select 1 from public.notificaciones where titulo = 'Base de datos lista'
);

commit;

-- =============================================================
-- CONSULTAS RÁPIDAS DE PRUEBA
-- Ejecuta por separado después del script si deseas verificar.
-- =============================================================
-- select * from public.clientes order by creado_en desc;
-- select * from public.concesionarios order by nombre;
-- select * from public.v_tarifario order by tipo_cliente, categoria_vehiculo, marca_lamina;
-- select * from public.v_inventario order by calidad, marca, tonalidad_porcentaje desc;
-- select * from public.citas order by fecha, hora;
-- select * from public.cotizaciones order by creado_en desc;
-- select * from public.v_ordenes_trabajo order by creado_en desc;

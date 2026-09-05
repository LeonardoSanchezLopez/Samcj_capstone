-- =============================================================
-- SAMCJ S.A.C. - Actualización operativa 08/10/2026
-- Ejecutar UNA vez en Supabase > SQL Editor sobre la BD existente.
-- =============================================================
begin;

-- Agenda: citas cada 30 min; servicio local ~120 min y domicilio ~180 min.
alter table public.configuracion_empresa
  add column if not exists intervalo_citas_minutos integer not null default 30,
  add column if not exists duracion_domicilio_minutos integer not null default 180;
update public.configuracion_empresa
set intervalo_citas_minutos=30,
    duracion_servicio_minutos=120,
    duracion_domicilio_minutos=180,
    max_servicios_dia=5,
    turno_manana_inicio='08:00', turno_manana_fin='13:00',
    turno_tarde_inicio='14:00', turno_tarde_fin='18:00'
where id=1;

-- Pregunta 2 con selección múltiple.
alter table public.preguntas_cita add column if not exists seleccion_multiple boolean not null default false;
update public.preguntas_cita set seleccion_multiple=(codigo='OBJETIVO_POLARIZADO');
alter table public.respuestas_cita drop constraint if exists respuestas_cita_cita_id_pregunta_id_key;
create unique index if not exists ux_respuesta_cita_opcion
  on public.respuestas_cita(cita_id,pregunta_id,opcion_id);

-- Ya no existe el servicio Retiro de lámina ni su opción pública.
update public.servicios set activo=false where lower(nombre)=lower('Retiro de lámina');
update public.opciones_pregunta set activo=false
where codigo='RETIRAR_LAMINA';

-- Concesionarios definitivos. B Motors fue un nombre cargado por error.
-- Si tenía registros demo/históricos, se reasignan a Derco Center antes de eliminarlo.
insert into public.concesionarios(nombre,activo) values ('Derco Center',true)
on conflict(nombre) do update set activo=true;

do $$
declare
  v_b uuid;
  v_derco uuid;
begin
  select id into v_b from public.concesionarios where nombre='B Motors' limit 1;
  select id into v_derco from public.concesionarios where nombre='Derco Center' limit 1;
  if v_b is not null and v_derco is not null then
    update public.ordenes_trabajo set concesionario_id=v_derco where concesionario_id=v_b;
    delete from public.concesionarios where id=v_b;
  end if;
end $$;

update public.concesionarios set activo=true where nombre in ('Automotores Inka','Autonort','Intermotors','Derco Center');

-- Marcas de vehículo habilitadas por concesionario.
create table if not exists public.concesionario_marcas (
  id bigserial primary key,
  concesionario_id uuid not null references public.concesionarios(id) on delete cascade,
  marca_vehiculo varchar(80) not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique(concesionario_id,marca_vehiculo)
);

insert into public.concesionario_marcas(concesionario_id,marca_vehiculo)
select c.id,m.marca from public.concesionarios c
join (values
 ('Automotores Inka','Mazda'),('Automotores Inka','Renault'),('Automotores Inka','Subaru'),('Automotores Inka','Hyundai'),('Automotores Inka','JAC'),('Automotores Inka','DFSK'),('Automotores Inka','Great Wall'),('Automotores Inka','BYD'),('Automotores Inka','Changan'),('Automotores Inka','Fuso'),('Automotores Inka','Suzuki'),
 ('Autonort','Toyota'),
 ('Derco Center','Suzuki'),('Derco Center','Changan'),('Derco Center','Mazda'),('Derco Center','Renault'),('Derco Center','JAC'),('Derco Center','GWM'),('Derco Center','Haval'),('Derco Center','Citroën'),
 ('Intermotors','Kia'),('Intermotors','Mitsubishi'),('Intermotors','Chery'),('Intermotors','MG'),('Intermotors','Peugeot'),('Intermotors','Jetour')
) as m(concesionario,marca) on c.nombre=m.concesionario
on conflict(concesionario_id,marca_vehiculo) do update set activo=true;

-- OT: serie interna, paralelismo de concesionarios y responsables reales.
alter table public.ordenes_trabajo
  add column if not exists serie_interna varchar(8),
  add column if not exists atencion_paralela boolean not null default false,
  add column if not exists realizado_por text[] not null default '{}';

update public.ordenes_trabajo
set serie_interna = upper('LEG'||substr(md5(id::text),1,5))
where tipo_ot='CONCESIONARIO' and (serie_interna is null or serie_interna='');

alter table public.ordenes_trabajo drop constraint if exists chk_ot_serie_interna;
alter table public.ordenes_trabajo add constraint chk_ot_serie_interna check (
  tipo_ot <> 'CONCESIONARIO'
  or (serie_interna is not null and serie_interna ~ '^[A-Za-z0-9]{6,8}$')
);

-- Agenda unificada y protegida en BD. Se usa un advisory lock por fecha para evitar dobles reservas concurrentes.
create or replace function public.fn_validar_cupo_cita()
returns trigger
language plpgsql
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_duracion integer;
  v_total integer;
  v_inicio timestamp;
  v_fin timestamp;
begin
  if new.activo = true and new.estado in ('RESERVADA','CONFIRMADA','ATENDIDA') then
    select * into v_cfg from public.configuracion_empresa where id=1;
    perform pg_advisory_xact_lock(hashtext(new.fecha::text));

    v_duracion := case when new.lugar_servicio='DOMICILIO'
      then coalesce(v_cfg.duracion_domicilio_minutos,180)
      else v_cfg.duracion_servicio_minutos end;
    v_inicio := new.fecha + new.hora;
    v_fin := v_inicio + make_interval(mins=>v_duracion);

    if extract(minute from new.hora)::integer % v_cfg.intervalo_citas_minutos <> 0 then
      raise exception 'La hora debe respetar intervalos de % minutos', v_cfg.intervalo_citas_minutos;
    end if;

    if not (
      (new.hora >= v_cfg.turno_manana_inicio and v_fin::date=new.fecha and v_fin::time <= v_cfg.turno_manana_fin)
      or
      (new.hora >= v_cfg.turno_tarde_inicio and v_fin::date=new.fecha and v_fin::time <= v_cfg.turno_tarde_fin)
    ) then
      raise exception 'La cita debe iniciar y terminar dentro de un turno de trabajo';
    end if;

    select
      (select count(*) from public.citas c
        where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
          and (tg_op='INSERT' or c.id<>new.id))
      +
      (select count(*) from public.ordenes_trabajo ot
        where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
          and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha)
    into v_total;

    if v_total >= v_cfg.max_servicios_dia then
      raise exception 'Se alcanzó el máximo de servicios programados para la fecha %', new.fecha;
    end if;

    if exists (
      select 1 from public.bloqueos_agenda b
      where b.fecha=new.fecha and b.activo=true and (
        b.todo_el_dia=true or (
          b.hora_inicio is not null and b.hora_fin is not null
          and v_inicio < (new.fecha + b.hora_fin)
          and (new.fecha + b.hora_inicio) < v_fin
        )
      )
    ) then
      raise exception 'La fecha/hora seleccionada está bloqueada por el administrador';
    end if;

    if exists (
      select 1 from public.citas c
      where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
        and (tg_op='INSERT' or c.id<>new.id)
        and v_inicio < (c.fecha + c.hora + make_interval(mins=>case when c.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end))
        and (c.fecha + c.hora) < v_fin
    ) then
      raise exception 'Ese horario se cruza con otra cita';
    end if;

    if exists (
      select 1 from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha
        and v_inicio < ((ot.fecha_inicio at time zone v_cfg.zona_horaria) + make_interval(mins=>case when ot.atencion_paralela then 180 else v_cfg.duracion_servicio_minutos end))
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria) < v_fin
    ) then
      raise exception 'Ese horario está ocupado por una OT de concesionario';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_cupo_cita on public.citas;
create trigger trg_validar_cupo_cita
before insert or update of fecha,hora,lugar_servicio,estado,activo on public.citas
for each row execute function public.fn_validar_cupo_cita();

create or replace function public.fn_validar_agenda_ot_concesionario()
returns trigger
language plpgsql
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_fecha date;
  v_inicio timestamp;
  v_fin timestamp;
  v_duracion integer;
  v_total integer;
  v_partner integer;
begin
  if new.tipo_ot='CONCESIONARIO' and new.activo=true and new.estado in ('EN_PROCESO','FINALIZADA') then
    if new.fecha_inicio is null then raise exception 'Selecciona fecha y hora de inicio'; end if;
    select * into v_cfg from public.configuracion_empresa where id=1;
    v_inicio := new.fecha_inicio at time zone v_cfg.zona_horaria;
    v_fecha := v_inicio::date;
    perform pg_advisory_xact_lock(hashtext(v_fecha::text));
    v_duracion := case when new.atencion_paralela then 180 else v_cfg.duracion_servicio_minutos end;
    v_fin := v_inicio + make_interval(mins=>v_duracion);

    if extract(minute from v_inicio)::integer % v_cfg.intervalo_citas_minutos <> 0 then
      raise exception 'La hora debe respetar intervalos de % minutos', v_cfg.intervalo_citas_minutos;
    end if;

    if not (
      (v_inicio::time >= v_cfg.turno_manana_inicio and v_fin::date=v_fecha and v_fin::time <= v_cfg.turno_manana_fin)
      or
      (v_inicio::time >= v_cfg.turno_tarde_inicio and v_fin::date=v_fecha and v_fin::time <= v_cfg.turno_tarde_fin)
    ) then
      raise exception 'La OT debe iniciar y terminar dentro de un turno de trabajo';
    end if;

    select
      (select count(*) from public.citas c where c.fecha=v_fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA'))
      +
      (select count(*) from public.ordenes_trabajo ot
        where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
          and ot.id<>new.id and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=v_fecha)
    into v_total;
    if v_total >= v_cfg.max_servicios_dia then
      raise exception 'Se alcanzó el máximo de servicios programados para la fecha %', v_fecha;
    end if;

    if exists (
      select 1 from public.bloqueos_agenda b
      where b.fecha=v_fecha and b.activo=true and (
        b.todo_el_dia=true or (b.hora_inicio is not null and b.hora_fin is not null
          and v_inicio < (v_fecha+b.hora_fin) and (v_fecha+b.hora_inicio) < v_fin)
      )
    ) then raise exception 'Ese horario está bloqueado en la agenda'; end if;

    if exists (
      select 1 from public.citas c
      where c.fecha=v_fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
        and v_inicio < (c.fecha+c.hora+make_interval(mins=>case when c.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end))
        and (c.fecha+c.hora) < v_fin
    ) then raise exception 'La OT se cruza con una cita de cliente particular'; end if;

    if exists (
      select 1 from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
        and ot.id<>new.id
        and v_inicio < ((ot.fecha_inicio at time zone v_cfg.zona_horaria)+make_interval(mins=>case when ot.atencion_paralela then 180 else v_cfg.duracion_servicio_minutos end))
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria) < v_fin
        and not (new.atencion_paralela and ot.atencion_paralela and (ot.fecha_inicio at time zone v_cfg.zona_horaria)=v_inicio)
    ) then raise exception 'La OT se cruza con otro servicio programado'; end if;

    if new.atencion_paralela then
      select count(*) into v_partner from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
        and ot.id<>new.id and ot.atencion_paralela=true
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)=v_inicio;
      if v_partner >= 1 then
        -- Ya existe un vehículo paralelo: el nuevo será el segundo. Más de dos no está permitido.
        if v_partner + 1 > 2 then raise exception 'Solo se permiten dos vehículos en atención paralela'; end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_agenda_ot_concesionario on public.ordenes_trabajo;
create trigger trg_validar_agenda_ot_concesionario
before insert or update of fecha_inicio,atencion_paralela,estado,activo on public.ordenes_trabajo
for each row execute function public.fn_validar_agenda_ot_concesionario();

-- Quitar campos ya descartados por la empresa.
drop view if exists public.v_ordenes_trabajo;
alter table public.citas drop column if exists numero_direccion;
alter table public.citas drop column if exists placa;
alter table public.ordenes_trabajo drop column if exists placa;
alter table public.ordenes_trabajo drop column if exists referencia_documento_concesionario;

create or replace function public.fn_cita_direccion_local()
returns trigger language plpgsql as $$
declare v_direccion text;
begin
  if new.lugar_servicio='LOCAL' then
    select direccion_local into v_direccion from public.configuracion_empresa where id=1;
    new.direccion_local_snapshot:=v_direccion;
    new.distrito:=null;
    new.calle_avenida:=null;
    new.referencia:=null;
  else
    new.direccion_local_snapshot:=null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_cita_direccion_local on public.citas;
create trigger trg_cita_direccion_local before insert or update on public.citas
for each row execute function public.fn_cita_direccion_local();

create or replace view public.v_ordenes_trabajo
with (security_invoker=true) as
select
  ot.id,ot.codigo,ot.tipo_ot,
  coalesce(c.nombres||' '||c.apellidos,con.nombre) as cliente_o_concesionario,
  c.dni,cv.nombre as categoria_vehiculo,tve.nombre as tipo_especial,
  ot.marca_vehiculo,ot.modelo_vehiculo,ot.anio_vehiculo,ot.serie_interna,ot.atencion_paralela,
  ml.nombre as marca_lamina,t.porcentaje as tonalidad_porcentaje,t.nombre as tonalidad,
  ot.estado,ot.fecha_inicio,ot.fecha_fin,ot.precio_final,ot.metraje_estimado,
  ot.stock_descontado,ot.realizado_por,ot.activo,ot.creado_en
from public.ordenes_trabajo ot
left join public.clientes c on c.id=ot.cliente_id
left join public.concesionarios con on con.id=ot.concesionario_id
join public.categorias_vehiculo cv on cv.id=ot.categoria_vehiculo_id
left join public.tipos_vehiculo_especial tve on tve.id=ot.tipo_vehiculo_especial_id
join public.marcas_lamina ml on ml.id=ot.marca_lamina_id
join public.tonalidades t on t.id=ot.tonalidad_id;

-- DNI de clientes: exactamente 8 dígitos para nuevos/actualizados.
alter table public.clientes drop constraint if exists chk_clientes_dni_8;
alter table public.clientes add constraint chk_clientes_dni_8 check (dni ~ '^[0-9]{8}$') not valid;

-- Accesos de backend service_role.
alter table public.concesionario_marcas enable row level security;
revoke all on table public.concesionario_marcas from anon, authenticated;
grant select,insert,update,delete on table public.concesionario_marcas to service_role;
grant select on table public.v_ordenes_trabajo to service_role;

create index if not exists idx_ot_serie_interna on public.ordenes_trabajo(serie_interna);
create index if not exists idx_concesionario_marcas_concesionario on public.concesionario_marcas(concesionario_id);

-- Ingreso de rollos atómico: suma el nuevo metraje al remanente y registra el movimiento.
create or replace function public.fn_agregar_rollos_inventario(
  p_inventario_id uuid,
  p_cantidad integer,
  p_creado_por uuid default null
)
returns table (
  inventario_id uuid,
  cantidad_rollos integer,
  metros_por_rollo numeric,
  metros_agregados numeric,
  stock_anterior numeric,
  stock_nuevo numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual numeric(8,2);
  v_por_rollo numeric(8,2);
  v_agregado numeric(10,2);
  v_nuevo numeric(10,2);
begin
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 100 then
    raise exception 'Cantidad de rollos inválida';
  end if;

  select i.metros_actuales, cl.metros_por_rollo
    into v_actual, v_por_rollo
  from public.inventario i
  join public.marcas_lamina ml on ml.id = i.marca_lamina_id
  join public.calidades_lamina cl on cl.id = ml.calidad_lamina_id
  where i.id = p_inventario_id and i.activo = true
  for update of i;

  if v_actual is null or v_por_rollo is null then
    raise exception 'Registro de inventario no encontrado o sin metraje por rollo';
  end if;

  v_agregado := p_cantidad * v_por_rollo;
  v_nuevo := v_actual + v_agregado;

  update public.inventario
  set metros_actuales = v_nuevo,
      actualizado_en = now()
  where id = p_inventario_id;

  insert into public.movimientos_inventario(
    inventario_id,tipo_movimiento,metros,metros_antes,metros_despues,motivo,creado_por
  ) values (
    p_inventario_id,'AJUSTE_POSITIVO',v_agregado,v_actual,v_nuevo,
    'Ingreso de ' || p_cantidad || ' rollo(s) de ' || v_por_rollo || ' m',p_creado_por
  );

  return query select p_inventario_id,p_cantidad,v_por_rollo,v_agregado,v_actual,v_nuevo;
end;
$$;

revoke all on function public.fn_agregar_rollos_inventario(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.fn_agregar_rollos_inventario(uuid,integer,uuid) to service_role;

commit;

-- =============================================================
-- SAMCJ S.A.C. - V5: lotes de concesionario, reserva atómica,
-- idempotencia y protección de fechas pasadas.
-- Este bloque es idempotente y puede ejecutarse después de V4.
-- =============================================================
begin;

-- -------------------------------------------------------------
-- 1) Reserva pública idempotente y transaccional
-- -------------------------------------------------------------
alter table public.citas
  add column if not exists idempotency_key uuid;
create unique index if not exists ux_citas_idempotency_key
  on public.citas(idempotency_key)
  where idempotency_key is not null;

-- -------------------------------------------------------------
-- 2) Bloques/lotes de atención de concesionarios
-- -------------------------------------------------------------
create table if not exists public.bloques_atencion_concesionario (
  id uuid primary key default gen_random_uuid(),
  concesionario_id uuid not null references public.concesionarios(id),
  fecha date not null,
  hora_inicio time without time zone not null,
  hora_fin time without time zone not null,
  cantidad_vehiculos smallint not null check (cantidad_vehiculos between 2 and 5),
  estado varchar(20) not null default 'COMPLETO' check (estado in ('ABIERTO','COMPLETO','CANCELADO')),
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint chk_bloque_horas check (hora_fin > hora_inicio)
);

alter table public.ordenes_trabajo
  add column if not exists bloque_atencion_id uuid references public.bloques_atencion_concesionario(id);

create index if not exists idx_bloques_fecha
  on public.bloques_atencion_concesionario(fecha,activo);
create index if not exists idx_ot_bloque_atencion
  on public.ordenes_trabajo(bloque_atencion_id);

-- El antiguo checkbox de paralelismo deja de gobernar la agenda.
update public.ordenes_trabajo set atencion_paralela=false where atencion_paralela=true;

-- Mantener actualizado_en en bloques.
drop trigger if exists trg_bloques_atencion_actualizado_en on public.bloques_atencion_concesionario;
create trigger trg_bloques_atencion_actualizado_en
before update on public.bloques_atencion_concesionario
for each row execute function public.fn_set_actualizado_en();

-- -------------------------------------------------------------
-- 3) Validar bloque de concesionario y reservar capacidad real
-- -------------------------------------------------------------
create or replace function public.fn_validar_bloque_concesionario()
returns trigger
language plpgsql
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_hoy date;
  v_inicio timestamp;
  v_fin timestamp;
  v_total integer;
begin
  if new.activo=true and new.estado<>'CANCELADO' then
    select * into v_cfg from public.configuracion_empresa where id=1;
    v_hoy := (now() at time zone v_cfg.zona_horaria)::date;
    if tg_op='INSERT' then
      if new.fecha < v_hoy then raise exception 'No se puede programar un lote en una fecha pasada'; end if;
    elsif new.fecha is distinct from old.fecha and new.fecha < v_hoy then
      raise exception 'No se puede programar un lote en una fecha pasada';
    end if;

    if extract(minute from new.hora_inicio)::integer % coalesce(v_cfg.intervalo_citas_minutos,30) <> 0
       or extract(minute from new.hora_fin)::integer % coalesce(v_cfg.intervalo_citas_minutos,30) <> 0 then
      raise exception 'El inicio y fin deben respetar intervalos de % minutos', coalesce(v_cfg.intervalo_citas_minutos,30);
    end if;

    if new.hora_inicio < v_cfg.turno_manana_inicio or new.hora_fin > v_cfg.turno_tarde_fin then
      raise exception 'El bloque debe mantenerse dentro del horario de trabajo';
    end if;

    v_inicio := new.fecha + new.hora_inicio;
    v_fin := new.fecha + new.hora_fin;
    perform pg_advisory_xact_lock(hashtext(new.fecha::text));

    -- El total diario cuenta citas + OT individuales + vehículos reservados por otros lotes.
    select
      (select count(*) from public.citas c
        where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA'))
      +
      (select count(*) from public.ordenes_trabajo ot
        where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
          and ot.bloque_atencion_id is null
          and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha)
      +
      (select coalesce(sum(b.cantidad_vehiculos),0) from public.bloques_atencion_concesionario b
        where b.fecha=new.fecha and b.activo=true and b.estado<>'CANCELADO'
          and (tg_op='INSERT' or b.id<>new.id))
    into v_total;

    if v_total + new.cantidad_vehiculos > v_cfg.max_servicios_dia then
      raise exception 'El lote supera la capacidad máxima de % vehículos para ese día', v_cfg.max_servicios_dia;
    end if;

    if exists (
      select 1 from public.bloqueos_agenda ba
      where ba.fecha=new.fecha and ba.activo=true and (
        ba.todo_el_dia=true or (
          ba.hora_inicio is not null and ba.hora_fin is not null
          and v_inicio < (new.fecha+ba.hora_fin)
          and (new.fecha+ba.hora_inicio) < v_fin
        )
      )
    ) then raise exception 'El bloque se cruza con un bloqueo de agenda'; end if;

    if exists (
      select 1 from public.citas c
      where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
        and v_inicio < (c.fecha+c.hora+make_interval(mins=>case when c.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end))
        and (c.fecha+c.hora) < v_fin
    ) then raise exception 'El lote se cruza con una cita de cliente particular'; end if;

    if exists (
      select 1 from public.bloques_atencion_concesionario b
      where b.activo=true and b.estado<>'CANCELADO' and b.fecha=new.fecha
        and (tg_op='INSERT' or b.id<>new.id)
        and v_inicio < (b.fecha+b.hora_fin)
        and (b.fecha+b.hora_inicio) < v_fin
    ) then raise exception 'El lote se cruza con otro lote de concesionario'; end if;

    if exists (
      select 1 from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
        and ot.bloque_atencion_id is null
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha
        and v_inicio < ((ot.fecha_inicio at time zone v_cfg.zona_horaria)+make_interval(mins=>v_cfg.duracion_servicio_minutos))
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria) < v_fin
    ) then raise exception 'El lote se cruza con una OT individual de concesionario'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_bloque_concesionario on public.bloques_atencion_concesionario;
create trigger trg_validar_bloque_concesionario
before insert or update of fecha,hora_inicio,hora_fin,cantidad_vehiculos,estado,activo
on public.bloques_atencion_concesionario
for each row execute function public.fn_validar_bloque_concesionario();

-- -------------------------------------------------------------
-- 4) Nueva validación de agenda de OT concesionario
--    - Individual: ocupa ~2 h.
--    - En lote: la capacidad/intervalo ya la reserva el bloque.
-- -------------------------------------------------------------
create or replace function public.fn_validar_agenda_ot_concesionario()
returns trigger
language plpgsql
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_bloque public.bloques_atencion_concesionario%rowtype;
  v_fecha date;
  v_hoy date;
  v_inicio timestamp;
  v_fin timestamp;
  v_total integer;
  v_en_bloque integer;
begin
  if new.tipo_ot='CONCESIONARIO' and new.activo=true and new.estado in ('EN_PROCESO','FINALIZADA') then
    if new.fecha_inicio is null then raise exception 'Selecciona fecha y hora de inicio'; end if;
    select * into v_cfg from public.configuracion_empresa where id=1;
    v_inicio := new.fecha_inicio at time zone v_cfg.zona_horaria;
    v_fecha := v_inicio::date;
    v_hoy := (now() at time zone v_cfg.zona_horaria)::date;
    if tg_op='INSERT' then
      if v_fecha < v_hoy then raise exception 'No se puede registrar una OT en una fecha pasada'; end if;
    elsif new.fecha_inicio is distinct from old.fecha_inicio and v_fecha < v_hoy then
      raise exception 'No se puede registrar una OT en una fecha pasada';
    end if;

    if new.bloque_atencion_id is not null then
      select * into v_bloque from public.bloques_atencion_concesionario where id=new.bloque_atencion_id and activo=true and estado<>'CANCELADO';
      if v_bloque.id is null then raise exception 'El lote seleccionado no existe o está cancelado'; end if;
      if v_bloque.concesionario_id<>new.concesionario_id then raise exception 'La OT no corresponde al concesionario del lote'; end if;
      if v_bloque.fecha<>v_fecha then raise exception 'La OT debe usar la misma fecha del lote'; end if;

      select count(*) into v_en_bloque from public.ordenes_trabajo ot
      where ot.bloque_atencion_id=new.bloque_atencion_id and ot.activo=true
        and (tg_op='INSERT' or ot.id<>new.id);
      if v_en_bloque >= v_bloque.cantidad_vehiculos then
        raise exception 'Ya se registraron todos los vehículos previstos para este lote';
      end if;
      -- No se repite el control de solapamiento: lo hace el bloque.
      return new;
    end if;

    perform pg_advisory_xact_lock(hashtext(v_fecha::text));
    v_fin := v_inicio + make_interval(mins=>v_cfg.duracion_servicio_minutos);

    if extract(minute from v_inicio)::integer % coalesce(v_cfg.intervalo_citas_minutos,30) <> 0 then
      raise exception 'La hora debe respetar intervalos de % minutos', coalesce(v_cfg.intervalo_citas_minutos,30);
    end if;

    if not (
      (v_inicio::time >= v_cfg.turno_manana_inicio and v_fin::date=v_fecha and v_fin::time <= v_cfg.turno_manana_fin)
      or
      (v_inicio::time >= v_cfg.turno_tarde_inicio and v_fin::date=v_fecha and v_fin::time <= v_cfg.turno_tarde_fin)
    ) then raise exception 'La OT individual debe iniciar y terminar dentro de un turno'; end if;

    select
      (select count(*) from public.citas c where c.fecha=v_fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA'))
      +
      (select count(*) from public.ordenes_trabajo ot
        where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
          and ot.bloque_atencion_id is null and ot.id<>new.id
          and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=v_fecha)
      +
      (select coalesce(sum(b.cantidad_vehiculos),0) from public.bloques_atencion_concesionario b
        where b.fecha=v_fecha and b.activo=true and b.estado<>'CANCELADO')
    into v_total;
    if v_total >= v_cfg.max_servicios_dia then
      raise exception 'Se alcanzó el máximo de servicios programados para ese día';
    end if;

    if exists (
      select 1 from public.citas c where c.fecha=v_fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
        and v_inicio < (c.fecha+c.hora+make_interval(mins=>case when c.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end))
        and (c.fecha+c.hora) < v_fin
    ) then raise exception 'La OT se cruza con una cita de cliente particular'; end if;

    if exists (
      select 1 from public.bloques_atencion_concesionario b
      where b.fecha=v_fecha and b.activo=true and b.estado<>'CANCELADO'
        and v_inicio < (b.fecha+b.hora_fin) and (b.fecha+b.hora_inicio) < v_fin
    ) then raise exception 'La OT se cruza con un lote de concesionario'; end if;

    if exists (
      select 1 from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
        and ot.bloque_atencion_id is null and ot.id<>new.id
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=v_fecha
        and v_inicio < ((ot.fecha_inicio at time zone v_cfg.zona_horaria)+make_interval(mins=>v_cfg.duracion_servicio_minutos))
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria) < v_fin
    ) then raise exception 'La OT se cruza con otro servicio programado'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_agenda_ot_concesionario on public.ordenes_trabajo;
create trigger trg_validar_agenda_ot_concesionario
before insert or update of fecha_inicio,bloque_atencion_id,estado,activo
on public.ordenes_trabajo
for each row execute function public.fn_validar_agenda_ot_concesionario();

-- -------------------------------------------------------------
-- 5) Proteger citas contra fechas pasadas y contra lotes/OT
-- -------------------------------------------------------------
create or replace function public.fn_validar_cupo_cita()
returns trigger
language plpgsql
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_hoy date;
  v_duracion integer;
  v_total integer;
  v_inicio timestamp;
  v_fin timestamp;
begin
  if new.activo=true and new.estado in ('RESERVADA','CONFIRMADA','ATENDIDA') then
    select * into v_cfg from public.configuracion_empresa where id=1;
    v_hoy := (now() at time zone v_cfg.zona_horaria)::date;
    if tg_op='INSERT' then
      if new.fecha < v_hoy then raise exception 'No se puede reservar una fecha pasada'; end if;
    elsif new.fecha is distinct from old.fecha and new.fecha < v_hoy then
      raise exception 'No se puede reservar una fecha pasada';
    end if;

    perform pg_advisory_xact_lock(hashtext(new.fecha::text));
    v_duracion := case when new.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end;
    v_inicio := new.fecha+new.hora;
    v_fin := v_inicio+make_interval(mins=>v_duracion);

    if extract(minute from new.hora)::integer % coalesce(v_cfg.intervalo_citas_minutos,30) <> 0 then
      raise exception 'La hora debe respetar intervalos de % minutos', coalesce(v_cfg.intervalo_citas_minutos,30);
    end if;

    if not (
      (new.hora>=v_cfg.turno_manana_inicio and v_fin::date=new.fecha and v_fin::time<=v_cfg.turno_manana_fin)
      or
      (new.hora>=v_cfg.turno_tarde_inicio and v_fin::date=new.fecha and v_fin::time<=v_cfg.turno_tarde_fin)
    ) then raise exception 'La cita debe iniciar y terminar dentro de un turno de trabajo'; end if;

    select
      (select count(*) from public.citas c
        where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA') and (tg_op='INSERT' or c.id<>new.id))
      +
      (select count(*) from public.ordenes_trabajo ot
        where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA')
          and ot.bloque_atencion_id is null
          and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha)
      +
      (select coalesce(sum(b.cantidad_vehiculos),0) from public.bloques_atencion_concesionario b
        where b.fecha=new.fecha and b.activo=true and b.estado<>'CANCELADO')
    into v_total;
    if v_total>=v_cfg.max_servicios_dia then raise exception 'Se alcanzó el máximo de servicios programados para la fecha %',new.fecha; end if;

    if exists (
      select 1 from public.bloqueos_agenda b where b.fecha=new.fecha and b.activo=true and (
        b.todo_el_dia=true or (b.hora_inicio is not null and b.hora_fin is not null and v_inicio<(new.fecha+b.hora_fin) and (new.fecha+b.hora_inicio)<v_fin)
      )
    ) then raise exception 'La fecha/hora seleccionada está bloqueada por el administrador'; end if;

    if exists (
      select 1 from public.citas c where c.fecha=new.fecha and c.activo=true and c.estado in ('RESERVADA','CONFIRMADA','ATENDIDA')
        and (tg_op='INSERT' or c.id<>new.id)
        and v_inicio < (c.fecha+c.hora+make_interval(mins=>case when c.lugar_servicio='DOMICILIO' then coalesce(v_cfg.duracion_domicilio_minutos,180) else v_cfg.duracion_servicio_minutos end))
        and (c.fecha+c.hora)<v_fin
    ) then raise exception 'Ese horario se cruza con otra cita'; end if;

    if exists (
      select 1 from public.bloques_atencion_concesionario b where b.fecha=new.fecha and b.activo=true and b.estado<>'CANCELADO'
        and v_inicio<(b.fecha+b.hora_fin) and (b.fecha+b.hora_inicio)<v_fin
    ) then raise exception 'Ese horario está ocupado por un lote de concesionario'; end if;

    if exists (
      select 1 from public.ordenes_trabajo ot
      where ot.tipo_ot='CONCESIONARIO' and ot.activo=true and ot.estado in ('EN_PROCESO','FINALIZADA') and ot.bloque_atencion_id is null
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)::date=new.fecha
        and v_inicio < ((ot.fecha_inicio at time zone v_cfg.zona_horaria)+make_interval(mins=>v_cfg.duracion_servicio_minutos))
        and (ot.fecha_inicio at time zone v_cfg.zona_horaria)<v_fin
    ) then raise exception 'Ese horario está ocupado por una OT de concesionario'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_cupo_cita on public.citas;
create trigger trg_validar_cupo_cita
before insert or update of fecha,hora,lugar_servicio,estado,activo on public.citas
for each row execute function public.fn_validar_cupo_cita();

-- -------------------------------------------------------------
-- 6) Registrar lote + todas sus OT en una sola transacción
-- -------------------------------------------------------------
create or replace function public.fn_registrar_lote_concesionario(
  p_concesionario_id uuid,
  p_fecha date,
  p_hora_inicio time,
  p_hora_fin time,
  p_vehiculos jsonb,
  p_observaciones text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_bloque public.bloques_atencion_concesionario%rowtype;
  v_item jsonb;
  v_ot public.ordenes_trabajo%rowtype;
  v_precio numeric;
  v_fecha_inicio timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_vehiculos)<>'array' then raise exception 'La lista de vehículos no es válida'; end if;
  v_count:=jsonb_array_length(p_vehiculos);
  if v_count<2 or v_count>5 then raise exception 'Un lote debe contener entre 2 y 5 vehículos'; end if;
  select * into v_cfg from public.configuracion_empresa where id=1;

  insert into public.bloques_atencion_concesionario(concesionario_id,fecha,hora_inicio,hora_fin,cantidad_vehiculos,estado,observaciones)
  values(p_concesionario_id,p_fecha,p_hora_inicio,p_hora_fin,v_count,'COMPLETO',p_observaciones)
  returning * into v_bloque;

  v_fecha_inicio := (p_fecha+p_hora_inicio) at time zone v_cfg.zona_horaria;

  for v_item in select value from jsonb_array_elements(p_vehiculos) loop
    if coalesce(v_item->>'serie_interna','') !~ '^[A-Za-z0-9]{6,8}$' then raise exception 'Cada Serie Interna debe tener entre 6 y 8 letras o números'; end if;
    if not exists (
      select 1 from public.concesionario_marcas cm
      where cm.concesionario_id=p_concesionario_id and cm.activo=true and cm.marca_vehiculo=(v_item->>'marca_vehiculo')
    ) then raise exception 'La marca % no corresponde al concesionario',v_item->>'marca_vehiculo'; end if;

    select public.fn_calcular_precio(
      'CONCESIONARIO',
      (v_item->>'servicio_id')::uuid,
      (v_item->>'categoria_vehiculo_id')::smallint,
      (v_item->>'marca_lamina_id')::smallint,
      nullif(v_item->>'tipo_vehiculo_especial_id','')::smallint
    ) into v_precio;
    if v_precio is null then raise exception 'No existe tarifa configurada para uno de los vehículos del lote'; end if;

    insert into public.ordenes_trabajo(
      codigo,tipo_ot,concesionario_id,bloque_atencion_id,servicio_id,categoria_vehiculo_id,tipo_vehiculo_especial_id,
      marca_vehiculo,modelo_vehiculo,serie_interna,marca_lamina_id,tonalidad_id,asesor_concesionario,
      estado,fecha_inicio,precio_final,observaciones,atencion_paralela
    ) values (
      '','CONCESIONARIO',p_concesionario_id,v_bloque.id,(v_item->>'servicio_id')::uuid,(v_item->>'categoria_vehiculo_id')::smallint,
      nullif(v_item->>'tipo_vehiculo_especial_id','')::smallint,v_item->>'marca_vehiculo',nullif(v_item->>'modelo_vehiculo',''),upper(v_item->>'serie_interna'),
      (v_item->>'marca_lamina_id')::smallint,(v_item->>'tonalidad_id')::smallint,nullif(v_item->>'asesor_concesionario',''),
      'EN_PROCESO',v_fecha_inicio,v_precio,nullif(v_item->>'observaciones',''),false
    ) returning * into v_ot;
    v_result := v_result || jsonb_build_array(jsonb_build_object('id',v_ot.id,'codigo',v_ot.codigo,'serie_interna',v_ot.serie_interna));
  end loop;

  return jsonb_build_object(
    'bloque',jsonb_build_object('id',v_bloque.id,'fecha',v_bloque.fecha,'hora_inicio',v_bloque.hora_inicio,'hora_fin',v_bloque.hora_fin,'cantidad_vehiculos',v_bloque.cantidad_vehiculos),
    'ordenes',v_result
  );
end;
$$;

revoke all on function public.fn_registrar_lote_concesionario(uuid,date,time,time,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_registrar_lote_concesionario(uuid,date,time,time,jsonb,text) to service_role;

-- -------------------------------------------------------------
-- 7) Registrar reserva pública completa en una sola transacción
-- -------------------------------------------------------------
create or replace function public.fn_registrar_reserva_publica(
  p_idempotency_key uuid,
  p_cliente jsonb,
  p_cita jsonb,
  p_respuestas jsonb,
  p_recomendacion jsonb,
  p_seleccion jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_cliente public.clientes%rowtype;
  v_cita public.citas%rowtype;
  v_cot public.cotizaciones%rowtype;
  v_ot public.ordenes_trabajo%rowtype;
  v_resp jsonb;
  v_monto numeric;
  v_existing uuid;
  v_base_service uuid;
begin
  if p_idempotency_key is null then raise exception 'Falta la llave de confirmación de la reserva'; end if;
  perform pg_advisory_xact_lock(hashtext(p_idempotency_key::text));

  select id into v_existing from public.citas where idempotency_key=p_idempotency_key limit 1;
  if v_existing is not null then
    select * into v_cita from public.citas where id=v_existing;
    select * into v_cot from public.cotizaciones where cita_id=v_existing order by creado_en desc limit 1;
    select * into v_ot from public.ordenes_trabajo where cita_id=v_existing order by creado_en desc limit 1;
    return jsonb_build_object('reused',true,'cita',jsonb_build_object('id',v_cita.id,'fecha',v_cita.fecha,'hora',v_cita.hora),'cotizacion',jsonb_build_object('id',v_cot.id,'monto',v_cot.monto),'orden',jsonb_build_object('id',v_ot.id));
  end if;

  insert into public.clientes(nombres,apellidos,dni,telefono,correo,activo)
  values(trim(p_cliente->>'nombres'),trim(p_cliente->>'apellidos'),p_cliente->>'dni',p_cliente->>'telefono',nullif(trim(coalesce(p_cliente->>'correo','')),''),true)
  on conflict(dni) do update set
    nombres=excluded.nombres,apellidos=excluded.apellidos,telefono=excluded.telefono,correo=excluded.correo,activo=true,actualizado_en=now()
  returning * into v_cliente;

  v_monto := public.fn_calcular_precio(
    'NATURAL',
    (p_cita->>'servicio_id')::uuid,
    (p_cita->>'categoria_vehiculo_id')::smallint,
    (p_seleccion->>'marca_lamina_id')::smallint,
    nullif(p_cita->>'tipo_vehiculo_especial_id','')::smallint
  );
  if v_monto is null then
    select id into v_base_service from public.servicios where nombre='Polarizado completo' and activo=true limit 1;
    if v_base_service is not null then
      v_monto := public.fn_calcular_precio(
        'NATURAL',v_base_service,(p_cita->>'categoria_vehiculo_id')::smallint,
        (p_seleccion->>'marca_lamina_id')::smallint,nullif(p_cita->>'tipo_vehiculo_especial_id','')::smallint
      );
    end if;
  end if;
  if v_monto is null then raise exception 'No existe una tarifa configurada para la selección realizada'; end if;

  insert into public.citas(
    codigo,idempotency_key,cliente_id,servicio_id,fecha,hora,lugar_servicio,distrito,calle_avenida,referencia,
    categoria_vehiculo_id,tipo_vehiculo_especial_id,marca_vehiculo,modelo_vehiculo,anio_vehiculo,estado,observaciones
  ) values (
    '',p_idempotency_key,v_cliente.id,(p_cita->>'servicio_id')::uuid,(p_cita->>'fecha')::date,(p_cita->>'hora')::time,(p_cita->>'lugar_servicio')::public.lugar_servicio_enum,
    nullif(p_cita->>'distrito',''),nullif(trim(coalesce(p_cita->>'calle_avenida','')),''),nullif(trim(coalesce(p_cita->>'referencia','')),''),
    (p_cita->>'categoria_vehiculo_id')::smallint,nullif(p_cita->>'tipo_vehiculo_especial_id','')::smallint,p_cita->>'marca_vehiculo',p_cita->>'modelo_vehiculo',(p_cita->>'anio_vehiculo')::smallint,
    'RESERVADA',nullif(p_cita->>'observaciones','')
  ) returning * into v_cita;

  if p_respuestas is not null and jsonb_typeof(p_respuestas)='array' then
    for v_resp in select value from jsonb_array_elements(p_respuestas) loop
      insert into public.respuestas_cita(cita_id,pregunta_id,opcion_id)
      values(v_cita.id,(v_resp->>'pregunta_id')::smallint,(v_resp->>'opcion_id')::bigint)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.recomendaciones_cita(cita_id,calidad_lamina_id,marca_lamina_id,tonalidad_id,explicacion,generado_por)
  values(v_cita.id,nullif(p_recomendacion->>'calidad_lamina_id','')::smallint,nullif(p_recomendacion->>'marca_lamina_id','')::smallint,nullif(p_recomendacion->>'tonalidad_id','')::smallint,p_recomendacion->>'explicacion','REGLAS');

  insert into public.cotizaciones(codigo,cita_id,cliente_id,servicio_id,categoria_vehiculo_id,tipo_vehiculo_especial_id,marca_lamina_id,tonalidad_id,monto,estado,observaciones)
  values('',v_cita.id,v_cliente.id,(p_cita->>'servicio_id')::uuid,(p_cita->>'categoria_vehiculo_id')::smallint,nullif(p_cita->>'tipo_vehiculo_especial_id','')::smallint,
    (p_seleccion->>'marca_lamina_id')::smallint,(p_seleccion->>'tonalidad_id')::smallint,v_monto,'PRELIMINAR','Cotización preliminar generada al confirmar la reserva web.')
  returning * into v_cot;

  insert into public.ordenes_trabajo(codigo,tipo_ot,cliente_id,cita_id,cotizacion_id,servicio_id,categoria_vehiculo_id,tipo_vehiculo_especial_id,marca_vehiculo,modelo_vehiculo,anio_vehiculo,marca_lamina_id,tonalidad_id,estado,precio_final,observaciones)
  values('', 'CLIENTE_NATURAL',v_cliente.id,v_cita.id,v_cot.id,(p_cita->>'servicio_id')::uuid,(p_cita->>'categoria_vehiculo_id')::smallint,nullif(p_cita->>'tipo_vehiculo_especial_id','')::smallint,
    p_cita->>'marca_vehiculo',p_cita->>'modelo_vehiculo',(p_cita->>'anio_vehiculo')::smallint,(p_seleccion->>'marca_lamina_id')::smallint,(p_seleccion->>'tonalidad_id')::smallint,
    'PENDIENTE_VALIDACION',v_monto,'Elección preliminar creada desde la página pública. Pendiente de asesoría y validación.')
  returning * into v_ot;

  return jsonb_build_object('reused',false,'cita',jsonb_build_object('id',v_cita.id,'fecha',v_cita.fecha,'hora',v_cita.hora),'cotizacion',jsonb_build_object('id',v_cot.id,'monto',v_cot.monto),'orden',jsonb_build_object('id',v_ot.id));
end;
$$;

revoke all on function public.fn_registrar_reserva_publica(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fn_registrar_reserva_publica(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- -------------------------------------------------------------
-- 8) Vista OT con información del lote
-- -------------------------------------------------------------
drop view if exists public.v_ordenes_trabajo;
create or replace view public.v_ordenes_trabajo
with (security_invoker=true) as
select
  ot.id,ot.codigo,ot.tipo_ot,
  coalesce(c.nombres||' '||c.apellidos,con.nombre) as cliente_o_concesionario,
  c.dni,cv.nombre as categoria_vehiculo,tve.nombre as tipo_especial,
  ot.marca_vehiculo,ot.modelo_vehiculo,ot.anio_vehiculo,ot.serie_interna,
  ot.bloque_atencion_id,
  case when ot.bloque_atencion_id is null then 'INDIVIDUAL' else 'LOTE' end as modalidad_atencion,
  bac.fecha as bloque_fecha,bac.hora_inicio as bloque_hora_inicio,bac.hora_fin as bloque_hora_fin,bac.cantidad_vehiculos as bloque_cantidad_vehiculos,
  ml.nombre as marca_lamina,t.porcentaje as tonalidad_porcentaje,t.nombre as tonalidad,
  ot.estado,ot.fecha_inicio,ot.fecha_fin,ot.precio_final,ot.metraje_estimado,
  ot.stock_descontado,ot.realizado_por,ot.activo,ot.creado_en
from public.ordenes_trabajo ot
left join public.clientes c on c.id=ot.cliente_id
left join public.concesionarios con on con.id=ot.concesionario_id
left join public.bloques_atencion_concesionario bac on bac.id=ot.bloque_atencion_id
join public.categorias_vehiculo cv on cv.id=ot.categoria_vehiculo_id
left join public.tipos_vehiculo_especial tve on tve.id=ot.tipo_vehiculo_especial_id
join public.marcas_lamina ml on ml.id=ot.marca_lamina_id
join public.tonalidades t on t.id=ot.tonalidad_id;

grant select on table public.v_ordenes_trabajo to service_role;

alter table public.bloques_atencion_concesionario enable row level security;
revoke all on table public.bloques_atencion_concesionario from anon,authenticated;
grant select,insert,update,delete on table public.bloques_atencion_concesionario to service_role;

commit;

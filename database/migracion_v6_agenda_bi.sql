-- =============================================================
-- SAMCJ S.A.C. - Migración V6
-- Ejecutar DESPUÉS de migracion_v5_completa.sql
-- Cambios de BD: cálculo real de duración para lotes de concesionario.
-- BI visual y correcciones de interfaz no requieren cambios de tablas.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1) Calcular automáticamente el fin de un lote de concesionario
-- Regla operativa validada:
--   - 2 vehículos en paralelo = ~180 min de trabajo.
--   - Si queda 1 vehículo impar = ~120 min adicionales.
--   - El descanso 13:00-14:00 no cuenta como tiempo trabajado.
--   - Máximo 5 vehículos y el bloque debe terminar hasta las 18:00.
-- -------------------------------------------------------------
create or replace function public.fn_calcular_fin_lote_concesionario(
  p_hora_inicio time,
  p_cantidad integer
)
returns time
language plpgsql
stable
set search_path=public
as $$
declare
  v_cfg public.configuracion_empresa%rowtype;
  v_actual integer;
  v_restantes integer;
  v_trabajo integer;
  v_pendiente integer;
  v_fin_segmento integer;
  v_disponible integer;
  v_toma integer;
  v_manana_inicio integer;
  v_manana_fin integer;
  v_tarde_inicio integer;
  v_tarde_fin integer;
begin
  if p_hora_inicio is null then return null; end if;
  if p_cantidad < 2 or p_cantidad > 5 then
    raise exception 'Un lote debe contener entre 2 y 5 vehículos';
  end if;

  select * into v_cfg from public.configuracion_empresa where id=1;

  v_manana_inicio := extract(hour from v_cfg.turno_manana_inicio)::integer*60 + extract(minute from v_cfg.turno_manana_inicio)::integer;
  v_manana_fin := extract(hour from v_cfg.turno_manana_fin)::integer*60 + extract(minute from v_cfg.turno_manana_fin)::integer;
  v_tarde_inicio := extract(hour from v_cfg.turno_tarde_inicio)::integer*60 + extract(minute from v_cfg.turno_tarde_inicio)::integer;
  v_tarde_fin := extract(hour from v_cfg.turno_tarde_fin)::integer*60 + extract(minute from v_cfg.turno_tarde_fin)::integer;
  v_actual := extract(hour from p_hora_inicio)::integer*60 + extract(minute from p_hora_inicio)::integer;

  if not ((v_actual>=v_manana_inicio and v_actual<v_manana_fin) or (v_actual>=v_tarde_inicio and v_actual<v_tarde_fin)) then
    return null;
  end if;

  v_restantes := p_cantidad;
  while v_restantes > 0 loop
    if v_restantes >= 2 then
      v_trabajo := 180;
      v_restantes := v_restantes - 2;
    else
      v_trabajo := 120;
      v_restantes := v_restantes - 1;
    end if;

    v_pendiente := v_trabajo;
    while v_pendiente > 0 loop
      if v_actual < v_manana_inicio then v_actual := v_manana_inicio; end if;
      if v_actual >= v_manana_fin and v_actual < v_tarde_inicio then v_actual := v_tarde_inicio; end if;
      if v_actual >= v_tarde_fin then return null; end if;

      if v_actual < v_manana_fin then
        v_fin_segmento := v_manana_fin;
      else
        v_fin_segmento := v_tarde_fin;
      end if;

      v_disponible := greatest(0,v_fin_segmento-v_actual);
      if v_disponible=0 then
        if v_fin_segmento=v_manana_fin then
          v_actual:=v_tarde_inicio;
          continue;
        else
          return null;
        end if;
      end if;

      v_toma := least(v_pendiente,v_disponible);
      v_actual := v_actual+v_toma;
      v_pendiente := v_pendiente-v_toma;

      if v_pendiente>0 and v_actual=v_manana_fin then
        v_actual:=v_tarde_inicio;
      end if;
    end loop;
  end loop;

  if v_actual>v_tarde_fin then return null; end if;
  return make_time((v_actual/60)::integer,(v_actual%60)::integer,0);
end;
$$;

revoke all on function public.fn_calcular_fin_lote_concesionario(time,integer) from public,anon,authenticated;
grant execute on function public.fn_calcular_fin_lote_concesionario(time,integer) to service_role;

-- -------------------------------------------------------------
-- 2) El bloque ya no acepta una hora fin arbitraria.
--    PostgreSQL la recalcula antes de validar solapamientos.
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
  v_fin_calculado time;
begin
  if new.activo=true and new.estado<>'CANCELADO' then
    select * into v_cfg from public.configuracion_empresa where id=1;
    v_hoy := (now() at time zone v_cfg.zona_horaria)::date;

    if tg_op='INSERT' then
      if new.fecha < v_hoy then raise exception 'No se puede programar un lote en una fecha pasada'; end if;
    elsif new.fecha is distinct from old.fecha and new.fecha < v_hoy then
      raise exception 'No se puede programar un lote en una fecha pasada';
    end if;

    if extract(minute from new.hora_inicio)::integer % coalesce(v_cfg.intervalo_citas_minutos,30) <> 0 then
      raise exception 'La hora de inicio debe respetar intervalos de % minutos', coalesce(v_cfg.intervalo_citas_minutos,30);
    end if;

    v_fin_calculado := public.fn_calcular_fin_lote_concesionario(new.hora_inicio,new.cantidad_vehiculos);
    if v_fin_calculado is null then
      raise exception 'El lote no puede completarse dentro del horario de trabajo para esa hora de inicio';
    end if;
    new.hora_fin := v_fin_calculado;

    v_inicio := new.fecha + new.hora_inicio;
    v_fin := new.fecha + new.hora_fin;
    perform pg_advisory_xact_lock(hashtext(new.fecha::text));

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
    ) then raise exception 'El lote se cruza con un bloqueo de agenda'; end if;

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

-- El trigger ya existe en V5; se recrea para asegurar que usa la función nueva.
drop trigger if exists trg_validar_bloque_concesionario on public.bloques_atencion_concesionario;
create trigger trg_validar_bloque_concesionario
before insert or update of fecha,hora_inicio,hora_fin,cantidad_vehiculos,estado,activo
on public.bloques_atencion_concesionario
for each row execute function public.fn_validar_bloque_concesionario();

-- -------------------------------------------------------------
-- 3) Registrar lote: p_hora_fin se conserva por compatibilidad,
--    pero la BD usa exclusivamente el fin calculado.
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
  v_hora_fin_calculada time;
begin
  if jsonb_typeof(p_vehiculos)<>'array' then raise exception 'La lista de vehículos no es válida'; end if;
  v_count:=jsonb_array_length(p_vehiculos);
  if v_count<2 or v_count>5 then raise exception 'Un lote debe contener entre 2 y 5 vehículos'; end if;
  select * into v_cfg from public.configuracion_empresa where id=1;

  v_hora_fin_calculada:=public.fn_calcular_fin_lote_concesionario(p_hora_inicio,v_count);
  if v_hora_fin_calculada is null then
    raise exception 'El lote no puede completarse dentro del horario laboral desde la hora seleccionada';
  end if;

  insert into public.bloques_atencion_concesionario(concesionario_id,fecha,hora_inicio,hora_fin,cantidad_vehiculos,estado,observaciones)
  values(p_concesionario_id,p_fecha,p_hora_inicio,v_hora_fin_calculada,v_count,'COMPLETO',p_observaciones)
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

commit;

-- Verificación opcional después de ejecutar:
-- select public.fn_calcular_fin_lote_concesionario('10:00',3); -- esperado 16:00
-- select public.fn_calcular_fin_lote_concesionario('08:00',4); -- esperado 15:00
-- select public.fn_calcular_fin_lote_concesionario('08:00',5); -- esperado 17:00

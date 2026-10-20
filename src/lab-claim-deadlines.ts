// Laboratorio MANTENIMIENTO 360°: cálculo informativo de plazos, sin envíos externos.
// El calendario se publica por año; si falta un año NO se calcula un vencimiento.
// Atención profesional computable: lunes a viernes 07:00–19:00, Argentina.
// Avisos externos (WhatsApp/correo) tendrán un calendario de envío independiente.
const MINUTE=60_000;
const HOUR=60*MINUTE;
const DAY=24*HOUR;
const ARG_OFFSET=3*HOUR; // Argentina, UTC-03:00 durante el calendario 2026.

// Feriados nacionales de 2026 y días turísticos no laborables incluidos para
// no acortar el tiempo de respuesta. Verificar y actualizar por año.
// Calendario piloto de Provincia de Buenos Aires; incluye el feriado local
// de 11/11/2026. En producción será configurable por jurisdicción.
// https://www.argentina.gob.ar/feriados
// https://www.argentina.gob.ar/normativa/nacional/norma-430580/texto
const LAB_CLOSED_DAYS:Record<number,ReadonlySet<string>>={
  2026:new Set([
    '2026-01-01','2026-02-16','2026-02-17',
    '2026-03-23','2026-03-24','2026-04-02','2026-04-03',
    '2026-05-01','2026-05-25','2026-06-15','2026-06-20',
    '2026-07-09','2026-07-10','2026-08-17','2026-10-12',
    '2026-11-09','2026-11-11','2026-11-23',
    '2026-12-07','2026-12-08','2026-12-25'
  ])
};

function calendarDay(dayIndex:number):{open:boolean,configured:boolean} {
  const pseudoDate=new Date(dayIndex*DAY);
  const year=pseudoDate.getUTCFullYear();
  const closed=LAB_CLOSED_DAYS[year];
  if(!closed)return {open:false,configured:false};
  const weekday=pseudoDate.getUTCDay();
  return {open:weekday>=1&&weekday<=5&&!closed.has(pseudoDate.toISOString().slice(0,10)),configured:true};
}

function dayStart(epochMs:number):number {
  return Math.floor((epochMs-ARG_OFFSET)/DAY);
}

function minutesBetween(fromMs:number,toMs:number):number|null {
  if(toMs<=fromMs)return 0;
  const first=dayStart(fromMs),last=dayStart(toMs);
  if(last-first>730)return null;
  let total=0;
  for(let index=first;index<=last;index++){
    const day=calendarDay(index);
    if(!day.configured)return null;
    if(!day.open)continue;
    const opening=index*DAY+ARG_OFFSET+7*HOUR;
    const closing=index*DAY+ARG_OFFSET+19*HOUR;
    total+=Math.max(0,Math.min(toMs,closing)-Math.max(fromMs,opening));
  }
  return Math.floor(total/MINUTE);
}

function afterWorkingMinutes(fromMs:number,minutes:number):number|null{
  let remaining=minutes*MINUTE;
  let index=dayStart(fromMs);
  for(let tries=0;tries<732;tries++,index++){
    const day=calendarDay(index);
    if(!day.configured)return null;
    if(!day.open)continue;
    const opening=index*DAY+ARG_OFFSET+7*HOUR;
    const closing=index*DAY+ARG_OFFSET+19*HOUR;
    const start=Math.max(opening,fromMs);
    const available=Math.max(0,closing-start);
    if(!available)continue;
    if(remaining<=available)return start+remaining;
    remaining-=available;
  }
  return null;
}

export type LabClaimReminder={
  state:'waiting'|'reminder4'|'reminder8'|'overdue'|'responded'|'calendar_pending';
  elapsedBusinessMinutes:number|null;
  dueAt:string|null;
  firstReminderAt:string|null;
  secondReminderAt:string|null;
  responseAt:string|null;
  // NO indica que un WhatsApp, email ni notificación push haya sido enviado.
  inAppOnly:true;
};

export function getLabClaimReminder(createdAt:Date|string,
  firstResponseAt:Date|string|null|undefined,now=new Date()):LabClaimReminder{
  const createdMs=new Date(createdAt).getTime();
  const responseMs=firstResponseAt?new Date(firstResponseAt).getTime():null;
  const endedMs=responseMs??now.getTime();
  const first=afterWorkingMinutes(createdMs,240);
  const second=afterWorkingMinutes(createdMs,480);
  const due=afterWorkingMinutes(createdMs,720);
  const elapsed=minutesBetween(createdMs,endedMs);
  if(!Number.isFinite(createdMs)||!Number.isFinite(endedMs)||
      first===null||second===null||due===null||elapsed===null){
    return {state:'calendar_pending',elapsedBusinessMinutes:null,dueAt:null,
      firstReminderAt:null,secondReminderAt:null,responseAt:responseMs===null?null:new Date(responseMs).toISOString(),
      inAppOnly:true};
  }
  const state:LabClaimReminder['state']=responseMs!==null?'responded':
    elapsed>=720?'overdue':elapsed>=480?'reminder8':elapsed>=240?'reminder4':'waiting';
  return {state,elapsedBusinessMinutes:Math.max(0,elapsed),
    firstReminderAt:new Date(first).toISOString(),
    secondReminderAt:new Date(second).toISOString(),
    dueAt:new Date(due).toISOString(),
    responseAt:responseMs===null?null:new Date(responseMs).toISOString(),inAppOnly:true};
}

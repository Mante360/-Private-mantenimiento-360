(() => {
  'use strict';
  // Two-stage visit/diagnosis workflow, LAB ONLY. Never makes a real charge.
  const el=id=>document.getElementById(id);
  const api=async(method,path,data)=>{
    const token=sessionStorage.getItem('m360-lab-token')||'';
    const response=await fetch(path,{
      method,cache:'no-store',
      headers:{Authorization:'Bearer '+token,
        ...(data===undefined?{}:{'Content-Type':'application/json'})},
      ...(data===undefined?{}:{body:JSON.stringify(data)})
    });
    let result={};
    try{result=await response.json();}catch(_){}
    if(!response.ok){
      const errors={
        invalid_or_expired_token:'La sesión venció; volvé a iniciar sesión.',
        authentication_required:'Iniciá sesión para continuar.',
        professional_has_open_claim:'Tenés un reclamo pendiente; no se permite presupuestar.',
        professional_not_eligible:'El profesional no está habilitado para esta solicitud.',
        quote_already_submitted:'Ya presentaste un presupuesto o una visita para este trabajo.',
        job_not_accepting_visits:'El trabajo ya no acepta propuestas de visita.',
        job_not_accepting_selection:'Este trabajo ya no admite nuevas selecciones.',
        repair_decision_unavailable:'Ya existe una decisión sobre esta reparación.',
        visit_not_ready_for_diagnosis:'La visita todavía no fue aceptada o ya avanzó de etapa.'
      };
      throw new Error(errors[result.error]||('No se pudo realizar la operación (HTTP '+response.status+').'));
    }
    return result;
  };
  const node=(tag,value,cl)=>{
    const x=document.createElement(tag);
    if(value!==undefined)x.textContent=value;
    if(cl)x.className=cl;
    return x;
  };
  const ars=v=>Number(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const datestr=v=>v?new Date(v).toLocaleString('es-AR',{
    timeZone:'America/Argentina/Buenos_Aires',hour12:false
  }):'';
  const amountFrom=value=>{
    const t=value.trim().replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(t))return null;
    const n=Number(t);
    return Number.isFinite(n)&&n>0&&n<=9999999999.99?n:null;
  };
  let openedJob=null,openedProfile=null,callId=0;
  function statusText(offer) {
    if(offer.status==='not_selected')return 'Visita técnica no seleccionada';
    if(offer.status==='submitted')return 'Visita propuesta · esperando respuesta';
    if(offer.repair_decision==='accepted')return 'Reparación contratada después de la visita';
    if(offer.repair_decision==='rejected')return 'Visita realizada · reparación no contratada';
    if(offer.repair_offered_at)return 'Diagnóstico y presupuesto de reparación presentados';
    return 'Visita técnica aceptada · esperando diagnóstico';
  }
  function makeFormField(form,title,type,maxLength=3000){
    const label=node('label',title);
    const field=type==='textarea'?node('textarea'):node('input');
    if(type==='textarea')field.rows=4;
    else{field.type='text';field.inputMode='decimal';}
    field.required=true;
    field.maxLength=maxLength;
    form.append(label,field);
    return field;
  }
  async function perform(label,path,data,after){
    if(!confirm(label+' Es una operación ficticia; no se procesa ningún pago.'))return;
    try{await api('POST',path,data);await after();}
    catch(error){alert(error.message);}
  }
  function renderOffer(offer,job,profile){
    const item=node('div',undefined,'jobspanel');
    item.append(node('h4','Visita técnica de diagnóstico · '+offer.professional_name));
    item.append(node('p','Importe de la visita: ARS '+ars(offer.amount)+
      '\nDetalle: '+offer.description+
      '\nEstado: '+statusText(offer)+
      '\nPropuesta registrada: '+datestr(offer.offered_at)));
    const route='/api/jobs/'+job.id+'/visits/'+offer.id;
    const owner=profile.role==='client';
    const pro=profile.role==='professional'&&String(profile.id)===String(offer.professional_id);
    if(owner&&offer.status==='submitted'&&offer.job_status==='quoted'){
      const accept=node('button','Aceptar solamente la visita técnica','secondary');
      accept.type='button';
      accept.onclick=async()=>{
        accept.disabled=true;
        await perform('¿Aceptar la visita de ARS '+ars(offer.amount)+
          '? La reparación todavía NO queda contratada.',route+'/accept',undefined,()=>window.labVisit.refreshPage());
        accept.disabled=false;
      };
      item.append(accept);
    }
    if(offer.status==='accepted'){
      const info=node('p','La visita se acuerda por separado. No se cobró dinero real. Aceptar la visita NO obliga a contratar la reparación.','hint');
      item.append(info);
      if(offer.accepted_at)item.append(node('p','Visita aceptada: '+datestr(offer.accepted_at),'hint'));
      if(offer.diagnosis){
        item.append(node('strong','Diagnóstico informado'));
        item.append(node('p',offer.diagnosis));
        item.append(node('p','Diagnóstico registrado: '+datestr(offer.diagnosed_at),'hint'));
        item.append(node('strong','Propuesta de reparación (adicional y separada de la visita)'));
        item.append(node('p','Importe reparación: ARS '+ars(offer.repair_amount)+
          '\nGarantía de reparación: '+offer.repair_warranty_days+' días'+
          '\nDetalle: '+offer.repair_description+
          '\nPropuesta registrada: '+datestr(offer.repair_offered_at)));
        if(offer.repair_decided_at)item.append(node('p','Decisión del cliente: '+
          (offer.repair_decision==='accepted'?'Reparación aceptada':'Reparación no contratada')+
          ' · '+datestr(offer.repair_decided_at),'hint'));
      }
      if(pro&&offer.job_status==='accepted'&&!offer.diagnosed_at){
        const form=node('form');
        form.append(node('p','Después de la visita ficticia, registrá un diagnóstico y presentá el presupuesto de REPARACIÓN. No se modifica el costo de la visita.','hint'));
        const diagnosis=makeFormField(form,'Diagnóstico técnico de prueba','textarea');
        diagnosis.minLength=10;
        const amount=makeFormField(form,'Importe de reparación (ARS)','text',16);
        const description=makeFormField(form,'Detalle de la reparación','textarea');
        description.minLength=10;
        const warranty=makeFormField(form,'Garantía de reparación (días)','text',4);
        warranty.value='30';warranty.inputMode='numeric';
        const submit=node('button','Enviar diagnóstico y presupuesto de reparación','primary');
        submit.type='submit';
        form.append(submit);
        form.onsubmit=async(event)=>{
          event.preventDefault();
          const parsedAmount=amountFrom(amount.value),days=warranty.value.trim();
          if(parsedAmount===null||!/^(?:0|[1-9]\d{0,3})$/.test(days)||Number(days)>3650){
            alert('Revisá el importe y los días de garantía de la reparación.');return;
          }
          submit.disabled=true;
          try{
            await api('POST',route+'/diagnosis',{
              diagnosis:diagnosis.value.trim(),amount:parsedAmount,
              description:description.value.trim(),warrantyDays:Number(days)
            });
            await window.labVisit.reload();
          }catch(error){alert(error.message);submit.disabled=false;}
        };
        item.append(form);
      }
      if(owner&&offer.job_status==='accepted'&&offer.repair_offered_at&&!offer.repair_decision){
        const note=node('p','Podés rechazar la reparación sin contratarla. La visita que aceptaste queda registrada por separado; no hay cobro automático.','hint');
        item.append(note);
        const yes=node('button','Aceptar presupuesto de reparación','primary');
        yes.type='button';
        yes.onclick=()=>void perform('¿Contratar la reparación por ARS '+ars(offer.repair_amount)+
          '? El importe de visita queda registrado por separado.',route+'/repair-decision',{accept:true},()=>window.labVisit.refreshPage());
        const no=node('button','No contratar la reparación','secondary');
        no.type='button';
        no.onclick=()=>void perform('¿Rechazar únicamente la reparación y finalizar este recorrido de visita? Se conserva el acuerdo de visita.',route+'/repair-decision',{accept:false},()=>window.labVisit.refreshPage());
        item.append(yes,no);
      }
    }
    return item;
  }
  async function reload(){
    const job=openedJob,profile=openedProfile,id=callId;
    const section=el('labVisitSection');
    if(!job||!profile){section.hidden=true;return;}
    section.hidden=false;
    const list=el('labVisitOffers');
    list.textContent='Consultando visitas técnicas...';
    try{
      const offers=await api('GET','/api/jobs/'+job.id+'/visits');
      if(callId!==id)return;
      list.replaceChildren();
      if(!offers.length){
        section.hidden=true;
      }else{
        for(const offer of offers)list.append(renderOffer(offer,job,profile));
      }
      // A professional cannot submit a second offer on this job.
      if(profile.role==='professional'&&['requested','quoted'].includes(job.status)){
        const own=await api('GET','/api/jobs/mine/quotes');
        if(callId!==id)return;
        const alreadyQuoted=own.some(q=>String(q.job_id)===String(job.id))||offers.length>0;
        if(alreadyQuoted){
          el('quoteForm').hidden=true;
          el('quoteFeedback').textContent='Ya presentaste una propuesta en este trabajo. Se conserva en tu historial.';
        }
      }
    }catch(error){
      if(callId===id)list.textContent='No se pudieron consultar las visitas: '+error.message;
    }
  }
  async function loadMine(openJob){
    const list=el('myVisitOffers');
    if(!list)return;
    list.textContent='Consultando visitas técnicas...';
    try{
      const items=await api('GET','/api/jobs/mine/visits');
      list.replaceChildren();
      if(!items.length){list.textContent='Todavía no ofreciste visitas de diagnóstico.';return;}
      for(const offer of items){
        const item=node('div',undefined,'service-review-item');
        item.append(node('p',offer.public_code+' · '+offer.locality+
          '\nVisita: ARS '+ars(offer.visit_amount)+
          ' · '+statusText({...offer,status:offer.visit_status}),'hint'));
        const button=node('button','Ver visita y diagnóstico','secondary');button.type='button';
        button.onclick=()=>void openJob({
          id:offer.job_id,public_code:offer.public_code,
          description:offer.description,locality:offer.locality,
          status:offer.status,specialty_id:offer.specialty_id,service_id:offer.service_id,
          amount:offer.repair_contract_amount,
          warranty_days:offer.repair_contract_warranty_days,
          quote_description:offer.repair_contract_description
        });
        item.append(button);list.append(item);
      }
    }catch(error){list.textContent='No se pudieron consultar las visitas: '+error.message;}
  }
  window.labVisit={
    openJob(job,profile){openedJob=job;openedProfile=profile;callId++;void reload();},
    close(){openedJob=null;openedProfile=null;callId++;el('labVisitSection').hidden=true;},
    reload,loadMine,
    refreshPage:()=>{}
  };
  if(typeof window.labVisitRefreshJobs==='function'){
    window.labVisit.refreshPage=window.labVisitRefreshJobs;
  }
})();

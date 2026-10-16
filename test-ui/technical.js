(() => {
  'use strict';
  // Dedicated technical-information requests tied to an existing submitted quote.
  const el=id=>document.getElementById(id);
  const token=()=>sessionStorage.getItem('m360-lab-token')||'';
  let shownJob=null;
  let session=0;
  const endpoint=(jobId)=>'/api/jobs/'+encodeURIComponent(String(jobId))+'/technical';

  async function request(method,path,data){
    const response=await fetch(path,{
      method,cache:'no-store',
      headers:{
        Authorization:'Bearer '+token(),
        ...(data!==undefined?{'Content-Type':'application/json'}:{})
      },
      ...(data!==undefined?{body:JSON.stringify(data)}:{})
    });
    let body={};
    try { body=await response.json(); } catch(_) {}
    if(!response.ok) {
      const known={
        professional_has_open_claim:'No podés enviar nuevas consultas mientras tengas un reclamo abierto.',
        technical_answer_pending:'Primero esperá la respuesta a tu última consulta.',
        technical_window_closed:'Las consultas previas se cerraron al cambiar el estado del trabajo o presupuesto.',
        invalid_technical_input:'Revisá la información ingresada y su extensión.',
        quote_not_found:'No existe un presupuesto tuyo para esta solicitud.',
        question_already_answered:'Esta consulta ya fue respondida.',
        technical_info_not_found:'No tenés acceso a esta información técnica.'
      };
      throw new Error(known[body.error] || 'No se pudo completar esta operación (HTTP '+response.status+').');
    }
    return body;
  }

  function node(tag,text,cls){
    const x=document.createElement(tag);
    if(text!==undefined) x.textContent=text;
    if(cls) x.className=cls;
    return x;
  }
  function notice(box,message,isError=false){
    box.textContent=message;
    box.className=isError?'feedback error':'feedback ok';
  }

  function renderThread(job,profile,thread){
    const box=node('section',undefined,'technical-thread');
    box.append(node('h4',profile.role==='client'
      ? 'Presupuesto N.º '+thread.quoteId+' · '+thread.professionalName
      : 'Tu presupuesto N.º '+thread.quoteId));
    box.append(node('p','Estado: '+(thread.quoteStatus==='submitted'?'Presentado':
      thread.quoteStatus==='accepted'?'Aceptado':'No seleccionado')+'. Las preguntas son privadas entre cliente y profesional.','hint'));

    if(!thread.questions.length) box.append(node('p','Todavía no hay solicitudes de información técnica.','hint'));

    for(const item of thread.questions){
      const pair=node('div',undefined,'technical-pair');
      pair.append(node('p','Profesional · Consulta '+new Date(item.asked_at).toLocaleString('es-AR'),'technical-meta'));
      pair.append(node('p',item.question));
      if(item.answer!==null){
        pair.append(node('p','Cliente · Respuesta','technical-meta'));
        pair.append(node('p',item.answer));
      } else if(profile.role==='client'&&thread.canAnswer){
        const form=node('form',undefined,'technical-answer-form');
        const label=node('label','Responder esta consulta');label.htmlFor='technical-answer-'+item.id;
        const field=node('textarea');field.id=label.htmlFor;field.rows=3;
        field.minLength=2;field.maxLength=1500;field.required=true;
        field.placeholder='Escribí la aclaración técnica. Para fotos, usá Fotografías del trabajo.';
        const button=node('button','Enviar respuesta','secondary');button.type='submit';
        const msg=node('p',undefined,'feedback');msg.setAttribute('role','status');
        form.append(label,field,button,msg);
        form.addEventListener('submit',async(event)=>{
          event.preventDefault();
          button.disabled=true;
          try{
            await request('POST',endpoint(job.id)+'/quotes/'+thread.quoteId+
              '/questions/'+item.id+'/answer',{answer:field.value.trim()});
            notice(msg,'Respuesta guardada correctamente.');
            await reload(job,profile);
          }catch(error){notice(msg,error.message,true);button.disabled=false;}
        });
        pair.append(form);
      } else {
        pair.append(node('p','Esperando respuesta del cliente.','hint'));
      }
      box.append(pair);
    }

    if(profile.role==='professional'){
      if(thread.canAsk){
        const button=node('button','Solicitar más información','secondary');
        button.type='button';
        const form=node('form',undefined,'technical-question-form');
        form.hidden=true;
        form.append(node('p','Pedí únicamente datos técnicos necesarios para preparar la visita. No solicites domicilios exactos ni teléfonos.','hint'));
        const label=node('label','Información que necesitás');label.htmlFor='technical-question-'+thread.quoteId;
        const field=node('textarea');field.id=label.htmlFor;field.minLength=10;field.maxLength=800;field.rows=4;field.required=true;
        field.placeholder='Ejemplo: ¿Qué marca y modelo tiene el equipo? ¿Podés agregar una foto de la etiqueta?';
        const submit=node('button','Enviar solicitud de información','primary');submit.type='submit';
        const msg=node('p',undefined,'feedback');msg.setAttribute('role','status');
        form.append(label,field,submit,msg);
        button.addEventListener('click',()=>{form.hidden=!form.hidden;});
        form.addEventListener('submit',async(event)=>{
          event.preventDefault();submit.disabled=true;
          try{
            await request('POST',endpoint(job.id)+'/quotes/'+thread.quoteId+'/questions',
              {question:field.value.trim()});
            notice(msg,'Consulta enviada al cliente.');
            await reload(job,profile);
          }catch(error){notice(msg,error.message,true);submit.disabled=false;}
        });
        box.append(button,form);
      } else if(thread.questions.some(x=>x.answer===null)){
        box.append(node('p','Ya solicitaste información. Podés volver a consultar cuando el cliente responda.','hint'));
      } else if(['submitted','accepted'].includes(thread.quoteStatus)){
        box.append(node('p','Las nuevas consultas no están disponibles para este presupuesto o en este estado del trabajo.','hint'));
      }

      if(thread.canEditPreparation){
        const prep=node('div',undefined,'technical-preparation');
        prep.append(node('h4','Preparación de la visita · Solo visible para vos'));
        prep.append(node('p','Registrá instrumentos, herramientas y posibles repuestos para llevar. Esta nota no modifica el presupuesto.','hint'));
        const form=node('form');
        const label=node('label','Mi lista de preparación');label.htmlFor='technical-prep-'+thread.quoteId;
        const field=node('textarea');field.id=label.htmlFor;field.rows=4;field.maxLength=1800;
        field.placeholder='Ejemplo: multímetro, manómetros, capacitores compatibles, herramientas, hidrolavadora...';
        field.value=thread.preparation?.notes||'';
        const button=node('button','Guardar preparación de la visita','secondary');button.type='submit';
        const msg=node('p',undefined,'feedback');msg.setAttribute('role','status');
        form.append(label,field,button,msg);
        form.addEventListener('submit',async(event)=>{
          event.preventDefault();button.disabled=true;
          try{
            await request('PUT',endpoint(job.id)+'/quotes/'+thread.quoteId+'/preparation',
              {notes:field.value.trim()});
            notice(msg,'Preparación guardada. Solo vos podés ver esta lista.');
          }catch(error){notice(msg,error.message,true);}
          finally{button.disabled=false;}
        });
        prep.append(form);
        box.append(prep);
      }
    }
    return box;
  }

  async function reload(job,profile){
    const version=++session;
    shownJob=Number(job.id);
    const section=el('technicalInfoSection');
    const panel=el('technicalInfoPanel');
    section.hidden=false;
    panel.replaceChildren(node('p','Consultando información técnica...','hint'));
    try{
      const data=await request('GET',endpoint(job.id));
      if(shownJob!==Number(job.id)||version!==session) return;
      panel.replaceChildren();
      if(!data.threads?.length){
        section.hidden=true;
        return;
      }
      for(const thread of data.threads) panel.append(renderThread(job,profile,thread));
    }catch(error){
      if(shownJob!==Number(job.id)||version!==session) return;
      // Existing requests do not become unusable if consultations fail.
      panel.replaceChildren(node('p','No se pudieron consultar las solicitudes técnicas: '+error.message,'feedback error'));
    }
  }
  function openJob(job,profile) {
    shownJob=Number(job.id);
    session++;
    el('technicalInfoSection').hidden=true;
    el('technicalInfoPanel').replaceChildren();
    if(['client','professional'].includes(profile?.role)) void reload(job,profile);
  }
  function close() {
    shownJob=null;
    session++;
    el('technicalInfoSection').hidden=true;
  }
  el('refreshTechnicalInfo').addEventListener('click',()=>{
    const data=window.labTechnicalCurrent;
    if(data?.job&&data?.profile) void reload(data.job,data.profile);
  });
  window.labTechnical={openJob,close};
  // Stored only in the browser; no customer or professional personal data persisted.
})();

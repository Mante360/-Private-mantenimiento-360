(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const tokenKey = 'm360-lab-token';
  let choice = 'client';
  let token = sessionStorage.getItem(tokenKey) || '';
  let profile = null;
  let labCategoryId=null;
  let labProfessional=null;

  function feedback(message, failed = false) {
    const node = el('feedback');
    node.textContent = message;
    node.className = 'feedback ' + (failed ? 'error' : 'ok');
  }
  async function api(method, path, data, credential = token) {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(credential ? { Authorization: 'Bearer ' + credential } : {})
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      const known = {
        invalid_input: 'Revisá los datos ingresados. La contraseña necesita 12 caracteres o más.',
        account_unavailable: 'Esta cuenta ya existe o no está disponible.',
        invalid_credentials: 'Correo o contraseña incorrectos.',
        professional_has_open_claim: 'No podés enviar nuevos presupuestos porque tenés un reclamo pendiente de resolver. Podés consultar las solicitudes y responder al reclamo desde tu cuenta.',
        authentication_required: 'Necesitás iniciar sesión.',
        invalid_or_expired_token: 'La sesión venció. Volvé a ingresar.',
        warranty_correction_already_confirmed: 'La corrección en garantía ya fue confirmada por el cliente. No se admiten nuevos descargos sobre este reclamo.',
        claim_already_open: 'Ya existe un reclamo abierto o en revisión para este trabajo. Esperá su resolución antes de presentar otro.',
        evidence_required: 'No se puede revisar sin un PDF o fotografía de respaldo.',
        evidence_must_be_viewed: 'Antes de revisar, abrí el PDF o imagen de respaldo y compará su fecha con la declaración.'
      };
      const error = new Error(body.error === 'invalid_input' ? 'Los datos de la operación no son válidos.' : (known[body.error] || 'La solicitud no se completó (HTTP ' + response.status + ').'));
      error.code = body.error || '';
      throw error;
    }
    return body;
  }

  // A single source of truth for browsing (guest/pro/client/admin).
  // Browsing does not update professional verification or assigned specialties.
  let labProfessionCatalog=[];
  let labProfessionCatalogPromise=null;
  const professionNormalized=value=>String(value||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-AR').trim();
  const professionSearchable=p=>professionNormalized([
    p.title,p.category,p.description,...(Array.isArray(p.aliases)?p.aliases:[])
  ].join(' '));
  const professionMatches=(p,query)=>!query||professionSearchable(p).includes(professionNormalized(query));
  function catalogTitle(id,fallback){
    return labProfessionCatalog.find(p=>String(p.specialty_id)===String(id))?.title||fallback;
  }
  async function fetchLabProfessionCatalog(){
    if(!labProfessionCatalogPromise){
      labProfessionCatalogPromise=api('GET','/api/catalog/professions',null,'')
        .then(rows=>{
          if(!Array.isArray(rows))throw new Error('Catálogo de formato inválido');
          labProfessionCatalog=rows;
          renderProfessionFinder('guestProfessionList','guestProfessionSearch');
          renderProfessionFinder('proProfessionList','proProfessionSearch');
          if(profile?.role==='client')renderClientSpecialtyOptions();
          if(profile?.role==='admin'&&labCategories.length)renderAdminSpecialtyOptions();
          return rows;
        }).catch(error=>{labProfessionCatalogPromise=null;throw error;});
    }
    return labProfessionCatalogPromise;
  }

  // Cada servicio depende de una declaración del profesional y de revisión.
  let labServiceCatalog=[],labServiceCatalogPromise=null;
  const registrationServiceIds=new Set(),proServiceIds=new Set(),proServiceStatuses=new Map();
  // Keep the last server-confirmed selection separate from checkboxes being edited.
  const persistedProServiceIds=new Set();
  function serviceSelectionFeedback(){
    if(profile?.role!=='professional')return;
    const status=el('proServicesStatus');
    const additions=[...proServiceIds].filter(id=>!persistedProServiceIds.has(id));
    const removals=[...persistedProServiceIds].filter(id=>!proServiceIds.has(id));
    const unsaved=additions.length>0||removals.length>0;
    status.classList.toggle('services-unsaved',unsaved);
    status.textContent=unsaved
      ? 'CAMBIOS SIN GUARDAR: '+additions.length+' servicio(s) para agregar y '+
        removals.length+' para retirar. Administración todavía ve la selección anterior. '+
        'Presioná «Guardar mis servicios para revisión» para confirmar.'
      : 'Selección guardada: '+persistedProServiceIds.size+
        ' servicio(s). Los pendientes siguen a la espera de Administración.';
  }
  const serviceSearchMatch=(service,query)=>!query||
    professionNormalized([service.service_name,service.profession_name,...(service.keywords||[])].join(' ')).includes(professionNormalized(query));
  async function fetchLabServiceCatalog(){
    if(!labServiceCatalogPromise){
      labServiceCatalogPromise=api('GET','/api/lab-services/catalog',null,'')
        .then(response=>{
          labServiceCatalog=response.items||[];
          renderServiceChecklist('regServiceChoices','regServiceSearch',registrationServiceIds);
          renderServiceChecklist('proServiceChoices','proServiceSearch',proServiceIds,proServiceStatuses);
          if(profile?.role==='client')renderClientSpecialtyOptions();
          return labServiceCatalog;
        }).catch(error=>{labServiceCatalogPromise=null;throw error;});
    }
    return labServiceCatalogPromise;
  }
  function renderServiceChecklist(panelId,searchId,chosen,statuses=new Map()){
    const panel=el(panelId);
    if(!panel)return;
    panel.replaceChildren();
    if(!labServiceCatalog.length){panel.textContent='Consultando servicios disponibles...';return;}
    const rows=labServiceCatalog.filter(service=>serviceSearchMatch(service,el(searchId)?.value||''));
    if(!rows.length){panel.textContent='No encontramos ese trabajo. Podés sugerir un servicio nuevo a Administración.';return;}
    const heading=document.createElement('p');heading.className='hint';
    heading.textContent='Trabajos disponibles para declarar: '+rows.length+'. Marcá solo los que sabés realizar.';
    panel.append(heading);
    for(const service of rows){
      const id=String(service.service_id),label=document.createElement('label');
      label.className='service-checkbox';
      const input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=chosen.has(id);
      const description=document.createElement('span'),title=document.createElement('strong'),subtitle=document.createElement('small');
      title.textContent=service.service_name;
      const status=statuses.get(id);
      const refreshLabel=()=>{
        let text=status==='approved'?'Aprobado para pruebas':
          status==='pending'?'Pendiente de revisión':
          status==='rejected'?'Rechazado (podés volver a solicitarlo)':'';
        if(panelId==='proServiceChoices'){
          if(!chosen.has(id)&&persistedProServiceIds.has(id))
            text='DESMARCADO · retiro sin guardar (aún figura en Administración)';
          else if(chosen.has(id)&&!persistedProServiceIds.has(id))
            text='MARCADO · alta sin guardar';
        }
        subtitle.textContent=service.profession_name+(text?' · '+text:'');
      };
      refreshLabel();
      description.append(title,subtitle);label.append(input,description);
      input.addEventListener('change',()=>{
        if(input.checked)chosen.add(id);else chosen.delete(id);
        refreshLabel();
        if(panelId==='proServiceChoices')serviceSelectionFeedback();
      });
      panel.append(label);
    }
  }
  async function loadMyDeclaredServices(){
    if(profile?.role!=='professional')return;
    const status=el('proServicesStatus');
    try{
      const [_,result]=await Promise.all([fetchLabServiceCatalog(),api('GET','/api/lab-services/mine')]);
      proServiceIds.clear();proServiceStatuses.clear();persistedProServiceIds.clear();
      for(const entry of result.items||[]){
        const id=String(entry.service_id);
        proServiceIds.add(id);persistedProServiceIds.add(id);
        proServiceStatuses.set(id,entry.status);
      }
      renderServiceChecklist('proServiceChoices','proServiceSearch',proServiceIds,proServiceStatuses);
      serviceSelectionFeedback();
    }catch(error){status.textContent='No se pudieron consultar tus servicios: '+error.message;}
  }
  async function saveMyDeclaredServices(){
    if(profile?.role!=='professional')return;
    const serviceIds=[...proServiceIds].map(Number);
    const removals=[...persistedProServiceIds].filter(id=>!proServiceIds.has(id)).length;
    if(!confirm('¿Guardar '+serviceIds.length+' servicio(s) declarados y retirar '+removals+
      '? Los nuevos quedarán pendientes y los retirados desaparecerán de la cola de Administración.'))return;
    const button=el('saveProServices');button.disabled=true;
    try{
      await api('POST','/api/lab-services/mine',{serviceIds});
      await loadMyDeclaredServices();
      const actual=[...persistedProServiceIds].map(Number);
      const requested=new Set(serviceIds);
      if(actual.length!==requested.size||actual.some(id=>!requested.has(id))){
        el('proServicesStatus').textContent='La selección enviada no coincide con lo que devolvió el servidor. Revisá antes de continuar.';
        return;
      }
      el('proServicesStatus').textContent='GUARDADO EN LA BASE DE PRUEBAS: '+actual.length+
        ' servicio(s). Retirados: '+removals+
        '. Actualizá Administración para ver las declaraciones pendientes reales.';
      el('proServicesStatus').classList.remove('services-unsaved');
    }catch(error){
      el('proServicesStatus').classList.add('services-unsaved');
      el('proServicesStatus').textContent='NO SE GUARDARON LOS CAMBIOS: '+error.message+
        '. Administración todavía ve los servicios anteriores.';
    }finally{button.disabled=false;}
  }
  async function loadServiceReviews(){
    if(profile?.role!=='admin')return;
    const panel=el('adminServiceDeclarations');panel.textContent='Cargando declaraciones...';
    try{
      const records=await api('GET','/api/lab-services/pending');panel.replaceChildren();
      if(!records.items?.length){panel.textContent='No hay nuevas declaraciones pendientes.';return;}
      for(const record of records.items){
        const item=document.createElement('div');item.className='service-review-item';
        const details=document.createElement('p');
        details.textContent=record.professional_name+' · '+record.profession_name+
          ' · '+record.service_name+'\nProfesional: '+record.verification_status+
          (record.credential_note?'\nAtención: puede necesitar documentación habilitante.':'');
        item.append(details);
        for(const decision of ['approved','rejected']){
          const button=document.createElement('button');button.type='button';button.className='secondary';
          button.textContent=decision==='approved'?'Aprobar servicio (prueba)':'Rechazar servicio';
          button.addEventListener('click',async()=>{
            if(!confirm('¿'+(decision==='approved'?'Aprobar':'Rechazar')+' '+record.service_name+
              ' para '+record.professional_name+'? Simulación sin verificación real de identidad ni matrícula.'))return;
            button.disabled=true;
            try{
              await api('POST','/api/lab-services/pending/'+encodeURIComponent(record.id)+'/decision',{decision});
              labServiceCatalogPromise=null;await fetchLabServiceCatalog();await loadServiceReviews();
            }catch(error){feedback('No se completó la revisión: '+error.message,true);button.disabled=false;}
          });item.append(button);
        }panel.append(item);
      }
    }catch(error){panel.textContent='No se pudieron cargar las declaraciones: '+error.message;}
  }


  // Legajos ficticios: NO reciben archivos, DNI, biometría ni números fiscales.
  // Los recordatorios se calculan cuando el usuario consulta la plataforma.
  let labDocRequirements=[];
  function labDocLabel(key){
    return labDocRequirements.find(d=>d.key===key)?.label||key;
  }
  function labDocumentStatus(item){
    const state={
      pending:'Pendiente de revisión',
      needs_more:'Documentación adicional solicitada',
      rejected:'Rechazado para la prueba',
      reviewed_test_only:'Revisado (SOLO datos ficticios)',
      superseded:'Presentación duplicada anterior (conservada en historial)'
    }[item.status]||item.status;
    if(item.status!=='reviewed_test_only')return state;
    // An approved renewal supersedes the older version for alerts,
    // without deleting or altering the original review history.
    if(item.is_current_approved===false)return state+
      ' · Histórico, reemplazado por una versión aprobada más vigente'+
      (item.expires_on?' (vencimiento original: '+item.expires_on+')':'');
    const days=item.days_until_expiry;
    if(days==null)return state+' · sin vencimiento cargado';
    if(days<0)return state+' · VENCIDO hace '+Math.abs(days)+' día(s)';
    if(days===0)return state+' · VENCE HOY';
    if(days<=7)return state+' · vence en '+days+' día(s) (último aviso)';
    if(days<=15)return state+' · vence en '+days+' día(s)';
    if(days<=30)return state+' · vence en '+days+' día(s)';
    return state+' · vigente hasta '+item.expires_on;
  }
  async function loadLabDocumentRequirements(){
    if(labDocRequirements.length)return;
    const data=await api('GET','/api/lab-documents/requirements');
    labDocRequirements=data.types||[];
    const select=el('labDocType');
    select.replaceChildren(new Option('Seleccionar',''));
    for(const kind of labDocRequirements)select.add(new Option(kind.label,kind.key));
  }

  async function showLabEvidence(docId,holder,status){
    if(holder.dataset.open==='true'){
      holder.replaceChildren();holder.dataset.open='false';return;
    }
    status.textContent='Abriendo respaldo privado de prueba...';
    try{
      const response=await fetch('/api/lab-documents/'+encodeURIComponent(docId)+'/evidence',{
        headers:{Authorization:'Bearer '+token},cache:'no-store'
      });
      if(!response.ok)throw Error('No se pudo abrir el respaldo (HTTP '+response.status+').');
      const type=response.headers.get('content-type')?.split(';')[0]||'application/octet-stream';
      const bytes=await response.blob();
      const url=URL.createObjectURL(new Blob([bytes],{type}));
      holder.replaceChildren();
      const info=document.createElement('p');info.className='hint';
      info.textContent='Archivo SIMULADO privado. Compará visualmente su fecha con el vencimiento declarado.';
      let preview;
      if(type==='application/pdf'){
        preview=document.createElement('iframe');
        preview.title='PDF ficticio de respaldo documental';
        preview.className='lab-doc-preview-pdf';
      }else{
        preview=document.createElement('img');
        preview.alt='Imagen ficticia de respaldo documental';
        preview.className='lab-doc-preview-image';
      }
      preview.src=url;
      const download=document.createElement('a');
      download.href=url;download.download='respaldo-ficticio'+(type==='application/pdf'?'.pdf':type==='image/png'?'.png':type==='image/webp'?'.webp':'.jpg');
      download.textContent='Abrir o guardar copia ficticia';
      download.className='lab-doc-evidence-link';
      const close=document.createElement('button');
      close.className='secondary';close.type='button';close.textContent='Cerrar respaldo';
      close.addEventListener('click',()=>{
        holder.replaceChildren();holder.dataset.open='false';
        URL.revokeObjectURL(url);
      });
      holder.append(info,preview,download,close);
      holder.dataset.open='true';
      status.textContent='Respaldo de prueba abierto; revisá el contenido antes de decidir.';
    }catch(error){status.textContent='Error al abrir el respaldo: '+error.message;}
  }
  function addLabEvidenceViewer(doc,host,status){
    if(!doc.has_evidence)return;
    const button=document.createElement('button');
    button.type='button';button.className='secondary';button.textContent='Ver respaldo PDF / imagen';
    const holder=document.createElement('div');holder.className='lab-evidence-holder';
    button.addEventListener('click',()=>void showLabEvidence(doc.id,holder,status));
    host.append(button,holder);
  }
  async function submitLabEvidenceUpload(docId,file,status){
    if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)||
       file.size<20||file.size>1500000){
      status.textContent='Usá un PDF/JPG/PNG/WEBP INVENTADO de hasta 1,5 MB.';return;
    }
    status.textContent='Adjuntando archivo de prueba privado...';
    try{
      const response=await fetch('/api/lab-documents/mine/'+encodeURIComponent(docId)+'/evidence',{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':file.type},
        body:file
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'No se pudo subir el respaldo.');
      status.textContent='Respaldo guardado. Administración podrá abrirlo, comparar la fecha y revisarlo.';
      await loadMyLabDocuments();
    }catch(error){status.textContent='Error al adjuntar: '+error.message;}
  }

  async function loadMyLabDocuments(){
    if(profile?.role!=='professional')return;
    const list=el('proDocExpiryList');
    try{
      await loadLabDocumentRequirements();
      const results=await api('GET','/api/lab-documents/mine');
      list.replaceChildren();
      if(!results.items?.length){
        list.textContent='Todavía no hay documentos de prueba. Podés enviar una referencia SIM- para simular una renovación.';
        return;
      }
      const heading=document.createElement('p');heading.className='hint';
      heading.textContent='Historial de registros ficticios; las actualizaciones no borran las versiones anteriores.';
      list.append(heading);
      for(const entry of results.items){
        const item=document.createElement('div');item.className='service-review-item';
        const title=document.createElement('strong');title.textContent=labDocLabel(entry.document_type)+' · '+entry.fictional_reference;
        const body=document.createElement('p');
        body.textContent=labDocumentStatus(entry)+(entry.reviewer_note?'\nRevisión: '+entry.reviewer_note:'');
        item.append(title,body);
        if(entry.has_evidence)addLabEvidenceViewer(entry,item,el('proLabDocStatus'));
        if(['pending','needs_more'].includes(entry.status)){
          const actions=document.createElement('div');actions.className='lab-doc-evidence-actions';
          const demo=document.createElement('button');
          demo.type='button';demo.className='secondary';
          demo.textContent=entry.has_evidence?'Reemplazar con PDF ficticio':'Generar y adjuntar PDF ficticio';
          demo.addEventListener('click',async()=>{
            demo.disabled=true;
            const status=el('proLabDocStatus');
            try{
              await api('POST','/api/lab-documents/mine/'+encodeURIComponent(entry.id)+'/evidence/demo');
              status.textContent='PDF ficticio generado. Volvé a abrirlo para ver la fecha que figura en el documento.';
              await loadMyLabDocuments();
            }catch(error){status.textContent='Error generando respaldo: '+error.message;demo.disabled=false;}
          });
          const uploadLabel=document.createElement('label');
          uploadLabel.textContent='O adjuntar una foto / PDF inventado:';
          const fileInput=document.createElement('input');
          fileInput.type='file';fileInput.accept='application/pdf,image/jpeg,image/png,image/webp';
          fileInput.addEventListener('change',()=>{
            const file=fileInput.files?.[0];
            if(file)void submitLabEvidenceUpload(entry.id,file,el('proLabDocStatus'));
          });
          uploadLabel.append(fileInput);
          actions.append(demo,uploadLabel);
          item.append(actions);
        }
        list.append(item);
      }
    }catch(error){list.textContent='Error al consultar la documentación de prueba: '+error.message;}
  }
  async function submitLabDocument(event){
    event.preventDefault();
    if(profile?.role!=='professional')return;
    const type=el('labDocType').value,reference=el('labDocReference').value.trim();
    const expiresOn=el('labDocExpiry').value||null;
    const status=el('proLabDocStatus');
    if(!/^SIM-[A-Za-z0-9-]{3,100}$/.test(reference)){
      status.textContent='Solo referencias inventadas que comiencen con SIM-; nunca documentos reales.';return;
    }
    const button=el('proLabDocForm').querySelector('button[type="submit"]');
    if(button.disabled)return;
    button.disabled=true;
    try{
      const result=await api('POST','/api/lab-documents/mine',{type,reference,expiresOn});
      status.textContent=result.alreadyPending
        ? 'Ya existía un registro pendiente. Adjuntale un PDF ficticio desde el listado para que pueda revisarse.'
        : 'Declaración guardada. AHORA adjuntá un PDF o foto ficticios para justificarla; todavía no está verificada.';
      el('labDocReference').value='';el('labDocExpiry').value='';
      await loadMyLabDocuments();
    }catch(error){status.textContent='No se pudo registrar la simulación: '+error.message;}
    finally{button.disabled=false;}
  }
  async function loadLabDocumentsQueue(){
    if(!['admin','subadmin'].includes(profile?.role))return;
    const panel=el('labDocsQueue'),status=el('labDocsQueueStatus');
    panel.textContent='Consultando expedientes de prueba...';
    try{
      const result=await api('GET','/api/lab-documents/queue');
      panel.replaceChildren();
      status.textContent=result.items?.length
        ? result.items.length+' registro(s) ficticio(s) a revisar. No se han verificado documentos reales.'
        : 'No hay nuevas declaraciones documentales pendientes.';
      if(!result.items?.length){panel.textContent='Sin registros pendientes.';return;}
      for(const doc of result.items){
        const article=document.createElement('div');article.className='service-review-item';
        const title=document.createElement('strong');
        title.textContent=doc.professional_name+' · '+labDocLabel(doc.document_type);
        const info=document.createElement('p');
        info.textContent='Referencia ficticia: '+doc.fictional_reference+
          (doc.expires_on?'\nVencimiento informado: '+doc.expires_on:'\nSin fecha de vencimiento');
        const evidenceNotice=document.createElement('p');
        evidenceNotice.className='hint';
        evidenceNotice.textContent=doc.has_evidence
          ? 'Hay un respaldo privado. Abrilo y compará su fecha antes de aprobar.'
          : 'FALTA RESPALDO: solo puede solicitarse una corrección o rechazar el registro.';
        article.append(title,info,evidenceNotice);
        addLabEvidenceViewer(doc,article,status);
        const label=document.createElement('label');
        label.textContent='Observación para el profesional';
        const note=document.createElement('textarea');
        note.rows=2;note.maxLength=600;
        note.placeholder='Ej.: SIMULACIÓN: falta indicar la vigencia del seguro.';
        const buttons=document.createElement('div');buttons.className='actions';
        for(const [value,name] of [
          ['needs_more','Solicitar corrección'],
          ['reviewed_test_only','Revisado para prueba'],
          ['rejected','Rechazar registro ficticio']
        ]){
          const btn=document.createElement('button');
          btn.type='button';btn.className='secondary';btn.textContent=name;
          if(value==='reviewed_test_only'&&!doc.has_evidence){
            btn.disabled=true;btn.title='Falta PDF o imagen de respaldo.';}
          btn.addEventListener('click',async()=>{
            if(note.value.trim().length<8){
              status.textContent='Escribí una observación de al menos 8 caracteres.';
              note.focus();return;
            }
            if(!confirm('¿Registrar decisión sobre datos SIMULADOS? Esto no aprueba identidad ni documentación real.'))return;
            btn.disabled=true;
            try{
              await api('POST','/api/lab-documents/queue/'+encodeURIComponent(doc.id)+'/review',
                {decision:value,note:note.value.trim()});
              await loadLabDocumentsQueue();
            }catch(error){status.textContent='Error: '+error.message;btn.disabled=false;}
          });
          buttons.append(btn);
        }
        article.append(label,note,buttons);
        panel.append(article);
      }
    }catch(error){panel.textContent='Error al consultar revisión: '+error.message;}
  }
  // Only the general administrator may read this immutable-by-UI lab audit view.
  async function loadLabAuditHistory(){
    if(profile?.role!=='admin')return;
    const list=el('labAuditList'),status=el('labAuditStatus');
    list.textContent='Consultando actuaciones registradas...';
    try{
      const result=await api('GET','/api/lab-documents/audit');
      list.replaceChildren();
      status.textContent=(result.items||[]).length+
        ' actuación(es) de laboratorio. Vista de solo lectura.';
      if(!result.items?.length){
        list.textContent='Todavía no hay actuaciones documentales registradas.';
        return;
      }
      const names={
        lab_doc_reviewed:'Revisión documental',
        lab_doc_duplicate_superseded:'Duplicado conservado',
        lab_subadmin_created:'Alta de subadministrador'
      };
      const decisions={
        reviewed_test_only:'Revisado para prueba',
        needs_more:'Corrección solicitada',
        rejected:'Rechazado'
      };
      for(const event of result.items){
        const row=document.createElement('div');
        row.className='service-review-item';
        const heading=document.createElement('strong');
        let when='Fecha no disponible';
        if(event.created_at){
          const date=new Date(event.created_at);
          if(!Number.isNaN(date.getTime())){
            when=new Intl.DateTimeFormat('es-AR',{
              dateStyle:'short',timeStyle:'short',
              timeZone:'America/Argentina/Buenos_Aires'
            }).format(date);
          }
        }
        heading.textContent=(names[event.action]||'Actuación administrativa')+' · '+when;
        const detail=document.createElement('p');
        const lines=[
          'Responsable: '+(event.actor_name||'Sistema')+
            (event.actor_id?' (ID '+event.actor_id+')':''),
          event.professional_name?'Profesional: '+event.professional_name:null,
          event.fictional_reference
            ?'Documento: '+labDocLabel(event.document_type)+' · '+event.fictional_reference:null,
          event.decision?'Decisión: '+(decisions[event.decision]||event.decision):null,
          event.created_staff_name
            ?'Subadministrador creado: '+event.created_staff_name:null,
          event.review_note?'Observación: '+event.review_note:null
        ];
        detail.textContent=lines.filter(Boolean).join('\n');
        row.append(heading,detail);
        list.append(row);
      }
    }catch(error){
      list.textContent='No se pudo consultar el historial: '+error.message;
      status.textContent='';
    }
  }

  async function createLabSubadmin(event){
    event.preventDefault();
    if(profile?.role!=='admin')return;
    const status=el('labStaffCreateStatus');
    const email=el('labStaffEmail').value.trim().toLowerCase();
    if(!email.endsWith('@test.invalid')){
      status.textContent='Usá un correo ficticio terminado en @test.invalid.';return;
    }
    try{
      const data=await api('POST','/api/lab-documents/staff',{
        name:el('labStaffName').value.trim(),
        email,password:el('labStaffPassword').value
      });
      el('labStaffPassword').value='';
      status.textContent='Subadministrador de prueba creado, ID '+data.user.id+
        '. Accede únicamente a la revisión de documentos ficticios.';
      await loadLabStaff();
    }catch(error){el('labStaffPassword').value='';status.textContent='No se creó la cuenta: '+error.message;}
  }
  async function loadLabStaff(){
    if(profile?.role!=='admin')return;
    const list=el('labStaffList');
    try{
      const result=await api('GET','/api/lab-documents/staff');
      list.textContent=(result.items||[]).length
        ? result.items.map(x=>x.name+' (ID '+x.id+') · '+(x.document_review?'Permiso: revisión documental':'Sin permiso')+' · '+x.status).join('\n')
        : 'No hay subadministradores de prueba creados.';
    }catch(error){list.textContent='No se pudieron listar revisores: '+error.message;}
  }

  function renderProfessionFinder(panelId,searchId){
    const panel=el(panelId);
    if(!panel)return;
    const query=el(searchId).value;
    const found=labProfessionCatalog.filter(p=>professionMatches(p,query));
    panel.replaceChildren();
    if(!labProfessionCatalog.length){
      panel.textContent='Cargando catálogo de profesiones...';return;
    }
    if(!found.length){
      panel.textContent='No encontramos ese oficio en el catálogo. Podrá solicitarse su incorporación a Administración.';return;
    }
    const count=document.createElement('p');
    count.className='hint';
    count.textContent=found.length+' oficio(s) encontrado(s).';
    panel.append(count);
    for(const profession of found.slice(0,35)){
      const item=document.createElement('div');
      item.className='profession-result';
      const title=document.createElement('strong');title.textContent=profession.title;
      const category=document.createElement('small');category.textContent=profession.category;
      const description=document.createElement('p');description.textContent=profession.description;
      item.append(title,category,description);
      if(profession.credential_note){
        const note=document.createElement('p');
        note.className='hint';note.textContent=profession.credential_note;
        item.append(note);
      }
      panel.append(item);
    }
  }
  // El cliente describe el problema: primero recomendamos, luego elige.
  // No se asigna una especialidad ni se crea una solicitud sin confirmación.
  function clientProfessionMatches(query,heaterType=''){
    const phrase=professionNormalized(query).replace(/[^\p{L}\p{N}\s]/gu,' ')
      .replace(/\s+/g,' ').trim();
    if(phrase.length<2)return [];
    const common=new Set(['una','uno','con','del','por','para','este','esta',
      'necesito','quiero','tengo','tiene','hay','mis','sus','las','los',
      'el','la','en','al','un','mi','se','me','que','como','no','de',
      'falla','fallo','funciona','funcionar','funcionan','arreglar',
      'reparar','reparacion','roto','rota','rompio','rompió',
      'problema','anda','hacer','estoy','servicio','servicios','y']);
    const terms=phrase.split(' ').filter(word=>word.length>=2&&!common.has(word));
    if(!terms.length)return [];
    const heater=terms.some(term=>term.startsWith('termotanque')||term.startsWith('calefon'));
    const gas=heaterType==='gas';
    const electric=heaterType==='electrico';
    const ranked=labProfessionCatalog.map(profession=>{
      const title=professionNormalized(profession.title);
      const aliases=(profession.aliases||[]).map(professionNormalized);
      const labels=[title,...aliases];
      const desc=professionNormalized(profession.description);
      const exact=labels.some(label=>label===phrase);
      const includesPhrase=phrase.length>=3&&labels.some(label=>label.includes(phrase));
      const tokenScore=terms.reduce((score,term)=>{
        if(title.includes(term))return score+22;
        if(aliases.some(alias=>alias.includes(term)))return score+18;
        if(desc.includes(term))return score+3;
        return score;
      },0);
      let score=exact?180:includesPhrase?100:tokenScore;
      // Para equipos de agua caliente la consulta es orientativa, NO un diagnóstico.
      // Gasista es prioritario para artefactos a gas; plomero para circuito de agua.
      if(heater){
        if(gas&&profession.profession_key==='gasista')score+=200;
        else if(electric&&profession.profession_key==='electricista')score+=200;
      }
      return {profession,score};
    }).filter(item=>item.score>0)
      .sort((a,b)=>b.score-a.score||a.profession.title.localeCompare(b.profession.title,'es-AR'));
    if(heater){
      // Nunca ocultar al segundo oficio por tener menor puntuación.
      const keys=gas?['gasista','plomero']:
        electric?['electricista','plomero']:
          ['gasista','plomero','electricista'];
      return keys.map(key=>labProfessionCatalog.find(p=>p.profession_key===key))
        .filter(Boolean);
    }
    if(!ranked.length)return [];
    // Las palabras genéricas ("agua", "reparar") no deben poner a un
    // piletero a la par de un plomero si el cliente especificó una canilla.
    const floor=Math.max(12,Math.ceil(ranked[0].score*0.68));
    return ranked.filter(item=>item.score>=floor).slice(0,6).map(item=>item.profession);
  }
  // Una respuesta elegida por el cliente tiene prioridad sobre lo escrito.
  // Si el cliente ya puso "a gas" o "eléctrico", preseleccionamos la opción
  // correspondiente, pero puede corregirla antes de elegir al profesional.
  let manualHeaterType='';
  function heaterTypeFromDescription(phrase){
    const normalized=professionNormalized(phrase);
    if(/\b(?:a|de) gas\b|\bgasista\b/.test(normalized))return 'gas';
    if(/\belectric[oa]s?\b/.test(normalized))return 'electrico';
    return '';
  }
  function requestIsHeater(phrase){
    return /termotanque|calefon/.test(professionNormalized(phrase));
  }

  // El ejemplo se adapta al problema sin modificar lo que el cliente escribió.
  function updateRequestDescriptionExample(phrase,heaterType=''){
    const field=el('requestDescription');
    if(!field)return;
    const normalized=professionNormalized(phrase);
    if(requestIsHeater(phrase)){
      if(heaterType==='gas'){
        field.placeholder='Ejemplo: Mi termotanque a gas no calienta el agua. Indicá qué sucede cuando intentás usarlo y desde cuándo ocurre.';
      }else if(heaterType==='electrico'){
        field.placeholder='Ejemplo: Mi termotanque eléctrico no calienta el agua. Contá desde cuándo pasa y qué síntomas observaste.';
      }else{
        field.placeholder='Ejemplo: Mi termotanque no calienta el agua. No sé si es a gas o eléctrico. Contá qué sucede y desde cuándo.';
      }
    }else if(/canilla|plomer|fontaner|perdida de agua|falta de agua|sin agua/.test(normalized)){
      field.placeholder='Ejemplo: La canilla pierde agua aunque está cerrada. Contá dónde ocurre y desde cuándo.';
    }else if(/aire acondicionado|acondicionador de aire|split/.test(normalized)){
      field.placeholder='Ejemplo: Mi aire acondicionado no enfría bien. Contá qué sucede y desde cuándo pasa.';
    }else if(/heladera|refriger|freezer/.test(normalized)){
      field.placeholder='Ejemplo: Mi heladera no enfría bien. Describí qué sucede y desde cuándo ocurre.';
    }else if(/electric|luz|enchufe|termica|cable/.test(normalized)){
      field.placeholder='Ejemplo: Un enchufe dejó de funcionar. Describí el problema sin manipular la instalación.';
    }else if(phrase){
      field.placeholder='Ejemplo: '+phrase.slice(0,80)+'. Agregá qué sucede, dónde y desde cuándo.';
    }else{
      field.placeholder='Describí el problema, qué sucede y desde cuándo. Ejemplo: La canilla pierde agua.';
    }
  }


  // Recomendaciones precisas: se basan en la oferta declarada, NO solo en el
  // rubro general. Una opción sin profesionales aprobados no se ofrece para contratar.
  function matchedLabServices(phrase,heaterType=''){
    const query=professionNormalized(phrase);
    if(query.length<3||!labServiceCatalog.length)return [];
    const kind=/termotanque|calefon/.test(query)?'heater':
      /lavasecarropas?|secarropas?|secadora/.test(query)?'dryer':
      /lavarropas?|lavadora/.test(query)?'washer':
      /heladera|freezer/.test(query)?'fridge':
      /aire acondicionado|acondicionador de aire|\baire\b|\bsplit\b/.test(query)?'air':'other';
    if(kind==='heater'&&!heaterType)return [];
    const stopwords=new Set(['mi','mis','el','la','los','las','se','no','que','tengo','tiene','un','una',
      'me','de','a','en','por','con','para','del','anda','funciona','averio','roto','rompio',
      'necesito','quiero','reparar','arreglar','esta','hace','hizo','mal']);
    const tokens=query.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/)
      .filter(x=>x.length>2&&!stopwords.has(x));
    const rows=labServiceCatalog.map(service=>{
      const title=professionNormalized(service.service_name);
      const keywords=(service.keywords||[]).map(professionNormalized);
      if(kind==='washer'&&!/lavarropas/.test(title))return {service,score:0};
      if(kind==='dryer'&&!/secarropas/.test(title))return {service,score:0};
      if(kind==='fridge'&&!/heladera/.test(title))return {service,score:0};
      if(kind==='air'&&!/aires acondicionados/.test(title))return {service,score:0};
      if(kind==='heater'){
        if(!/termotanque|calefon/.test(title))return {service,score:0};
        if(heaterType==='gas'&&/electric/.test(title))return {service,score:0};
        if(heaterType==='electrico'&&/a gas/.test(title))return {service,score:0};
      }
      let score=0;
      for(const word of tokens){
        if(title.includes(word))score+=22;
        else if(keywords.some(k=>k.includes(word)))score+=15;
      }
      if(kind!=='other')score+=70;
      return {service,score};
    }).filter(entry=>entry.score>0)
      .sort((a,b)=>
        Number(Number(b.service.eligible_professional_count)>0)-Number(Number(a.service.eligible_professional_count)>0)||
        b.score-a.score||
        a.service.service_name.localeCompare(b.service.service_name,'es-AR'));
    return rows.slice(0,10).map(x=>x.service);
  }
  function renderClientServiceChoices(phrase,heaterType,notice,options,hidden){
    const suggestions=matchedLabServices(phrase,heaterType);
    if(!suggestions.length)return false;
    const available=suggestions.filter(s=>Number(s.eligible_professional_count)>0).length;
    notice.textContent=available
      ? 'Encontramos '+suggestions.length+' tipos de servicio relacionados. '+available+
        ' cuentan con profesionales habilitados actualmente para recibir presupuestos. Elegí el que necesitás:'
      : 'Encontramos estos tipos de trabajo, pero por ahora no hay profesionales habilitados para recibir nuevas solicitudes. Los servicios pueden estar aprobados sin estar disponibles.';
    if(heaterType==='gas'||heaterType==='electrico'){
      notice.textContent+=' Según la falla podría intervenir más de un oficio; el diagnóstico lo confirma el profesional.';
    }
    for(const service of suggestions){
      const choice=document.createElement('button');choice.type='button';
      choice.className='specialty-choice';
      const count=Number(service.eligible_professional_count)||0;
      const approved=Number(service.approved_professional_count)||0;
      choice.disabled=count===0;choice.setAttribute('aria-pressed','false');
      const title=document.createElement('strong');
      title.textContent=service.service_name+' · '+service.profession_name;
      const caption=document.createElement('small');
      caption.textContent=count
        ? count+' profesional(es) aprobado(s) disponible(s) para nuevas cotizaciones en el laboratorio.'
        : approved
          ? 'Este servicio está aprobado, pero ningún profesional puede presupuestarlo actualmente.'
          : 'Todavía no hay profesionales aprobados que ofrezcan este trabajo.';
      const action=document.createElement('span');
      action.className='specialty-choice-action';
      action.textContent=count?'Elegir este servicio':'No disponible actualmente';
      choice.append(title,caption,action);
      choice.addEventListener('click',()=>{
        hidden.value=String(service.specialty_id);
        el('requestServiceId').value=String(service.service_id);
        notice.classList.remove('specialty-warning');
        notice.classList.add('specialty-found');
        notice.textContent='✓ Servicio seleccionado: '+service.service_name+
          ' ('+service.profession_name+'). Solo podrá recibirlo alguien aprobado que declaró este servicio.';
        for(const button of options.querySelectorAll('button.specialty-choice')){
          const selected=button===choice;
          button.classList.toggle('selected',selected);
          button.setAttribute('aria-pressed',String(selected));
          button.querySelector('.specialty-choice-action').textContent=selected?'✓ Servicio elegido':'Elegir este servicio';
        }
      });
      options.append(choice);
    }
    if(!available){
      notice.classList.add('specialty-warning');
      const hint=document.createElement('p');
      hint.className='hint';
      hint.textContent='Una especialidad puede estar registrada y aprobada sin tener profesionales disponibles para presupuestar. Cuando haya uno habilitado, aparecerá como disponible.';
      options.append(hint);
    }
    return true;
  }

  function renderClientSpecialtyOptions(){
    const input=el('requestSpecialtySearch');
    const hidden=el('requestSpecialty');
    const notice=el('requestSpecialtyMatch');
    const options=el('requestSpecialtyMatches');
    const guide=el('requestHeaterGuide');
    const phrase=input.value.trim();
    const heater=requestIsHeater(phrase);
    updateRequestDescriptionExample(phrase,heater?(manualHeaterType||heaterTypeFromDescription(phrase)):'');
    guide.hidden=!heater;
    if(!heater)manualHeaterType='';
    hidden.value='';
    el('requestServiceId').value='';
    notice.classList.remove('specialty-found','specialty-warning');
    options.replaceChildren();
    if(!phrase){
      notice.textContent='Contanos qué necesitás reparar y te sugerimos quién puede ayudarte.';
      return;
    }
    if(!labProfessionCatalog.length){
      notice.textContent='Cargando las especialidades...';
      return;
    }
    let heaterType='';
    if(heater){
      heaterType=manualHeaterType||heaterTypeFromDescription(phrase);
      for(const radio of guide.querySelectorAll('input[type="radio"]')){
        radio.checked=radio.value===heaterType;
      }
      if(!heaterType){
        notice.textContent='Elegí si es a gas, eléctrico o si no sabés. Así podemos orientar mejor tu solicitud.';
        return;
      }
    }
    // Prefer precise services if the catalog recognizes the customer's problem.
    if(renderClientServiceChoices(phrase,heaterType,notice,options,hidden))return;
    const found=clientProfessionMatches(phrase,heaterType);
    if(!found.length){
      notice.classList.add('specialty-warning');
      notice.textContent='Todavía no encontramos un oficio claro para "'+phrase+
        '". Contanos qué elemento no funciona (por ejemplo: canilla, heladera o techo).';
      return;
    }
    if(heater){
      if(heaterType==='gas'){
        notice.textContent='Para un termotanque a gas, te sugerimos Gasista habilitado para el artefacto y Plomero si el problema está en el agua. No podemos determinar la causa sin revisarlo.';
      }else if(heaterType==='electrico'){
        notice.textContent='Para un termotanque eléctrico, te sugerimos Electricista para la alimentación y Plomero para el circuito de agua. Es una orientación, no un diagnóstico.';
      }else{
        notice.textContent='No hay problema si no sabés el tipo. Te mostramos los oficios posibles; podés elegir uno o describir más síntomas.';
      }
    }else{
      notice.textContent=found.length===1
        ? 'Por lo que escribiste, te sugerimos esta especialidad:'
        : 'Por lo que escribiste, hay varias especialidades posibles. Elegí la que mejor corresponda:';
    }
    // Una sugerencia NO es una selección: el usuario debe pulsar Elegir.
    notice.textContent+=' Todavía no elegiste ninguna especialidad. Tocá «Elegir» para confirmarla.';
    for(const [index,profession] of found.entries()){
      const choice=document.createElement('button');
      choice.className='specialty-choice';
      choice.type='button';
      choice.dataset.professionTitle=profession.title;
      choice.setAttribute('aria-pressed','false');
      const label=document.createElement('strong');
      label.textContent=heater&&heaterType==='no_se'
        ? 'Opción posible: '+profession.title
        : (index===0?'Sugerencia principal: ':'Otra opción: ')+profession.title;
      const desc=document.createElement('small');
      if(heater&&profession.profession_key==='gasista'){
        desc.textContent='Para el encendido, quemador e instalaciones de gas, con la habilitación correspondiente.';
      }else if(heater&&profession.profession_key==='plomero'){
        desc.textContent='Para cañerías, pérdidas, presión y abastecimiento de agua. No habilita a intervenir instalaciones de gas.';
      }else if(heater&&profession.profession_key==='electricista'){
        desc.textContent='Para alimentación y controles eléctricos, con la habilitación que corresponda.';
      }else{
        desc.textContent=profession.description;
      }
      const action=document.createElement('span');
      action.className='specialty-choice-action';
      action.textContent='Elegir '+profession.title;
      choice.append(label,desc,action);
      choice.addEventListener('click',()=>{
        hidden.value=String(profession.specialty_id);
        notice.classList.remove('specialty-warning');
        notice.classList.add('specialty-found');
        notice.textContent='✓ Especialidad seleccionada: '+profession.title+
          '. La selección quedó confirmada. Ahora completá los datos para crear la solicitud.';
        for(const button of options.querySelectorAll('button.specialty-choice')){
          const selected=button===choice;
          button.classList.toggle('selected',selected);
          button.setAttribute('aria-pressed',String(selected));
          const buttonAction=button.querySelector('.specialty-choice-action');
          const buttonTitle=button.dataset.professionTitle||'';
          if(buttonAction){
            buttonAction.textContent=selected
              ? '✓ Seleccionaste '+buttonTitle
              : 'Elegir '+buttonTitle;
          }
        }
      });
      options.append(choice);
    }
    if(heater){
      const hint=document.createElement('p');
      hint.className='hint';
      hint.textContent='Un mismo problema puede necesitar más de un oficio. Por ahora, esta solicitud comienza con uno: describí todos los síntomas para facilitar la revisión. Si sentís olor a gas, comunicate directamente con emergencias de la distribuidora; no esperes una respuesta por esta plataforma.';
      options.append(hint);
    }
  }

  function select(role) {
    choice = role;
    el('roleClient').classList.toggle('active', role === 'client');
    el('rolePro').classList.toggle('active', role === 'professional');
    el('roleClient').setAttribute('aria-pressed',String(role === 'client'));
    el('rolePro').setAttribute('aria-pressed',String(role === 'professional'));
    el('registerHeading').textContent = role === 'client' ? 'Registrar cliente de prueba' : 'Registrar profesional de prueba';
    el('regName').placeholder = role === 'client' ? 'Ejemplo: Cliente de Prueba' : 'Ejemplo: Profesional de Prueba';
    el('regEmail').placeholder = role === 'client' ? 'cliente360@test.invalid' : 'profesional360@test.invalid';
    el('registerProfessionSearchBox').hidden=role!=='professional';
    if(role==='professional')renderProfessionFinder('guestProfessionList','guestProfessionSearch');
  }
  function view(tab) {
    const isReg = tab === 'register';
    el('registerForm').hidden = !isReg;
    el('loginForm').hidden = isReg;
    el('showRegister').classList.toggle('active',isReg);
    el('showLogin').classList.toggle('active',!isReg);
    feedback('');
  }
  function render() {
    el('guest').hidden = !!profile;
    el('signedIn').hidden = !profile;
    if (!profile) return;
    el('profileName').textContent = profile.name || '—';
    el('profileRole').textContent = profile.role === 'professional' ? 'Profesional' : profile.role === 'client' ? 'Cliente' : profile.role === 'subadmin' ? 'Subadministrador documental' : 'Administrador';
    el('profileId').textContent = String(profile.id || '—');
    el('roleNotice').textContent = profile.role === 'admin'
      ? 'Administración de laboratorio: sólo aprobación ficticia, sin documentos personales.'
      : profile.role === 'professional'
      ? 'Cuenta profesional de laboratorio. Consultá solicitudes disponibles y tus trabajos contratados. No hay datos reales.'
      : profile.role === 'subadmin'
      ? 'Revisor limitado de documentación ficticia. No tenés acceso a reclamos ni a aprobación general.'
      : 'Tu cuenta ficticia ya puede iniciar sesión. Las solicitudes serán exclusivamente de prueba.';
    el('jobsPanel').textContent = '';
    el('adminSection').hidden = profile.role !== 'admin';
    el('documentReviewSection').hidden=!['admin','subadmin'].includes(profile.role);
    el('labSubadminManagement').hidden=profile.role!=='admin';
    el('labAuditSection').hidden=profile.role!=='admin';
    el('refreshJobs').hidden=profile.role==='subadmin';
    el('proDocExpirySection').hidden=profile.role!=='professional';
    if(['admin','subadmin'].includes(profile.role))void loadLabDocumentsQueue();
    if(profile.role==='professional')void loadMyLabDocuments();
    el('contractsSection').hidden = profile.role !== 'professional';
    el('myQuotesSection').hidden = profile.role !== 'professional';
    el('proProfessionCatalogSection').hidden=profile.role!=='professional';
    if(profile.role==='professional'){renderProfessionFinder('proProfessionList','proProfessionSearch');void loadMyDeclaredServices();}
    if(profile.role === 'professional') void loadMyQuotes();
    if(profile.role!=='subadmin')void loadClaimInbox();
    if (profile.role === 'professional') void loadContracts();
    
el('clientRequestSection').hidden = profile.role !== 'client';
if (profile.role === 'client') void loadClientSpecialties();

    if(profile.role === 'admin') { void loadProfessionals(); void loadServiceReviews(); void loadAdminClaims(); void loadLabReminderLedger(); void loadClaimPerformance(); }
  }
  async function activate(data) {
    token = data.token;
    profile = data.user;
    sessionStorage.setItem(tokenKey, token);
    el('regPassword').value = '';
    el('loginPassword').value = '';
    render();
    feedback('Cuenta de prueba activa.');
  }
  async function handleRegistration(event) {
    event.preventDefault();
    const name = el('regName').value.trim();
    const email = el('regEmail').value.trim().toLowerCase();
    const password = el('regPassword').value;
    if (!email.endsWith('@test.invalid')) {
      feedback('Para esta prueba usá un correo inventado terminado en @test.invalid.',true);
      return;
    }
    const selectedServices=choice==='professional'?[...registrationServiceIds].map(Number):[];
    const button=el('registerButton');
    button.disabled = true;
    try {
      const data=await api('POST','/api/auth/register',{ name,email,password,role:choice },'');
      await activate(data);
      if(choice==='professional'&&selectedServices.length){
        try{
          await api('POST','/api/lab-services/mine',{serviceIds:selectedServices},data.token);
          registrationServiceIds.clear();await loadMyDeclaredServices();
          feedback('Cuenta creada. Tus trabajos declarados quedaron pendientes de revisión.');
        }catch(error){feedback('Cuenta creada, pero no se guardaron los trabajos: '+error.message,true);}
      }
    } catch(err) {
      feedback(err.message,true);
    } finally {
      button.disabled=false;
      el('regPassword').value = '';
    }
  }
  async function handleLogin(event) {
    event.preventDefault();
    const button=el('loginButton');
    button.disabled=true;
    try {
      const data=await api('POST','/api/auth/login',{
        email:el('loginEmail').value.trim().toLowerCase(),
        password:el('loginPassword').value
      },'');
      await activate(data);
    }catch(err){
      feedback(err.message,true);
    }finally{
      button.disabled=false;
      el('loginPassword').value='';
    }
  }
  async function restore() {
    if (!token) return;
    try {
      const data = await api('GET','/api/auth/me');
      profile=data.user;
      render();
    } catch {
      token='';
      sessionStorage.removeItem(tokenKey);
      render();
    }
  }
  let displayedJobs = [];
  let openedJob = null;
  async function refreshJobs() {
    const panel = el('jobsPanel');
    el('jobDetailPanel').hidden = true;
    openedJob = null;
    window.labTechnical.close();
    el('jobClaimHistory').hidden = true;
    panel.replaceChildren();
    try {
      displayedJobs = await api('GET', '/api/jobs');
      if (!displayedJobs.length) {
        panel.textContent = profile?.role === 'professional'
          ? 'No hay solicitudes abiertas para tu especialidad en este momento.'
          : 'Todavía no hay solicitudes de prueba para mostrar.';
        return;
      }
      const headline = document.createElement('p');
      headline.textContent = 'Solicitudes de prueba disponibles: ' + displayedJobs.length;
      panel.append(headline);
      displayedJobs.forEach(job => {
        const line = document.createElement('div');
        line.className = 'jobspanel';
        const summary = document.createElement('span');
        summary.textContent = job.public_code + ' · ' + job.locality + ' · ' + statusLabel(job.status,job) + ' ';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = profile?.role === 'client' && ['confirmed','in_progress','completed'].includes(job.status)
          ? 'Seguir trabajo' : 'Ver solicitud';
        button.addEventListener('click', () => void openJob(job));
        line.append(summary, button);
        panel.append(line);
      });
    } catch(error) { panel.textContent = error.message; }
  }

  // Only the authenticated professional's accepted contracts come from /api/jobs/mine.
  async function loadMyQuotes() {
    if(profile?.role !== 'professional') return;
    const panel=el('myQuotesPanel');
    panel.textContent='Consultando presupuestos...';
    try {
      const quotes=await api('GET','/api/jobs/mine/quotes');
      panel.replaceChildren();
      if(!quotes.length){panel.textContent='Todavía no enviaste presupuestos.';return;}
      for(const quote of quotes){
        const card=document.createElement('div');card.className='jobspanel';
        const title=document.createElement('strong');
        title.textContent='Solicitud '+quote.public_code+' · '+quote.locality;
        const details=document.createElement('p');
        details.textContent='Presupuesto N.º '+quote.id+
          '\nImporte ARS '+quote.amount+' · Garantía '+quote.warranty_days+' días'+
          '\nEstado del presupuesto: '+statusLabel(quote.status)+
          '\nEstado del trabajo: '+statusLabel(quote.job_status)+
          '\nDetalle: '+quote.description;
        const open=document.createElement('button');
        open.type='button';open.className='secondary';
        open.textContent='Ver consultas y preparar visita';
        open.addEventListener('click',()=>void openJob({
          id:quote.job_id,public_code:quote.public_code,
          locality:quote.locality,status:quote.job_status,
          description:quote.job_description
        }));
        card.append(title,details,open);panel.append(card);
      }
    }catch(error){panel.textContent='No se pudieron consultar los presupuestos: '+error.message;}
  }

  async function loadContracts() {
    if (profile?.role !== 'professional') return;
    const panel = el('contractsPanel');
    panel.replaceChildren();
    panel.textContent = 'Consultando trabajos contratados...';
    try {
      const contracts = await api('GET', '/api/jobs/mine');
      panel.replaceChildren();
      if (!contracts.length) {
        panel.textContent = 'Todavía no tenés trabajos contratados.';
        return;
      }
      for (const job of contracts) {
        const line = document.createElement('div');
        line.className = 'jobspanel';
        const summary = document.createElement('p');
        summary.textContent = job.public_code + ' · ' + job.locality +
          ' · ' + statusLabel(job.status,job) + ' · ARS ' + job.amount;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = 'Ver trabajo contratado';
        button.addEventListener('click', () => void openJob(job));
        line.append(summary, button);
        panel.append(line);
      }
    } catch (error) {
      panel.textContent = 'No se pudieron consultar los trabajos: ' + error.message;
    }
  }

  const statusLabels = {
    requested: 'Solicitado', quoted: 'Presupuestado', submitted: 'Enviado',
    confirmed: 'Contratado', in_progress: 'En ejecución',
    completed: 'Finalización informada · pendiente de revisión', cancelled: 'Cancelado',
    accepted: 'Aceptado', not_selected: 'No seleccionado', rejected: 'Rechazado',
    withdrawn: 'Retirado', open: 'Abierto', in_review: 'En revisión',
    resolved: 'Resuelto', dismissed: 'Desestimado', scheduled: 'Programado'
  };
  const statusLabel = (status, job = null) =>
    status === 'completed' && job?.client_approved === true
      ? 'Finalizado con conformidad del cliente'
      : (statusLabels[status] || status);
  const warrantyStatusLabel = (status) =>
    status === 'completed' ? 'Intervención completada' : statusLabel(status);

  const displayArgDate=value=>new Date(value).toLocaleString('es-AR',{
    timeZone:'America/Argentina/Buenos_Aires',hour12:false
  });
  function claimResponseNotice(window){
    if(!window)return '';
    if(window.state==='calendar_pending'){
      return 'Plazo sin calcular: falta configurar el calendario hábil correspondiente. Administración debe revisarlo.';
    }
    if(window.state==='responded'){
      return 'Descargo recibido. Se detuvo el plazo para la primera respuesta.';
    }
    const due='Vence: '+displayArgDate(window.dueAt)+' (hora Argentina).';
    if(window.state==='overdue')
      return 'ALERTA INTERNA: transcurrieron las 12 horas hábiles sin descargo. Administración debe revisar el caso. '+due;
    if(window.state==='reminder8')
      return 'SEGUNDO RECORDATORIO INTERNO: transcurrieron 8 horas hábiles sin descargo. '+due;
    if(window.state==='reminder4')
      return 'PRIMER RECORDATORIO INTERNO: transcurrieron 4 horas hábiles sin descargo. '+due;
    return 'Plazo de primera respuesta: 12 horas hábiles (lunes a viernes, 07:00–19:00, excluyendo feriados). '+
      'Primer recordatorio interno: '+displayArgDate(window.firstReminderAt)+'. '+due;
  }


  async function loadJobTimeline(job) {
    const panel = el('jobTimeline');
    panel.textContent = 'Consultando seguimiento...';
    try {
      const events = await api('GET', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/events');
      if (openedJob?.id !== job.id) return;
      const rows = events.map(event => {
        const date = new Date(event.created_at);
        const time = Number.isNaN(date.getTime())
          ? '' : ' · ' + date.toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false});
        return '• ' + (event.note?.includes('Conformidad del cliente') ? 'Conformidad registrada por el cliente' : statusLabel(event.new_status)) + time;
      });
      panel.textContent = 'Seguimiento del trabajo\n' +
        (rows.length ? rows.join('\n') : 'Solicitud registrada. Sin cambios posteriores.');
    } catch (error) {
      panel.textContent = 'No se pudo consultar el seguimiento: ' + error.message;
    }
  }

  async function loadProfessionalReview(job) {
    const panel = el('professionalReview');
    panel.hidden = false;
    panel.textContent = 'Consultando calificación...';
    try {
      const review = await api('GET', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/review');
      if (openedJob?.id !== job.id) return;
      if (review && job.status === 'completed') {
        el('jobDetailText').textContent = el('jobDetailText').textContent.replace(/Estado: [^\n]+/, 'Estado: Finalizado con conformidad del cliente');
      }
      panel.textContent = review
        ? 'Calificación del cliente: ' + review.stars + ' de 5 estrellas' +
          (review.comment ? '\nReseña: ' + review.comment : '')
        : 'Este trabajo todavía no tiene calificación.';
    } catch (error) { panel.textContent = 'No se pudo consultar la calificación: ' + error.message; }
  }

  async function openJob(job) {
    openedJob = job;
    window.labPhotos.openJob(job,profile);
    window.labTechnical.openJob(job,profile);
    el('jobDetailPanel').hidden = false;
    el('professionalReview').hidden = profile?.role !== 'professional';
    el('jobDetailTitle').textContent = 'Seguimiento del trabajo ' + job.public_code;
    el('jobDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadJobTimeline(job);
    void loadJobClaimHistory(job);
    if (profile?.role === 'professional') void loadProfessionalReview(job);
    el('jobDetailText').textContent = 'Descripción: ' + job.description +
      '\nLocalidad: ' + job.locality + '\nEstado: ' + statusLabel(job.status,job);
    el('quoteFeedback').textContent = '';
    el('quoteFeedback').classList.remove('quote-warning');
    el('quoteFeedback').setAttribute('role','status');
    if (profile?.role === 'professional' && ['confirmed','in_progress','completed'].includes(job.status)) {
      el('jobDetailText').textContent += '\nImporte acordado (ARS): ' + job.amount +
        '\nGarantía acordada: ' + job.warranty_days + ' días' +
        (job.quote_description ? '\nPresupuesto: ' + job.quote_description : '');
    }
    const startButton = el('startJobButton');
    startButton.hidden = !(profile?.role === 'professional' && job.status === 'confirmed');
    startButton.disabled = false;
    startButton.onclick = async () => {
      if (!confirm('¿Iniciar el trabajo ' + job.public_code + '?')) return;
      startButton.disabled = true;
      try {
        await api('POST', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/start');
        await loadContracts();
        await openJob({...job, status:'in_progress'});
        el('quoteFeedback').textContent = 'Trabajo iniciado correctamente. Estado: en ejecución.';
      } catch (error) {
        el('quoteFeedback').textContent = 'No se pudo iniciar el trabajo: ' + error.message;
        startButton.disabled = false;
      }
    };
    const completeButton = el('completeJobButton');
    completeButton.hidden = !(profile?.role === 'professional' && job.status === 'in_progress');
    completeButton.disabled = false;
    completeButton.onclick = async () => {
      if (!confirm('¿Informar que terminaste el trabajo ' + job.public_code + '? El cliente todavía debe revisarlo.')) return;
      completeButton.disabled = true;
      try {
        await api('POST', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/report-completed');
        await loadContracts();
        await openJob({...job, status:'completed'});
        el('quoteFeedback').textContent = 'Finalización informada. Pendiente de revisión del cliente; no se realizó ningún pago.';
      } catch (error) {
        el('quoteFeedback').textContent = 'No se pudo informar la finalización: ' + error.message;
        completeButton.disabled = false;
      }
    };
    el('clientCompletionNotice').hidden = true;
    if (job.status === 'completed' && profile?.role === 'client') {
      const noticeJobId = job.id;
      void api('GET', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/review')
        .then(review => {
          if (openedJob?.id !== noticeJobId) return;
          el('clientCompletionNotice').hidden = false;
          el('clientCompletionNotice').textContent = review
            ? 'Conformidad del cliente registrada. El trabajo original está finalizado; podés consultar sus reclamos y garantías en el historial. No se procesó ningún pago.'
            : 'El profesional informó que terminó el trabajo. Queda pendiente la revisión y conformidad del cliente. No se procesó ningún pago.';
        })
        .catch(() => {
          if (openedJob?.id === noticeJobId) el('clientCompletionNotice').hidden = true;
        });
    }
    el('clientReviewSection').hidden = !(profile?.role === 'client' && job.status === 'completed');
    el('clientReviewForm').hidden = true;
    el('clientClaimForm').hidden = true;
    el('reviewResult').textContent = '';
    el('claimResult').textContent = '';
    if (profile?.role === 'client' && job.status === 'completed') void loadClientReviewStatus(job);
    const isProfessional = profile?.role === 'professional';
    el('quoteForm').hidden = !isProfessional || !['requested','quoted'].includes(job.status);
    await loadJobQuotes(job);
  }

  function renderClaimUpdates(container, updates) {
    container.replaceChildren();
    if (!updates.length) {
      container.textContent = 'Todavía no hay intervenciones registradas.';
      return;
    }
    for (const update of updates) {
      const entry = document.createElement('div');
      entry.style.margin = '12px 0';
      entry.style.padding = '10px 12px';
      entry.style.borderLeft = update.action === 'claim_technical_review_requested'
        ? '4px solid #315d9a' : '4px solid #5e687a';
      entry.style.background = 'rgba(128,148,175,.09)';
      entry.style.borderRadius = '5px';
      const heading = document.createElement('strong');
      heading.textContent = update.action === 'claim_technical_review_requested'
        ? 'ADMINISTRACIÓN · Solicitud de revisión técnica'
        : 'PROFESIONAL · Descargo técnico';
      const body = document.createElement('p');
      body.textContent = update.action === 'warranty_client_confirmed' ? 'El cliente confirmó que la corrección fue satisfactoria.' : (update.description || '');
      body.style.margin = '7px 0 0';
      if(update.action === 'claim_warranty_authorized') heading.textContent='ADMINISTRACIÓN · Garantía autorizada';
      if(update.action === 'warranty_client_confirmed') heading.textContent='CLIENTE · Corrección confirmada';
      entry.append(heading,body);
      container.append(entry);
    }
  }

  function appendClaimResolution(item, claim) {
    if (claim.status !== 'resolved') return;
    const box = document.createElement('div');
    box.style.cssText = 'margin:12px 0;padding:10px 12px;border-left:4px solid #315d9a;background:rgba(128,148,175,.09);border-radius:5px';
    const title = document.createElement('strong');
    title.textContent = 'ADMINISTRACIÓN · Reclamo resuelto';
    const detail = document.createElement('p');
    detail.style.margin = '7px 0 0';
    detail.textContent = claim.resolution_note || 'No hay un detalle de resolución disponible.';
    box.append(title, detail);
    item.append(box);
  }

  async function renderClaimCards(panel,claims) {
    panel.replaceChildren();
    if (!claims.length) {panel.textContent='No tenés reclamos pendientes.';return;}
    for(const claim of claims){
        const item = document.createElement('div');
        item.className = 'jobspanel';
        const info = document.createElement('p');
        info.textContent = 'Reclamo ' + claim.id + ' · Trabajo ' + claim.job_id +
          ' · ' + statusLabel(claim.status) + '\nMotivo: ' + claim.reason +
          '\nDescripción: ' + claim.description;
        item.append(info);
        if(profile?.role==='professional' && ['open','in_review'].includes(claim.status)){
          const receipt=document.createElement('div');
          receipt.className='claim-receipt';
          const title=document.createElement('strong');
          title.textContent='Aviso del reclamo en MANTENIMIENTO 360°';
          const state=document.createElement('p');
          state.className='hint';
          if(claim.professional_acknowledged_at){
            state.textContent='Recepción confirmada el '+
              new Date(claim.professional_acknowledged_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false})+
              '. El descargo se presenta por separado.';
          }else{
            state.textContent='Este reclamo está disponible en tu cuenta. Confirmá que tomaste conocimiento; esto no reemplaza tu respuesta técnica.';
            const button=document.createElement('button');
            button.type='button';button.className='secondary';
            button.textContent='Tomé conocimiento del reclamo';
            const result=document.createElement('p');
            result.className='hint';result.setAttribute('role','status');
            button.addEventListener('click',async()=>{
              if(!confirm('¿Confirmás que tomaste conocimiento del reclamo N.º '+claim.id+'? La recepción quedará registrada y tu descargo seguirá pendiente.'))return;
              button.disabled=true;result.textContent='Registrando recepción...';
              try{
                await api('POST','/api/claims/'+encodeURIComponent(String(claim.id))+'/acknowledge');
                await loadClaimInbox();
                if(openedJob && String(openedJob.id)===String(claim.job_id))await loadJobClaimHistory(openedJob);
              }catch(error){
                result.textContent='No se pudo confirmar la recepción: '+error.message;
                button.disabled=false;
              }
            });
            receipt.append(title,state,button,result);
          }
          if(claim.professional_acknowledged_at)receipt.append(title,state);
          item.append(receipt);
          const reminder=document.createElement('div');
          reminder.className='claim-response-clock'+
            (claim.response_window?.state==='overdue'?' overdue':'');
          const text=document.createElement('p');
          text.textContent=claimResponseNotice(claim.response_window);
          reminder.append(text);
          const note=document.createElement('small');
          note.textContent='Seguimiento visible al ingresar o actualizar. WhatsApp y correo todavía no están activos.';
          reminder.append(note);
          item.append(reminder);
        }
        const updates = document.createElement('div');
        item.append(updates);
        let updatesLoaded=false;
        let correctionConfirmed=false;
        try {
          const responses = await api('GET', '/api/claims/' + encodeURIComponent(String(claim.id)) + '/updates');
          correctionConfirmed=responses.some(record=>record.action==='warranty_client_confirmed');
          updatesLoaded=true;
          renderClaimUpdates(updates, responses);
        } catch (err) { updates.textContent = 'No se pudo consultar el descargo: ' + err.message; }
        appendClaimResolution(item, claim);
        try {
          const warranties = await api('GET','/api/claims/'+claim.id+'/warranty');
          const confirmedVisits = new Set((await api('GET','/api/claims/'+claim.id+'/updates')).filter(x=>x.action==='warranty_client_confirmed').map(x=>String(x.warranty_id)));
          for(const visit of warranties){
            const clientConfirmed=Boolean(visit.client_confirmed_at) || confirmedVisits.has(String(visit.id));
            if(clientConfirmed) correctionConfirmed=true;
            const summary=document.createElement('div');
            summary.style.margin='12px 0';
            summary.style.padding='10px 12px';
            summary.style.borderLeft='4px solid #315d9a';
            summary.style.background='rgba(128,148,175,.09)';
            summary.style.borderRadius='5px';
            const heading=document.createElement('strong');
            heading.textContent='ADMINISTRACIÓN · Garantía '+visit.code+' · '+warrantyStatusLabel(visit.status);
            const detail=document.createElement('p');
            detail.textContent='Autorización: '+visit.description;
            detail.style.margin='7px 0 0';
            summary.append(heading,detail);
            if(visit.resolution_note){
              const correction=document.createElement('p');
              correction.textContent='Corrección informada por el profesional: '+visit.resolution_note;
              correction.style.margin='7px 0 0';
              summary.append(correction);
            }
            item.append(summary);
            if(clientConfirmed){
              const notice=document.createElement('p');
              notice.className='feedback ok';
              notice.textContent='Corrección confirmada por el cliente'+
                (visit.client_confirmed_at?' · '+new Date(visit.client_confirmed_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false}):'')+'.';
              item.append(notice);
            }
            if(visit.status==='completed'){
              try{
                const rating=await api('GET','/api/claims/'+claim.id+'/warranty/'+visit.id+'/rating');
                if(rating){
                  const shown=document.createElement('p');
                  shown.textContent='Calificación de esta garantía: '+rating.stars+' estrellas'+
                    (rating.comment?' · '+rating.comment:'');
                  item.append(shown);
                }else if(profile.role==='client' && clientConfirmed){
                  const form=document.createElement('form');
                  const heading=document.createElement('strong');heading.textContent='Calificar esta garantía';
                  const select=document.createElement('select');select.required=true;
                  select.append(new Option('Elegí de 1 a 5 estrellas',''));
                  for(let n=5;n>=1;n--)select.append(new Option(n+' estrellas',String(n)));
                  const comment=document.createElement('textarea');
                  comment.placeholder='Opinión sobre la corrección (opcional)';
                  comment.maxLength=3000;comment.rows=3;
                  const button=document.createElement('button');
                  button.type='submit';button.className='secondary';button.textContent='Enviar calificación de garantía';
                  const notice=document.createElement('p');
                  form.append(heading,select,comment,button,notice);
                  form.addEventListener('submit',async(event)=>{
                    event.preventDefault();button.disabled=true;
                    try{
                      await api('POST','/api/claims/'+claim.id+'/warranty/'+visit.id+'/rating',
                        {stars:Number(select.value),comment:comment.value.trim()});
                      if(openedJob)await loadJobClaimHistory(openedJob);
                      await loadClaimInbox();
                    }catch(error){notice.textContent='No se pudo calificar: '+error.message;button.disabled=false;}
                  });
                  item.append(form);
                }
              }catch(error){const m=document.createElement('p');m.textContent='No se pudo consultar calificación: '+error.message;item.append(m);}
            }
            if(profile.role==='professional' && visit.status==='requested'){
              const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent='Informar corrección realizada';
              btn.onclick=async()=>{
                const note=prompt('Describí la corrección realizada (mínimo 10 caracteres):');
                if(note===null)return;
                if(note.trim().length<10){alert('Escribí al menos 10 caracteres.');return;}
                btn.disabled=true;
                try{await api('POST','/api/claims/'+claim.id+'/warranty/'+visit.id+'/report-completed',{note:note.trim()});await loadClaimInbox();}
                catch(error){alert(error.message);btn.disabled=false;}
              };item.append(btn);
            }
            if(profile.role==='client' && visit.status==='completed' && !clientConfirmed){
              const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent='Confirmar corrección de garantía';
              btn.onclick=async()=>{
                if(!confirm('¿Confirmás que se realizó satisfactoriamente la corrección de esta garantía?'))return;
                btn.disabled=true;
                const status=document.createElement('p');
                status.setAttribute('role','status');
                btn.after(status);
                try{
                  await api('POST','/api/claims/'+claim.id+'/warranty/'+visit.id+'/client-confirm',{confirmed:true});
                }catch(error){
                  status.className='feedback error';
                  status.textContent='No se registró la confirmación: '+error.message;
                  btn.disabled=false;
                  return;
                }
                btn.textContent='Corrección confirmada';
                status.className='feedback ok';
                status.textContent='Corrección confirmada y registrada. Actualizando historial...';
                await loadClaimInbox();
                if(openedJob && String(openedJob.id)===String(claim.job_id)) await loadJobClaimHistory(openedJob);
              };item.append(btn);
            }
          }
        } catch(error) {
          const msg=document.createElement('p');msg.textContent='No se pudo consultar garantía: '+error.message;item.append(msg);
        }
        if (profile.role === 'professional' && correctionConfirmed) {
          const closed=document.createElement('p');
          closed.className='hint';
          closed.textContent='Descargo técnico cerrado: el cliente confirmó la corrección en garantía. Administración debe resolver el reclamo.';
          item.append(closed);
        }
        if (profile.role === 'professional' && updatesLoaded && !correctionConfirmed &&
          ['open','in_review'].includes(claim.status)) {
          const form = document.createElement('form');
          const label = document.createElement('label');
          label.textContent = 'Diagnóstico y descargo técnico';
          const input = document.createElement('textarea');
          input.rows=5;input.maxLength=3000;input.minLength=10;input.required=true;
          input.placeholder='Describí qué encontraste y cómo proponés resolverlo.';
          const submit = document.createElement('button');
          submit.type='submit';submit.className='primary';submit.textContent='Enviar descargo';
          const result = document.createElement('p');
          form.append(label,input,submit,result);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled=true;
            try {
              await api('POST','/api/claims/'+encodeURIComponent(String(claim.id))+'/professional-response',{description:input.value.trim()});
              await loadClaimInbox();
            } catch(error) {result.textContent='No se pudo enviar: '+error.message;submit.disabled=false;}
          });
          item.append(form);
        }
        panel.append(item);
    }
  }

  async function loadJobClaimHistory(job) {
    const section=el('jobClaimHistory');
    const panel=el('jobClaimHistoryPanel');
    const warrantyPanel=el('jobWarrantySummary');
    section.hidden=true;
    panel.replaceChildren();
    warrantyPanel.replaceChildren();
    if(!profile || !['client','professional'].includes(profile.role) ||
        !['confirmed','in_progress','completed'].includes(job.status)) return;
    section.hidden=false;
    warrantyPanel.textContent='Consultando vigencia de la garantía...';
    panel.textContent='Consultando historial de reclamos...';
    const jobId=encodeURIComponent(String(job.id));
    const displayDate=(value)=>new Date(value).toLocaleString('es-AR',{
      timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short',hour12:false
    });
    try {
      const warranty=await api('GET','/api/jobs/'+jobId+'/warranty-status');
      if(openedJob?.id !== job.id) return;
      const days=Number(warranty.warranty_days);
      let message='Garantía pactada: '+days+' día(s).';
      if(warranty.warranty_status==='awaiting_conformity'){
        message+='\nInicio y vencimiento: pendientes de la conformidad del cliente.';
      } else if(warranty.warranty_status==='no_warranty'){
        message+='\nEstado: sin garantía contractual (0 días).';
      } else if(warranty.approved_at && warranty.expires_at){
        message+='\nInicio: '+displayDate(warranty.approved_at)+
          '\nVencimiento: '+displayDate(warranty.expires_at)+
          '\nEstado: '+(warranty.warranty_status==='active'?'Vigente':'Vencida');
      } else {
        message+='\nEstado: pendiente de verificar.';
      }
      warrantyPanel.textContent=message;
    } catch(error){
      if(openedJob?.id===job.id) warrantyPanel.textContent=
        'No se pudo consultar la garantía: '+error.message;
    }
    try {
      const all=await api('GET','/api/claims');
      if(openedJob?.id !== job.id) return;
      const related=all.filter(c=>String(c.job_id)===String(job.id));
      if(!related.length) {
        panel.textContent='No hay reclamos ni intervenciones en garantía registrados para este trabajo.';
      } else {
        await renderClaimCards(panel,related);
      }
    } catch(error){
      if(openedJob?.id===job.id) panel.textContent='No se pudo cargar el historial: '+error.message;
    }
  }

  async function loadClaimInbox() {
    const section=el('claimInboxSection');
    section.hidden=!profile || !['client','professional'].includes(profile.role);
    if(section.hidden)return;
    const panel=el('claimInboxPanel');
    panel.textContent='Consultando reclamos pendientes...';
    try {
      const claims=(await api('GET','/api/claims')).filter(c=>['open','in_review'].includes(c.status));
      await renderClaimCards(panel,claims);
    }catch(error){panel.textContent='No se pudieron cargar reclamos: '+error.message;}
  }

  // Liquidaciones, etapa 1: cierres reales y validación documental.
  // No se calculan ni generan transferencias ni descuentos.
  let claimPerformancePage=1;
  let claimPerformanceVersion=0;
  const complexityNames={
    simple:'Simple',intermediate:'Intermedio',complex:'Complejo'
  };

  async function loadClaimPerformance(){
    if(profile?.role!=='admin')return;
    const month=el('claimPerformanceMonth');
    if(!month.value){
      const now=new Date();
      month.value=String(now.getFullYear())+'-'+String(now.getMonth()+1).padStart(2,'0');
    }
    const currentMonth=month.value;
    const version=++claimPerformanceVersion;
    const status=el('claimPerformanceStatus');
    const summary=el('claimPerformanceSummary');
    const cases=el('claimPerformanceCases');
    status.textContent='Consultando cierres registrados...';
    summary.replaceChildren();
    cases.replaceChildren();
    try{
      const params=new URLSearchParams({month:currentMonth,page:String(claimPerformancePage)});
      const data=await api('GET','/api/admin/claim-performance?'+params.toString());
      if(version!==claimPerformanceVersion||profile?.role!=='admin'||month.value!==currentMonth)return;
      status.textContent='Cierres del mes: '+data.total+'. La validación NO genera un pago.';
      el('claimPerformancePageInfo').textContent='Página '+data.page+' de '+Math.max(1,Math.ceil(data.total/data.pageSize));
      el('claimPerformancePrev').disabled=claimPerformancePage<=1;
      el('claimPerformanceNext').disabled=!data.hasMore;
      if(!data.people.length){
        summary.textContent='No hay reclamos cerrados en este mes.';
      }
      for(const person of data.people){
        const item=document.createElement('div');
        item.className='admin-performance-person';
        const heading=document.createElement('strong');
        heading.textContent=person.administrator_name+' · Cerrados: '+person.closed;
        const details=document.createElement('p');
        details.textContent='Validados: '+person.validated+
          ' (simples '+person.simple+', intermedios '+person.intermediate+
          ', complejos '+person.complex+') · Sin validar: '+person.unvalidated;
        item.append(heading,details);
        summary.append(item);
      }
      if(!data.items.length&&data.total&&claimPerformancePage>1){
        claimPerformancePage--;
        void loadClaimPerformance();
        return;
      }
      if(!data.items.length){
        cases.textContent='No hay expedientes para revisar.';
        return;
      }
      for(const claim of data.items){
        const detail=document.createElement('details');
        detail.className='admin-archive-item';
        const head=document.createElement('summary');
        head.textContent='Reclamo N.º '+claim.id+' · Trabajo '+claim.job_public_code+
          ' · '+(claim.complexity?'Validado: '+complexityNames[claim.complexity]:'Pendiente de validar');
        detail.append(head);
        const owner=document.createElement('p');
        owner.className='hint';
        owner.textContent='Cierre registrado por: '+claim.administrator_name+
          ' · Fecha: '+new Date(claim.resolved_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false});
        detail.append(owner);
        if(claim.complexity){
          const note=document.createElement('p');
          note.textContent='Complejidad validada: '+complexityNames[claim.complexity]+
            '. Sin tarifa ni pago asignado.';
          detail.append(note);
        }else{
          const form=document.createElement('form');
          form.className='claim-performance-review';
          const label=document.createElement('label');
          const select=document.createElement('select');
          select.required=true;
          select.id='performanceComplexity'+claim.id;
          label.htmlFor=select.id;
          label.textContent='Nivel de complejidad';
          const placeholder=document.createElement('option');
          placeholder.value='';placeholder.textContent='Elegir nivel';
          select.append(placeholder);
          for(const [value,text] of Object.entries(complexityNames)){
            const opt=document.createElement('option');
            opt.value=value;opt.textContent=text;
            select.append(opt);
          }
          const why=document.createElement('label');
          const rationale=document.createElement('textarea');
          rationale.id='performanceRationale'+claim.id;
          rationale.required=true;rationale.minLength=8;rationale.maxLength=800;
          rationale.rows=3;
          why.htmlFor=rationale.id;
          why.textContent='Motivo de la validación (mínimo 8 caracteres)';
          const button=document.createElement('button');
          button.type='submit';button.className='secondary';
          button.textContent='Validar resolución y complejidad';
          const result=document.createElement('p');
          result.className='hint';
          form.append(label,select,why,rationale,button,result);
          form.addEventListener('submit',async event=>{
            event.preventDefault();
            if(!confirm('¿Validar el reclamo N.º '+claim.id+' como '+complexityNames[select.value]+'? No se generará ningún pago.'))return;
            button.disabled=true;
            result.textContent='Guardando validación...';
            try{
              await api('POST','/api/admin/claim-performance/'+claim.id+'/validate',{
                complexity:select.value,rationale:rationale.value.trim()
              });
              result.textContent='Validación registrada.';
              void loadClaimPerformance();
            }catch(error){
              result.textContent='No se pudo validar: '+error.message;
              button.disabled=false;
            }
          });
          detail.append(form);
        }
        cases.append(detail);
      }
    }catch(error){
      if(version===claimPerformanceVersion)status.textContent=
        'No se pudo consultar el control de cierres: '+error.message;
    }
  }

  let adminPendingPage=1;
  let adminArchivePage=1;
  let adminPendingVersion=0;
  let adminArchiveVersion=0;

  async function renderAdminClaimCards(panel, claims) {
    panel.replaceChildren();
    if (!claims.length) { panel.textContent='No hay reclamos en esta selección.'; return; }
      for (const claim of claims) {
        const item = document.createElement('div');
        item.className = 'jobspanel';
        const info = document.createElement('p');
        info.textContent = 'Reclamo ' + claim.id + ' · Trabajo ' + (claim.job_public_code || claim.job_id) +
          ' · Estado: ' + statusLabel(claim.status) +
          '\nProfesional: ' + (claim.professional_name || 'Sin asignar') +
          '\nMotivo: ' + claim.reason + '\nDetalle: ' + claim.description +
          '\nRecepción del aviso: ' +
          (claim.professional_acknowledged_at
            ? 'Confirmada por el profesional · '+new Date(claim.professional_acknowledged_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false})
            : 'Sin confirmación explícita') +
          '\nDescargo profesional: ' +
          (claim.professional_responded_at
            ? 'Presentado · '+new Date(claim.professional_responded_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour12:false})
            : 'Pendiente')+
          (claim.response_window
            ? '\nSeguimiento del plazo: '+claimResponseNotice(claim.response_window)
            : '');

        item.append(info);
        const professionalUpdates = document.createElement('div');
        professionalUpdates.textContent = 'Consultando descargo profesional...';
        item.append(professionalUpdates);
        try {
          const updates = await api('GET','/api/claims/'+encodeURIComponent(String(claim.id))+'/updates');
          renderClaimUpdates(professionalUpdates, updates);
        } catch(error) { professionalUpdates.textContent = 'No se pudo consultar descargo: '+error.message; }
        appendClaimResolution(item, claim);
        try {
          const visits=await api('GET','/api/claims/'+claim.id+'/warranty');
          if(visits.length){
            const summary=document.createElement('p');
            summary.textContent=visits.map(v=>'Garantía '+v.code+' · '+warrantyStatusLabel(v.status)+
              (v.resolution_note?' · Corrección: '+v.resolution_note:'')).join('\n');
            item.append(summary);
          } else if(['open','in_review'].includes(claim.status) && Number(claim.warranty_days) > 0){
            const authorize=document.createElement('button');
            authorize.type='button';authorize.className='secondary';authorize.textContent='Autorizar intervención en garantía';
            authorize.onclick=async()=>{
              const note=prompt('Describí por qué corresponde la corrección bajo garantía:',
                'El diagnóstico del profesional vincula la falla con la reparación anterior. Se autoriza corrección sin costo adicional.');
              if(note===null)return;
              if(note.trim().length<10){alert('Escribí al menos 10 caracteres.');return;}
              if(!confirm('¿Autorizar la intervención en garantía vinculada al trabajo original?'))return;
              authorize.disabled=true;
              try{await api('POST','/api/claims/'+claim.id+'/authorize-warranty',{note:note.trim()});await loadAdminClaims();}
              catch(error){alert('No se pudo autorizar: '+error.message);authorize.disabled=false;}
            };item.append(authorize);
          } else if(['open','in_review'].includes(claim.status)){
            const note = document.createElement('p');
            note.textContent = 'Sin garantía contractual comprobada: no se habilita una intervención automática en garantía. El reclamo puede revisarse y resolverse.';
            item.append(note);
          }
        }catch(error){const msg=document.createElement('p');msg.textContent='Error consultando garantías: '+error.message;item.append(msg);}
        if (['open','in_review'].includes(claim.status)) {
          const requestButton = document.createElement('button');
          requestButton.className = 'secondary';
          requestButton.type = 'button';
          requestButton.textContent = 'Solicitar revisión técnica';
          requestButton.onclick = async () => {
            const note = prompt('Indicaciones de revisión técnica para el profesional y el cliente (mínimo 10 caracteres):',
              'Solicito una nueva revisión técnica para identificar la causa de la falla y documentar si corresponde al trabajo original. El reclamo continúa abierto.');
            if (note === null) return;
            if (note.trim().length < 10) { alert('Escribí al menos 10 caracteres.'); return; }
            requestButton.disabled = true;
            try {
              await api('POST','/api/claims/'+encodeURIComponent(String(claim.id))+'/request-technical-review',{note:note.trim()});
              await loadAdminClaims();
            } catch(error) {alert('No se pudo solicitar la revisión: '+error.message);requestButton.disabled=false;}
          };
          item.append(requestButton);
        }
        if (['open','in_review'].includes(claim.status)) {
          const button = document.createElement('button');
          button.className = 'secondary';
          button.type = 'button';
          button.textContent = 'Resolver reclamo';
          button.onclick = async () => {
            const resolutionNote = prompt('Motivo y medida adoptada para resolver el reclamo (mínimo 5 caracteres):');
            if (resolutionNote === null) return;
            if (resolutionNote.trim().length < 5) { alert('Escribí al menos 5 caracteres.'); return; }
            button.disabled = true;
            try {
              await api('PATCH', '/api/claims/' + encodeURIComponent(String(claim.id)) + '/resolve', {resolutionNote:resolutionNote.trim()});
              await loadAdminClaims();
            } catch (error) {
              alert('No se pudo resolver: ' + error.message);
              button.disabled = false;
            }
          };
          item.append(button);
        }
        panel.append(item);
      }
  }

  async function loadAdminClaims() {
    if(profile?.role!=='admin') return;
    const version=++adminPendingVersion;
    const panel=el('adminClaimsPanel');
    panel.textContent='Consultando reclamos pendientes...';
    try{
      const data=await api('GET','/api/claims/admin-list?view=pending&page='+adminPendingPage);
      if(version!==adminPendingVersion || profile?.role!=='admin') return;
      // Independent figures always cover all records, not only the visible page.
      const totals=data.statusTotals;
      if(totals){
        el('adminOpenCount').textContent=String(totals.open);
        el('adminReviewCount').textContent=String(totals.inReview);
        el('adminTotalPendingCount').textContent=String(totals.pending);
        el('adminArchivedCount').textContent=String(totals.archived);
      }
      el('adminPendingCount').textContent='Total sin resolver: '+data.total;
      el('adminPendingPageInfo').textContent='Página '+data.page+' de '+Math.max(1,Math.ceil(data.total/data.pageSize));
      el('adminPendingPrev').disabled=adminPendingPage<=1;
      el('adminPendingNext').disabled=!data.hasMore;
      // If the archive is open, refresh it too when a complaint is resolved.
      if(!el('claimArchiveSection').hidden) void loadArchivedClaims();
      if(!data.items.length && data.total && adminPendingPage>1){
        adminPendingPage=Math.max(1,adminPendingPage-1);
        return loadAdminClaims();
      }
      if(!data.items.length){panel.textContent='No hay reclamos pendientes de atención.';return;}
      await renderAdminClaimCards(panel,data.items);
    }catch(error){
      if(version===adminPendingVersion)panel.textContent='No se pudieron consultar los reclamos pendientes: '+error.message;
    }
  }

  async function loadLabReminderLedger(){
    if(profile?.role!=='admin')return;
    const panel=el('labReminderLedger');
    panel.textContent='Consultando historial interno...';
    try{
      const data=await api('GET','/api/admin/claim-reminders');
      panel.replaceChildren();
      if(!data.items?.length){
        panel.textContent='Todavía no se registraron recordatorios. El proceso programado no está activado.';
        return;
      }
      const intro=document.createElement('p');
      intro.textContent='Registros internos: '+data.totals.recorded+
        ' · Alertas de 12 horas: '+data.totals.overdue+
        '. No indica mensajes enviados ni confirmaciones de lectura.';
      panel.append(intro);
      for(const notice of data.items){
        const item=document.createElement('p');
        item.textContent='Reclamo '+notice.claim_id+
          ' · Trabajo '+notice.job_public_code+
          ' · '+notice.milestone_hours+' horas hábiles'+
          '\nProgramado para: '+displayArgDate(notice.scheduled_at)+
          '\nRegistrado: '+displayArgDate(notice.recorded_at)+
          ' · '+(notice.origin==='manual'?'Comprobación manual':'Tarea programada');
        panel.append(item);
      }
    }catch(error){panel.textContent='No se pudo consultar el historial: '+error.message;}
  }
  async function runLabReminders(){
    if(profile?.role!=='admin')return;
    const button=el('runLabReminders'),status=el('labReminderRunResult');
    if(!confirm('¿Comprobar ahora los plazos y registrar los recordatorios internos que correspondan? Esta operación no envía WhatsApp ni correo.'))return;
    button.disabled=true;status.textContent='Comprobando recordatorios...';
    try{
      const result=await api('POST','/api/admin/claim-reminders/run');
      status.textContent=result.busy
        ? 'Ya hay otra comprobación ejecutándose. Volvé a intentar luego.'
        : 'Comprobación finalizada. Reclamos examinados: '+result.scanned+
          '. Nuevos registros internos: '+result.recorded+
          '. Calendarios pendientes: '+result.calendarPending+
          '. Sin envíos externos.';
      await loadLabReminderLedger();
    }catch(error){status.textContent='No se pudo ejecutar la comprobación: '+error.message;}
    finally{button.disabled=false;}
  }

  async function loadArchivedClaims() {
    if(profile?.role!=='admin' || el('claimArchiveSection').hidden) return;
    const version=++adminArchiveVersion;
    const panel=el('adminArchivePanel');
    panel.textContent='Buscando reclamos finalizados...';
    const params=new URLSearchParams({
      view:'archived',
      page:String(adminArchivePage),
      search:el('adminArchiveSearch').value.trim()
    });
    try{
      const data=await api('GET','/api/claims/admin-list?'+params.toString());
      if(version!==adminArchiveVersion || profile?.role!=='admin' || el('claimArchiveSection').hidden)return;
      el('adminArchiveCount').textContent='Reclamos finalizados encontrados: '+data.total;
      el('adminArchivePageInfo').textContent='Página '+data.page+' de '+Math.max(1,Math.ceil(data.total/data.pageSize));
      el('adminArchivePrev').disabled=adminArchivePage<=1;
      el('adminArchiveNext').disabled=!data.hasMore;
      if(!data.items.length && data.total && adminArchivePage>1){
        adminArchivePage=Math.max(1,adminArchivePage-1);
        return loadArchivedClaims();
      }
      panel.replaceChildren();
      if(!data.items.length){
        panel.textContent='No hay reclamos finalizados con ese criterio.';
        return;
      }
      for(const claim of data.items){
        const details=document.createElement('details');
        details.className='admin-archive-item';
        const summary=document.createElement('summary');
        summary.textContent='Reclamo '+claim.id+' · Trabajo '+(claim.job_public_code||claim.job_id)+
          ' · '+(claim.professional_name||'Profesional sin asignar')+
          ' · '+statusLabel(claim.status);
        const full=document.createElement('div');
        details.append(summary,full);
        details.addEventListener('toggle',async()=>{
          if(!details.open || details.dataset.loaded)return;
          details.dataset.loaded='true';
          full.textContent='Consultando historial...';
          try{await renderAdminClaimCards(full,[claim]);}
          catch(error){full.textContent='No se pudo mostrar el detalle: '+error.message;delete details.dataset.loaded;}
        });
        panel.append(details);
      }
    }catch(error){
      if(version===adminArchiveVersion) panel.textContent='No se pudo consultar el archivo: '+error.message;
    }
  }

  async function loadClientReviewStatus(job) {
    try {
      const [review, claims] = await Promise.all([
        api('GET', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/review'),
        api('GET', '/api/claims')
      ]);
      if (openedJob?.id !== job.id) return;
      const pending = claims.some(claim => String(claim.job_id) === String(job.id) &&
        ['open','in_review'].includes(claim.status));
      const reviewForm = el('clientReviewForm');
      reviewForm.hidden = Boolean(review) || pending;
      el('openClaimFormButton').hidden = pending;
      el('openClaimFormButton').textContent = claims.some(c => String(c.job_id) === String(job.id) && ['resolved','dismissed'].includes(c.status))
        ? 'Presentar otro reclamo' : 'Presentar reclamo';
      if (review) {
        el('jobDetailText').textContent = el('jobDetailText').textContent.replace(/Estado: [^\n]+/, 'Estado: Finalizado con conformidad del cliente');
        el('clientCompletionNotice').hidden = false;
        el('clientCompletionNotice').textContent = 'Conformidad del cliente registrada. El trabajo está finalizado. No se procesó ningún pago.';
        el('reviewResult').textContent = 'Conformidad registrada: ' + review.stars + ' estrellas.';
        try {
          const quotes = await api('GET','/api/jobs/'+encodeURIComponent(String(job.id))+'/quotes');
          if (openedJob?.id !== job.id) return;
          const accepted = quotes.find(q => q.status === 'accepted');
          if (accepted) {
            const days = Number(accepted.warranty_days);
            el('reviewResult').textContent += days === 0
              ? ' Presupuesto con 0 días de garantía pactada.'
              : ' Garantía pactada: '+days+' días. Se computa desde la conformidad registrada por el cliente.';
          }
        } catch (_) { /* Do not assert validity if quote lookup fails. */ }
      } else if (pending) {
        el('reviewResult').textContent = 'Hay un reclamo abierto en este trabajo. Administración debe revisarlo antes de registrar conformidad.';
      }
      if (pending) el('claimResult').textContent = 'Ya existe un reclamo pendiente para este trabajo. No se puede presentar otro hasta su resolución.';
      else if (claims.some(c => String(c.job_id) === String(job.id) && ['resolved','dismissed'].includes(c.status)))
        el('claimResult').textContent = 'El reclamo anterior quedó archivado. Si surgió un problema distinto, podés presentar uno nuevo.';
    } catch (error) {
      el('clientReviewForm').hidden = true;
      el('reviewResult').textContent = 'No se pudo verificar la conformidad: ' + error.message;
    }
  }

  async function submitClientReview(event) {
    event.preventDefault();
    if (profile?.role !== 'client' || !openedJob || openedJob.status !== 'completed') return;
    const stars = Number(el('reviewStars').value);
    const comment = el('reviewComment').value.trim();
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const button = el('clientReviewForm').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (!confirm('¿Confirmar conformidad con el trabajo y enviar tu calificación de prueba?')) return;
      await api('POST', '/api/jobs/' + encodeURIComponent(String(openedJob.id)) + '/review', {stars,comment});
      await loadClientReviewStatus(openedJob);
      void loadJobTimeline(openedJob);
    } catch (error) {
      el('reviewResult').textContent = 'No se pudo guardar la conformidad: ' + error.message;
    } finally { button.disabled = false; }
  }

  async function submitClientClaim(event) {
    event.preventDefault();
    if (profile?.role !== 'client' || !openedJob || openedJob.status !== 'completed') return;
    const job = openedJob;
    const reason = el('claimReason').value.trim();
    const description = el('claimDescription').value.trim();
    if (reason.length < 2 || description.length < 3) return;
    const button = el('clientClaimForm').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (!confirm('¿Registrar este reclamo de prueba para el profesional involucrado? Administración también podrá consultarlo y resolverlo.')) return;
      await api('POST', '/api/claims', {jobId:Number(job.id),reason,description});
      el('clientClaimForm').reset();
      el('clientClaimForm').hidden = true;
      await loadClientReviewStatus(job);
      el('claimResult').textContent = 'Reclamo registrado. El profesional involucrado y Administración pueden consultarlo desde sus respectivas cuentas.';
    } catch (error) {
      el('claimResult').textContent = 'No se pudo enviar el reclamo: ' + error.message;
    } finally { button.disabled = false; }
  }

  async function loadJobQuotes(job) {
    const list = el('quoteList');
    list.replaceChildren();
    if (profile?.role !== 'client') return;
    try {
      const quotes = await api('GET', '/api/jobs/' + job.id + '/quotes');
      if (!quotes.length) {
        list.textContent = 'Todavía no recibiste presupuestos para esta solicitud.';
        return;
      }
      quotes.forEach(quote => {
        const section = document.createElement('div');
        section.className = 'jobspanel';
        const summary = document.createElement('p');
        summary.textContent = 'Profesional: ' + quote.professional_name +
          ' · Importe ARS ' + quote.amount +
          ' · Garantía: ' + quote.warranty_days + ' días' +
          ' · Estado: ' + statusLabel(quote.status) +
          '\nDetalle: ' + quote.description;
        section.append(summary);
        if (job.status === 'quoted' && quote.status === 'submitted') {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary';
          button.textContent = 'Aceptar presupuesto de prueba';
          button.addEventListener('click', async () => {
            if (!confirm('¿Aceptar este presupuesto de PRUEBA? No se realiza ningún pago.')) return;
            button.disabled = true;
            try {
              await api('POST', '/api/jobs/' + job.id + '/accept-quote', {quoteId: Number(quote.id)});
              el('quoteFeedback').textContent = 'Presupuesto aceptado en el Laboratorio. No se procesó ningún pago.';
              await refreshJobs();
            } catch(error) {
              el('quoteFeedback').textContent = error.message;
              button.disabled = false;
            }
          });
          section.append(button);
        }
        list.append(section);
      });
    } catch(error) { list.textContent = 'No se pudieron consultar presupuestos: ' + error.message; }
  }

  async function submitLabQuote(event) {
    event.preventDefault();
    if (profile?.role !== 'professional' || !openedJob) return;
    el('quoteFeedback').classList.remove('quote-warning');
    el('quoteFeedback').setAttribute('role','status');
    const rawAmount = el('quoteAmount').value.trim().replace(',', '.');
    const rawWarranty = el('quoteWarranty').value.trim();
    const amount = Number(rawAmount);
    const description = el('quoteDescription').value.trim();
    const warrantyDays = Number(rawWarranty);
    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(rawAmount) ||
        !(amount > 0) || amount > 9999999999.99 ||
        !/^[0-9]+$/.test(rawWarranty) || warrantyDays > 3650 ||
        description.length < 3) {
      el('quoteFeedback').textContent = 'Revisá importe, garantía y descripción.';
      return;
    }
    const button = el('quoteForm').querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('POST', '/api/jobs/' + openedJob.id + '/quotes',
        {amount, description, warrantyDays});
      el('quoteFeedback').textContent = 'Presupuesto de prueba enviado correctamente.';
      el('quoteForm').reset();
      await refreshJobs();
      await loadMyQuotes();
    } catch(error) {
      const blocked = error.code === 'professional_has_open_claim';
      const notice = el('quoteFeedback');
      notice.classList.toggle('quote-warning',blocked);
      notice.setAttribute('role',blocked ? 'alert' : 'status');
      notice.textContent = blocked
        ? '⛔ PRESUPUESTO BLOQUEADO. ' + error.message
        : 'No se pudo enviar el presupuesto: ' + error.message;
    } finally { button.disabled = false; }
  }

async function loadClientSpecialties() {
  try {
    await fetchLabProfessionCatalog();
    renderClientSpecialtyOptions();
  } catch(error) {
    el('requestResult').textContent='No se pudo cargar el catálogo de oficios: '+error.message;
  }
}

async function createLabRequest(event) {
  event.preventDefault();

  if (!profile || profile.role !== 'client') return;

  const specialtyId = Number(el('requestSpecialty').value);
  const serviceId = Number(el('requestServiceId').value)||null;
  const description = el('requestDescription').value.trim();
  const locality = el('requestLocality').value.trim();

  if(!specialtyId){
    el('requestResult').textContent='Primero elegí una de las especialidades sugeridas para tu problema.';
    el('requestSpecialtySearch').focus();
    return;
  }
  if(description.length<3 || locality.length<2)return;
  const photos=window.labPhotos.getStagedPhotos();
  if (photos.length>5) { el('requestResult').textContent='Elegí hasta 5 fotografías.'; return; }

  const button = el('createRequestButton');
  button.disabled = true;

  try {
    const job = await api('POST', '/api/jobs', {
      specialtyId,
      serviceId,
      description,
      locality
    });

    let photosResult='';
    if (photos.length) {
      try {
        const count=await window.labPhotos.uploadLabPhotos(job.id,photos);
        photosResult=' Se guardaron '+count+' foto(s).';
        // Previews are cleared after confirming the completed request.
      } catch (error) {
        photosResult=' Atención: '+error.message+
          ' La solicitud quedó creada. Abrila para ver qué fotos llegaron y agregar las faltantes.';
      }
    }
    window.labPhotos.clearStagedPhotos();
    el('requestResult').textContent =
      'Solicitud de prueba creada: ' + job.public_code + '.' + photosResult;

    el('requestDescription').value = '';
    el('requestLocality').value = '';
    el('requestSpecialtySearch').value = '';
    manualHeaterType='';
    renderClientSpecialtyOptions();

    await refreshJobs();
  } catch (error) {
    el('requestResult').textContent =
      'No se pudo crear la solicitud: ' + error.message;
  } finally {
    button.disabled = false;
  }
}

  let labProfessionals = [];
  let labCategories = [];
  function renderAdminSpecialtyOptions(preferred=null){
    const selection=el('adminSpecialtySelect');
    const keep=preferred===null?selection.value:String(preferred);
    const query=professionNormalized(el('adminSpecialtySearch').value);
    const found=labCategories.filter(c=>{
      const entry=labProfessionCatalog.find(p=>String(p.specialty_id)===String(c.id));
      return !query || professionNormalized(c.name).includes(query) ||
        (entry&&professionMatches(entry,query));
    });
    selection.replaceChildren(new Option('Seleccionar especialidad',''));
    found.forEach(c=>selection.add(new Option(catalogTitle(c.id,c.name),String(c.id))));
    if(found.some(c=>String(c.id)===keep))selection.value=keep;
    updateAdminSelection();
  }
  function selectedProfessional() {
    return labProfessionals.find(p => String(p.id) === el('adminProfessionalSelect').value) || null;
  }
  function updateAdminSelection() {
    labProfessional = selectedProfessional();
    labCategoryId = Number(el('adminSpecialtySelect').value) || null;
    const target = el('adminTarget');
    target.textContent = labProfessional
      ? 'Profesional: ' + labProfessional.name + ' | ID: ' + labProfessional.id +
        '\\nEstado: ' + labProfessional.verification_status
      : 'Elegí un profesional pendiente para aprobar.';
    el('approveSelected').disabled = !labProfessional ||
      labProfessional.verification_status !== 'pending' || !labCategoryId;
    // Password recovery remains strictly restricted to the original ID 4.
    el('resetProfessionalForm').hidden = !labProfessionals.some(p => String(p.id) === '4');
  }
  async function loadProfessionals() {
    const target = el('adminTarget');
    target.textContent = 'Consultando cuentas de prueba...';
    el('approveSelected').disabled = true;
    try {
      const [pros, categories] = await Promise.all([
        api('GET', '/api/admin/professionals'),
        api('GET', '/api/admin/specialties')
      ]);
      labProfessionals = pros;
      labCategories = categories;
      const previousPro = el('adminProfessionalSelect').value;
      const previousSpecialty = el('adminSpecialtySelect').value;
      const pending = pros.filter(p => p.verification_status === 'pending');
      const proSelect = el('adminProfessionalSelect');
      proSelect.replaceChildren(new Option('Seleccionar profesional', ''));
      pending.forEach(p => proSelect.add(new Option(p.name + ' (ID ' + p.id + ')', String(p.id))));
      if (pending.some(p => String(p.id) === previousPro)) proSelect.value = previousPro;
      renderAdminSpecialtyOptions(previousSpecialty);
      target.textContent = pending.length
        ? 'Profesionales pendientes: ' + pending.length + '. Seleccioná uno y elegí su especialidad.'
        : 'No hay profesionales pendientes de aprobación.';
      updateAdminSelection();
    } catch(error) {
      target.textContent = error.message;
      el('approveSelected').disabled = true;
    }
  }
  async function prepareRefrigeration() {
    const button = el('prepareRefrigeration');
    button.disabled = true;
    try {
      const result = await api('POST', '/api/admin/specialties', {
        name: 'Refrigeración', services: ['Reparación', 'Mantenimiento preventivo']
      });
      feedback('Rubro ficticio Refrigeración preparado.');
      await loadProfessionals();
      el('adminSpecialtySelect').value = String(result.id);
      updateAdminSelection();
    } catch(error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  }
  async function approveSelected() {
    updateAdminSelection();
    const person = labProfessional;
    const specialtyId = labCategoryId;
    if (!person || person.verification_status !== 'pending' || !specialtyId) return;
    if (!confirm('¿Aprobar para PRUEBAS a ' + person.name + ' (ID ' + person.id + ')?')) return;
    const button = el('approveSelected');
    button.disabled = true;
    try {
      const result = await api('POST', '/api/admin/professionals/' +
        encodeURIComponent(String(person.id)) + '/approve', { specialtyId });
      feedback('Profesional ' + result.name + ' (ID ' + result.professionalId +
        ') aprobado solamente para el laboratorio: ' + result.specialty + '.');
      await loadProfessionals();
    } catch(error) {
      feedback(error.message, true);
      button.disabled = false;
    }
  }

  async function resetProfessionalPassword(event) {
    event.preventDefault();
    if (!profile || profile.role !== 'admin' ||
        !labProfessionals.some(p => String(p.id) === '4')) return;
    const adminPassword = el('adminConfirmPassword').value;
    const newPassword = el('newProfessionalPassword').value;
    if (!confirm('¿Cambiar la contraseña de Sebastián Salva (ID 4)? La aprobación seguirá intacta.')) return;
    const button = el('resetProfessionalButton');
    button.disabled = true;
    try {
      const result=await api('POST','/api/admin/professionals/4/reset-test-password',{
        adminPassword,newPassword
      });
      feedback('Contraseña nueva guardada. Ahora podés ingresar como Sebastián Salva.');
      el('adminTarget').textContent='Clave renovada para '+result.name+
        ' (ID '+result.professionalId+'). Correo: '+result.email+
        '\\nLa aprobación de Refrigeración se mantiene.';
    }catch(error){
      const message=String(error.message||'');
      feedback(message.includes('HTTP 403')
        ? 'No pudimos validar la contraseña de Administración de Pruebas.'
        : message,true);
    }finally{
      el('adminConfirmPassword').value='';
      el('newProfessionalPassword').value='';
      button.disabled=false;
    }
  }

  el('roleClient').addEventListener('click',()=>select('client'));
  el('rolePro').addEventListener('click',()=>select('professional'));
  el('showRegister').addEventListener('click',()=>view('register'));
  el('showLogin').addEventListener('click',()=>view('login'));
  el('registerForm').addEventListener('submit',handleRegistration);
  el('refreshMyLabDocuments').addEventListener('click',loadMyLabDocuments);
  el('proLabDocForm').addEventListener('submit',submitLabDocument);
  el('refreshLabDocsQueue').addEventListener('click',loadLabDocumentsQueue);
  el('labSubadminForm').addEventListener('submit',createLabSubadmin);
  el('refreshLabStaff').addEventListener('click',loadLabStaff);
  el('refreshLabAudit').addEventListener('click',loadLabAuditHistory);
  el('regServiceSearch').addEventListener('input',()=>renderServiceChecklist('regServiceChoices','regServiceSearch',registrationServiceIds));
  el('proServiceSearch').addEventListener('input',()=>renderServiceChecklist('proServiceChoices','proServiceSearch',proServiceIds,proServiceStatuses));
  el('saveProServices').addEventListener('click',saveMyDeclaredServices);
  el('refreshServiceDeclarations').addEventListener('click',loadServiceReviews);
  el('guestProfessionSearch').addEventListener('input',()=>renderProfessionFinder('guestProfessionList','guestProfessionSearch'));
  el('proProfessionSearch').addEventListener('input',()=>renderProfessionFinder('proProfessionList','proProfessionSearch'));
  el('requestSpecialtySearch').addEventListener('input',renderClientSpecialtyOptions);
  el('requestHeaterGuide').addEventListener('change',event=>{
    if(event.target?.name==='requestHeaterType'){
      manualHeaterType=event.target.value;
      renderClientSpecialtyOptions();
    }
  });
  el('adminSpecialtySearch').addEventListener('input',()=>renderAdminSpecialtyOptions());
  el('loginForm').addEventListener('submit',handleLogin);
  el('refreshJobs').addEventListener('click',refreshJobs);
  el('refreshContracts').addEventListener('click',loadContracts);
  el('refreshMyQuotes').addEventListener('click',loadMyQuotes);
  
el('labRequestForm').addEventListener('submit',createLabRequest);
  el('quoteForm').addEventListener('submit',submitLabQuote);
  el('clientReviewForm').addEventListener('submit',submitClientReview);
  el('clientClaimForm').addEventListener('submit',submitClientClaim);
  el('refreshClaimPerformance').addEventListener('click',()=>{
    claimPerformancePage=1;
    void loadClaimPerformance();
  });
  el('claimPerformancePrev').addEventListener('click',()=>{
    if(claimPerformancePage>1){claimPerformancePage--;void loadClaimPerformance();}
  });
  el('claimPerformanceNext').addEventListener('click',()=>{
    claimPerformancePage++;
    void loadClaimPerformance();
  });
  el('refreshAdminClaims').addEventListener('click',()=>{adminPendingPage=1;void loadAdminClaims();});
  el('refreshLabReminders').addEventListener('click',loadLabReminderLedger);
  el('runLabReminders').addEventListener('click',runLabReminders);
  el('adminPendingPrev').addEventListener('click',()=>{if(adminPendingPage>1){adminPendingPage--;void loadAdminClaims();}});
  el('adminPendingNext').addEventListener('click',()=>{adminPendingPage++;void loadAdminClaims();});
  el('toggleClaimArchive').addEventListener('click',()=>{
    const archive=el('claimArchiveSection');
    archive.hidden=!archive.hidden;
    el('toggleClaimArchive').setAttribute('aria-expanded',String(!archive.hidden));
    el('toggleClaimArchive').textContent=archive.hidden
      ? 'Abrir archivo de reclamos finalizados' : 'Cerrar archivo de reclamos finalizados';
    if(!archive.hidden) void loadArchivedClaims();
  });
  el('adminArchiveSearchForm').addEventListener('submit',event=>{
    event.preventDefault();
    adminArchivePage=1;
    void loadArchivedClaims();
  });
  el('clearAdminArchiveSearch').addEventListener('click',()=>{
    el('adminArchiveSearch').value='';
    adminArchivePage=1;
    void loadArchivedClaims();
  });
  el('adminArchivePrev').addEventListener('click',()=>{
    if(adminArchivePage>1){adminArchivePage--;void loadArchivedClaims();}
  });
  el('adminArchiveNext').addEventListener('click',()=>{
    adminArchivePage++;
    void loadArchivedClaims();
  });
  el('refreshClaimInbox').addEventListener('click',loadClaimInbox);
  el('openClaimFormButton').addEventListener('click', () => {
    el('clientClaimForm').hidden = !el('clientClaimForm').hidden;
  });

  el('showPending').addEventListener('click',loadProfessionals);
  el('adminProfessionalSelect').addEventListener('change',updateAdminSelection);
  el('adminSpecialtySelect').addEventListener('change',updateAdminSelection);
  el('prepareRefrigeration').addEventListener('click',prepareRefrigeration);
  el('approveSelected').addEventListener('click',approveSelected);
  el('resetProfessionalForm').addEventListener('submit',resetProfessionalPassword);
  el('logout').addEventListener('click',()=>{
    token='';profile=null;labProfessional=null;labCategoryId=null;
    el('adminSection').hidden=true;
    el('resetProfessionalForm').hidden=true;
    el('adminConfirmPassword').value='';
    el('newProfessionalPassword').value='';
    sessionStorage.removeItem(tokenKey);
    render();
    feedback('Sesión de prueba cerrada.');
  });
  select('client');
  view('register');
  render();
  void fetchLabServiceCatalog().catch(error=>{el('regServiceChoices').textContent='No se pudo consultar el catálogo de servicios: '+error.message;});
  void fetchLabProfessionCatalog().catch(error=>{
    el('guestProfessionList').textContent='No se pudo consultar el catálogo: '+error.message;
  });
  void restore();
})();

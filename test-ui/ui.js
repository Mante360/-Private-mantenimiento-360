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
        claim_already_open: 'Ya existe un reclamo abierto o en revisión para este trabajo. Esperá su resolución antes de presentar otro.'
      };
      const error = new Error(body.error === 'invalid_input' ? 'Los datos de la operación no son válidos.' : (known[body.error] || 'La solicitud no se completó (HTTP ' + response.status + ').'));
      error.code = body.error || '';
      throw error;
    }
    return body;
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
    el('profileRole').textContent = profile.role === 'professional' ? 'Profesional' : profile.role === 'client' ? 'Cliente' : 'Administrador';
    el('profileId').textContent = String(profile.id || '—');
    el('roleNotice').textContent = profile.role === 'admin'
      ? 'Administración de laboratorio: sólo aprobación ficticia, sin documentos personales.'
      : profile.role === 'professional'
      ? 'Cuenta profesional de laboratorio. Consultá solicitudes disponibles y tus trabajos contratados. No hay datos reales.'
      : 'Tu cuenta ficticia ya puede iniciar sesión. Las solicitudes serán exclusivamente de prueba.';
    el('jobsPanel').textContent = '';
    el('adminSection').hidden = profile.role !== 'admin';
    el('contractsSection').hidden = profile.role !== 'professional';
    el('myQuotesSection').hidden = profile.role !== 'professional';
    if(profile.role === 'professional') void loadMyQuotes();
    void loadClaimInbox();
    if (profile.role === 'professional') void loadContracts();
    
el('clientRequestSection').hidden = profile.role !== 'client';
if (profile.role === 'client') void loadClientSpecialties();

    if(profile.role === 'admin') { void loadProfessionals(); void loadAdminClaims(); }
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
    const button=el('registerButton');
    button.disabled = true;
    try {
      const data=await api('POST','/api/auth/register',{ name,email,password,role:choice },'');
      await activate(data);
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

  async function loadJobTimeline(job) {
    const panel = el('jobTimeline');
    panel.textContent = 'Consultando seguimiento...';
    try {
      const events = await api('GET', '/api/jobs/' + encodeURIComponent(String(job.id)) + '/events');
      if (openedJob?.id !== job.id) return;
      const rows = events.map(event => {
        const date = new Date(event.created_at);
        const time = Number.isNaN(date.getTime())
          ? '' : ' · ' + date.toLocaleString('es-AR');
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
                (visit.client_confirmed_at?' · '+new Date(visit.client_confirmed_at).toLocaleString('es-AR'):'')+'.';
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
      timeZone:'America/Argentina/Buenos_Aires',dateStyle:'medium',timeStyle:'short'
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
          '\nMotivo: ' + claim.reason + '\nDetalle: ' + claim.description;
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
      el('adminPendingCount').textContent='Reclamos pendientes: '+data.total;
      el('adminPendingPageInfo').textContent='Página '+data.page+' de '+Math.max(1,Math.ceil(data.total/data.pageSize));
      el('adminPendingPrev').disabled=adminPendingPage<=1;
      el('adminPendingNext').disabled=!data.hasMore;
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
  const select = el('requestSpecialty');
  select.replaceChildren(new Option('Seleccionar especialidad', ''));

  try {
    const categories = await api('GET', '/api/jobs/specialties');
    categories.forEach(c => {
      select.add(new Option(c.name, String(c.id)));
    });
  } catch (error) {
    el('requestResult').textContent =
      'No se pudieron cargar especialidades: ' + error.message;
  }
}

async function createLabRequest(event) {
  event.preventDefault();

  if (!profile || profile.role !== 'client') return;

  const specialtyId = Number(el('requestSpecialty').value);
  const description = el('requestDescription').value.trim();
  const locality = el('requestLocality').value.trim();

  if (!specialtyId || description.length < 3 || locality.length < 2) return;
  const photos=window.labPhotos.getStagedPhotos();
  if (photos.length>5) { el('requestResult').textContent='Elegí hasta 5 fotografías.'; return; }

  const button = el('createRequestButton');
  button.disabled = true;

  try {
    const job = await api('POST', '/api/jobs', {
      specialtyId,
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
      const specialtySelect = el('adminSpecialtySelect');
      specialtySelect.replaceChildren(new Option('Seleccionar especialidad', ''));
      categories.forEach(c => specialtySelect.add(new Option(c.name, String(c.id))));
      if (categories.some(c => String(c.id) === previousSpecialty)) specialtySelect.value = previousSpecialty;
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
  el('loginForm').addEventListener('submit',handleLogin);
  el('refreshJobs').addEventListener('click',refreshJobs);
  el('refreshContracts').addEventListener('click',loadContracts);
  el('refreshMyQuotes').addEventListener('click',loadMyQuotes);
  
el('labRequestForm').addEventListener('submit',createLabRequest);
  el('quoteForm').addEventListener('submit',submitLabQuote);
  el('clientReviewForm').addEventListener('submit',submitClientReview);
  el('clientClaimForm').addEventListener('submit',submitClientClaim);
  el('refreshAdminClaims').addEventListener('click',()=>{adminPendingPage=1;void loadAdminClaims();});
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
  void restore();
})();

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
        authentication_required: 'Necesitás iniciar sesión.',
        invalid_or_expired_token: 'La sesión venció. Volvé a ingresar.'
      };
      throw new Error(body.error === 'invalid_input' ? 'Los datos de la operación no son válidos.' : (known[body.error] || 'La solicitud no se completó (HTTP ' + response.status + ').'));
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
    if (profile.role === 'professional') void loadContracts();
    
el('clientRequestSection').hidden = profile.role !== 'client';
if (profile.role === 'client') void loadClientSpecialties();

    if(profile.role === 'admin') void loadProfessionals();
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
        summary.textContent = job.public_code + ' · ' + job.locality + ' · ' + job.status + ' ';
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
          ' · ' + job.status + ' · ARS ' + job.amount;
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
    requested: 'Solicitado', quoted: 'Presupuestado',
    confirmed: 'Contratado', in_progress: 'En ejecución',
    completed: 'Finalización informada · pendiente de revisión', cancelled: 'Cancelado',
    accepted: 'Aceptado'
  };
  const statusLabel = (status) => statusLabels[status] || status;

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
        return '• ' + statusLabel(event.new_status) + time;
      });
      panel.textContent = 'Seguimiento del trabajo\n' +
        (rows.length ? rows.join('\n') : 'Solicitud registrada. Sin cambios posteriores.');
    } catch (error) {
      panel.textContent = 'No se pudo consultar el seguimiento: ' + error.message;
    }
  }

  async function openJob(job) {
    openedJob = job;
    el('jobDetailPanel').hidden = false;
    el('jobDetailTitle').textContent = 'Seguimiento del trabajo ' + job.public_code;
    el('jobDetailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadJobTimeline(job);
    el('jobDetailText').textContent = 'Descripción: ' + job.description +
      '\nLocalidad: ' + job.locality + '\nEstado: ' + job.status;
    el('quoteFeedback').textContent = '';
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
    el('clientCompletionNotice').hidden = job.status !== 'completed';
    const isProfessional = profile?.role === 'professional';
    el('quoteForm').hidden = !isProfessional || !['requested','quoted'].includes(job.status);
    await loadJobQuotes(job);
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
          ' · Estado: ' + quote.status +
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
    } catch(error) {
      el('quoteFeedback').textContent = 'No se pudo enviar el presupuesto: ' + error.message;
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

  const button = el('createRequestButton');
  button.disabled = true;

  try {
    const job = await api('POST', '/api/jobs', {
      specialtyId,
      description,
      locality
    });

    el('requestResult').textContent =
      'Solicitud de prueba creada: ' + job.public_code;

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
  
el('labRequestForm').addEventListener('submit',createLabRequest);
  el('quoteForm').addEventListener('submit',submitLabQuote);

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

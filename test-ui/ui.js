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
      throw new Error(known[body.error] || 'La solicitud no se completó (HTTP ' + response.status + ').');
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
      ? 'Las cuentas profesionales nuevas requieren aprobación de Administración antes de recibir solicitudes. No hay datos reales.'
      : 'Tu cuenta ficticia ya puede iniciar sesión. Las solicitudes serán exclusivamente de prueba.';
    el('jobsPanel').textContent = '';
    el('adminSection').hidden = profile.role !== 'admin';
    
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
  async function refreshJobs() {
    try {
      const jobs=await api('GET','/api/jobs');
      el('jobsPanel').textContent=jobs.length
        ? 'Solicitudes de prueba disponibles: ' + jobs.length + '\n' +
          jobs.map(j=>'• '+j.public_code+' · '+j.locality+' · '+j.status).join('\n')
        : 
profile?.role === 'professional'
  ? 'No hay solicitudes abiertas para tu especialidad en este momento.'
  : 'Todavía no hay solicitudes de prueba para mostrar.'
;
    }catch(err){
      el('jobsPanel').textContent=err.message;
    }
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
  
el('labRequestForm').addEventListener('submit',createLabRequest);

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

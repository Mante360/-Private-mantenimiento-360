(() => {
  'use strict';
  // Temporary test-laboratory uploader. All bytes are re-encoded as JPEG in the browser.
  const el = id => document.getElementById(id);
  const token = () => sessionStorage.getItem('m360-lab-token') || '';
  let opened = null;
  let urls = [];
  let viewerItems = [];
  let viewerIndex = 0;
  let viewerPreviousFocus = null;
  let touchStartX = null;
  let staged = [];
  let stagedUrls = [];
  let pendingUpload = false;
  let stagingError = '';
  const release = () => { urls.forEach(x=>URL.revokeObjectURL(x)); urls=[]; };
  function closePhotoViewer() {
    const viewer=el('photoViewer');
    if (viewer.hidden) return;
    viewer.hidden=true;
    document.body.classList.remove('photo-viewer-open');
    el('photoViewerImage').removeAttribute('src');
    const previous=viewerPreviousFocus;
    viewerPreviousFocus=null;
    if (previous?.isConnected && !previous.closest('[hidden]')) previous.focus();
  }
  function showViewerItem(index) {
    if (!viewerItems.length) return;
    viewerIndex=(index+viewerItems.length)%viewerItems.length;
    const item=viewerItems[viewerIndex];
    el('photoViewerImage').src=item.url;
    el('photoViewerImage').alt=item.alt;
    el('photoViewerCounter').textContent='Fotografía '+(viewerIndex+1)+' de '+viewerItems.length;
    el('photoViewerDescription').textContent=item.caption;
    const single=viewerItems.length<2;
    el('photoViewerPrev').disabled=single;
    el('photoViewerNext').disabled=single;
  }
  function openPhotoViewer(index) {
    if (!viewerItems[index]) return;
    viewerPreviousFocus=document.activeElement;
    showViewerItem(index);
    el('photoViewer').hidden=false;
    document.body.classList.add('photo-viewer-open');
    el('photoViewerClose').focus();
  }
  el('photoViewerClose').addEventListener('click',closePhotoViewer);
  el('photoViewerPrev').addEventListener('click',()=>showViewerItem(viewerIndex-1));
  el('photoViewerNext').addEventListener('click',()=>showViewerItem(viewerIndex+1));
  el('photoViewer').addEventListener('click',event=>{
    if(event.target===el('photoViewer')) closePhotoViewer();
  });
  document.addEventListener('keydown',event=>{
    if(el('photoViewer').hidden) return;
    if(event.key==='Escape') {
      event.preventDefault();
      closePhotoViewer();
    } else if(event.key==='ArrowLeft'){
      event.preventDefault();
      showViewerItem(viewerIndex-1);
    } else if(event.key==='ArrowRight'){
      event.preventDefault();
      showViewerItem(viewerIndex+1);
    } else if(event.key==='Tab') {
      const controls=['photoViewerClose','photoViewerPrev','photoViewerNext']
        .map(el).filter(button=>!button.disabled);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&document.activeElement===last){
        event.preventDefault();first.focus();
      }
    }
  });
  el('photoViewerImage').addEventListener('touchstart',event=>{
    touchStartX=event.touches.length===1?event.touches[0].clientX:null;
  },{passive:true});
  el('photoViewerImage').addEventListener('touchend',event=>{
    if(touchStartX===null || event.changedTouches.length!==1)return;
    const travel=event.changedTouches[0].clientX-touchStartX;
    touchStartX=null;
    if(Math.abs(travel)>55){
      showViewerItem(viewerIndex+(travel<0?1:-1));
    }
  },{passive:true});

  async function optimize(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      throw new Error('Solo se aceptan JPG, PNG o WebP.');
    }
    if (file.size > 10*1024*1024) throw new Error(file.name+' supera los 10 MB originales.');
    const bmp=await createImageBitmap(file);
    try {
      const max=Math.max(bmp.width,bmp.height);
      if (!max) throw new Error('Imagen sin dimensiones válidas.');
      let edge=Math.min(1600,max);
      const canvas=document.createElement('canvas');
      for (let attempt=0;attempt<9;attempt++) {
        const scale=edge/max;
        canvas.width=Math.max(1,Math.round(bmp.width*scale));
        canvas.height=Math.max(1,Math.round(bmp.height*scale));
        const ctx=canvas.getContext('2d',{alpha:false});
        if (!ctx) throw new Error('No se pudo procesar la imagen.');
        ctx.fillStyle='#ffffff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(bmp,0,0,canvas.width,canvas.height);
        const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',Math.max(0.48,0.84-attempt*0.055)));
        if (result && result.size<=700000) return result;
        edge=Math.max(320,Math.floor(edge*0.8));
      }
      throw new Error('No se pudo reducir la imagen al límite del laboratorio.');
    } finally { bmp.close(); }
  }


  function clearStagedPhotos() {
    staged = [];
    stagingError = '';
    el('requestPhotoInput').value = '';
    renderStagedPhotos();
  }

  function renderStagedPhotos() {
    stagedUrls.forEach(url=>URL.revokeObjectURL(url));
    stagedUrls = [];
    const panel = el('requestPhotoPreview');
    panel.replaceChildren();
    const notice = document.createElement('p');
    notice.className = 'hint';
    notice.textContent = stagingError || (staged.length ?
      staged.length+' fotografía(s) listas para enviar con la solicitud.' :
      'Todavía no seleccionaste fotografías.');
    panel.append(notice);
    if (!staged.length) return;
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    staged.forEach((file, index)=>{
      const url = URL.createObjectURL(file);
      stagedUrls.push(url);
      const box = document.createElement('div');
      box.className = 'photo-thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Vista previa de '+file.name;
      const info = document.createElement('span');
      info.textContent = file.name + ' · '+Math.round(file.size/1024)+' KB (original)';
      const remove = document.createElement('button');
      remove.className = 'secondary photo-remove';
      remove.type = 'button';
      remove.textContent = 'Quitar';
      remove.addEventListener('click',()=>{
        staged.splice(index,1);
        stagingError = '';
        renderStagedPhotos();
      });
      box.append(img,info,remove);
      grid.append(box);
    });
    panel.append(grid);
  }

  function stageNewRequestPhotos() {
    const picker = el('requestPhotoInput');
    const chosen = Array.from(picker.files || []);
    picker.value = '';
    if (!chosen.length) return;
    const bad = chosen.find(file=> !['image/jpeg','image/png','image/webp'].includes(file.type) ||
      file.size>10*1024*1024);
    if (bad) {
      stagingError='La foto '+bad.name+' no es JPG/PNG/WebP o supera los 10 MB. No se agregaron las nuevas fotos.';
    } else if(staged.length+chosen.length>5) {
      stagingError='Podés seleccionar hasta 5 fotos por solicitud. Quitá alguna antes de agregar más.';
    } else {
      staged.push(...chosen);
      stagingError = '';
    }
    renderStagedPhotos();
  }

  async function uploadLabPhotos(jobId,files) {
    if (files.length>5) throw new Error('Se permiten hasta 5 fotos por carga.');
    let saved=0;
    for (const file of files) {
      const jpg=await optimize(file);
      const response=await fetch('/api/jobs/'+encodeURIComponent(String(jobId))+'/photos',{
        method:'POST',cache:'no-store',
        headers:{Authorization:'Bearer '+token(),'Content-Type':'image/jpeg'},
        body:jpg
      });
      if (!response.ok) {
        let data={};
        try { data=await response.json(); } catch (_) { /* malformed response */ }
        const reasons={
          photo_limit_reached:'Se alcanzó el máximo de 5 fotos por perfil y trabajo.',
          photo_upload_not_allowed:'No tenés permiso para agregar fotos a ese trabajo.',
          invalid_or_large_image:'La imagen fue rechazada por el servidor.',
          photo_too_large:'La imagen supera el límite del servidor.'
        };
        throw new Error((saved?saved+' fotos guardadas antes de este error. ':'')+
          (reasons[data.error]||'No se pudo guardar (HTTP '+response.status+').'));
      }
      saved++;
    }
    return saved;
  }

  async function loadPhotos(jobId) {
    closePhotoViewer();
    viewerItems=[];
    release();
    const panel=el('jobPhotosGallery');
    panel.replaceChildren();
    panel.textContent='Consultando fotografías...';
    try {
      const listResponse=await fetch('/api/jobs/'+encodeURIComponent(String(jobId))+'/photos',{
        cache:'no-store',headers:{Authorization:'Bearer '+token()}
      });
      if (!listResponse.ok) throw new Error('No tenés acceso a estas fotografías.');
      const photos=await listResponse.json();
      if (opened?.id!==jobId) return;
      panel.replaceChildren();
      if (!photos.length) { panel.textContent='Todavía no hay fotografías cargadas.'; return; }
      for (const photo of photos) {
        const response=await fetch('/api/jobs/'+encodeURIComponent(String(jobId))+'/photos/'+encodeURIComponent(String(photo.id)),{
          cache:'no-store',headers:{Authorization:'Bearer '+token()}
        });
        if (!response.ok) throw new Error('No se pudo recuperar una foto.');
        const blob=await response.blob();
        const url=URL.createObjectURL(blob);
        if (opened?.id!==jobId) { URL.revokeObjectURL(url); return; }
        urls.push(url);
        const thumb=document.createElement('button');
        thumb.type='button';
        thumb.className='photo-thumb';
        thumb.title='Ampliar y recorrer fotografías';
        thumb.setAttribute('aria-label','Ampliar foto '+(viewerItems.length+1)+' de '+photos.length);
        const img=document.createElement('img');
        img.src=url; img.loading='lazy';
        img.alt='Foto de '+(photo.uploader_role==='client'?'cliente':'profesional');
        const caption=document.createElement('span');
        caption.textContent=(photo.uploader_role==='client'?'Cliente':'Profesional')+
          ' · '+Math.round(Number(photo.size_bytes)/1024)+' KB';
        const index=viewerItems.length;
        viewerItems.push({url,alt:img.alt,caption:caption.textContent});
        thumb.addEventListener('click',()=>openPhotoViewer(index));
        thumb.append(img,caption);
        const card = document.createElement('div');
        card.className='photo-item';
        card.append(thumb);
        if (photo.can_remove === true) {
          const remove = document.createElement('button');
          remove.type='button';
          remove.className='secondary photo-remove';
          remove.textContent='Quitar esta foto';
          remove.addEventListener('click', async ()=>{
            if (!confirm('¿Quitar esta fotografía? Solo podrás quitar tus propias fotos recientes.')) return;
            remove.disabled=true;
            try {
              const result=await fetch('/api/jobs/'+encodeURIComponent(String(jobId))+
                '/photos/'+encodeURIComponent(String(photo.id)),{
                method:'DELETE',cache:'no-store',headers:{Authorization:'Bearer '+token()}
              });
              if(!result.ok) throw new Error('La foto ya no puede quitarse o no tenés autorización.');
              el('photoUploadResult').textContent='Fotografía retirada correctamente.';
              if (opened?.id===jobId) await loadPhotos(jobId);
            } catch(error) {
              el('photoUploadResult').textContent=error.message;
              remove.disabled=false;
            }
          });
          card.append(remove);
        }
        panel.append(card);
      }
    } catch (error) { panel.textContent='No se pudieron cargar las fotos: '+error.message; }
  }

  function openJob(job,profile) {
    closePhotoViewer();
    const jobId=Number(job.id);
    opened={id:jobId};
    el('photoArchiveNotice').textContent='Trabajo finalizado con conformidad: las fotografías originales quedan protegidas. Todavía no está habilitada la carga independiente de imágenes en reclamos o garantías de este laboratorio.';
    const mayUpload=profile?.role==='client' ||
      (profile?.role==='professional' && job.amount!==undefined &&
       ['confirmed','in_progress','completed'].includes(job.status));
    const conformidadRegistrada=job.status==='completed' && job.client_approved===true;
    el('photoArchiveNotice').hidden=!conformidadRegistrada;
    // For completed jobs, fail closed until the current conformity is checked.
    el('photoUploadControls').hidden=!mayUpload || job.status==='completed';
    el('jobPhotoInput').value='';
    el('photoUploadResult').textContent='';
    void loadPhotos(jobId);
    if(job.status==='completed' && !conformidadRegistrada && mayUpload) {
      void fetch('/api/jobs/'+encodeURIComponent(String(jobId))+'/review',{
        cache:'no-store',headers:{Authorization:'Bearer '+token()}
      }).then(async response=>{
        if(!response.ok)throw new Error('review_unavailable');
        return response.json();
      }).then(review=>{
        if(opened?.id!==jobId)return;
        el('photoArchiveNotice').hidden=!review;
        el('photoUploadControls').hidden=!!review;
      }).catch(()=>{
        if(opened?.id!==jobId)return;
        // Never enable modification when conformity cannot be verified.
        el('photoArchiveNotice').hidden=false;
        el('photoArchiveNotice').textContent='No se pudo comprobar si el trabajo tiene conformidad. Las fotografías se conservan, pero no se permite modificarlas hasta verificarlo.';
      });
    }
  }

  el('requestPhotoInput').addEventListener('change',stageNewRequestPhotos);
  renderStagedPhotos();

  el('jobPhotoInput').addEventListener('change',async()=>{
    const picker=el('jobPhotoInput');
    const files=Array.from(picker.files||[]);
    picker.value='';
    if (!opened || !files.length || pendingUpload) return;
    const jobId=opened.id;
    pendingUpload=true;
    picker.disabled=true;
    el('photoUploadResult').textContent='Preparando y guardando '+files.length+' foto(s)...';
    try {
      const count=await uploadLabPhotos(jobId,files);
      if (opened?.id===jobId) {
        el('photoUploadResult').textContent='Guardadas: '+count+' fotografía(s). Ya aparecen en este trabajo.';
      }
    } catch (error) {
      if (opened?.id===jobId) {
        el('photoUploadResult').textContent='Carga incompleta: '+error.message;
      }
    } finally {
      pendingUpload=false;
      picker.disabled=false;
      if (opened?.id===jobId) await loadPhotos(jobId);
    }
  });

  window.labPhotos={openJob,uploadLabPhotos,optimizeForEvidence:optimize,
    getStagedPhotos:()=>staged.slice(),clearStagedPhotos};

})();

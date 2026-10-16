(() => {
  'use strict';
  // Temporary test-laboratory uploader. All bytes are re-encoded as JPEG in the browser.
  const el = id => document.getElementById(id);
  const token = () => sessionStorage.getItem('m360-lab-token') || '';
  let opened = null;
  let urls = [];
  const release = () => { urls.forEach(x=>URL.revokeObjectURL(x)); urls=[]; };

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
        const a=document.createElement('a');
        a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
        a.className='photo-thumb'; a.title='Abrir fotografía ampliada';
        const img=document.createElement('img');
        img.src=url; img.loading='lazy';
        img.alt='Foto de '+(photo.uploader_role==='client'?'cliente':'profesional');
        const caption=document.createElement('span');
        caption.textContent=(photo.uploader_role==='client'?'Cliente':'Profesional')+
          ' · '+Math.round(Number(photo.size_bytes)/1024)+' KB';
        a.append(img,caption);
        panel.append(a);
      }
    } catch (error) { panel.textContent='No se pudieron cargar las fotos: '+error.message; }
  }

  function openJob(job,profile) {
    opened={id:Number(job.id)};
    const mayUpload=profile?.role==='client' ||
      (profile?.role==='professional' && job.amount!==undefined &&
       ['confirmed','in_progress','completed'].includes(job.status));
    el('photoUploadControls').hidden=!mayUpload;
    el('jobPhotoInput').value='';
    el('photoUploadResult').textContent='';
    void loadPhotos(Number(job.id));
  }

  el('requestPhotoInput').addEventListener('change',()=>{
    const n=el('requestPhotoInput').files?.length||0;
    el('requestPhotoPreview').textContent=n+' archivo(s) seleccionado(s)'+(n>5?' (máximo 5)':'');
  });
  el('uploadJobPhotos').addEventListener('click',async()=>{
    const files=Array.from(el('jobPhotoInput').files||[]);
    if (!opened||!files.length) {
      el('photoUploadResult').textContent='Elegí una fotografía primero.'; return;
    }
    const jobId=opened.id;
    const button=el('uploadJobPhotos');
    button.disabled=true;
    el('photoUploadResult').textContent='Preparando y subiendo fotos...';
    try {
      const count=await uploadLabPhotos(jobId,files);
      el('jobPhotoInput').value='';
      el('photoUploadResult').textContent='Guardadas: '+count+' fotografía(s).';
    } catch (error) {
      el('photoUploadResult').textContent='Carga incompleta: '+error.message;
    } finally {
      button.disabled=false;
      if (opened?.id===jobId) await loadPhotos(jobId);
    }
  });
  window.labPhotos={openJob,uploadLabPhotos};
})();

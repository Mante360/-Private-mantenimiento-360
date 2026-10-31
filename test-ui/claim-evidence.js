(() => {
  'use strict';
  // Separate laboratory evidence for a specific claim or authorized warranty
  // visit. Original job photos remain immutable after client conformity.
  const token=()=>sessionStorage.getItem('m360-lab-token')||'';
  const date=value=>new Date(value).toLocaleString('es-AR',{
    timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',
    year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  });
  const make=(tag,text,className)=>{
    const el=document.createElement(tag);
    if(text!==undefined)el.textContent=text;
    if(className)el.className=className;
    return el;
  };
  const dataUrl=blob=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('No se pudo leer la fotografía.'));
    reader.readAsDataURL(blob);
  });

  function create(claimId,visitId,canUpload,code='') {
    const isWarranty=visitId!==null && visitId!==undefined;
    const base='/api/claims/'+encodeURIComponent(String(claimId))+
      (isWarranty?'/warranty/'+encodeURIComponent(String(visitId)):'')+'/evidence';
    const section=make('section',undefined,'admin-section');
    section.style.marginTop='12px';
    const title=make('h4',isWarranty?'Fotografías de la garantía '+code:'Evidencias fotográficas del reclamo');
    const explanation=make('p','Las imágenes se vinculan únicamente a este expediente, con responsable y fecha. No modifican las fotografías del trabajo original.','hint');
    const gallery=make('div','Consultando evidencias...','photo-grid');
    gallery.setAttribute('role','status');
    const status=make('p',undefined,'hint');
    status.setAttribute('role','status');
    section.append(title,explanation,gallery);

    const controls=make('div');
    let input=null;
    if(canUpload) {
      const label=make('label','Adjuntar evidencias ficticias (hasta 5 por persona en este expediente)');
      input=make('input');input.type='file';
      input.accept='image/jpeg,image/png,image/webp';input.multiple=true;
      label.append(input);
      const hint=make('p','Las fotografías enviadas se conservan como evidencia y no se pueden reemplazar ni eliminar.','hint');
      controls.append(label,hint,status);
      section.append(controls);
    } else {
      status.textContent='Expediente en solo lectura: sus evidencias permanecen conservadas.';
      section.append(status);
    }

    const dialog=make('div',undefined,'photo-viewer');
    dialog.hidden=true;
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label','Fotografías del expediente');
    const inner=make('div',undefined,'photo-viewer-inner');
    const bar=make('div',undefined,'photo-viewer-header');
    const count=make('strong','Fotografía');
    const close=make('button','✕ Cerrar','photo-viewer-close');
    close.type='button';bar.append(count,close);
    const main=make('div',undefined,'photo-viewer-main');
    const prev=make('button','❮','photo-viewer-arrow');prev.type='button';
    prev.setAttribute('aria-label','Fotografía anterior');
    const image=make('img');image.alt='Evidencia de reclamo ampliada';
    const next=make('button','❯','photo-viewer-arrow');next.type='button';
    next.setAttribute('aria-label','Fotografía siguiente');
    main.append(prev,image,next);
    const caption=make('p',undefined,'photo-viewer-caption');
    inner.append(bar,main,caption);
    dialog.append(inner);section.append(dialog);
    let photos=[],index=0;
    const show=n=>{
      if(!photos.length)return;
      index=(n+photos.length)%photos.length;
      image.src=photos[index].url;
      count.textContent='Fotografía '+(index+1)+' de '+photos.length;
      caption.textContent=photos[index].caption;
      prev.disabled=next.disabled=photos.length===1;
    };
    const keyboard=e=>{
      if(e.key==='Escape'){e.preventDefault();hide();}
      else if(e.key==='ArrowRight'){e.preventDefault();show(index+1);}
      else if(e.key==='ArrowLeft'){e.preventDefault();show(index-1);}
    };
    function hide(){
      dialog.hidden=true;
      document.body.classList.remove('photo-viewer-open');
      document.removeEventListener('keydown',keyboard);
    }
    function open(i){
      show(i);dialog.hidden=false;
      document.body.classList.add('photo-viewer-open');
      document.addEventListener('keydown',keyboard);
      close.focus();
    }
    close.onclick=hide;
    prev.onclick=()=>show(index-1);
    next.onclick=()=>show(index+1);
    dialog.addEventListener('click',e=>{if(e.target===dialog)hide();});

    async function refresh() {
      gallery.textContent='Consultando evidencias...';
      try{
        const list=await fetch(base,{headers:{Authorization:'Bearer '+token()},cache:'no-store'});
        if(!list.ok)throw new Error('HTTP '+list.status);
        const rows=await list.json();
        const pictures=[];
        for(const row of rows){
          const response=await fetch(base+'/'+encodeURIComponent(String(row.id)),{
            headers:{Authorization:'Bearer '+token()},cache:'no-store'
          });
          if(!response.ok)throw new Error('No se pudo abrir una imagen (HTTP '+response.status+').');
          const url=await dataUrl(await response.blob());
          const who=row.uploader_role==='client'?'Cliente':row.uploader_role==='professional'?'Profesional':'Administración';
          pictures.push({url,caption:who+' · '+row.uploader_name+
            ' · '+date(row.created_at)+' · '+Math.round(Number(row.size_bytes)/1024)+' KB'});
        }
        if(!section.isConnected)return;
        hide();photos=pictures;gallery.replaceChildren();
        if(!photos.length){gallery.textContent='Todavía no hay fotografías en este expediente.';return;}
        photos.forEach((photo,i)=>{
          const box=make('div',undefined,'photo-item');
          const thumb=make('button',undefined,'photo-thumb');
          thumb.type='button';thumb.setAttribute('aria-label','Ampliar evidencia '+(i+1)+' de '+photos.length);
          const img=make('img');img.src=photo.url;img.alt='Evidencia fotográfica '+(i+1);
          const label=make('span',photo.caption);
          thumb.append(img,label);thumb.onclick=()=>open(i);
          box.append(thumb);gallery.append(box);
        });
      }catch(error){gallery.textContent='No se pudieron consultar las evidencias: '+error.message;}
    }

    if(input)input.addEventListener('change',async()=>{
      const files=Array.from(input.files||[]);input.value='';
      if(!files.length)return;
      if(files.length>5){status.textContent='Seleccioná como máximo cinco fotografías.';return;}
      input.disabled=true;status.textContent='Guardando evidencias...';
      let saved=0;
      try{
        for(const file of files){
          const converted=await window.labPhotos.optimizeForEvidence(file);
          const response=await fetch(base,{
            method:'POST',cache:'no-store',
            headers:{Authorization:'Bearer '+token(),'Content-Type':'image/jpeg'},
            body:converted
          });
          if(!response.ok) {
            const body=await response.json().catch(()=>({}));
            const message=body.error==='claim_evidence_limit_reached'
              ? 'Se alcanzó el máximo de cinco fotos por persona en este expediente.'
              : body.error==='claim_evidence_upload_not_allowed'
                ? 'El expediente ya no admite nuevas pruebas, o no tenés autorización.'
                : 'HTTP '+response.status;
            throw new Error(message);
          }
          saved++;
        }
        status.textContent='Guardadas: '+saved+' evidencia(s) en este expediente.';
      }catch(error){
        status.textContent='Carga incompleta. '+saved+' guardada(s). '+error.message;
      }finally{
        input.disabled=false;
        await refresh();
      }
    });
    // Only query evidence for a card the UI is authorized to display. The
    // server still independently validates every list and individual image.
    void refresh();
    return section;
  }
  window.labClaimEvidence={create};
})();

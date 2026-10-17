(function () {
'use strict';
/*
 * Receipt Studio is a clean editor. It owns the design surface and inspector;
 * receipt-designer.js remains the production renderer/printer so the custom
 * layout does not invent a new hardware/ESC-POS path.
 */
var engine, schema, root, branch, design, format, selected, saved, busy=false, revision=0, undo=[];
var esc=function(v){return PosnicPro.escapeHtml(String(v==null?'':v));};
var id=function(){return 'studio-'+Math.random().toString(36).slice(2,10);};
var layout=function(){return design.layouts[format];};
var current=function(){return layout().blocks.find(function(b){return b.id===selected;});};
var names={logo:'Logo image',store:'Store details',transaction:'Receipt details',items:'Sale items',totals:'Totals',text:'Text',field:'Dynamic field',qr:'QR code',image:'Image',barcode:'Barcode',divider:'Divider',signature:'Signature'};
var sizes={ '58':{w:48,h:280},'80':{w:72,h:320},'112':{w:104,h:350},a4:{w:186,h:263},a5:{w:124,h:176},letter:{w:190,h:250}};
function checkpoint(){undo.push(engine.copy(design));if(undo.length>20)undo.shift();}
function status(s,bad){root.find('.rs-status').text(s).toggleClass('text-danger',!!bad);}
function seed(data){
 design=data.receipt_designs?schema.normalize(data.receipt_designs):engine.defaults(data);
 format=design.defaultFormat||'80';
 Object.keys(design.layouts).forEach(function(f){
   var l=design.layouts[f]; l.canvas=true;
   l.canvasHeight=Math.max(240,Number(l.canvasHeight)||sizes[f].h*3.78);
   var w=0; l.blocks.forEach(function(b,i){
     if(!Number.isFinite(Number(b.x)))b.x=4;
     if(!Number.isFinite(Number(b.y)))b.y=12+i*42;
     if(!Number.isFinite(Number(b.w)))b.w=(b.type==='items'||b.type==='totals'||b.type==='store'||b.type==='transaction')?92:70;
     if(!Number.isFinite(Number(b.h)))b.h=b.type==='logo'?54:b.type==='items'?110:b.type==='totals'?72:30;
     if(!Number.isFinite(Number(b.rotation)))b.rotation=0;
     w=Math.max(w,Number(b.y)+Number(b.h)+12);
   });
   l.canvasHeight=Math.min(8000,Math.max(l.canvasHeight,w));
 });
 selected=layout().blocks[0]&&layout().blocks[0].id;
 saved=JSON.stringify(design);
}
function sample(){
 var item=function(n,p,q){return {item_name:n,item_price:p,item_quantity:q,item_unit:'ea',total_amount:p*q};};
 return Object.assign({},branch,{receipt_designs:design,sales_id:'SAMPLE-001',created_date:new Date().toLocaleString(),customer_name:'Sample Customer',customer_phone:'0550 00 00 00',items:[item('Example product',1200,2),item('Second item',850,1)],items_subtotal:3250,items_total:3250,tax:0,discount:0,charges:[],payment_mode:'Cash',partial_check:'false',sales_description:'Thank you for shopping with us.'});
}
function render(){
 if(!root||!root.length)return;
 var f=schema.formats[format], l=layout();
 root.find('.rs-format').removeClass('active').filter('[data-format="'+format+'"]').addClass('active');
 root.find('.rs-paper').css({width:Math.min(100, f.height?100:100)+'%',minHeight:Math.max(260,Math.min(650,Number(l.canvasHeight)||320))+'px'});
 root.find('.rs-paper').empty();
 l.blocks.forEach(function(b){
   var label=names[b.type]||b.type, el=$('<button type="button" class="rs-object"></button>').attr('data-id',b.id).text(label);
   el.css({left:b.x+'%',top:b.y+'px',width:b.w+'%',height:b.h+'px',transform:'rotate('+(b.rotation||0)+'deg)',fontSize:(b.fontSize||l.fontSize||12)+'px',fontWeight:b.bold?'700':'400',textAlign:b.align||'left'});
   if(b.type==='text')el.text(b.text||'Text'); else if(b.type==='field')el.text(schema.fields[b.field]||b.field||'Dynamic field');
   else if(b.type==='logo'||b.type==='image') {el.empty(); if(b.src)el.append($('<img>').attr('src',b.src));else el.text(label);}
   if(b.id===selected)el.addClass('selected');
   root.find('.rs-paper').append(el);
 });
 var b=current();
 root.find('.rs-inspector').html(b?inspector(b):'<p>Select an item on the receipt or add one from the left.</p>');
 root.find('.rs-paper-size').text(f.name+' · '+f.width+' mm'+(f.height?' × '+f.height+' mm':' roll'));
 root.find('.rs-undo').prop('disabled',!undo.length);
}
function inspector(b){
 return '<div class="form-group"><label>Selected item</label><input class="form-control" readonly value="'+esc(names[b.type]||b.type)+'"></div>'+
 '<div class="form-row"><div class="form-group col-6"><label>Left (%)</label><input class="form-control" data-prop="x" type="number" min="0" max="100" value="'+esc(b.x)+'"></div><div class="form-group col-6"><label>Top (px)</label><input class="form-control" data-prop="y" type="number" min="0" max="8000" value="'+esc(b.y)+'"></div></div>'+
 '<div class="form-row"><div class="form-group col-6"><label>Width (%)</label><input class="form-control" data-prop="w" type="number" min="2" max="100" value="'+esc(b.w)+'"></div><div class="form-group col-6"><label>Height (px)</label><input class="form-control" data-prop="h" type="number" min="8" max="1200" value="'+esc(b.h)+'"></div></div>'+
 '<div class="form-row"><div class="form-group col-6"><label>Rotation (°)</label><input class="form-control" data-prop="rotation" type="number" min="-180" max="180" value="'+esc(b.rotation||0)+'"></div><div class="form-group col-6"><label>Font size (px)</label><input class="form-control" data-prop="fontSize" type="number" min="6" max="96" value="'+esc(b.fontSize||layout().fontSize||12)+'"></div></div>'+
 '<div class="form-group"><label>Alignment</label><select class="form-control" data-prop="align"><option value="left" '+(b.align==='left'?'selected':'')+'>Left</option><option value="center" '+(b.align==='center'?'selected':'')+'>Center</option><option value="right" '+(b.align==='right'?'selected':'')+'>Right</option></select></div>'+
 ((b.type==='text'||b.type==='qr')?'<div class="form-group"><label>Text / QR content</label><textarea class="form-control" rows="3" data-prop="'+(b.type==='qr'?'text':'text')+'">'+esc(b.text||'')+'</textarea></div>':'')+
 (b.type==='field'?'<div class="form-group"><label>Dynamic field</label><select class="form-control" data-prop="field">'+Object.keys(schema.fields).map(function(k){return '<option value="'+esc(k)+'" '+(b.field===k?'selected':'')+'>'+esc(schema.fields[k])+'</option>';}).join('')+'</select></div>':'')+
 ((b.type==='logo'||b.type==='image')?'<div class="form-group"><label>Upload PNG/JPEG/WebP</label><input class="form-control-file" type="file" accept="image/png,image/jpeg,image/webp" id="rs-image"><small>Transparent PNG logos are supported.</small></div>':'')+
 '<div class="form-check mb-3"><input class="form-check-input" id="rs-bold" type="checkbox" '+(b.bold?'checked':'')+'><label class="form-check-label" for="rs-bold">Bold text</label></div>'+
 '<button type="button" class="btn btn-outline-danger btn-sm rs-delete">Delete selected item</button>';
}
function add(type){
 var b=engine.block(type,{id:id(),align:'left',x:4,y:Math.max(12,layout().canvasHeight?Math.min(500,layout().blocks.length*42+12):12),w: type==='items'||type==='totals'||type==='store'||type==='transaction'?92:55,h:type==='logo'||type==='image'?52:type==='items'?100:30,fontSize:12,rotation:0});
 if(type==='text')b.text='Your text'; if(type==='field')b.field=Object.keys(schema.fields)[0];
 if(type==='qr')b.text=''; if(type==='image'||type==='logo')b.src='';
 checkpoint();layout().blocks.push(b);layout().canvasHeight=Math.max(layout().canvasHeight,b.y+b.h+20);selected=b.id;render();status('Unsaved changes');
}
function persist(){
 if(busy)return;
 try{design=schema.normalize(design);}catch(e){status(e.message,true);return;}
 busy=true;root.find('.rs-save').prop('disabled',true);status('Saving design…');
 var payload=engine.copy(design);
 PosnicPro.put({url:'setting/updateCommonSettings',data:JSON.stringify({receipt_designs:payload,print_type:schema.formats[payload.defaultFormat].height?'a4':'standard'})},function(res){
  busy=false;root.find('.rs-save').prop('disabled',false);
  if(res.type!=='success'||!res.data||!res.data.receipt_designs){status(res.message||'Could not save receipt design.',true);return;}
  branch.receipt_designs=res.data.receipt_designs;design=schema.normalize(res.data.receipt_designs);saved=JSON.stringify(design);render();status('Design saved');
 },function(xhr){busy=false;root.find('.rs-save').prop('disabled',false);status(xhr&&xhr.responseJSON&&xhr.responseJSON.message||'Save failed; your edits are still here.',true);});
}
function printSample(){
 var data=sample();data.sales_id='SAMPLE-001';
 status('Preparing test receipt…');
 try{var html=engine.render(data,format,false);html=html.replace(/(<article[^>]*>)/,'$1<div style="text-align:center;font-weight:bold;font-size:10px">SAMPLE - NOT A SALE</div>');engine.print(html,format,{sample:true}).then(function(r){status(r&&r.success?'Test receipt sent.':'Print dialog closed.');}).catch(function(e){status(e.message||'Test print failed',true);});}
 catch(e){status(e.message||'Could not prepare test receipt.',true);}
}
function load(data){
 branch=data||{};engine=PosnicPro.receiptDesigner;schema=engine.contract;root=$('#receipt-designer');if(!root.length)return;
 seed(branch);
 root.html('<div class="rs-head"><div><h3>Receipt Studio</h3><p>Drag elements on the blank receipt, resize, rotate and set each element’s font independently.</p></div><div class="rs-actions"><span class="rs-status" role="status">New designer ready</span><button class="btn btn-outline-primary rs-undo" type="button">Undo</button><button class="btn btn-outline-primary rs-test" type="button">Print test</button><button class="btn btn-primary rs-save" type="button">Save design</button></div></div>'+
 '<div class="rs-formats">'+Object.keys(schema.formats).map(function(f){return '<button type="button" class="btn btn-outline-secondary rs-format" data-format="'+f+'">'+esc(schema.formats[f].name)+'</button>';}).join('')+'</div>'+
 '<div class="rs-work"><aside class="rs-tools"><h4>Add to receipt</h4>'+[['text','Text'],['field','Dynamic field'],['logo','Logo PNG'],['store','Store details'],['transaction','Receipt details'],['items','Sale items'],['totals','Totals'],['barcode','Barcode'],['qr','QR code'],['divider','Divider'],['signature','Signature']].map(function(a){return '<button type="button" class="btn btn-light btn-block rs-add" data-type="'+a[0]+'">＋ '+a[1]+'</button>';}).join('')+'<p class="small text-muted mt-3">Choose an element to add it, then drag it on the paper. Upload PNG logos from the inspector.</p></aside>'+
 '<section class="rs-stage"><div class="rs-paper-meta"><span class="rs-paper-size"></span><label>Canvas height <input class="form-control form-control-sm rs-height" type="number" min="240" max="8000" value="'+esc(layout().canvasHeight)+'"> px</label></div><div class="rs-paper-wrap"><div class="rs-paper" aria-label="Blank receipt canvas"></div></div></section>'+
 '<aside class="rs-inspector"><p>Select an item on the receipt or add one from the left.</p></aside></div>');
 render();
 root.off('.receiptStudio').on('click.receiptStudio','.rs-add',function(){add(this.getAttribute('data-type'));})
 .on('click.receiptStudio','.rs-format',function(){format=this.getAttribute('data-format');if(!design.layouts[format].canvas){design.layouts[format].canvas=true;}selected=layout().blocks[0]&&layout().blocks[0].id;render();})
 .on('click.receiptStudio','.rs-save',persist).on('click.receiptStudio','.rs-test',printSample)
 .on('click.receiptStudio','.rs-undo',function(){if(undo.length){design=undo.pop();render();status('Previous change restored');}})
 .on('click.receiptStudio','.rs-object',function(){selected=this.getAttribute('data-id');render();})
 .on('change.receiptStudio','[data-prop]',function(){var b=current(),k=this.getAttribute('data-prop');if(!b)return;checkpoint();var v=this.value;b[k]=['x','y','w','h','rotation','fontSize'].indexOf(k)>=0?Number(v):v;render();status('Unsaved changes');})
 .on('change.receiptStudio','#rs-bold',function(){var b=current();if(!b)return;checkpoint();b.bold=this.checked;render();status('Unsaved changes');})
 .on('change.receiptStudio','#rs-image',function(){var file=this.files&&this.files[0],b=current();if(!file||!b)return;if(file.size>5*1024*1024){status('Image must be 5 MB or smaller.',true);return;}var reader=new FileReader();reader.onload=function(){var img=new Image();img.onload=function(){var c=document.createElement('canvas'),scale=Math.min(1,768/img.width,768/img.height);c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);checkpoint();b.src=c.toDataURL('image/png');render();status('Image added. Save to keep it.');};img.onerror=function(){status('Could not load this image.',true);};img.src=reader.result;};reader.readAsDataURL(file);})
 .on('click.receiptStudio','.rs-delete',function(){var i=layout().blocks.findIndex(function(b){return b.id===selected;});if(i<0)return;checkpoint();layout().blocks.splice(i,1);selected=layout().blocks[0]&&layout().blocks[0].id;render();status('Item removed');})
 .on('change.receiptStudio','.rs-height',function(){checkpoint();layout().canvasHeight=Math.max(240,Math.min(8000,Number(this.value)||320));render();status('Unsaved changes');});
 // Pointer drag and corner resize are confined to the receipt paper.
 root.on('pointerdown.receiptStudio','.rs-object',function(e){
   if(e.button!==0)return;var el=this,b=layout().blocks.find(function(x){return x.id===el.getAttribute('data-id');});if(!b)return;
   selected=b.id;var paper=root.find('.rs-paper')[0],rect=paper.getBoundingClientRect(),startX=e.clientX,startY=e.clientY,start={x:Number(b.x),y:Number(b.y),w:Number(b.w),h:Number(b.h)};
   var resizing=e.target.classList.contains('rs-resize');checkpoint();el.setPointerCapture&&el.setPointerCapture(e.pointerId);e.preventDefault();
   function move(ev){var dx=ev.clientX-startX,dy=ev.clientY-startY;if(resizing){b.w=Math.max(2,Math.min(100,start.w+dx/rect.width*100));b.h=Math.max(8,Math.min(1200,start.h+dy));}else{b.x=Math.max(0,Math.min(100,start.x+dx/rect.width*100));b.y=Math.max(0,Math.min(8000,start.y+dy));}b.x=Math.round(b.x*10)/10;b.y=Math.round(b.y);el.style.left=b.x+'%';el.style.top=b.y+'px';el.style.width=b.w+'%';el.style.height=b.h+'px';}
   function up(){document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);render();status('Unsaved changes');}
   document.addEventListener('pointermove',move);document.addEventListener('pointerup',up,{once:true});
 });
 root.on('mouseenter.receiptStudio','.rs-object',function(){if(this.getAttribute('data-id')===selected&&!this.querySelector('.rs-resize')){var h=document.createElement('span');h.className='rs-resize';h.textContent='↘';this.appendChild(h);}});
 root.on('shown.bs.tab.receiptStudio','#print-design-tab',render);
}
PosnicPro.receiptDesignerEditor={load:load,save:persist,printSample:printSample};
}());
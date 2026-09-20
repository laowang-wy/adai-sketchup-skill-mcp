"""Read-only C API audit. Run in an independent bounded process (read_skp_batch.py).
No source save, UI or bridge writes. SDK/file compatibility is reported by the installed SDK.
"""
import argparse
import ctypes as c
import hashlib
import os
import json
import time
from pathlib import Path
from collections import Counter


def file_hash(source):
    digest=hashlib.sha256()
    with open(source,'rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--sdk-dir',type=Path,default=os.environ.get('SKETCHUP_SDK_DIR'))
    a=parser.parse_args()
    source=str(a.source.resolve());output=a.output.resolve()
    if not Path(source).is_file() or Path(source).suffix.lower()!='.skp':parser.error('Expected existing .skp source')
    if output==Path(source).parent or Path(source).parent in output.parents:parser.error('Keep outputs outside the source directory')
    if (output/'model-audit.json').exists():parser.error('Audit exists; use a new output directory')
    sdk=a.sdk_dir
    if sdk is None:
        parser.error('Set --sdk-dir or SKETCHUP_SDK_DIR to your compatible SketchUp SDK directory')
    sdk=Path(sdk).resolve()
    if not (sdk/'SketchUpAPI.dll').is_file():parser.error('SDK DLL missing; set --sdk-dir or SKETCHUP_SDK_DIR')
    sha_before=file_hash(source)
    output.mkdir(parents=True,exist_ok=True)
    class Ref(c.Structure):_fields_=[('ptr',c.c_void_p)]
    api=None;handle=None;initialized=False;model=Ref();getter_statuses=Counter()
    def fn(name,args,ret=c.c_int):
        f=getattr(api,name);f.argtypes=args;f.restype=ret;return f
    def check(code,label):
        if code:raise RuntimeError(f'{label}: SUResult {code}')
    try:
        handle=os.add_dll_directory(str(sdk));api=c.CDLL(str(sdk/'SketchUpAPI.dll'))
        fn('SUInitialize',[],None)();initialized=True
        t=time.time()
        check(fn('SUModelCreateFromFile',[c.POINTER(Ref),c.c_char_p])(c.byref(model),source.encode('utf-8')),'load')
        print('loaded',round(time.time()-t,2),flush=True)
        import collections,hashlib,math
        # All functions below are getters; the source is never saved or modified.
        fn('SUStringCreate',[c.POINTER(Ref)]);fn('SUStringRelease',[c.POINTER(Ref)]);fn('SUStringGetUTF8Length',[Ref,c.POINTER(c.c_size_t)]);fn('SUStringGetUTF8',[Ref,c.c_size_t,c.c_char_p,c.POINTER(c.c_size_t)])
        def text(prefix,ref,method='GetName'):
         s=Ref();check(api.SUStringCreate(c.byref(s)),'SUStringCreate')
         try:
          code=fn(prefix+method,[Ref,c.POINTER(Ref)])(ref,c.byref(s))
          if code:
           getter_statuses[prefix+method+':'+str(code)]+=1;return None
          n=c.c_size_t();check(api.SUStringGetUTF8Length(s,c.byref(n)),'SUStringGetUTF8Length');buf=c.create_string_buffer(n.value+1);check(api.SUStringGetUTF8(s,len(buf),buf,c.byref(n)),'SUStringGetUTF8');return buf.value.decode('utf8','replace')
         finally:api.SUStringRelease(c.byref(s))
        def count(prefix,ref,kind):
         n=c.c_size_t();check(fn(prefix+'GetNum'+kind,[Ref,c.POINTER(c.c_size_t)])(ref,c.byref(n)),kind);return n.value
        def refs(prefix,ref,kind):
         n=count(prefix,ref,kind)
         if not n:return []
         arr=(Ref*n)();got=c.c_size_t();check(fn(prefix+'Get'+kind,[Ref,c.c_size_t,c.POINTER(Ref),c.POINTER(c.c_size_t)])(ref,n,arr,c.byref(got)),kind);return list(arr)[:got.value]
        def refget(name,ref):
         out=Ref();check(fn(name,[Ref,c.POINTER(Ref)])(ref,c.byref(out)),name);return out
        class Point(c.Structure):_fields_=[('x',c.c_double),('y',c.c_double),('z',c.c_double)]
        class Bounds(c.Structure):_fields_=[('lo',Point),('hi',Point)]
        class Transform(c.Structure):_fields_=[('values',c.c_double*16)]
        def drawing(prefix,ref):
         d=fn(prefix+'ToDrawingElement',[Ref],Ref)(ref);bb=Bounds();code=fn('SUDrawingElementGetBoundingBox',[Ref,c.POINTER(Bounds)])(d,c.byref(bb));hide=c.c_bool();hide_code=fn('SUDrawingElementGetHidden',[Ref,c.POINTER(c.c_bool)])(d,c.byref(hide));layer=Ref();layer_code=fn('SUDrawingElementGetLayer',[Ref,c.POINTER(Ref)])(d,c.byref(layer))
         for label,status in [('bounds',code),('hidden',hide_code),('layer',layer_code)]:
          if status:getter_statuses[prefix+':'+label+':'+str(status)]+=1
         return {'bounds_m':[[round(v*0.0254,5) for v in [bb.lo.x,bb.lo.y,bb.lo.z]],[round(v*0.0254,5) for v in [bb.hi.x,bb.hi.y,bb.hi.z]]] if not code else None,'hidden':hide.value if not hide_code else None,'layer':text('SULayer',layer) if not layer_code and layer.ptr else None}
        def edge_count(ents):
         n=c.c_size_t();check(fn('SUEntitiesGetNumEdges',[Ref,c.c_bool,c.POINTER(c.c_size_t)])(ents,False,c.byref(n)),'edges');return n.value
        all_defs=refs('SUModel',model,'ComponentDefinitions');groups=refs('SUModel',model,'GroupDefinitions')
        lookup={d.ptr:f'C{i:04d}' for i,d in enumerate(all_defs)};lookup.update({d.ptr:f'G{i:04d}' for i,d in enumerate(groups)})
        nodes={};material_refs=refs('SUModel',model,'Materials');material_lookup={x.ptr:text('SUMaterial',x) for x in material_refs};assignments=collections.Counter()
        def node(ents):
         children=[]
         for kind,prefix in [('Instances','SUComponentInstance'),('Groups','SUGroup')]:
          for ref in refs('SUEntities',ents,kind):
           definition=refget(prefix+'GetDefinition',ref);tr=Transform();check(fn(prefix+'GetTransform',[Ref,c.POINTER(Transform)])(ref,c.byref(tr)),prefix+'transform')
           info={'definition':lookup.get(definition.ptr,'UNKNOWN'),'kind':kind,'name':text(prefix,ref),'transform':list(tr.values),**drawing(prefix,ref)}
           children.append(info)
         faces=refs('SUEntities',ents,'Faces');material_counts=collections.Counter()
         for face in faces:
          for side in ['Front','Back']:
           mat=Ref();code=fn('SUFaceGet'+side+'Material',[Ref,c.POINTER(Ref)])(face,c.byref(mat))
           if not code and mat.ptr:material_counts[material_lookup.get(mat.ptr,'unknown')]+=1
         return {'faces':len(faces),'edges':edge_count(ents),'images':count('SUEntities',ents,'Images'),'children':children,'material_face_sides':dict(material_counts)}
        root=node(refget('SUModelGetEntities',model));print('root read',len(root['children']),flush=True)
        for i,d in enumerate(all_defs+groups):
         key=lookup[d.ptr];n=node(refget('SUComponentDefinitionGetEntities',d));n.update({'name':text('SUComponentDefinition',d),'kind':'component' if key.startswith('C') else 'group','bounds':drawing('SUComponentDefinition',d) if hasattr(api,'SUComponentDefinitionToDrawingElement') else None});nodes[key]=n
         if i%150==0:print('definitions',i,flush=True)
        # Dynamic programming separates stored geometry from paths expanded through instances.
        cache={}
        def expand(key,anc=()):
         if key in cache:return cache[key]
         if key in anc:raise RuntimeError('Cyclic definition graph')
         n=root if key=='ROOT' else nodes[key];f=n['faces'];e=n['edges'];depth=0
         for ch in n['children']:
          cf,ce,cd=expand(ch['definition'],anc+(key,));f+=cf;e+=ce;depth=max(depth,cd+1)
         cache[key]=(f,e,depth);return cache[key]
        expanded=expand('ROOT');occ=collections.Counter();direct=collections.Counter();zlevels=collections.defaultdict(list)
        for n in [root]+list(nodes.values()):
         for ch in n['children']:direct[ch['definition']]+=1
        # propagate path multiplicities once per graph node
        reachable=set()
        def visit(k):
         if k in reachable:return
         reachable.add(k)
         for ch in nodes[k]['children']:visit(ch['definition'])
        for ch in root['children']:visit(ch['definition'])
        order=[];seen=set()
        def order_visit(k):
         if k in seen:return
         seen.add(k)
         for ch in nodes[k]['children']:order_visit(ch['definition'])
         order.append(k)
        for ch in root['children']:order_visit(ch['definition']);occ[ch['definition']]+=1
        for k in reversed(order):
         for ch in nodes[k]['children']:occ[ch['definition']]+=occ[k]
        for k,n in nodes.items():
         n['expanded_faces'],n['expanded_edges'],n['nest_depth']=expand(k);n['direct_instances_all_definitions']=direct[k];n['root_expanded_occurrences']=occ[k];n['reachable']=k in reachable
        mats=[]
        for m in material_refs:
         item={'name':text('SUMaterial',m)};tex=Ref();code=fn('SUMaterialGetTexture',[Ref,c.POINTER(Ref)])(m,c.byref(tex))
         if not code and tex.ptr:
          width=c.c_size_t();height=c.c_size_t();ss=c.c_double();tt=c.c_double();check(fn('SUTextureGetDimensions',[Ref,c.POINTER(c.c_size_t),c.POINTER(c.c_size_t),c.POINTER(c.c_double),c.POINTER(c.c_double)])(tex,c.byref(width),c.byref(height),c.byref(ss),c.byref(tt)),'texture')
          item.update({'texture':text('SUTexture',tex,'GetFileName'),'width':width.value,'height':height.value,'rgba_estimate_bytes':width.value*height.value*4})
         mats.append(item)
        layers=[]
        for l in refs('SUModel',model,'Layers'):
         v=c.c_bool();check(fn('SULayerGetVisibility',[Ref,c.POINTER(c.c_bool)])(l,c.byref(v)),'SULayerGetVisibility');layers.append({'name':text('SULayer',l),'visible':v.value})
        scenes=[{'name':text('SUScene',s)} for s in refs('SUModel',model,'Scenes')]
        sha_after=file_hash(source)
        if sha_before!=sha_after:raise RuntimeError('Source changed during read')
        result={'source_unchanged':True,'source_sha256_before':sha_before,'source':source,'source_bytes':Path(source).stat().st_size,'source_sha256':sha_after,'sdk_directory':str(sdk),'getter_statuses':dict(getter_statuses),'counts':{'component_definitions':len(all_defs),'group_definitions':len(groups),'materials':len(mats),'layers':len(layers),'scenes':len(scenes),'stored_faces_all':root['faces']+sum(n['faces'] for n in nodes.values()),'stored_edges_all':root['edges']+sum(n['edges'] for n in nodes.values()),'reachable_stored_faces':root['faces']+sum(nodes[k]['faces'] for k in reachable),'root_expanded_faces':expanded[0],'root_expanded_edges':expanded[1],'root_max_depth':expanded[2],'unreachable_definitions':len(nodes)-len(reachable)},'root':root,'definitions':nodes,'materials':mats,'layers':layers,'scenes':scenes,'caveat':'Expanded counts include hidden/tag-hidden geometry, not renderer draw calls. Texture RGBA estimate excludes mipmaps/compression. Reachability is from model root, not scene visibility.'}
        (output/'model-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result['counts'],indent=2),flush=True)
    finally:
        try:
            if initialized and model.ptr: fn('SUModelRelease',[c.POINTER(Ref)])(c.byref(model))
        finally:
            try:
                if initialized: fn('SUTerminate',[],None)()
            finally:
                if handle is not None: handle.close()


if __name__=='__main__': main()

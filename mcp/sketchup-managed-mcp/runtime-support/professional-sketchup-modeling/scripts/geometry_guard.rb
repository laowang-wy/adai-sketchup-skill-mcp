require 'digest'
# Shared SU readback kernel. Raises into the managed transaction; never rescues a missing face.
module ADAIGeometryGuard
 extend self
 VERSION='0.1.1'
 def fail!(code,id,detail={});raise JSON.generate({'code'=>code,'semantic_id'=>id}.merge(detail));end
 def cross(a,b);[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];end
 def sub(a,b);a.zip(b).map{|x,y|x-y};end
 def dot(a,b);a.zip(b).inject(0.0){|s,xy|s+xy[0]*xy[1]};end
 def topology(vertices,triangles,id,closed=true)
  fail!('VERTICES_INVALID',id) unless vertices.is_a?(Array) && vertices.length>=3 && vertices.all?{|p|p.is_a?(Array) && p.length==3 && p.all?{|x|x.is_a?(Numeric) && x.finite?}}
  fail!('EMPTY_MESH',id) unless triangles.is_a?(Array) && !triangles.empty?
  incidence=Hash.new{|h,k|h[k]=[]};seen={};neighbors=Array.new(triangles.length){[]}
  triangles.each_with_index do |f,i|
   fail!('FACE_INDEX',id,{'face'=>i}) unless f.is_a?(Array) && f.length==3 && f.uniq.length==3 && f.all?{|j|j.is_a?(Integer)&&j>=0&&j<vertices.length}
   a,b,c=f.map{|j|vertices[j]};n=cross(sub(b,a),sub(c,a));fail!('ZERO_AREA',id,{'face'=>i}) if dot(n,n)<1e-14
   key=f.sort;fail!('DUPLICATE_FACE',id,{'face'=>i}) if seen[key];seen[key]=true
   3.times{|j|a=f[j];b=f[(j+1)%3];incidence[[a,b].sort]<<[i,a<b ? 1 : -1]}
  end
  boundary=[]
  incidence.each do |edge,list|
   fail!('NONMANIFOLD_EDGE',id,{'edge'=>edge}) if list.length>2
   if list.length==1;boundary<<edge
   else
    a,b=list;fail!('LOCAL_ORIENTATION',id,{'faces'=>[a[0],b[0]],'edge'=>edge}) if a[1]==b[1]
    neighbors[a[0]]<<b[0];neighbors[b[0]]<<a[0]
   end
  end
  fail!('OPEN_CLOSED_COMPONENT',id,{'boundary_count'=>boundary.length,'edges'=>boundary.take(12)}) if closed && !boundary.empty?
  components=[];visited={}
  triangles.length.times do |seed|
   next if visited[seed];queue=[seed];visited[seed]=true;ids=[]
   until queue.empty?
    i=queue.pop;ids<<i;neighbors[i].each{|j|unless visited[j];visited[j]=true;queue<<j;end}
   end
   origin=vertices[triangles[seed][0]];volume=ids.inject(0.0){|s,i|a,b,c=triangles[i].map{|j|sub(vertices[j],origin)};s+dot(a,cross(b,c))/6}
   component_closed=incidence.values.none?{|edges|edges.length==1 && ids.include?(edges[0][0])}
   fail!('INWARD_COMPONENT',id,{'component'=>components.length,'signed_volume_mm3'=>volume}) if component_closed && volume<=1e-7
   pts=ids.flat_map{|i|triangles[i].map{|j|vertices[j]}};lo=3.times.map{|k|pts.map{|p|p[k]}.min};hi=3.times.map{|k|pts.map{|p|p[k]}.max}
   components<<{'face_count'=>ids.length,'signed_volume_mm3'=>volume,'bounds_mm'=>[lo,hi],'closed'=>component_closed}
  end
  components.each_with_index{|a,i|components[(i+1)..-1].each{|b|if 3.times.all?{|k|[a['bounds_mm'][1][k],b['bounds_mm'][1][k]].min >= [a['bounds_mm'][0][k],b['bounds_mm'][0][k]].max};fail!('OVERLAPPING_COMPONENT_BOUNDS_UNSUPPORTED',id);end}} if closed
  {'faces'=>triangles.length,'boundary_edges'=>boundary.length,'orientation_conflicts'=>0,'components'=>components,'kernel_version'=>VERSION,'closed'=>closed,'self_intersections'=>'unverified_by_live_topology'}
 end
 def read_mesh(entities,scale=1.0)
  vertices=[];triangles=[];lookup={}
  entities.grep(Sketchup::Face).each do |face|
   mesh=face.mesh
   mesh.polygons.each do |polygon|
    raise 'LIVE_NONTRIANGULATED_FACE_MESH' unless polygon.length==3
    points=polygon.map{|i|mesh.point_at(i.abs).to_a.map{|x|x.to_mm/scale}}
    normal=cross(sub(points[1],points[0]),sub(points[2],points[0]));points.reverse! if dot(normal,face.normal.to_a)<0
    triangles<<points.map{|p|key=p.map{|x|x.round(7)};unless lookup.key?(key);lookup[key]=vertices.length;vertices<<p;end;lookup[key]}
   end
  end
  [vertices,triangles]
 end
 def audit(entities,id,closed=true,expected_triangles=nil,scale=1.0)
  v,f=read_mesh(entities,scale);fail!('LIVE_TRIANGLE_COUNT',id,{'expected'=>expected_triangles,'actual'=>f.length}) if expected_triangles && expected_triangles!=f.length
  report=topology(v,f,id,closed);report['source']='SketchUp Face.mesh / vertices readback';report['actual_face_count']=entities.grep(Sketchup::Face).length;report['triangle_count']=f.length;report['normal_samples']=f.take(12).map{|tri|a,b,c=tri.map{|i|v[i]};n=cross(sub(b,a),sub(c,a));length=Math.sqrt(dot(n,n));n.map{|x|x/length}};report['mesh_sha256']=Digest::SHA256.hexdigest(JSON.generate([v,f]));report
 end
 def add_mesh(entities,vertices,faces,id='mesh',closed=true)
  start=Process.clock_gettime(Process::CLOCK_MONOTONIC)
  # Public callers supply validated triangles; polygons must use the offline ear-clipping compiler.
  fail!('TRIANGULATED_INPUT_REQUIRED',id) unless faces.is_a?(Array) && faces.all?{|f|f.is_a?(Array) && f.length==3}
  topology(vertices,faces,id,closed)
  fail!('NONEMPTY_GEOMETRY_CONTAINER',id) unless entities.grep(Sketchup::Face).empty?
  mesh=Geom::PolygonMesh.new(vertices.length,faces.length)
  ids=vertices.map{|p|mesh.add_point(Geom::Point3d.new(*p.map{|x|x.mm}))}
  fail!('SU_VERTEX_MERGE',id,{'input'=>vertices.length,'actual'=>ids.uniq.length}) if ids.uniq.length!=vertices.length
  faces.each_with_index{|f,i|result=mesh.add_polygon(f.map{|j|ids[j]});fail!('MESH_POLYGON_REJECTED',id,{'face'=>i}) unless result && result>0}
  entities.add_faces_from_mesh(mesh,0)
  entities.grep(Sketchup::Edge).each{|edge|if edge.faces.length==2 && edge.faces[0].normal.angle_between(edge.faces[1].normal)<1e-7;edge.hidden=true;end}
  write_done=Process.clock_gettime(Process::CLOCK_MONOTONIC)
  report=audit(entities,id,closed,faces.length);report['write_seconds']=write_done-start;report['readback_seconds']=Process.clock_gettime(Process::CLOCK_MONOTONIC)-write_done;report['write_readback_seconds']=Process.clock_gettime(Process::CLOCK_MONOTONIC)-start
  report
 end
 def add_source_mesh(entities,vertices,triangles,id,scale=1000.0)
  return {'state'=>'empty_source_container'} if triangles.empty?
  input=topology(vertices,triangles,id,false)
  mesh=Geom::PolygonMesh.new(vertices.length,triangles.length)
  indices=vertices.map{|p|mesh.add_point(Geom::Point3d.new(*p.map{|v|(v*scale).mm}))}
  triangles.each_with_index{|f,i|result=mesh.add_polygon(f.map{|j|indices[j]});fail!('SOURCE_POLYGON_REJECTED',id,{'face'=>i}) unless result && result>0}
  entities.add_faces_from_mesh(mesh,0)
  result=audit(entities,id,false,triangles.length,scale)
  fail!('SOURCE_BOUNDARY_CHANGED',id) unless result['boundary_edges']==input['boundary_edges'] && result['components'].length==input['components'].length
  result['source_boundary_contract']='preserved extracted source; open components explicitly remain diagnostic only'
  result
 end
 def tag(group,id,report)
  group.set_attribute('ADAI_GEOMETRY','semantic_id',id);group.set_attribute('ADAI_GEOMETRY','report',JSON.generate(report));group.set_attribute('ADAI_GEOMETRY','kernel_version',VERSION)
 end
 def mapping(entities,expected_ids)
  found=Hash.new{|h,k|h[k]=[]};walk=nil
  walk=lambda{|ents,tr|ents.each{|e|if e.is_a?(Sketchup::Group)||e.is_a?(Sketchup::ComponentInstance)
   id=e.get_attribute('ADAI_GEOMETRY','semantic_id');world=tr*e.transformation
   if id
    source=e.is_a?(Sketchup::Group) ? e.entities : e.definition.entities
    vertices,_=read_mesh(source);points=vertices.map{|v|Geom::Point3d.new(*v.map{|x|x.mm}).transform(world).to_a.map{|x|x.to_mm}}
    bounds=points.empty? ? nil : [3.times.map{|k|points.map{|p|p[k]}.min},3.times.map{|k|points.map{|p|p[k]}.max}]
    stored=JSON.parse(e.get_attribute('ADAI_GEOMETRY','report','{}'));fresh=audit(source,id,true);found[id]<<{'persistent_id'=>e.persistent_id,'bounds_mm'=>bounds,'report'=>stored.merge(fresh)}
   end
   walk.call(e.is_a?(Sketchup::Group) ? e.entities : e.definition.entities,world)
  end}}
  walk.call(entities,Geom::Transformation.new)
  expected_ids.each{|id|fail!('SEMANTIC_ID_MATCH_COUNT',id,{'matches'=>found[id].length}) unless found[id].length==1}
  expected_ids.each_with_object({}){|id,h|h[id]=found[id][0]}
 end
end

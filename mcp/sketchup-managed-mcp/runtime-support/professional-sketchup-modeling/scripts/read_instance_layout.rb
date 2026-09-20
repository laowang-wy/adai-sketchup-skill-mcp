require 'json'

# Read-only occurrence traversal. No open/save/selection/camera/attribute/model writes.
module PipClawInstanceReadback
  extend self
  def container?(e)
    e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
  end
  def identity(e)
    e.persistent_id.to_s
  end
  def matrix(t)
    a=t.to_a
    # SketchUp column-major inches -> row-major matrix with metre translations.
    (0..3).map { |r| (0..3).map { |c| (c==3 && r<3) ? a[c*4+r].to_f*0.0254 : a[c*4+r].to_f } }
  end
  def run(options)
    model=Sketchup.active_model
    expected=options.fetch('expected_path')
    raise 'Expected saved document path required' if expected.to_s.empty? || model.path.to_s.empty?
    same=begin File.identical?(expected,model.path); rescue; File.expand_path(expected).casecmp(File.expand_path(model.path)).zero?; end
    raise 'Active document does not match expected_path; no document was opened' unless same
    limit=options.fetch('max_instances',1000)
    depth_limit=options.fetch('max_depth',12)
    raise 'Invalid traversal limits' unless limit.is_a?(Integer) && limit.between?(1,5000) && depth_limit.is_a?(Integer) && depth_limit.between?(1,32)
    before={'path'=>model.path.to_s,'guid'=>model.guid.to_s,'modified'=>model.modified?}
    scope=options.fetch('scope_path',[])
    raise 'scope_path must be an array of persistent ID strings' unless scope.is_a?(Array) && scope.length<=32 && scope.all? { |x| x.is_a?(String) && x.match(/\A[0-9]+\z/) }
    entities=model.entities;chain=[];world=Geom::Transformation.new;anc=[];prefix=[]
    scope.each do |pid|
      e=entities.find { |x| container?(x) && identity(x)==pid }
      raise 'scope_path not found in active occurrence hierarchy' unless e
      chain << matrix(e.transformation);world=world*e.transformation
      prefix << identity(e);anc << e.definition.object_id;entities=e.definition.entities
    end
    rows=[];truncated=false;reasons=[];stack=[]
    entities.each do |e|
      next unless container?(e)
      if stack.length>=limit+1;truncated=true;reasons << 'pending_limit';break;end
      stack << [e,prefix,world,chain,anc,1]
    end
    until stack.empty?
      if rows.length>=limit;truncated=true;reasons << 'max_instances';break;end
      e,parent,t,parents,ancestors,depth=stack.pop
      local=e.transformation;wt=t*local;ids=parent+[identity(e)];wm=matrix(wt);axes=(0..2).map { |j| (0..2).map { |i| wm[i][j] } }
      a,b,c=axes;det=a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1])
      rows << {'entity_path'=>ids.join('/'),'definition_id'=>e.definition.guid.to_s,'definition_name'=>e.definition.name.to_s,'instance_name'=>e.name.to_s,
        'kind'=>e.is_a?(Sketchup::Group) ? 'group' : 'component','origin'=>wm[0..2].map { |r| r[3] },'world_matrix'=>wm,'parent_to_local_chain'=>parents+[matrix(local)],
        'axis_lengths'=>axes.map { |v| Math.sqrt(v.inject(0.0) { |sum,x| sum+x*x }) },'determinant'=>det,'hidden'=>e.hidden?, 'tag'=>e.layer.name.to_s,'tag_visible'=>e.layer.visible?}
      children=[]
      e.definition.entities.each do |x|
        next unless container?(x)
        if children.length>=limit+1;truncated=true;reasons << 'pending_limit';break;end
        children << x
      end
      unless children.empty?
        if depth>=depth_limit || ancestors.include?(e.definition.object_id)
          truncated=true;reasons << (depth>=depth_limit ? 'max_depth' : 'definition_cycle');next
        end
        children.each do |child|
          if stack.length>=limit+1;truncated=true;reasons << 'pending_limit';break;end
          stack << [child,ids,wt,parents+[matrix(local)],ancestors+[e.definition.object_id],depth+1]
        end
      end
    end
    after={'path'=>model.path.to_s,'guid'=>model.guid.to_s,'modified'=>model.modified?}
    raise 'Document identity/modified flag changed during readback' unless before==after
    {'schema_version'=>1,'scope'=>'active_document_occurrences','source'=>before,'source_after'=>after,'units'=>'m','coordinate_frame'=>'world:model-origin',
      'scope_path'=>scope,'instances'=>rows,'truncated'=>truncated,'truncation_reasons'=>reasons.uniq,'geometry_readback'=>'instance_transforms_only',
      'visibility_scope'=>'all_containers_including_hidden; inherited/scene visibility not resolved','surface_contact'=>'unverified'}
  end
end

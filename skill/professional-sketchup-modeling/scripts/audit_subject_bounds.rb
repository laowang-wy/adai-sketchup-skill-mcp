require 'json'
require 'fileutils'
module PipClawSubjectBoundsAudit
  extend self
  def mm(v); v.respond_to?(:to_mm) ? v.to_mm.to_f : v.to_f * 25.4; end
  def row(e)
    b=e.bounds
    return nil unless b.valid?
    {'name'=>(e.respond_to?(:name) ? e.name.to_s : ''),'type'=>e.class.name,'persistent_id'=>(e.respond_to?(:persistent_id) ? e.persistent_id : nil),'min'=>[mm(b.min.x),mm(b.min.y),mm(b.min.z)].map{|x|x.round(1)},'max'=>[mm(b.max.x),mm(b.max.y),mm(b.max.z)].map{|x|x.round(1)},'size'=>[mm(b.width),mm(b.height),mm(b.depth)].map{|x|x.round(1)},'entities'=>(e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities.length : e.entities.length)}
  end
  def run(output_path, min_height=300.0, max_span=100_000.0)
    model=Sketchup.active_model; rows=model.entities.to_a.select{|e|e.is_a?(Sketchup::Group)||e.is_a?(Sketchup::ComponentInstance)}.map{|e|row(e)}.compact
    subject=rows.select{|r|r['size'][2] >= min_height && r['size'].max <= max_span && r['size'][1] > 0.0}
    component_defs=model.definitions.reject{|d|d.image?}; reused=component_defs.count{|d|d.instances.length > 1}; high=component_defs.count{|d|d.instances.length >= 5}
    result={'ok'=>true,'model_path'=>model.path,'title'=>model.title,'top_level'=>rows,'subject_candidates'=>subject.sort_by{|r|[-r['entities'].to_i,-r['size'][2]]},'reuse'=>{'definitions'=>component_defs.length,'reused_definitions'=>reused,'high_reuse_definitions'=>high,'instances'=>model.entities.grep(Sketchup::ComponentInstance).length},'rules'=>['Do not use zero-depth or anomalously huge objects for subject framing.','Inspect subject candidates before visual comparison.','Repeated detail promotion requires component definitions and contact validation.']}
    FileUtils.mkdir_p(File.dirname(output_path)); File.open(output_path,'wb'){|f|f.write(JSON.pretty_generate(result))}; result.merge('output_path'=>output_path)
  rescue => e
    {'ok'=>false,'error'=>"#{e.class}: #{e.message}"}
  end
end

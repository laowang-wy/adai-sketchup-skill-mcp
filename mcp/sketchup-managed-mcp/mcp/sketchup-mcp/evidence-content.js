'use strict';
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

// Display an already sealed image. Never recapture, write geometry, or turn a
// delivery/display failure into a failed modeling operation.
async function evidenceContent(value, method) {
  let displayed, image;
  if (['step', 'retryEvidence'].includes(method) && value?.ok !== false && (value?.evidence_id || value?.inspection_only === true) && value?.files) {
    let key = value.files.review_sheet ? 'review_sheet' : 'reference';
    let focus, displayWarning;
    // A requested close-up is an inspection action, not an extra file the agent
    // should have to rediscover after receiving the same full-frame image again.
    const reportFile = value.files.review_report;
    if (value.files.comparison_0 && reportFile?.path && reportFile.sha256) {
      try {
        if ((await fs.stat(reportFile.path)).size > 1024 * 1024) throw Error('Comparison report exceeds display budget.');
        const bytes = await fs.readFile(reportFile.path);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== reportFile.sha256) throw Error('Comparison report hash differs.');
        const report = JSON.parse(bytes.toString('utf8'));
        const region = report.regions?.[0];
        if (region) {
          const entry = Object.entries(value.files).find(([name,file]) => name.startsWith('comparison_') && file.path === region.image?.path && file.sha256 === region.image?.sha256);
          if (!entry) throw Error('Requested crop is absent from the sealed image files.');
          key = entry[0];
          focus = {name:region.name, source_index:region.source_index ?? 0, region_count:report.regions.length, full_frame_view:'review_sheet'};
        }
      } catch (error) { displayWarning = error.message + ' Showing the full-frame evidence instead.'; }
    }
    const file = value.files[key];
    if (file?.path && file.sha256) {
      try {
        const stat = await fs.stat(file.path);
        if (stat.size > 8 * 1024 * 1024) throw Error('Image exceeds inline display size; open the sealed file.');
        const bytes = await fs.readFile(file.path);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('Sealed image hash differs; inspect evidence integrity.');
        const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null;
        if (!mimeType) throw Error('Unsupported inline image format; open the sealed file.');
        const comparisonHelp = value.files.review_sheet && !value.files.geometry_whole_comparison
          ? ' 对照前先核对双方的可见面与遮挡次序。角度不对应时，用 sketchup_project_retry_evidence(project_id,comparison={view:{azimuth_deg,elevation_deg}}) 补图；方位0从+X、-90从-Y看，仰角为正表示俯看。只换图，不重建几何。' : '';
        displayed = {view:key, path:file.path, evidence_id:value.evidence_id, state:'attached', ...(focus ? {focus} : {}), ...(displayWarning ? {warning:displayWarning} : {}), note:(focus ? '当前附图是请求的局部对照；完整原图、整栋对照及其它局部仍在 files 中。' : '当前图已附在回复中，其余视图可按返回路径打开。')+'比较图上实际边缘、端点与空隙，再报告观察。'+comparisonHelp};
        image = {type:'image', mimeType, data:bytes.toString('base64')};
      } catch (error) {
        displayed = {view:key, path:file.path, state:'not_attached', reason:error.message};
      }
    }
  }
  return {content:[{type:'text',text:JSON.stringify(displayed ? {...value, displayed_evidence:displayed} : value,null,2)}, ...(image ? [image] : [])]};
}
module.exports = {evidenceContent};

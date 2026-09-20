"""Advisory Ruby text lint. Not Ruby semantic analysis and never geometry acceptance."""
import argparse,json,re
from pathlib import Path

def lint(text):
 findings=[]
 for pattern,code in [(r'rescue\s+(?:StandardError|Exception)[\s\S]{0,100}?return\s+0','SILENT_FACE_FAILURE'),(r'return\s+0\s+unless\s+f\b','SILENT_NIL_FACE'),(r'\.add_face\s*\(','RAW_FACE_CREATION'),(r'normal\.dot\(hint\)','AD_HOC_DIRECTION_HINT')]:
  for m in re.finditer(pattern,text):findings.append({'code':code,'line':text[:m.start()].count('\n')+1})
 if 'ADAIGeometryGuard' not in text:findings.append({'code':'SHARED_KERNEL_NOT_RECORDED','line':None})
 return {'state':'review_required' if findings else 'no_text_findings','findings':findings,'geometry_acceptance':'unverified','scope':'advisory text scan; no semantic proof'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('--report',type=Path);a=p.parse_args();r=lint(a.input.read_text(encoding='utf-8-sig'))
 if a.report:a.report.write_text(json.dumps(r,indent=2),encoding='utf8')
 print(json.dumps(r));raise SystemExit(1 if r['findings'] else 0)

"""Bounded read-only SKP batch audit, one independent child process per model."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True,help='JSON array of absolute source SKP paths')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--sdk-dir',type=Path)
    p.add_argument('--timeout',type=float,default=180)
    a=p.parse_args()
    import math
    if not math.isfinite(a.timeout) or a.timeout<=0:p.error('timeout must be finite and positive')
    sources=json.loads(a.manifest.read_text(encoding='utf-8-sig'))
    if not isinstance(sources,list) or not sources:p.error('Expected nonempty source array')
    if any(not isinstance(s,str) or not Path(s).is_absolute() or not Path(s).is_file() or Path(s).suffix.lower()!='.skp' for s in sources):
        p.error('Each source must be an existing absolute SKP path')
    output=a.output.resolve()
    if output.exists():p.error('Use a new output directory to preserve previous evidence')
    for source in sources:
        parent=Path(source).resolve().parent
        if output==parent or parent in output.parents:p.error('Keep output outside all source directories')
    output.mkdir(parents=True)
    results=[]
    for i,source in enumerate(sources):
        dest=output/f'{i:04d}';dest.mkdir()
        cmd=[sys.executable,str(Path(__file__).with_name('read_skp_structure.py')),source,str(dest)]
        if a.sdk_dir:cmd+=['--sdk-dir',str(a.sdk_dir.resolve())]
        row={'source':source,'output':str(dest),'state':'failed'}
        with (dest/'reader.log').open('w',encoding='utf-8') as log:
            try:
                done=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=a.timeout,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                row['returncode']=done.returncode
                if done.returncode==0 and (dest/'model-audit.json').exists():row['state']='read'
            except subprocess.TimeoutExpired:row['state']='timeout';row['source_unchanged']='unverified'
            except OSError as e:row['error']=str(e)
        results.append(row)
        (output/'batch-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(row,ensure_ascii=False),flush=True)
    return 0 if all(r['state']=='read' for r in results) else 1


if __name__=='__main__':raise SystemExit(main())

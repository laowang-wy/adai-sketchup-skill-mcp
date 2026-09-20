"""AncientRoofKit command line: generate presets and compile deterministic managed builds."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'v4'))
from contract import DEFAULT,validate,read
from compile import prepare
from roof_mesh import TYPES

def main():
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
 make=sub.add_parser('preset',help='Create a complete preset from safe family defaults')
 make.add_argument('--type',choices=TYPES,required=True);make.add_argument('--output',type=Path,required=True)
 for name in ['width','depth','rise','thickness','ridge_length','corner_lift','gable_span_ratio','apron_rise_ratio','tile_width','tile_length','tile_overlap','ridge_width']:make.add_argument('--'+name.replace('_','-'),type=float)
 make.add_argument('--sides',type=int);make.add_argument('--details',choices=['shell','ridge','tile_sample','tiled','detailed'],default='shell')
 check=sub.add_parser('validate');check.add_argument('preset',type=Path)
 build=sub.add_parser('compile');build.add_argument('presets',nargs='+',type=Path);build.add_argument('--output',type=Path,required=True)
 info=sub.add_parser('capabilities')
 args=p.parse_args()
 try:
  if args.command=='capabilities':result=read(ROOT/'v4/capabilities.json')
  elif args.command=='preset':
   if args.output.exists():raise ValueError('OUTPUT_EXISTS')
   d=read(ROOT/'v4/presets'/(args.type+'.json'))
   for k in DEFAULT:
    v=getattr(args,k,None)
    if v is not None:d[k]=v
   validate(d);args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf8');result={'preset':str(args.output.resolve()),'parameters':d}
  elif args.command=='validate':result={'parameters':validate(read(args.preset)),'scope':'generic parameter contract; visual review still required'}
  else:result=prepare(args.presets,args.output)
  print(json.dumps({'ok':True,**result},ensure_ascii=False));return 0
 except (OSError,ValueError,TypeError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())

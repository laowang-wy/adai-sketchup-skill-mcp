"""Current standalone managed compiler, delegates to versioned v4 implementation."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'v4'))
from compile import prepare
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('preset');p.add_argument('--output',required=True);p.add_argument('--purpose',choices=['diagnostic','production'],default='diagnostic');a=p.parse_args()
 try:
  if a.purpose!='diagnostic':raise ValueError('PRODUCTION_FIDELITY_NOT_CERTIFIED')
  result=prepare([a.preset],a.output);print(json.dumps({'ok':True,**result}))
 except (OSError,ValueError,TypeError) as e:print(json.dumps({'ok':False,'error':str(e)}));raise SystemExit(2)

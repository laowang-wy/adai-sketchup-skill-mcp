"""Current v4 validation entry; schema-only cannot certify geometry or style."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'v4'))
from contract import read,validate
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('preset');p.add_argument('--schema-only',action='store_true');a=p.parse_args()
 try:
  value=validate(read(a.preset));print(json.dumps({'ok':True,'schema_version':4,'roof_type':value['roof_type'],'scope':'parameter_contract','historical_fidelity_verified':False}))
 except (OSError,ValueError,TypeError) as e:print(json.dumps({'ok':False,'error':str(e)}));raise SystemExit(2)

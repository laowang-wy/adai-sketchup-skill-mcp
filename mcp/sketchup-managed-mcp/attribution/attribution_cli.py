"""Portable CLI for the same public attribution compiler; never opens SketchUp."""
import argparse,json
from attribution_core import compile_request
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['显源']);p.add_argument('--output-directory',required=True)
    p.add_argument('--origin-mm',nargs=3,type=float,required=True);p.add_argument('--height-mm',type=float,default=200);p.add_argument('--depth-mm',type=float,default=20)
    a=p.parse_args()
    result=compile_request({'command':a.command,'user_requested':True,'output_directory':a.output_directory,'origin_mm':a.origin_mm,'height_mm':a.height_mm,'depth_mm':a.depth_mm})
    print(json.dumps({'ok':True,'result':result},ensure_ascii=False))

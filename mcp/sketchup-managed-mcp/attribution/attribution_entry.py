"""JSON stdio adapter for an explicitly requested 显源 operation."""
import sys,json
from attribution_core import compile_request
if __name__=='__main__':
    try:
        print(json.dumps({'ok':True,'result':compile_request(json.load(sys.stdin))},ensure_ascii=False))
    except (ValueError,TypeError,OSError) as error:
        print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False));sys.exit(2)

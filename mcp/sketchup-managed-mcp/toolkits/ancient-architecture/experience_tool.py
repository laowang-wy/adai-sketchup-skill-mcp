"""Read and verify source-backed ancient modeling experience cards."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def local(relative):
 p=(ROOT/relative).resolve()
 if not p.is_relative_to(ROOT):raise ValueError('PATH_OUTSIDE_PACKAGE')
 return p

def main():
 parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
 sub.add_parser('list');p=sub.add_parser('show');p.add_argument('id');sub.add_parser('check');a=parser.parse_args()
 try:
  index=read(ROOT/'experience/index.json')
  if a.command=='list':result=index
  elif a.command=='show':
   record=next((r for r in index['cards'] if r['id']==a.id),None)
   if not record:raise ValueError('UNKNOWN_CARD')
   result=read(local(record['path']))
  else:
   from source_templates.compiler import validate
   ids=set();refs=0;recipes=0
   for record in index['cards']:
    if record['id'] in ids:raise ValueError('DUPLICATE_CARD')
    ids.add(record['id']);card=read(local(record['path']))
    if card['id']!=record['id']:raise ValueError('CARD_ID_MISMATCH')
    for field in ['rules','checks','reject_when','evidence']:
     if not card[field]:raise ValueError('EMPTY_'+field)
    for reference in card['evidence']+[card['entrypoint']]:
     if not local(reference).is_file():raise ValueError('MISSING_REFERENCE '+reference)
     refs+=1
   for recipe in (ROOT/'experience/recipes').glob('*.json'):
    data=read(recipe)
    if data.get('schema')=='ark-template-1':validate(data)
    elif data.get('schema_version')==4:
     sys.path.insert(0,str(ROOT/'v4'))
     from contract import validate as roof_validate
     roof_validate(data)
    else:raise ValueError('UNKNOWN_RECIPE_SCHEMA '+recipe.name)
    recipes+=1
   result={'cards':len(ids),'references_checked':refs,'recipes_validated':recipes,'scope':'integrity and input validation; not live geometry acceptance'}
  print(json.dumps({'ok':True,'result':result},ensure_ascii=False));return 0
 except (OSError,KeyError,ValueError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())

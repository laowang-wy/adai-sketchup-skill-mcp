"""Read and verify source-backed ancient modeling experience cards."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def local(relative,root=ROOT):
 if not isinstance(relative,str) or not relative.strip():raise ValueError('INVALID_REFERENCE')
 root=Path(root).resolve();p=(root/relative).resolve()
 if not p.is_relative_to(root):raise ValueError('PATH_OUTSIDE_PACKAGE')
 return p

def check(root=ROOT):
 from source_templates.compiler import validate
 root=Path(root).resolve();index=read(root/'experience/index.json')
 ids=set();refs=0;recipes=0
 for record in index['cards']:
  card_id=record['id']
  if card_id in ids:raise ValueError('DUPLICATE_CARD '+card_id)
  ids.add(card_id);card=read(local(record['path'],root))
  if card['id']!=card_id:raise ValueError('CARD_ID_MISMATCH '+card_id)
  # Rejection guidance is optional; a constructive method need not invent it.
  # When present, it must still be valid content rather than a broken field.
  for field in ['rules','checks','evidence','reject_when']:
   if field=='reject_when' and field not in card:continue
   values=card.get(field)
   if not isinstance(values,list) or any(not isinstance(v,str) or not v.strip() for v in values):raise ValueError('INVALID_CARD_FIELD '+card_id+' '+field)
   if field!='reject_when' and not values:raise ValueError('EMPTY_CARD_FIELD '+card_id+' '+field)
  for reference in card['evidence']+[card.get('entrypoint')]:
   if not local(reference,root).is_file():raise ValueError('MISSING_REFERENCE '+card_id+' '+reference)
   refs+=1
 for recipe in (root/'experience/recipes').glob('*.json'):
  data=read(recipe)
  if data.get('schema')=='ark-template-1':validate(data)
  elif data.get('schema_version')==4:
   sys.path.insert(0,str(ROOT/'v4'))
   from contract import validate as roof_validate
   roof_validate(data)
  else:raise ValueError('UNKNOWN_RECIPE_SCHEMA '+recipe.name)
  recipes+=1
 return {'cards':len(ids),'references_checked':refs,'recipes_validated':recipes,'scope':'integrity and input validation; not live geometry acceptance'}

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
  else:result=check()
  print(json.dumps({'ok':True,'result':result},ensure_ascii=False));return 0
 except (OSError,KeyError,ValueError) as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())

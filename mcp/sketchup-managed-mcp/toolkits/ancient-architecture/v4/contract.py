"""Strict user contract for six explicit roof kernels."""
import json,math
from pathlib import Path
from roof_mesh import TYPES
DEFAULT={'schema_version':4,'roof_type':'wu_dian','width':12000.,'depth':9000.,'rise':3200.,'thickness':150.,'ridge_length':4500.,'corner_lift':450.,'gable_span_ratio':.48,'apron_rise_ratio':.30,'sides':4,'slope_segments':24,'span_segments':16,'details':'shell','tile_width':220.,'tile_length':360.,'tile_overlap':70.,'ridge_width':180.}
def read(path):
 def pairs(items):
  result={}
  for k,v in items:
   if k in result:raise ValueError('DUPLICATE_KEY '+k)
   result[k]=v
  return result
 return json.loads(Path(path).read_text(encoding='utf-8-sig'),object_pairs_hook=pairs,parse_constant=lambda s: (_ for _ in ()).throw(ValueError('INVALID_NUMBER '+s)))
def validate(p):
 if type(p)!=dict or set(p)!=set(DEFAULT):raise ValueError('FIELD_MISMATCH expected '+','.join(DEFAULT))
 if type(p['schema_version'])!=int or p['schema_version']!=4:raise ValueError('SCHEMA_VERSION')
 if p['roof_type'] not in TYPES:raise ValueError('UNKNOWN_ROOF_TYPE')
 if p['details'] not in ('shell','ridge','tile_sample','tiled','detailed'):raise ValueError('DETAIL_NOT_IMPLEMENTED: shell, ridge, tile_sample, tiled, detailed only')
 if p['details']=='detailed' and p['roof_type'] not in ('si_shan','helmet'):raise ValueError('DETAIL_FAMILY_NOT_IMPLEMENTED')
 ranges={'width':(2000,40000),'depth':(2000,40000),'rise':(500,12000),'thickness':(50,350),'ridge_length':(0,30000),'corner_lift':(0,1800),'gable_span_ratio':(.25,.7),'apron_rise_ratio':(.18,.55),'tile_width':(120,400),'tile_length':(200,600),'tile_overlap':(30,180),'ridge_width':(100,400),'slope_segments':(12,48),'span_segments':(8,32),'sides':(4,8)}
 for k,(lo,hi) in ranges.items():
  x=p[k]
  if type(x) not in (int,float) or not math.isfinite(x) or not lo<=x<=hi:raise ValueError('INVALID_NUMBER '+k)
 for k in ('slope_segments','span_segments','sides'):
  if type(p[k])!=int:raise ValueError('INTEGER_REQUIRED '+k)
 if p['slope_segments']%2 or p['span_segments']%2:raise ValueError('EVEN_SEGMENTS_REQUIRED')
 if p['sides'] not in (4,6,8):raise ValueError('SIDES_REQUIRED_4_6_8')
 if p['roof_type']!='zan_jian' and p['sides']!=4:raise ValueError('SIDES_APPLY_ONLY_ZAN_JIAN')
 if not p['thickness']*2<p['rise']<min(p['width'],p['depth'])*1.2:raise ValueError('HEIGHT_CHAIN')
 if p['corner_lift']>=p['rise']*.35:raise ValueError('EXCESSIVE_CORNER_LIFT')
 if p['roof_type']=='si_shan' and p['corner_lift']>=p['rise']*p['apron_rise_ratio']*.65:raise ValueError('APRON_LIFT_CONFLICT')
 if p['roof_type'] in ('si_shan','wu_dian','xie_ding'):
  if not p['width']*.15<=p['ridge_length']<=p['width']*.75:raise ValueError('RIDGE_LENGTH_RANGE')
 elif p['ridge_length']!=0:raise ValueError('RIDGE_LENGTH_MUST_BE_ZERO_FOR_THIS_TYPE')
 if p['roof_type']!='si_shan' and (p['gable_span_ratio']!=DEFAULT['gable_span_ratio'] or p['apron_rise_ratio']!=DEFAULT['apron_rise_ratio']):raise ValueError('GABLE_FIELDS_APPLY_ONLY_SI_SHAN')
 if p['roof_type']=='juan_peng' and p['corner_lift']!=0:raise ValueError('BARREL_CORNER_NOT_IMPLEMENTED')
 if p['tile_overlap']>=p['tile_length']*.45:raise ValueError('TILE_OVERLAP_RANGE')
 return p


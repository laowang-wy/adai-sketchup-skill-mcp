#!/usr/bin/env python3
"""Full-frame reference comparisons; explicit crops never replace the originals.

Coordinates refer to EXIF-corrected display pixels. Comparison images are aids
for human/model inspection, never an architectural similarity certificate.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageOps

MAX_BYTES = 100_000_000
MAX_PIXELS = 32_000_000


def read_image(file: Path, expected: str | None = None):
    if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_BYTES:
        raise ValueError('IMAGE_FILE_INVALID_OR_TOO_LARGE')
    data = file.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if expected and digest != expected.lower():
        raise ValueError('SOURCE_CHANGED')
    with Image.open(io.BytesIO(data)) as original:
        if original.width * original.height > MAX_PIXELS:
            raise ValueError('IMAGE_PIXEL_LIMIT')
        size = list(original.size)
        orientation = original.getexif().get(274, 1)
        image = ImageOps.exif_transpose(original).convert('RGB')
    return image, {'path': str(file.resolve()), 'sha256': digest, 'original_size': size,
                   'display_size': list(image.size), 'exif_orientation': orientation,
                   'coordinates': 'exif_transposed_display_pixels'}


def crop_box(box, size):
    if not isinstance(box, list) or len(box) != 4 or any(type(v) not in (int, float) or not math.isfinite(v) for v in box):
        raise ValueError('REGION_BOX_INVALID')
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError('REGION_BOX_OUT_OF_BOUNDS')
    pixels = tuple(round(v * size[i % 2]) for i, v in enumerate(box))
    if pixels[0] >= pixels[2] or pixels[1] >= pixels[3]:
        raise ValueError('REGION_BOX_ZERO_PIXELS')
    return pixels


def compose(source, candidate, width=800, height=900):
    scale = min(width/source.width, height/source.height, width/candidate.width, height/candidate.height, 1.0)
    header, gap = 44, 12
    sheet = Image.new('RGB', (width*2+gap, height+header), '#202328')
    draw = ImageDraw.Draw(sheet)
    maps = []
    for i, (image, label) in enumerate(((source, 'SOURCE REFERENCE'), (candidate, 'CURRENT MODEL'))):
        size = (max(1, round(image.width*scale)), max(1, round(image.height*scale)))
        offset = (i*(width+gap)+(width-size[0])//2, header+(height-size[1])//2)
        sheet.paste(image.resize(size, Image.Resampling.LANCZOS), offset)
        draw.text((i*(width+gap)+12, 14), label, fill='white')
        maps.append({'original_size': list(image.size), 'display_size': list(size),
                     'scale_xy': [size[0]/image.width, size[1]/image.height], 'offset_xy': list(offset), 'cropped': False})
    return sheet, maps


def save_image(file, image):
    with file.open('xb') as stream:
        image.save(stream, format='PNG')
    return {'path': str(file.resolve()), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
            'width': image.width, 'height': image.height}


def make_sheet(source_file: Path, candidate_file: Path, output: Path, report_file: Path,
               width=800, height=900, regions=None, aligned=False, expected_source=None):
    if type(width) is not int or type(height) is not int or not (320 <= width <= 2048 and 320 <= height <= 2048):
        raise ValueError('PANEL_DIMENSIONS_INVALID')
    source, sm = read_image(source_file, expected_source)
    candidate, cm = read_image(candidate_file)
    inputs = {source_file.resolve(), candidate_file.resolve()}
    if len(inputs) != 2 or output.resolve() in inputs or report_file.resolve() in inputs or output.resolve() == report_file.resolve():
        raise ValueError('OUTPUT_COLLIDES_WITH_INPUT')
    if type(aligned) is not bool or aligned and source.size != candidate.size:
        raise ValueError('ALIGNED_COMPARISON_REQUIRES_EQUAL_PIXEL_FRAMES')
    regions = [] if regions is None else regions
    if not isinstance(regions, list) or len(regions) > 16:
        raise ValueError('REGION_LIMIT')
    prepared, names = [], set()
    for region in regions:
        if not isinstance(region, dict) or set(region) != {'name','source_box','candidate_box'}:
            raise ValueError('REGION_FIELDS_INVALID')
        name = region['name']
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,48}', name) or name.lower() in names:
            raise ValueError('REGION_NAME_INVALID')
        names.add(name.lower())
        prepared.append((name, crop_box(region['source_box'], source.size), crop_box(region['candidate_box'], candidate.size)))
    paths = [output, report_file] + [output.with_name(output.stem+'-region-'+name+'.png') for name,_,_ in prepared]
    if aligned:
        paths += [output.with_name(output.stem+'-'+suffix+'.png') for suffix in ('overlay','difference')]
    if any(p.exists() or p.is_symlink() for p in paths):
        raise ValueError('OUTPUT_EXISTS')
    output.parent.mkdir(parents=True, exist_ok=True)
    report_file.parent.mkdir(parents=True, exist_ok=True)
    sheet, maps = compose(source,candidate,width,height)
    result = {'ok':True,'source':sm,'candidate':cm,'full_frame_maps':maps,
              'review_sheet':save_image(output,sheet),'regions':[], 'additional_images':[],
              'registration':'caller_declared_same_pixel_frame' if aligned else 'not_registered',
              'architectural_verdict':'not_evaluated', 'warning':'No automatic crop, camera adjustment, similarity score or architectural approval.'}
    for name, a, b in prepared:
        image, mapping = compose(source.crop(a),candidate.crop(b),width,height)
        item = save_image(output.with_name(output.stem+'-region-'+name+'.png'),image)
        result['regions'].append({'name':name,'source_box_px':a,'candidate_box_px':b,'maps':mapping,'image':item})
        result['additional_images'].append(item)
    if aligned:
        for suffix, image in [('overlay',Image.blend(source,candidate,0.5)),('difference',ImageChops.difference(source,candidate))]:
            result['additional_images'].append(save_image(output.with_name(output.stem+'-'+suffix+'.png'),image))
    with report_file.open('x',encoding='utf-8',newline='\n') as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2,allow_nan=False)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for field in ('source','candidate','output'):
        parser.add_argument('--'+field,type=Path,required=True)
    parser.add_argument('--report',type=Path)
    parser.add_argument('--panel-width',type=int,default=800)
    parser.add_argument('--panel-height',type=int,default=900)
    parser.add_argument('--regions-file',type=Path)
    parser.add_argument('--aligned',action='store_true')
    parser.add_argument('--source-sha256')
    args=parser.parse_args()
    try:
        regions=None
        if args.regions_file:
            if args.regions_file.stat().st_size>100_000:raise ValueError('REGION_FILE_LIMIT')
            regions=json.loads(args.regions_file.read_text(encoding='utf-8-sig'))
        make_sheet(args.source,args.candidate,args.output,args.report or args.output.with_suffix('.json'),args.panel_width,args.panel_height,regions,args.aligned,args.source_sha256)
        print(json.dumps({'ok':True,'output':str(args.output),'report':str(args.report or args.output.with_suffix('.json'))}))
        return 0
    except (ValueError,OSError) as error:
        print(json.dumps({'ok':False,'code':'IMAGE_COMPARISON_FAILED','message':str(error)}))
        return 2


if __name__=='__main__':
    raise SystemExit(main())

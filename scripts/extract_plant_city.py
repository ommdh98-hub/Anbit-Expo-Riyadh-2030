"""Development-only extractor. Source is opened read-only; no operational DB access."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def extract(source):
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        plants = [{'id': r[0], 'name': r[1]} for r in db.execute('SELECT id,name FROM Plant ORDER BY id')]
        cities = [{'id': r[0], 'name': r[1]} for r in db.execute('SELECT id,name FROM Cities ORDER BY id')]
        rows = db.execute('''SELECT s.id,s.plant_id,s.city_id,s.suitability_score,
            p.temp_low,p.temp_high,p.humidity_min,p.humidity_max,c.avg_temp,c.avg_humidity
            FROM PlantCitySuitability s JOIN Plant p ON p.id=s.plant_id
            JOIN Cities c ON c.id=s.city_id ORDER BY s.id''').fetchall()
        if (len(plants),len(cities),len(rows)) != (17,14,238):
            raise ValueError('Unexpected counts or missing joined references')
        if db.execute('SELECT count(*) FROM PlantCitySuitability').fetchone()[0] != len(rows):
            raise ValueError('Unresolved references')
        assessments=[]
        for ident,plant,city,score,lo,hi,hlo,hhi,temp,humidity in rows:
            if not all(isinstance(v,(int,float)) for v in (score,lo,hi,hlo,hhi,temp,humidity)):
                raise ValueError('Missing or nonnumeric source value')
            if not (lo<=hi and 0<=hlo<=hhi<=100 and 0<=humidity<=100):
                raise ValueError('Invalid source range')
            tm,hm=lo<=temp<=hi,hlo<=humidity<=hhi
            if score not in (0,50,100) or score != 50*(tm+hm):
                raise ValueError('Stored score disagrees with criteria')
            assessments.append(dict(id=ident,plant_id=plant,city_id=city,score=int(score),temperature_match=tm,air_humidity_match=hm))
        if len({(r['plant_id'],r['city_id']) for r in assessments}) != 238:
            raise ValueError('Duplicate relationships')
        if not all(r['name'] and r['name'].strip() for r in plants+cities):
            raise ValueError('Missing name')
    return {'metadata':{'source_file':source.name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'status':'unverified_reference','units':'Not independently documented; numerical climate fields omitted','rule':'50 temperature + 50 atmospheric humidity; not probability'},'plants':plants,'cities':cities,'assessments':assessments}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    if args.source.resolve()==args.output.resolve() or args.output.suffix!='.json':
        parser.error('Output must be a separate JSON file')
    data=extract(args.source)
    args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

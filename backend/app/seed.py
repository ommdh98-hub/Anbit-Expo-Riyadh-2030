from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select
from .models import Site, Zone, Plant, SoilProfile, ReferenceSource, MeasurementPoint, SoilMeasurement


def seed_demo(session: Session):
    if session.get(Site, 'demo'):
        return
    session.add(Site(id='demo', name='حديقة أنبت التجريبية'))
    if not session.get(ReferenceSource, 'demo'):
        session.add(ReferenceSource(id='demo', title='افتراضات فريق أنبت للعرض', description='قيم محاكاة وليست مرجعًا زراعيًا أو بيانات من إكسبو.'))
    if not session.get(ReferenceSource, 'grow-right'):
        session.add(ReferenceSource(id='grow-right', title='Grow Right — ملفات الفريق السابقة', description='ثمانية نباتات وسبع مدن؛ بيانات غير موثقة خارجيًا. لا تُستخدم درجة الملاءمة في الري.'))
    session.commit()
    names = [('rosemary','إكليل الجبل'), ('basil','الريحان'), ('mint','النعناع'), ('thyme','الزعتر'), ('parsley','البقدونس')]
    for key,name in names:
        if not session.get(Plant,key):
            session.add(Plant(id=key,name=name,notes='اسم مستفاد من قاعدة Grow Right. الاحتياجات المائية والتربة والشمس تحتاج مراجعة مصدر زراعي قبل التشغيل الميداني.',source_id='grow-right'))
    for i in range(5):
        if not session.get(SoilProfile,f'soil-{i+1}'):
            session.add(SoilProfile(id=f'soil-{i+1}', name=['تربة رملية تجريبية','تربة طميية تجريبية','تربة مزيج تجريبية','تربة طميية تجريبية','تربة رملية تجريبية'][i], lower_vwc=.18+i*.01, target_vwc=.27+i*.01, upper_vwc=.36+i*.01))
    session.commit()
    layouts = [(4,4,30,20),(38,4,20,20),(62,4,20,20),(4,30,36,20),(46,30,36,20)]
    titles = ['روضة المدخل','حديقة الظل','أحواض الأعشاب','المسطح الأوسط','الممر الأخضر']
    for i,((x,y,w,h),(plant,_)) in enumerate(zip(layouts,names),1):
        zone=Zone(id=f'z{i}',site_id='demo',name=titles[i-1],plant_id=plant,soil_id=f'soil-{i}',x=x,y=y,width=w,height=h,area_m2=w*h,irrigated_area_m2=w*h,root_depth_m=.2,efficiency=.8,root_representative=True,homogeneous=True)
        session.add(zone)
        session.commit()
        coords = [(x+w*.25,y+h*.25),(x+w*.75,y+h*.25),(x+w*.25,y+h*.75),(x+w*.75,y+h*.75)]
        if i == 1:
            coords=coords[:3]
        for j,(px,py) in enumerate(coords):
            pid=f'z{i}-p{j+1}'
            session.add(MeasurementPoint(id=pid,zone_id=zone.id,x=px,y=py,name=f'نقطة {j+1}'))
            session.commit()
            value = {1:15,2:43,3:16,4:12 if j%2 else 36,5:23}[i]
            for history in [2,1,0]:
                timestamp=datetime.now(timezone.utc)-timedelta(hours=(72 if i==5 else 1)+history*8)
                session.add(SoilMeasurement(id=f'{pid}-m{history}',zone_id=zone.id,point_id=pid,value=value+history,unit='vwc_percent',measured_at=timestamp.isoformat(),source='مولد سيناريو العرض',operator='فريق أنبت',quality='verified',origin='simulation'))
    session.commit()

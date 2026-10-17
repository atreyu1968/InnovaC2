"""Pruebas de consistencia de la transcripción del PIC oficial de 2026-2027."""
import json
from pathlib import Path
b=Path(__file__).resolve().parents[1]
catalog=json.loads((b/'config/pic_2026_2027_catalogo.json').read_text(encoding='utf8'))
assert catalog['id']=='PIC_2026_2027_INNOVACION_C2'
assert len(catalog['objetivos'])==6
acts=[a for o in catalog['objetivos'] for a in o['acciones']]
inds=[i for a in acts for i in a['indicadores']]
assert len(acts)==24, len(acts)
assert len(inds)==31, len(inds)
assert len({a['codigo'] for a in acts})==len(acts)
assert len({i['id'] for i in inds})==len(inds)
assert {'1.1','1.2'}<=set(a['codigo'] for a in acts if a['obligatoria'])
assert len(catalog['familias_profesionales'])>=20
assert len(catalog['ods_2030'])==17
assert len(catalog['dafo_categorias'])==4
for o in catalog['objetivos']:
    assert o['acciones'] and all(a['indicadores'] for a in o['acciones'])
for i in inds:
    assert i['descripcion'].strip() and i['tipo'] in {'booleano','porcentaje','numero','escala_1_5','revisar_unidad'}
print('CATALOGO PIC VALIDO:',len(catalog['objetivos']),'objetivos;',len(acts),'acciones;',len(inds),'indicadores')

from docx import Document
from docx.shared import Inches,Pt,RGBColor,Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_BREAK
from docx.enum.table import WD_ROW_HEIGHT_RULE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path
import re
B=Path('/mnt/data/INNOVA_C2_REPLIT_v1_1')
src=B/'ESPECIFICACION_FUNCIONAL_TECNICA_INNOVA_C2.md'
D=Document();sec=D.sections[0];sec.top_margin=Cm(2.3);sec.bottom_margin=Cm(2.1);sec.left_margin=Cm(2.3);sec.right_margin=Cm(2.3)
sec.header_distance=Cm(1);sec.footer_distance=Cm(0.9)
styles=D.styles
normal=styles['Normal'];normal.font.name='Aptos';normal.font.size=Pt(9.5);normal.font.color.rgb=RGBColor(40,49,61)
normal.paragraph_format.space_after=Pt(5);normal.paragraph_format.line_spacing=1.12
for n,size,space,navy in [('Title',27,16,(18,44,77)),('Heading 1',15,10,(21,65,107)),('Heading 2',11.5,7,(26,88,130)),('Heading 3',10,5,(38,95,122))]:
 s=styles[n];s.font.name='Aptos Display' if n!='Heading 3' else 'Aptos';s.font.size=Pt(size);s.font.bold=True;s.font.color.rgb=RGBColor(*navy);s.paragraph_format.space_before=Pt(space);s.paragraph_format.space_after=Pt(6);s.paragraph_format.keep_with_next=True
# custom
for nm in ['Small Note','Table Text','Code Text']:
 if nm not in styles:styles.add_style(nm,WD_STYLE_TYPE.PARAGRAPH)
styles['Small Note'].font.size=Pt(8.5);styles['Small Note'].font.color.rgb=RGBColor(76,89,106)
styles['Table Text'].font.size=Pt(8.3);styles['Table Text'].paragraph_format.space_after=Pt(1);styles['Table Text'].paragraph_format.line_spacing=1.0
styles['Code Text'].font.name='Consolas';styles['Code Text'].font.size=Pt(8)
header=sec.header.paragraphs[0];header.alignment=WD_ALIGN_PARAGRAPH.RIGHT
hr=header.add_run('INNOVA-C2  |  Especificación para Replit  |  v1.1')
hr.font.name='Aptos';hr.font.size=Pt(8);hr.font.color.rgb=RGBColor(102,121,140)
footer=sec.footer.paragraphs[0];footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
fr=footer.add_run('IES Manuel Martín González · 17/10/2026   |   Página ');fr.font.size=Pt(8);fr.font.color.rgb=RGBColor(108,120,132)
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld)

def inline(p,t):
 # inline formatter for bold & code
 pattern=re.compile(r'(\*\*.*?\*\*|`[^`]+`)')
 for part in pattern.split(t):
  if not part:continue
  if part.startswith('**') and part.endswith('**'):
   r=p.add_run(part[2:-2]);r.bold=True
  elif part.startswith('`') and part.endswith('`'):
   r=p.add_run(part[1:-1]);r.font.name='Consolas';r.font.size=Pt(8.4);r.font.color.rgb=RGBColor(11,75,103)
  else:p.add_run(part)

def shade(cell,hexval):
 tcPr=cell._tc.get_or_add_tcPr(); el=OxmlElement('w:shd');el.set(qn('w:fill'),hexval);tcPr.append(el)

def set_cell_margin(cell,top=95,start=110,bottom=85,end=110):
 tc=cell._tc;tcPr=tc.get_or_add_tcPr();mar=OxmlElement('w:tcMar')
 for m,val in [('top',top),('start',start),('bottom',bottom),('end',end)]:
  n=OxmlElement('w:'+m);n.set(qn('w:w'),str(val));n.set(qn('w:type'),'dxa');mar.append(n)
 tcPr.append(mar)

# front cover
p=D.add_paragraph();p.paragraph_format.space_before=Pt(84)
r=p.add_run('INNOVA-C2');r.bold=True;r.font.size=Pt(35);r.font.color.rgb=RGBColor(16,61,103)
p=D.add_paragraph();p.style='Heading 2';inline(p,'PLATAFORMA AUTÓNOMA DE GESTIÓN DE INNOVACIÓN DE FP')
p=D.add_paragraph();p.paragraph_format.space_before=Pt(22)
r=p.add_run('Especificación funcional, técnica y administrativa\npara desarrollo integral en Replit');r.font.size=Pt(19);r.font.color.rgb=RGBColor(47,74,102)
p=D.add_paragraph();p.paragraph_format.space_before=Pt(26)
for text in ['Promotor: IES Manuel Martín González · Guía de Isora','Curso de referencia: 2026-2027','Proyecto transversal: Innovando en FP','Edición: 17 de octubre de 2026 · Versión 1.1']:
 p=D.add_paragraph(text);p.style='Small Note';p.paragraph_format.space_after=Pt(10)
p=D.add_paragraph();p.paragraph_format.space_before=Pt(45)
r=p.add_run('DOCUMENTO DE ENCARGO Y CRITERIOS DE ACEPTACIÓN');r.bold=True;r.font.size=Pt(10);r.font.color.rgb=RGBColor(22,96,129)
D.add_page_break()
D.add_heading('Contenido',level=1)
for s in ['1. Mandato, alcance y criterios de éxito','2. Marco oficial y criterios de interpretación','3. Contexto organizativo del centro piloto','4. Principios UX y experiencia de usuario','5. Roles, autorización y segregación','6. Modelo funcional y trazabilidad','7. Recogida autónoma de información','8. Editor PIC / Laycos manual','9. Motor determinista de indicadores','10. CICLOPE: coordinación y convocatorias C2','11. ATECA, FABLab, SCORM e Innovando en FP','12. Comunicaciones y documentos oficiales','12.1–12.9 Centro de Comunicaciones Resend e IA','13. IA opcional segura y verificable','14. Seguridad y soberanía tecnológica','15. Arquitectura e instalación','16. API y contratos','17. Automatizaciones','18. Informes y métricas','19. Plan de construcción por fases','20. Pruebas de aceptación AT-01 a AT-40','21. Datos iniciales pendientes','22. Entrega contractual','23. Referencias']:
 p=D.add_paragraph(style='Small Note');p.paragraph_format.space_after=Pt(4);inline(p,s)
D.add_page_break()
lines=src.read_text(encoding='utf-8').splitlines();i=0
# skip title heading and first description until first > requirement? parse all but duplicates first 7 lines
while i < len(lines):
 line=lines[i].rstrip()
 if not line.strip():i+=1;continue
 if line=='---':
  # gentle spacing
  p=D.add_paragraph();p.paragraph_format.space_after=Pt(1);i+=1;continue
 if line.startswith('# '):
  i+=1;continue
 if line.startswith('## '):
  title=line[3:].strip()
  if title.startswith('Documento de especificación'):
   i+=1;continue
  D.add_heading(title,level=1);i+=1;continue
 if line.startswith('### '):
  D.add_heading(line[4:].strip(),level=2);i+=1;continue
 if line.startswith('#### '):
  D.add_heading(line[5:].strip(),level=3);i+=1;continue
 if line.startswith('|'):
  matrix=[]
  while i<len(lines) and lines[i].startswith('|'):
   st=lines[i].strip(); cols=[c.strip() for c in st[1:-1].split('|')]
   if not all(re.fullmatch(r':?-{3,}:?',c) for c in cols):matrix.append(cols)
   i+=1
  if not matrix:continue
  ncol=max(len(row) for row in matrix);tbl=D.add_table(rows=0,cols=ncol);tbl.alignment=WD_TABLE_ALIGNMENT.CENTER
  tbl.autofit=False
  # widths for better balance
  total_width=Inches(6.7)
  for index,row in enumerate(matrix):
   cells=tbl.add_row().cells
   for j in range(ncol):
    cell=cells[j];set_cell_margin(cell)
    if index==0:shade(cell,'DCEAF3')
    elif index%2==0:shade(cell,'F6F9FC')
    p=cell.paragraphs[0];p.style='Table Text';inline(p,row[j] if j<len(row) else '')
    if index==0:
     for r in p.runs:r.bold=True;r.font.color.rgb=RGBColor(20,70,107)
    cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
  D.add_paragraph().paragraph_format.space_after=Pt(1)
  continue
 if line.startswith('> '):
  p=D.add_paragraph(style='Small Note');p.paragraph_format.left_indent=Cm(.4);p.paragraph_format.right_indent=Cm(.3)
  inline(p,line[2:]);p.paragraph_format.space_after=Pt(8)
  i+=1;continue
 if re.match(r'^- ',line):
  p=D.add_paragraph(style='List Bullet');p.paragraph_format.space_after=Pt(3);inline(p,line[2:]);i+=1;continue
 if re.match(r'^\d+\. ',line):
  p=D.add_paragraph(style='List Number');p.paragraph_format.space_after=Pt(3);inline(p,re.sub(r'^\d+\. ','',line));i+=1;continue
 p=D.add_paragraph();inline(p,line.replace('  ',' '));i+=1

# doc properties
D.core_properties.title='INNOVA-C2. Especificación funcional, técnica y administrativa'
D.core_properties.subject='Documento de encargo para Replit'
D.core_properties.author='IES Manuel Martín González · Coordinación de Innovación'
D.core_properties.keywords='C2, PIC, CICLOPE, Replit, innovación, FABLab, IA'
out=B/'ESPECIFICACION_FUNCIONAL_TECNICA_INNOVA_C2.docx';D.save(out)
print(out,out.stat().st_size,'p',len(D.paragraphs),'tables',len(D.tables))

# -*- coding: utf-8 -*-
import json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

data = json.load(open("horario_export.json", encoding="utf8"))
sess, datas = data["sessoes"], data["datas"]

DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]
HORAS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"]
COR = {"T": colors.HexColor("#FFF6E5"), "TP": colors.HexColor("#EEF4FA"), "PL": colors.HexColor("#FAF1EE"), "S": colors.HexColor("#F3EEFA")}

styles = getSampleStyleSheet()
cell_st = ParagraphStyle("c", parent=styles["Normal"], fontSize=5.6, leading=6.6)
hd = ParagraphStyle("h", parent=styles["Normal"], fontSize=8, leading=10, alignment=1, fontName="Helvetica-Bold")

doc = SimpleDocTemplate("Horario_2ano_Proposta_100pc.pdf", pagesize=landscape(A4),
                        leftMargin=8*mm, rightMargin=8*mm, topMargin=8*mm, bottomMargin=8*mm)
story = []
title = ParagraphStyle("t", parent=styles["Title"], fontSize=13, leading=16)
sub = ParagraphStyle("s", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#666666"))

story.append(Paragraph("ESEUC — Gestor de Horários · Licenciatura em Enfermagem · 2.º Ano · Proposta 2026/2027", title))
story.append(Paragraph("Completude: 100% (2642/2642 blocos) · Máx. 8h/aluno/dia · Sem sobreposições · Almoço protegido · Semanas 8-15 só Turma B (manhã) · 16-23 só Turma A (manhã)", sub))
story.append(Spacer(1, 4*mm))

weeks = sorted(set(s["w"] for s in sess))
for wi, w in enumerate(weeks):
    ws = [s for s in sess if s["w"] == w]
    semestre = 1 if w <= 15 else 2
    story.append(Paragraph(f"Semana {w} — {semestre}.º Semestre" + (f" · {datas.get(str(w), datas.get(w, ''))}" if datas.get(str(w)) or datas.get(w) else ""), hd))
    story.append(Spacer(1, 1.5*mm))
    rows = [["Período"] + DIAS]
    spans = []
    for hi, h in enumerate(HORAS):
        row = [Paragraph(f"<b>{h}</b><br/>{int(h[:2])+2:02d}:00", cell_st)]
        for d in DIAS:
            cs = [s for s in ws if s["d"] == d and s["h"] == h]
            if not cs:
                row.append("")
                continue
            # agrupar por UC+tipo, listar turmas
            por = {}
            for s in cs:
                por.setdefault((s["uc"], s["t"]), []).append(s["tu"])
            partes = []
            for (uc, t), tus in sorted(por.items()):
                tus_s = ", ".join(sorted(tus, key=lambda x: (len(x), x)))
                partes.append(f"<b>{uc}</b> ({t}): {tus_s}")
            row.append(Paragraph("<br/>".join(partes), cell_st))
        rows.append(row)
    colw = [16*mm] + [(doc.width - 16*mm) / 5.0] * 5
    tb = Table(rows, colWidths=colw, repeatRows=1)
    st = [
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E1C19")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 7),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#F4F1EC")),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]
    # colorir células por tipo dominante
    for hi, h in enumerate(HORAS):
        for di, d in enumerate(DIAS):
            cs = [s for s in ws if s["d"] == d and s["h"] == h]
            if cs:
                tipos = set(s["t"] for s in cs)
                cor = COR.get("PL" if "PL" in tipos else ("TP" if "TP" in tipos else ("T" if "T" in tipos else "S")))
                st.append(("BACKGROUND", (di + 1, hi + 1), (di + 1, hi + 1), cor))
    tb.setStyle(TableStyle(st))
    story.append(tb)
    if wi < len(weeks) - 1:
        from reportlab.platypus import PageBreak
        story.append(PageBreak())

doc.build(story)
print("PDF gerado")

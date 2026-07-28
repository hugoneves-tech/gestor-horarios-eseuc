import type { SessaoHorario } from "../types";

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] as const;
const BLOCOS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"] as const;

const escaparHtml = (valor: unknown): string => String(valor ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const rotuloTurmaPdf = (turma: string): string => {
  if (turma === "Turma A") return "T1";
  if (turma === "Turma B") return "T2";
  return turma;
};

export interface OpcoesExportacaoPdf {
  sessoes: SessaoHorario[];
  semanas: { numero: number; semestre: number; intervalo: string }[];
  anoLetivo: string;
  anoCurricular: string;
  proposta: string;
}

export function criarHtmlHorarioPdf({
  sessoes,
  semanas,
  anoLetivo,
  anoCurricular,
  proposta,
}: OpcoesExportacaoPdf): string {
  const totalPaginas = semanas.length;
  const paginas = semanas.map((semana, indicePagina) => {
    const sessoesSemana = sessoes.filter(s => s.semana === semana.numero);
    const linhas = BLOCOS.map(hora => {
      const fim = `${String(Number(hora.slice(0, 2)) + 2).padStart(2, "0")}:00`;
      const celulas = DIAS.map(dia => {
        const itens = sessoesSemana
          .filter(s => s.diaSemana === dia && s.horaInicio === hora)
          .sort((a, b) => rotuloTurmaPdf(a.turma).localeCompare(rotuloTurmaPdf(b.turma), "pt")
            || a.tipoAula.localeCompare(b.tipoAula)
            || a.ucSigla.localeCompare(b.ucSigla, "pt"));
        const densidade = itens.length >= 10 ? "muito-densa" : itens.length >= 7 ? "densa" : "";
        const cartoes = itens.map(sessao =>
          `<div class="aula aula-${sessao.tipoAula.toLowerCase()} ${densidade}">`
          + `<strong>${escaparHtml(sessao.ucSigla)}</strong> `
          + `(${escaparHtml(sessao.tipoAula)}) `
          + `${escaparHtml(rotuloTurmaPdf(sessao.turma))}</div>`,
        ).join("");
        return `<td>${cartoes}</td>`;
      }).join("");
      return `<tr><th class="periodo">${hora}-${fim}</th>${celulas}</tr>`;
    }).join("");

    const mensagemVazia = sessoesSemana.length
      ? ""
      : `<div class="sem-aulas">${escaparHtml(
        semana.intervalo.includes("Pausa:")
          ? semana.intervalo.slice(semana.intervalo.indexOf("Pausa:") + 6).replace(")", "").trim()
          : "Sem aulas distribuídas",
      )}</div>`;

    return `<section class="pagina">
      <header>
        <h1>ESEUC - Horário do ${escaparHtml(anoCurricular)}</h1>
        <p>${escaparHtml(anoLetivo)} | ${semana.semestre}.º semestre | Semana ${semana.numero} | ${escaparHtml(semana.intervalo)}</p>
      </header>
      <main>
        <div class="grelha-wrap">
          <table>
            <colgroup><col class="col-periodo">${DIAS.map(() => "<col>").join("")}</colgroup>
            <thead><tr><th>Período</th>${DIAS.map(dia => `<th>${dia}</th>`).join("")}</tr></thead>
            <tbody>${linhas}</tbody>
          </table>
          ${mensagemVazia}
        </div>
      </main>
      <footer>
        <span>Proposta: ${escaparHtml(proposta)}</span>
        <span>Página ${indicePagina + 1} de ${totalPaginas}</span>
      </footer>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8">
  <title>Horário ESEUC - ${escaparHtml(anoCurricular)} - ${escaparHtml(anoLetivo)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #292621; font-family: Arial, Helvetica, sans-serif; }
    .pagina { position: relative; width: 297mm; height: 210mm; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
    .pagina:last-child { page-break-after: auto; break-after: auto; }
    header { height: 16.2mm; padding: 0 8.5mm; background: #211f1b; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 8mm; }
    header h1 { margin: 0; font-size: 15pt; line-height: 1; white-space: nowrap; }
    header p { margin: 0; font-size: 8.5pt; text-align: right; white-space: nowrap; }
    main { height: 185.3mm; padding: 4.5mm 8.5mm 5.2mm; }
    .grelha-wrap { position: relative; width: 100%; height: 100%; }
    table { width: 100%; height: 100%; table-layout: fixed; border-collapse: collapse; border: .45pt solid #8d867b; }
    col.col-periodo { width: 20.2mm; }
    thead { height: 7.8mm; }
    tbody tr { height: 27.85mm; }
    th, td { border: .45pt solid #8d867b; }
    thead th { padding: 0 1.5mm; background: #e7e1d8; color: #34302a; font-size: 8pt; text-align: center; vertical-align: middle; }
    th.periodo { padding: 0 1mm; background: #faf8f5; color: #59534b; font-size: 7.2pt; white-space: nowrap; text-align: center; vertical-align: middle; }
    td { padding: 1.2mm 1.1mm; vertical-align: top; overflow: hidden; }
    .aula { min-height: 3.4mm; margin: .15mm 0; padding: .55mm .85mm .4mm; border-radius: .65mm; color: #292621; font-size: 6.1pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .aula.densa { min-height: 2.65mm; padding: .3mm .7mm .2mm; font-size: 5.05pt; }
    .aula.muito-densa { min-height: 2.15mm; padding: .18mm .65mm .1mm; font-size: 4.35pt; }
    .aula-t { background: #f3f4f6; }
    .aula-tp { background: #e8f1fc; }
    .aula-pl { background: #fcede8; }
    .aula-s { background: #f1eafb; }
    .sem-aulas { position: absolute; inset: 7.8mm 0 0 20.2mm; display: flex; align-items: center; justify-content: center; color: #7b746a; font-size: 16pt; font-weight: 700; pointer-events: none; }
    footer { position: absolute; left: 8.5mm; right: 8.5mm; bottom: 2.8mm; display: flex; justify-content: space-between; color: #665f56; font-size: 6.5pt; }
    @page { size: A4 landscape; margin: 0; }
    @media print {
      html, body { width: 297mm; height: 210mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>${paginas}</body>
</html>`;
}

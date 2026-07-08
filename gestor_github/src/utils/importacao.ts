// Importação de um horário feito fora da plataforma (Excel/CSV) → SessaoHorario[].
// Caminho 100% determinístico: lê o template, valida cada linha e mapeia. As linhas
// inválidas são reportadas (nº + motivo) sem rebentar o resto.
import type { UC, SessaoHorario } from "../types";

export const CABECALHO_TEMPLATE = ["Semana", "Dia", "Hora", "UC", "Tipo", "Turma", "Docente", "Sala"] as const;

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
const HORAS = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
const TIPOS = ["T", "TP", "PL", "S"];

// Turmas válidas: Turma A/B, TP1-8, PL1-24.
function turmaValida(t: string): boolean {
  if (t === "Turma A" || t === "Turma B") return true;
  const tp = t.match(/^TP(\d+)$/); if (tp) return +tp[1] >= 1 && +tp[1] <= 8;
  const pl = t.match(/^PL(\d+)$/); if (pl) return +pl[1] >= 1 && +pl[1] <= 24;
  return false;
}

const somaHoras = (hora: string): string => {
  const i = HORAS.indexOf(hora);
  return i >= 0 && i + 1 < HORAS.length ? HORAS[i + 1] : hora;
};

export interface ErroLinha { linha: number; motivo: string; conteudo: string; }
export interface ResultadoImport { sessoes: SessaoHorario[]; erros: ErroLinha[]; }

// CSV com cabeçalho + uma linha de exemplo, para o autor externo preencher.
export function gerarTemplateCSV(): string {
  const sep = ";"; // ';' = compatível com Excel em locale PT
  const linhas = [
    CABECALHO_TEMPLATE.join(sep),
    ["5", "Quinta", "08:00", "ESDAC", "PL", "PL3", "", ""].join(sep),
    ["5", "Quinta", "08:00", "EIG", "TP", "TP1", "", ""].join(sep),
  ];
  return "﻿" + linhas.join("\r\n"); // BOM → acentos corretos no Excel
}

// Divide uma linha CSV respeitando aspas e o delimitador detetado.
function dividirLinha(linha: string, sep: string): string[] {
  const out: string[] = []; let cur = ""; let emAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (emAspas && linha[i + 1] === '"') { cur += '"'; i++; } else emAspas = !emAspas; }
    else if (c === sep && !emAspas) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

export function parseHorarioCSV(texto: string, ucs: UC[]): ResultadoImport {
  const ucPorSigla = new Map(ucs.map(u => [u.sigla.toUpperCase(), u]));
  const sessoes: SessaoHorario[] = [];
  const erros: ErroLinha[] = [];

  const limpo = texto.replace(/^﻿/, "");
  const linhas = limpo.split(/\r?\n/).filter(l => l.trim() !== "");
  if (linhas.length === 0) return { sessoes, erros: [{ linha: 0, motivo: "Ficheiro vazio.", conteudo: "" }] };

  // Detetar delimitador pela 1.ª linha (a que tiver mais ; ou ,).
  const sep = (linhas[0].split(";").length >= linhas[0].split(",").length) ? ";" : ",";

  // Mapear colunas pelo cabeçalho (tolerante a ordem/maiúsculas).
  const header = dividirLinha(linhas[0], sep).map(h => h.toLowerCase());
  const idx = (nome: string) => header.findIndex(h => h === nome.toLowerCase());
  const cSem = idx("Semana"), cDia = idx("Dia"), cHora = idx("Hora"), cUC = idx("UC"),
    cTipo = idx("Tipo"), cTurma = idx("Turma"), cDoc = idx("Docente"), cSala = idx("Sala");
  const obrig = { Semana: cSem, Dia: cDia, Hora: cHora, UC: cUC, Tipo: cTipo, Turma: cTurma };
  const emFalta = Object.entries(obrig).filter(([, v]) => v < 0).map(([k]) => k);
  if (emFalta.length) {
    return { sessoes, erros: [{ linha: 1, motivo: `Cabeçalho sem coluna(s): ${emFalta.join(", ")}. Usa o template.`, conteudo: linhas[0] }] };
  }

  for (let i = 1; i < linhas.length; i++) {
    const nLinha = i + 1; // nº humano (1-based, com cabeçalho na linha 1)
    const cols = dividirLinha(linhas[i], sep);
    const get = (c: number) => (c >= 0 && c < cols.length ? cols[c] : "");
    const semanaRaw = get(cSem), dia = get(cDia), hora = get(cHora);
    const ucSig = get(cUC).toUpperCase(), tipo = get(cTipo).toUpperCase(), turma = get(cTurma);
    const motivos: string[] = [];

    const semana = Number(semanaRaw);
    if (!Number.isInteger(semana) || semana < 1 || semana > 30) motivos.push(`Semana inválida ("${semanaRaw}", esperado 1-30)`);
    if (!DIAS.includes(dia)) motivos.push(`Dia inválido ("${dia}")`);
    if (!HORAS.includes(hora)) motivos.push(`Hora inválida ("${hora}", esperado 08:00/10:00/.../18:00)`);
    const uc = ucPorSigla.get(ucSig);
    if (!uc) motivos.push(`UC desconhecida ("${ucSig}")`);
    if (!TIPOS.includes(tipo)) motivos.push(`Tipo inválido ("${tipo}", esperado T/TP/PL/S)`);
    if (!turmaValida(turma)) motivos.push(`Turma inválida ("${turma}")`);

    if (motivos.length) { erros.push({ linha: nLinha, motivo: motivos.join("; "), conteudo: linhas[i] }); continue; }

    sessoes.push({
      id: sessoes.length + 1,
      ucNome: uc!.nome,
      ucSigla: uc!.sigla,
      tipoAula: tipo as SessaoHorario["tipoAula"],
      docente: get(cDoc),
      sala: get(cSala),
      salaTipo: "",
      turma,
      diaSemana: dia,
      horaInicio: hora,
      horaFim: somaHoras(hora),
      bloqueado: true, // importadas entram como FIXAS
      semana,
    });
  }

  return { sessoes, erros };
}

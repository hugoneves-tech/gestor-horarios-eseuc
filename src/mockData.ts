/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Curso, AnoLetivoSemestre, UC, Docente, Sala, Turma, FeriadoInterrupcao, RegraHorario, VersaoHorario, SolverRun } from "./types";

export const cursosIniciais: Curso[] = [
  { id: "c1", nome: "Licenciatura em Enfermagem", sigla: "LE", departamento: "Unid. Científico-Pedagógica de Enfermagem Fundamental" },
  { id: "c2", nome: "Mestrado em Enfermagem de Saúde Materna e Obstétrica", sigla: "MESMO", departamento: "Unid. Científico-Pedagógica de Enfermagem de Saúde da Mulher" },
];

export const anosSemestresIniciais: AnoLetivoSemestre[] = [
  { id: "as1", anoLetivo: "2026/2027", semestre: 1, edicao: "Regular", ativo: true,  dataInicioSemestre: "2026-09-08" },
  { id: "as2", anoLetivo: "2026/2027", semestre: 2, edicao: "Regular", ativo: false, dataInicioSemestre: "2027-02-01" },
];

export const generateEseucTurmas = (sigla: string, cargaT: number, cargaTP: number, cargaPratica: number, cargaS: number = 0) => {
  const turmas: any[] = [];
  if (cargaT > 0) {
    turmas.push({ id: `tc_${sigla}_TA`, nome: "Turma A", tipo: "Teórica" as const, docenteId: "" });
    turmas.push({ id: `tc_${sigla}_TB`, nome: "Turma B", tipo: "Teórica" as const, docenteId: "" });
  }
  if (cargaTP > 0) {
    for (let i = 1; i <= 8; i++) {
      turmas.push({ id: `tc_${sigla}_TP${i}`, nome: `TP${i}`, tipo: "TeoricoPratica" as const, docenteId: "" });
    }
  }
  if (cargaPratica > 0) {
    for (let i = 1; i <= 24; i++) {
      turmas.push({ id: `tc_${sigla}_PL${i}`, nome: `PL${i}`, tipo: "Prática" as const, docenteId: "" });
    }
  }
  if (cargaS > 0) {
    turmas.push({ id: `tc_${sigla}_S1`, nome: "Seminário 1", tipo: "Seminário" as const, docenteId: "" });
  }
  return turmas;
};

const createUcEseuc = (
  id: string,
  nome: string,
  sigla: string,
  ects: number,
  semestre: 1 | 2,
  periodo: string,
  semanaInicio: number,
  semanaFim: number,
  dataInicio: string,
  dataFim: string,
  cargaHorariaTeorica: number,
  cargaHorariaTP: number,
  cargaHorariaPratica: number,
  observacoes: string
): UC => ({
  id,
  nome,
  sigla,
  cursoId: "c1",
  anoCurricular: 2,
  cargaHorariaTeorica,
  cargaHorariaPratica,
  cargaHorariaTP,
  cargaHorariaE: 0,
  ects,
  semestre,
  semanaInicio,
  semanaFim,
  numSemanas: Math.max(1, semanaFim - semanaInicio + 1),
  dataInicio,
  dataFim,
  periodo,
  observacoes,
  turmasConfig: generateEseucTurmas(sigla, cargaHorariaTeorica, cargaHorariaTP, cargaHorariaPratica)
});

export const ucsIniciais: UC[] = [
  createUcEseuc("uc_mi", "Metodologia de Investigação", "MI", 4, 1, "1.º semestre, fase inicial", 1, 7, "2026-09-10", "2026-10-23", 16, 30, 6, "2 turmas T; TP e PL por subdivisão de cada turma."),
  createUcEseuc("uc_eig", "Enfermagem do Idoso e Geriatria", "EIG", 3, 1, "1.º semestre, fase inicial", 1, 7, "2026-09-10", "2026-10-23", 8, 38, 0, "Inclui interrupção da Latada e feriado de 5/10."),
  createUcEseuc("uc_ft", "Farmacologia e Terapêutica", "FT", 3, 1, "1.º semestre, fase inicial", 1, 7, "2026-09-10", "2026-10-23", 8, 10, 20, "Aulas T sujeitas à restrição do auditório."),
  createUcEseuc("uc_esdac", "Enfermagem em Situações de Dependência no Autocuidado", "ESDAC", 3, 1, "1.º semestre, fase inicial", 1, 7, "2026-09-10", "2026-10-23", 8, 6, 24, "2 turmas T; 4 TP e 12 PL por turma."),
  createUcEseuc("uc_es", "Educação em Saúde", "ES", 2, 1, "1.º semestre, fase inicial", 1, 7, "2026-09-10", "2026-10-23", 16, 10, 0, "Apesar de surgir na lista como 2.º semestre, foi adequada à calendarização indicada."),
  createUcEseuc("uc_ps_i", "Patologia Sistémica - 1.º Bloco", "PS-I", 3, 1, "1.º semestre, bloco final", 8, 15, "2026-10-26", "2026-12-18", 32, 6, 0, "Inclui feriados de 1 e 8 de dezembro."),
  createUcEseuc("uc_er_i", "Enfermagem de Reabilitação - 1.º Bloco", "ER-I", 2, 1, "1.º semestre, bloco final", 8, 15, "2026-10-26", "2026-12-18", 8, 8, 10, "UC organizada em bloco de 8 semanas."),
  createUcEseuc("uc_escf_i", "Enfermagem de Saúde Comunitária e Familiar - 1.º Bloco", "ESCF-I", 6, 1, "1.º semestre, bloco final", 8, 15, "2026-10-26", "2026-12-18", 36, 28, 12, "UC organizada em bloco de 8 semanas."),
  createUcEseuc("uc_esip_i", "Enfermagem de Saúde Infantil e Pediátrica - 1.º Bloco", "ESIP-I", 4, 1, "1.º semestre, bloco final", 8, 15, "2026-10-26", "2026-12-18", 16, 28, 8, "UC organizada em bloco de 8 semanas."),
  createUcEseuc("uc_ps_ii", "Patologia Sistémica - 2.º Bloco", "PS-II", 3, 2, "2.º semestre, bloco inicial", 1, 8, "2027-02-01", "2027-03-26", 32, 6, 0, "Corresponde às primeiras 8 semanas do 2.º semestre."),
  createUcEseuc("uc_er_ii", "Enfermagem de Reabilitação - 2.º Bloco", "ER-II", 2, 2, "2.º semestre, bloco inicial", 1, 8, "2027-02-01", "2027-03-26", 8, 8, 10, "Corresponde às primeiras 8 semanas do 2.º semestre."),
  createUcEseuc("uc_escf_ii", "Enfermagem de Saúde Comunitária e Familiar - 2.º Bloco", "ESCF-II", 6, 2, "2.º semestre, bloco inicial", 1, 8, "2027-02-01", "2027-03-26", 36, 28, 12, "Corresponde às primeiras 8 semanas do 2.º semestre."),
  createUcEseuc("uc_esip_ii", "Enfermagem de Saúde Infantil e Pediátrica - 2.º Bloco", "ESIP-II", 4, 2, "2.º semestre, bloco inicial", 1, 8, "2027-02-01", "2027-03-26", 16, 28, 8, "Corresponde às primeiras 8 semanas do 2.º semestre."),
  createUcEseuc("uc_emc", "Enfermagem Médico-Cirúrgica", "EMC", 4, 2, "2.º semestre, bloco final", 9, 15, "2027-03-30", "2027-05-20", 26, 8, 18, "360 estudantes; 2 turmas; mesma restrição do auditório. Semana 15 + fecho até 20/05/2027."),
  createUcEseuc("uc_essr", "Enfermagem de Saúde Sexual e Reprodutiva", "ESSR", 4, 2, "2.º semestre, bloco final", 9, 15, "2027-03-30", "2027-05-20", 16, 28, 8, "Corresponde à Saúde materna indicada. Semana 15 + fecho até 20/05/2027."),
  createUcEseuc("uc_esmp", "Enfermagem de Saúde Mental e Psiquiátrica", "ESMP", 4, 2, "2.º semestre, bloco final", 9, 15, "2027-03-30", "2027-05-20", 16, 20, 16, "2 turmas T; 4 TP e 12 PL por turma quando aplicável. Semana 15 + fecho até 20/05/2027."),
  createUcEseuc("uc_psis", "Psicologia da Saúde", "PsiS", 3, 2, "2.º semestre, bloco final", 9, 15, "2027-03-30", "2027-05-20", 20, 18, 0, "Mantida no 2.º semestre por adequação à informação indicada. Semana 15 + fecho até 20/05/2027.")
];
export const docentesIniciais: Docente[] = [
  {
    id: "t1",
    nome: "Prof. Dra. Maria do Céu",
    email: "mariaceu@eseuc.pt",
    departamento: "UCP Enfermagem de Saúde da Mulher",
    maxHorasSemanais: 12,
    unidadesCurriculares: ["BDP", "PCS1"],
    disponibilidade: {
      "Segunda": ["08:00-12:00", "14:00-18:00"],
      "Terça": ["08:00-12:00"],
      "Quarta": ["14:00-18:00"],
      "Quinta": ["08:00-12:00", "14:00-18:00"],
      "Sexta": []
    }
  },
  {
    id: "t2",
    nome: "Prof. Dr. António Jesus Coimbra",
    email: "antoniojesus@eseuc.pt",
    departamento: "UCP Enfermagem Fundamental",
    maxHorasSemanais: 16,
    unidadesCurriculares: ["FE", "ECCP"],
    disponibilidade: {
      "Segunda": ["08:00-12:00"],
      "Terça": ["10:00-14:00", "14:00-18:00"],
      "Quarta": ["08:00-12:00", "14:00-18:00"],
      "Quinta": [],
      "Sexta": ["08:00-12:00", "14:00-18:00"]
    }
  },
  {
    id: "t3",
    nome: "Dra. Ana Rita Mendonça",
    email: "anarita@eseuc.pt",
    departamento: "UCP Enfermagem Fundamental",
    maxHorasSemanais: 8,
    unidadesCurriculares: ["AFH", "PCS1"],
    disponibilidade: {
      "Segunda": ["14:00-20:00"],
      "Terça": ["14:00-20:00"],
      "Quarta": [],
      "Quinta": ["14:00-20:00"],
      "Sexta": []
    }
  }
];

export const salasIniciais: Sala[] = [
  { id: "s1", nome: "Auditório Geral ESEUC", tipo: "Teórica", capacidade: 400, equipamento: ["Projetor", "Sistema de Som", "Captação de Aula", "Lotação para aula conjunta inicial"], tipologia: "Anfiteatro (Teórica T)", tipologias: ["Anfiteatro (Teórica T)"] },
  { id: "s2", nome: "Sala TP 1", tipo: "Teórico-prática", capacidade: 50, equipamento: ["Projetor", "Quadro", "Mesas móveis"], tipologia: "Sala Comum TP", tipologias: ["Sala Comum TP"] },
  { id: "s3", nome: "Sala TP 2", tipo: "Teórico-prática", capacidade: 50, equipamento: ["Projetor", "Quadro", "Mesas móveis"], tipologia: "Sala Comum TP", tipologias: ["Sala Comum TP"] },
  { id: "s4", nome: "Laboratório de Simulação 1", tipo: "Laboratório", capacidade: 18, equipamento: ["Camas Hospitalares", "Manequins Clínicos", "Suportes de Soro"], tipologia: "Laboratório de Simulação PL", tipologias: ["Laboratório de Simulação PL"] },
  { id: "s5", nome: "Laboratório de Simulação 2", tipo: "Laboratório", capacidade: 18, equipamento: ["Camas Hospitalares", "Manequins Clínicos", "Material de Cuidados"], tipologia: "Laboratório de Simulação PL", tipologias: ["Laboratório de Simulação PL"] },
  { id: "s6", nome: "Sala de Informática", tipo: "Sala de Computadores", capacidade: 45, equipamento: ["Computadores", "Projetor"], tipologia: "Sala de Computadores", tipologias: ["Sala de Computadores"] }
];

// Helper to generate the standard turma structure for years 1, 2 and 4
// Structure: 2 teóricas (180 each) → 4 TPs per teórica (45 each) → 3 PLs per TP (15 each)
function gerarTurmasPorAno(ano: number, alunosTeorica = 180): Turma[] {
  const turmas: Turma[] = [];
  const alunosTP = Math.round(alunosTeorica / 4);
  const alunosPL = Math.round(alunosTP / 3);

  turmas.push({ id: `tr_${ano}ta`, nome: "Turma A", cursoId: "c1", alunos: alunosTeorica, vagas: alunosTeorica, tipo: "Teórica", anoCurricular: ano });
  turmas.push({ id: `tr_${ano}tb`, nome: "Turma B", cursoId: "c1", alunos: alunosTeorica, vagas: alunosTeorica, tipo: "Teórica", anoCurricular: ano });
  for (let i = 1; i <= 8; i++) {
    turmas.push({ id: `tr_${ano}tp${i}`, nome: `TP${i}`, cursoId: "c1", alunos: alunosTP, vagas: alunosTP, tipo: "TeoricoPratica", anoCurricular: ano });
  }
  for (let i = 1; i <= 24; i++) {
    turmas.push({ id: `tr_${ano}pl${i}`, nome: `PL${i}`, cursoId: "c1", alunos: alunosPL, vagas: alunosPL, tipo: "Prática", anoCurricular: ano });
  }
  return turmas;
}

// 3rd year: two blocks (hospitalar + comunitária) that rotate the same 360 students
// Each block has 2 groups of 180 (the same students alternate between blocks each semester)
function gerarTurmas3Ano(alunosPorTurma = 180): Turma[] {
  return [
    { id: "tr_3hosp_a", nome: "Hosp. A", cursoId: "c1", alunos: alunosPorTurma, vagas: alunosPorTurma, tipo: "Teórica", anoCurricular: 3, bloco: "hospitalar" },
    { id: "tr_3hosp_b", nome: "Hosp. B", cursoId: "c1", alunos: alunosPorTurma, vagas: alunosPorTurma, tipo: "Teórica", anoCurricular: 3, bloco: "hospitalar" },
    { id: "tr_3com_a",  nome: "Com. A",  cursoId: "c1", alunos: alunosPorTurma, vagas: alunosPorTurma, tipo: "Teórica", anoCurricular: 3, bloco: "comunitaria" },
    { id: "tr_3com_b",  nome: "Com. B",  cursoId: "c1", alunos: alunosPorTurma, vagas: alunosPorTurma, tipo: "Teórica", anoCurricular: 3, bloco: "comunitaria" },
  ];
}

export const turmasIniciais: Turma[] = [
  ...gerarTurmasPorAno(1),
  ...gerarTurmasPorAno(2),
  ...gerarTurmas3Ano(),
  ...gerarTurmasPorAno(4),
];

export const feriadosIniciais: FeriadoInterrupcao[] = [
  { id: "latada_2026", nome: "Latada", tipo: "Interrupção Letiva", dataInicio: "2026-09-30", dataFim: "2026-10-02" },
  { id: "fer_2026_10_05", nome: "Implantação da República", tipo: "Feriado", dataInicio: "2026-10-05", dataFim: "2026-10-05" },
  { id: "fer_2026_12_01", nome: "Restauração da Independência", tipo: "Feriado", dataInicio: "2026-12-01", dataFim: "2026-12-01" },
  { id: "fer_2026_12_08", nome: "Imaculada Conceição", tipo: "Feriado", dataInicio: "2026-12-08", dataFim: "2026-12-08" }
];
export const regrasIniciais: RegraHorario[] = [
  // Hard Constraints
  {
    id: "h1",
    nome: "Evitar mais do que uma aula para o mesmo Encarregado de Disciplina no mesmo horário",
    tipo: "hard",
    categoria: "Professor",
    descricao: "Garantir que nenhum professor de enfermagem tem duas sessões clínicas marcadas ao mesmo tempo.",
    config: { traducaoSimples: "A IA valida automaticamente a agenda de cada docente e impede sobreposições de horários." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_docente_horario_fixo",
    nome: "Respeitar horários fixos e reduzidos dos docentes",
    tipo: "hard",
    categoria: "Docente",
    descricao: "Alguns docentes têm disponibilidade reduzida e específica (dias da semana e horas fixas). As aulas atribuídas só podem ser marcadas dentro da disponibilidade declarada de cada docente.",
    config: { traducaoSimples: "Ao atribuir docentes, o motor só coloca aulas nos dias/horas em que o docente está disponível (definido na ficha do docente)." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_mi_pl_computador",
    nome: "PL de MI em salas de computadores (paralelas às de laboratório)",
    tipo: "hard",
    categoria: "Sala",
    descricao: "As PL de Metodologia de Investigação (MI) decorrem em salas de computadores, não nos laboratórios de simulação. Por isso podem ocorrer em simultâneo com outras PL, contando num conjunto de salas próprio (4 a 6 PL de MI em simultâneo).",
    config: { traducaoSimples: "As PL de MI usam salas de computadores: têm o seu próprio limite (até 6 em simultâneo) e não competem pelas manchas dos laboratórios de simulação." },
    peso: 9,
    ativa: true
  },
  {
    id: "h_pl_dias_4a_6a",
    nome: "PL apenas de 4.ª a 6.ª feira (quarta a sexta)",
    tipo: "soft",
    categoria: "Calendário",
    descricao: "Quando ativa, as Práticas de Laboratório (PL) só podem ser marcadas de quarta a sexta-feira (4.ª, 5.ª e 6.ª feira). Desative para permitir as PL em qualquer dia útil e comparar os dois cenários.",
    config: { traducaoSimples: "PL só de quarta a sexta.", diasPermitidos: ["Quarta", "Quinta", "Sexta"] },
    peso: 6,
    ativa: false
  },
  {
    id: "h2",
    nome: "Evitar ocupação dupla de salas de práticas simuladas ou anfiteatros",
    tipo: "hard",
    categoria: "Sala",
    descricao: "Garantir que as salas físicas ou laboratórios num determinado horário acomodam apenas um grupo de estudantes de cada vez.",
    config: { traducaoSimples: "Proteção física e automática de ocupação de espaçãos para evitar conflitos de salas e camas de práticas." },
    peso: 10,
    ativa: true
  },
  {
    id: "h3",
    nome: "Limitar lotação de estudantes por espação físico na ESEUC",
    tipo: "hard",
    categoria: "Sala",
    descricao: "Garantir que o número de alunos registados na turma de enfermagem não excede o limite de lugares sentados na sala física atribuída.",
    config: { traducaoSimples: "Se a turma tem 120 alunos, a IA forçará a seleção de anfiteatros de grande dimensão, barrando as salas pequenas de práticas." },
    peso: 10,
    ativa: true
  },
  {
    id: "h4",
    nome: "Bloquear marcação de aulas em Feriados e Queima das Fitas de Coimbra",
    tipo: "hard",
    categoria: "Calendário",
    descricao: "Impedir de forma segura que qualquer aula ou estágio prático coincida com feriados municipais, nacionais ou férias académicas devidamente listadas.",
    config: { traducaoSimples: "Desativação automática de todos os blocos de horário que se encontrem sob as datas assinaladas no calendário escolar de Coimbra." },
    peso: 10,
    ativa: true
  },
  {
    id: "h5",
    nome: "Respeitar exclusivamente a disponibilidade clínica do Professor",
    tipo: "hard",
    categoria: "Professor",
    descricao: "Bloquear a agenda de cada docente para que nunca sejam alocados períodos letivos fora das horas de escala ou consulta declaradas pelo professor.",
    config: { traducaoSimples: "A IA cruza o mapa de preferências preenchido individualmente por cada docente com o gerador antes de propor slots." },
    peso: 10,
    ativa: true
  },
  {
    id: "h6",
    nome: "Exigência de Equipamento de Práticas (Laboratórios Sims)",
    tipo: "hard",
    categoria: "Sala",
    descricao: "Aulas práticas clínicas simuladas exigem de forma obrigatória instalações equipadas com manequins de simulação ou camas hospitalares.",
    config: { traducaoSimples: "Garantia que as aulas práticas com componente simulada clínica nunca calham em anfiteatros tradicionais sem os equipamentos adequados." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_transversal_carga_total_uc",
    nome: "Cumprir a carga horária prevista de todas as UCs",
    tipo: "hard",
    categoria: "Estudantes",
    descricao: "Todas as UCs ativas devem ter todos os blocos previstos de T, TP, PL e S alocados no horário gerado.",
    escopo: "transversal",
    anoCurricular: "todos",
    config: { traducaoSimples: "Regra transversal: nenhuma UC fica com carga horária por distribuir." },
    peso: 10,
    ativa: true
  },  {
    id: "h_eseuc_estrutura_360",
    nome: "Estrutura oficial de 360 estudantes em Turmas A/B, TP e PL",
    tipo: "hard",
    categoria: "Estudantes",
    descricao: "Organizar 360 estudantes em 2 turmas T de 180 estudantes, 8 grupos TP de 45 estudantes e 24 grupos PL de 15 estudantes.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "A app aplica a hierarquia Turma A/B > TP > PL e impede que uma turma-mãe e os seus subgrupos tenham aulas simultâneas." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_eseuc_auditorio",
    nome: "Restrição do Auditório para aulas teóricas",
    tipo: "hard",
    categoria: "Sala",
    descricao: "Aulas T em auditório apenas às segundas e quartas-feiras todo o dia e às sextas-feiras de manhã.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "As aulas teóricas ficam condicionadas aos períodos disponíveis do auditório ESEUC." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_eseuc_primeira_sexta",
    nome: "Primeira sexta-feira com aula T conjunta",
    tipo: "hard",
    categoria: "Calendário",
    descricao: "Na primeira sexta-feira do ano letivo, a aula T no auditório é dada às duas turmas em conjunto.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "Exceção inicial: Turma A e Turma B podem assistir em conjunto no auditório na primeira sexta-feira." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_eseuc_horario_08_20",
    nome: "Funcionamento letivo entre 08h00 e 20h00",
    tipo: "hard",
    categoria: "Calendário",
    descricao: "Todos os blocos letivos devem decorrer dentro do intervalo 08h00-20h00.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "A grelha semanal fica limitada aos blocos entre as 08h00 e as 20h00." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_eseuc_ordem_t_tp_pl",
    nome: "Sequência semanal T → TP → PL",
    tipo: "hard",
    categoria: "Estudantes",
    descricao: "Em cada semana, a distribuição pedagógica deve colocar primeiro as aulas teóricas, depois as teórico-práticas e só depois as práticas laboratoriais.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "O motor ordena a semana por ciclo pedagógico: T no início da semana, TP a meio e PL no fim." },
    peso: 10,
    ativa: true
  },
  {
    id: "h_eseuc_turnos_por_bloco",
    nome: "Manhã/tarde por turma e bloco",
    tipo: "hard",
    categoria: "Estudantes",
    descricao: "No 1.º semestre, a família da Turma A fica de manhã e a família da Turma B à tarde. No 2.º semestre, a família da Turma A passa para a tarde e a família da Turma B para a manhã, exceto nas primeiras 8 semanas, que mantêm o padrão do 1.º semestre.",
        escopo: "ano",
    anoCurricular: 2,
config: { traducaoSimples: "A app separa Turma A/B e respetivos TP/PL por manhã/tarde conforme o semestre e a exceção das primeiras 8 semanas do 2.º semestre." },
    peso: 10,
    ativa: true
  },

  // Soft Constraints
  {
    id: "s1",
    nome: "Preferência por dar prioridade ao período matinal para turmas de enfermagem iniciais",
    tipo: "soft",
    categoria: "Estudantes",
    descricao: "Procurar agendar as aulas teóricas fundamentais predominantemente na parte da manhã (08:00 às 13:00) para otimizar o foco pedagógico.",
    config: { traducaoSimples: "Penalização automática no score caso a IA posicione aulas de teoria básica a horas tardias." },
    peso: 8,
    ativa: true
  },
  {
    id: "s2",
    nome: "Minimizar tempos livres excessivos (buracos no horário)",
    tipo: "soft",
    categoria: "Estudantes",
    descricao: "Procurar agendar consecutivamente as aulas do mesmo curso letivo, reduzindo os tempos de espera longos entre turmas.",
    config: { traducaoSimples: "O algoritmo agrupa as sessões para reduzir intervalos inúteis a menos de 2 horas." },
    peso: 6,
    ativa: true
  },
  {
    id: "s3",
    nome: "Garantir dias equilibrados sem sobrecarga letiva",
    tipo: "soft",
    categoria: "Estudantes",
    descricao: "Evitar concentrar mais de 6 ou 8 horas de práticas clínicas hospitalares no mesmo dia para salvaguarda física.",
    config: { traducaoSimples: "Garantia de bem-estar dos estudantes, distribuindo a carga de forma homogénea na semana letiva." },
    peso: 5,
    ativa: true
  },
  {
    id: "s4",
    nome: "Distribuir as aulas da mesma disciplina de forma espaçada",
    tipo: "soft",
    categoria: "Estudantes",
    descricao: "Evitar colocar aulas contínuas da mesma unidade curricular (ex: 6 horas de Anatomia seguidas no mesmo dia).",
    config: { traducaoSimples: "A IA distribui as unidades de contacto ao longo dos dias letivos (máximo 4h seguidas)." },
    peso: 4,
    ativa: true
  },
  {
    id: "s5",
    nome: "Facilitar folgas ou tardes livres para Investigação ou Escalas Clínicas do Docente",
    tipo: "soft",
    categoria: "Professor",
    descricao: "Procurar organizar o horário de professores para assegurar pelo menos 1 a 2 tardes livres semanais dedicadas à investigação ou prática clínica externa.",
    config: { traducaoSimples: "Otimização de satisfação do corpo docente mantendo a qualidade letiva intata." },
    peso: 3,
    ativa: false
  }
];

export const sessoesIniciaisV1: any[] = [];

export const sessoesIniciaisV2: any[] = [];

export const versoesIniciais: VersaoHorario[] = [
  {
    id: "v1",
    nome: "2026/27 - 1.º Semestre (por gerar)",
    anoSemestreId: "as1",
    criadaEm: "2026-06-04T00:00:00Z",
    criadaPor: "hugoneves@gmail.com",
    ativa: true,
    score: 0,
    sessoes: []
  },
  {
    id: "v2",
    nome: "2026/27 - 2.º Semestre (por gerar)",
    anoSemestreId: "as2",
    criadaEm: "2026-06-04T00:00:00Z",
    criadaPor: "hugoneves@gmail.com",
    ativa: false,
    score: 0,
    sessoes: []
  }
];
export const solverRunsIniciais: SolverRun[] = [];



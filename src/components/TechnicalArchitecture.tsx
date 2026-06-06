import React, { useState } from "react";
import { Server, Database, Brain, Disc, Shield, Sparkles, CheckCircle } from "lucide-react";

export function TechnicalArchitecture() {
  const [activeTab, setActiveTab] = useState<"infra" | "database" | "solver" | "endpoints">("infra");

  return (
    <div className="bg-white rounded-2xl p-8 border border-gray-150/80 shadow-xs space-y-6">
      <div className="border-b border-gray-100 pb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-full font-serif text-2xs font-semibold tracking-wide">
            Arquitetura Simplificada
          </span>
          <span className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-full font-serif text-2xs font-semibold tracking-wide">
            100% Livre de Códigos
          </span>
        </div>
        <h2 className="text-2xl font-serif font-semibold text-stone-900 tracking-tight">
          Como funciona a nossa tecnologia inteligente?
        </h2>
        <p className="text-sm text-stone-500 mt-1.5 leading-relaxed">
          Tornámos o processo de agendamento universitário extremamente avançado, ocultando toda a complexidade técnica. Veja o que corre por trás das suas decisões em tempo real.
        </p>
      </div>

      {/* Tabs navigation */}
      <div className="flex flex-wrap gap-2 border-b border-gray-150 pb-4">
        {[
          { id: "infra", label: "O Fluxo da Informação", icon: Server },
          { id: "database", label: "Base de Dados Segura & Protegida", icon: Database },
          { id: "solver", label: "A Magia da Organização Automática", icon: Disc },
          { id: "endpoints", label: "Serviço Académico Blindado", icon: Shield }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                isActive
                  ? "bg-stone-900 text-white shadow-xs"
                  : "bg-stone-100/60 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Cloud Architecture Diagram for Non-Tech */}
      {activeTab === "infra" && (
        <div className="space-y-6 animate-fade-in text-xs leading-relaxed">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-stone-50/70 p-6 rounded-2xl border border-stone-200/50">
            <div className="flex flex-col items-center text-center p-5 bg-white rounded-xl border border-stone-150 shadow-3xs space-y-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 uppercase tracking-wider">Passo 1</span>
              <Sparkles className="w-8 h-8 text-amber-600" />
              <div className="font-serif font-bold text-sm text-stone-900">Seu Pedido em Texto Livre</div>
              <p className="text-stone-500">Escreve em português simples as preferências sem SQL ou programação.</p>
            </div>
            
            <div className="flex flex-col items-center text-center p-5 bg-white rounded-xl border border-stone-150 shadow-3xs space-y-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 uppercase tracking-wider">Passo 2</span>
              <Brain className="w-8 h-8 text-indigo-600" />
              <div className="font-serif font-bold text-sm text-stone-900">A Inteligência Gemini</div>
              <p className="text-stone-500">A nossa inteligência interpreta o que escreveu, planeia o horário e descobre regras de forma automática.</p>
            </div>

            <div className="flex flex-col items-center text-center p-5 bg-white rounded-xl border border-stone-150 shadow-3xs space-y-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 uppercase tracking-wider">Passo 3</span>
              <CheckCircle className="w-8 h-8 text-emerald-600" />
              <div className="font-serif font-bold text-sm text-stone-900">O Gerador de Horários</div>
              <p className="text-stone-500">Os nossos servidores de alta velocidade resolvem o quebra-cabeças e criam o horário ideal sem erros.</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-serif font-bold text-stone-900 text-sm">Garantias do nosso ecossistema</h3>
            <p className="text-xs text-stone-600 leading-relaxed">
              O sistema foi construído para que qualquer coordenador de curso consiga utilizá-lo sem ter de aprender programação. Quando altera um professor, move uma aula ou escreve no Chat, os servidores gravam o estado tudo de forma segura e imediata.
            </p>
          </div>
        </div>
      )}

      {/* Tab 2: Database and Security */}
      {activeTab === "database" && (
        <div className="space-y-6 animate-fade-in text-xs leading-relaxed">
          <div className="bg-stone-50/70 p-5 rounded-xl border border-stone-200/50 space-y-3">
            <h3 className="font-serif font-bold text-stone-900 text-sm">Base de dados segura em Cloud Cloud SQL</h3>
            <p className="text-stone-600">
              Todas as informações sobre os seus docentes, salas letivas, regras e versões de horários são salvas num cofre digital de alta fiabilidade. 
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="bg-white p-4 rounded-xl border border-stone-150 space-y-2">
                <span className="font-bold text-stone-900 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-emerald-600" />
                  Preservação Permanente
                </span>
                <p className="text-stone-500">
                  Os seus dados nunca desaparecem ao fechar a janela ou mudar de telemóvel. Tudo fica blindado e sincronizado com cópias de segurança automáticas.
                </p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-stone-150 space-y-2">
                <span className="font-bold text-stone-900 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  Privacidade Universitária
                </span>
                <p className="text-stone-500">
                  Os emails dos docentes e detalhes das salas são codificados e encriptados, assegurando conformidade estrita com as políticas digitais de proteção de dados.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Automatic AI translation instead of Raw Code */}
      {activeTab === "solver" && (
        <div className="space-y-6 animate-fade-in text-xs leading-relaxed">
          <div className="bg-stone-50/70 p-5 rounded-xl border border-stone-200/50 space-y-4">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <span className="font-serif font-bold text-sm text-stone-900">Como funciona a inteligência artificial para o agendamento?</span>
            </div>
            
            <p className="text-stone-600">
              Ao contrário dos sistemas antigos onde tinha de saber programar ou preencher fórmulas de Excel confusas, aqui usamos inteligência de linguagem natural (desenvolvida com a tecnologia Google Gemini) para traduzir o que quer.
            </p>

            <div className="bg-white p-4 rounded-xl border border-stone-150 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="font-bold text-stone-800">A tradução inteligente em 3 etapas:</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-stone-500 text-[11px] leading-relaxed">
                <div>
                  <h5 className="font-bold text-stone-800">1. Audição do Pedido</h5>
                  <p>A IA ouve o seu texto natural como se estivesse a falar com um assistente humano ao telefone.</p>
                </div>
                <div>
                  <h5 className="font-bold text-stone-800">2. Estruturação Sem Esforço</h5>
                  <p>A IA cria as restrições matemáticas correspondentes de forma transparente, isolando-o de parâmetros enfadonhos.</p>
                </div>
                <div>
                  <h5 className="font-bold text-stone-800">3. Solução Ótima</h5>
                  <p>O gerador de horários calcula todas as possibilidades num piscar de olhos e reposiciona as aulas.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Blindado */}
      {activeTab === "endpoints" && (
        <div className="p-5 bg-stone-50/70 rounded-xl border border-stone-200/50 space-y-3 text-stone-600">
          <h4 className="font-serif font-bold text-stone-900 text-sm">Serviço Universitário 100% Protegido</h4>
          <p className="text-xs">
            Esta aplicação comunica diretamente com servidores encriptados de alta segurança. Cada ação que faz é auditada e autenticada individualmente para impedir que pessoas não autorizadas acorram ou modifiquem os mapas letivos da universidade.
          </p>
          <div className="bg-white p-4 rounded-xl border border-stone-150 space-y-1 text-stone-500">
            <strong>Garantia de Confiança:</strong>
            <p>Se as regras propostas gerarem alguma impossibilidade matemática, o próprio assistente deteta o problema e explica-lhe em português claro exatamente o que está errado para que o consiga corrigir instantaneamente.</p>
          </div>
        </div>
      )}
    </div>
  );
}

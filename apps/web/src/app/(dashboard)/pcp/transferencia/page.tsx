'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { transferenciaApi, TransferenciaResponse, TransferenciaGrupo } from '@/lib/pcpApi';
import { pcpConfigApi } from '@/lib/api';

const RELATORIO = 'gestao_transferencia';

export default function TransferenciaPage() {
  const { token } = useAuth();
  const { showToast } = useToast();

  const [referencia, setReferencia] = useState('');
  const [agruparPorCor, setAgruparPorCor] = useState(true);
  const [dados, setDados] = useState<TransferenciaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Filtros de legenda
  const [mostrarVerde, setMostrarVerde] = useState(true);
  const [mostrarAmarelo, setMostrarAmarelo] = useState(true);
  const [mostrarVermelho, setMostrarVermelho] = useState(true);

  // Thresholds de cobertura
  const [limiteVerde, setLimiteVerde] = useState(75);
  const [limiteAmarelo, setLimiteAmarelo] = useState(120);

  // Carregar configuração de thresholds e dados iniciais
  useEffect(() => {
    async function loadConfigAndData() {
      if (!token) return;
      try {
        const configRes = await pcpConfigApi.getTransferenciaConfig(token, RELATORIO);
        setLimiteVerde(configRes.config.transferenciaCoberturaDiasVerde);
        setLimiteAmarelo(configRes.config.transferenciaCoberturaDiasAmarelo);

        // Carregar todas as referências automaticamente
        setIsLoading(true);
        const resultado = await transferenciaApi.getTransferencia(token, '', agruparPorCor);
        setDados(resultado);
      } catch (error) {
        console.error('Erro ao carregar dados iniciais:', error);
        showToast('Erro ao carregar dados', 'error');
      } finally {
        setIsLoading(false);
      }
    }
    loadConfigAndData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, agruparPorCor]);

  const buscar = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      // Se referência vazia, busca todas
      const resultado = await transferenciaApi.getTransferencia(token, referencia.trim(), agruparPorCor);
      setDados(resultado);

      if (resultado.grupos.length === 0) {
        showToast('Nenhum estoque encontrado', 'info');
      }
    } catch (error) {
      showToast('Erro ao buscar dados de transferencia', 'error');
      console.error(error);
      setDados(null);
    } finally {
      setIsLoading(false);
    }
  }, [token, referencia, agruparPorCor, showToast]);

  function getCorLegenda(cobertura: number): 'verde' | 'amarelo' | 'vermelho' | null {
    // Se cobertura é 0 ou inválida, não colorir
    if (!cobertura || cobertura === 0 || !Number.isFinite(cobertura)) return null;
    // Cobertura muito alta (sem vendas) = vermelho
    if (cobertura >= 9999) return 'vermelho';
    if (cobertura < limiteVerde) return 'verde';
    if (cobertura < limiteAmarelo) return 'amarelo';
    return 'vermelho';
  }

  function getBgClass(cor: 'verde' | 'amarelo' | 'vermelho' | null): string {
    if (!cor) return '';
    if (cor === 'verde') return 'bg-green-100';
    if (cor === 'amarelo') return 'bg-yellow-100';
    return 'bg-red-100';
  }

  function grupoDeveMostrar(grupo: TransferenciaGrupo): boolean {
    // Se todos os filtros estão ativos, mostrar tudo
    if (mostrarVerde && mostrarAmarelo && mostrarVermelho) return true;

    // Checar se o grupo tem pelo menos uma célula com a cor selecionada
    for (const loja of grupo.lojas) {
      for (const tamanho of grupo.tamanhos) {
        const cobertura = loja.coberturaPorTamanho[tamanho];
        if (cobertura === undefined || cobertura === null) continue;

        const cor = getCorLegenda(cobertura);
        if (!cor) continue;

        if ((cor === 'verde' && mostrarVerde) ||
            (cor === 'amarelo' && mostrarAmarelo) ||
            (cor === 'vermelho' && mostrarVermelho)) {
          return true;
        }
      }
    }
    return false;
  }

  // Renderiza matriz com estrutura: Ref > Empresa > Cor
  function renderMatriz() {
    if (!dados || dados.grupos.length === 0) return null;

    const gruposFiltrados = dados.grupos.filter(grupoDeveMostrar);
    if (gruposFiltrados.length === 0) return null;

    // Coletar todos os tamanhos únicos de todos os grupos
    const todosOsTamanhos = new Set<string>();
    gruposFiltrados.forEach((grupo) => {
      grupo.tamanhos.forEach((t) => todosOsTamanhos.add(t));
    });

    // Ordenar tamanhos
    const tamanhosOrdenados = Array.from(todosOsTamanhos).sort((a, b) => {
      const ordemPadrao = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'EG'];
      const aIdx = ordemPadrao.indexOf(a.toUpperCase());
      const bIdx = ordemPadrao.indexOf(b.toUpperCase());

      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;

      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;

      return a.localeCompare(b);
    });

    // Criar estrutura de linhas: cada linha é uma combinação (ref, loja, cor)
    interface LinhaMatriz {
      referencia: string;
      empresa: string;
      cor: string;
      branchCode: number;
      dados: Record<string, { qtd: number; cor: 'verde' | 'amarelo' | 'vermelho' | null }>;
    }

    const linhas: LinhaMatriz[] = [];

    gruposFiltrados.forEach((grupo) => {
      grupo.lojas.forEach((loja) => {
        const dadosPorTamanho: Record<string, { qtd: number; cor: 'verde' | 'amarelo' | 'vermelho' | null }> = {};

        tamanhosOrdenados.forEach((tamanho) => {
          const qtd = loja.estoquePorTamanho[tamanho] || 0;
          const cobertura = loja.coberturaPorTamanho[tamanho] || 0;
          const cor = getCorLegenda(cobertura);

          dadosPorTamanho[tamanho] = { qtd, cor };
        });

        linhas.push({
          referencia: grupo.referencia,
          empresa: loja.branchName,
          cor: grupo.cor || 'Total',
          branchCode: loja.branchCode,
          dados: dadosPorTamanho,
        });
      });
    });

    // Ordenar linhas por referência, depois empresa (branch_code), depois cor
    linhas.sort((a, b) => {
      if (a.referencia !== b.referencia) return a.referencia.localeCompare(b.referencia);
      if (a.branchCode !== b.branchCode) return a.branchCode - b.branchCode;
      return a.cor.localeCompare(b.cor);
    });

    return (
      <Card>
        <div className="overflow-x-auto">
          <Table tableClassName="text-xs">
            <TableHead>
              <TableRow>
                <TableCell isHeader className="sticky left-0 bg-white z-10 min-w-[80px]">REF</TableCell>
                <TableCell isHeader className="sticky left-[80px] bg-white z-10 min-w-[120px]">EMPRESA</TableCell>
                <TableCell isHeader className="sticky left-[200px] bg-white z-10 min-w-[100px]">COR</TableCell>
                {tamanhosOrdenados.map((tamanho) => (
                  <TableCell key={tamanho} isHeader align="center" className="min-w-[60px]">
                    {tamanho}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {linhas.map((linha, index) => (
                <TableRow key={index}>
                  <TableCell className="sticky left-0 bg-white font-medium">{linha.referencia}</TableCell>
                  <TableCell className="sticky left-[80px] bg-white">{linha.empresa}</TableCell>
                  <TableCell className="sticky left-[200px] bg-white">{linha.cor}</TableCell>
                  {tamanhosOrdenados.map((tamanho) => {
                    const { qtd, cor } = linha.dados[tamanho] || { qtd: 0, cor: null };
                    const bgClass = getBgClass(cor);

                    return (
                      <TableCell
                        key={tamanho}
                        align="center"
                        className={`${bgClass} ${qtd === 0 ? 'text-gray-300' : ''}`}
                      >
                        {qtd > 0 ? qtd : '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">PCP</p>
        <h1 className="text-2xl font-bold text-gray-900">Gestao de Transferencia</h1>
        <p className="text-gray-500 text-sm mt-1">
          Visualize a distribuicao de estoque por loja e tamanho para facilitar transferencias entre filiais.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-4 items-end">
          <Input
            label="Referencia (opcional)"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') buscar();
            }}
            placeholder="Deixe em branco para ver todas"
            className="w-64"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={agruparPorCor}
              onChange={(e) => setAgruparPorCor(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">Separar por cor</span>
          </label>
          <Button onClick={buscar} isLoading={isLoading}>
            {referencia.trim() ? 'Filtrar' : 'Atualizar'}
          </Button>
          {referencia.trim() && (
            <Button
              onClick={async () => {
                setReferencia('');
                setIsLoading(true);
                try {
                  const resultado = await transferenciaApi.getTransferencia(token, '', agruparPorCor);
                  setDados(resultado);
                } catch (error) {
                  showToast('Erro ao carregar dados', 'error');
                } finally {
                  setIsLoading(false);
                }
              }}
              variant="secondary"
              disabled={isLoading}
            >
              Limpar Filtro
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {agruparPorCor
            ? 'Com "Separar por cor" marcado, cada cor sera exibida em uma tabela separada.'
            : 'Com "Separar por cor" desmarcado, todas as cores serao somadas em uma unica tabela.'}
        </p>

        {dados && dados.grupos.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-gray-700 mb-2">Filtrar por cobertura:</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mostrarVerde}
                  onChange={(e) => setMostrarVerde(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="inline-block w-4 h-4 bg-green-100 border border-green-300 rounded"></span>
                <span className="text-sm text-gray-700">Verde (&lt; {limiteVerde} dias)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mostrarAmarelo}
                  onChange={(e) => setMostrarAmarelo(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="inline-block w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></span>
                <span className="text-sm text-gray-700">Amarelo ({limiteVerde}-{limiteAmarelo} dias)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mostrarVermelho}
                  onChange={(e) => setMostrarVermelho(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="inline-block w-4 h-4 bg-red-100 border border-red-300 rounded"></span>
                <span className="text-sm text-gray-700">Vermelho (&gt; {limiteAmarelo} dias)</span>
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Mostrando apenas referencias que contenham pelo menos uma celula com as cores selecionadas.
            </p>
          </div>
        )}
      </Card>

      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm text-gray-600">Carregando dados de transferencia...</span>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && renderMatriz()}

      {!isLoading && dados && dados.grupos.length > 0 && dados.grupos.filter(grupoDeveMostrar).length === 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <p className="text-sm text-yellow-700">
            Nenhuma referencia encontrada com as cores de cobertura selecionadas.
            Experimente marcar mais opcoes no filtro acima.
          </p>
        </Card>
      )}

      {!isLoading && dados && dados.grupos.length === 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <p className="text-sm text-yellow-700">
            Nenhum estoque encontrado para a referencia &quot;{referencia}&quot;.
          </p>
        </Card>
      )}
    </div>
  );
}

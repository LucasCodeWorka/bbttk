'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { raioXApi, RaioXFiltro, RaioXResponse, RaioXProdutoSearch } from '@/lib/pcpApi';
import { Card } from '@/components/ui/Card';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';

export default function RaioXPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RaioXResponse | null>(null);

  // Busca de produtos
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<RaioXProdutoSearch[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<RaioXProdutoSearch[]>([]);
  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filtros
  const hoje = new Date().toISOString().split('T')[0];
  const primeiroDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [filtro, setFiltro] = useState<RaioXFiltro>({
    dataInicio: primeiroDiaMes,
    dataFim: hoje,
    canal: 'todos',
    visao: 'analitico',
    agruparPorCor: false,
  });

  const buscarProdutos = async (search: string = '') => {
    if (!token) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await raioXApi.buscarProdutos(token, search, 20);
      setSearchResults(results);
      setShowDropdown(true);
    } catch (err) {
      console.error('Erro ao buscar produtos:', err);
      setSearchResults([]);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        buscarProdutos(value);
      }, 300);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  const adicionarProduto = (produto: RaioXProdutoSearch) => {
    if (!selectedProducts.find((p) => p.reference_code === produto.reference_code)) {
      setSelectedProducts([...selectedProducts, produto]);
    }
    setSearchTerm('');
    setShowDropdown(false);
    setSearchResults([]);
  };

  const removerProduto = (referenceCode: string) => {
    setSelectedProducts(selectedProducts.filter((p) => p.reference_code !== referenceCode));
  };

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const buscarDados = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const filtroComProdutos = {
        ...filtro,
        referencias: selectedProducts.length > 0 ? selectedProducts.map((p) => p.reference_code) : undefined,
      };
      const resultado = await raioXApi.getRaioX(token, filtroComProdutos);
      setData(resultado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar dados');
    } finally {
      setLoading(false);
    }
  };

  const formatarNumero = (valor: number): string => {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(valor);
  };

  const formatarCobertura = (cobertura: number): string => {
    if (cobertura >= 999) return '∞';
    return cobertura.toFixed(1);
  };

  const getCorCobertura = (cobertura: number, config: RaioXResponse['config']): string => {
    if (cobertura >= 999) return '';
    if (cobertura <= config.coberturaLimiteVerde) return 'bg-green-100 text-green-800';
    if (cobertura >= config.coberturaLimiteVermelho) return 'bg-red-100 text-red-800';
    return '';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Raio X do Produto</h1>
      </div>

      {/* Aviso sobre dados de produção */}
      <Card className="bg-blue-50 border-blue-200">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">Informação</p>
            <p className="text-sm text-blue-800 mt-1">
              Os dados de <strong>Peças em Produção</strong> ainda não estão disponíveis. O relatório exibe apenas Estoque, Transferências, Vendas e Cobertura.
            </p>
          </div>
        </div>
      </Card>

      {/* Filtros */}
      <Card>
        {/* Busca de Produtos */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Produtos</label>

          <div className="flex gap-2 mb-2">
            <div ref={dropdownRef} className="relative flex-1">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0) {
                    setShowDropdown(true);
                  } else if (!searchTerm.trim()) {
                    // Se clicar sem ter digitado nada, busca lista inicial
                    buscarProdutos('');
                  }
                }}
                onClick={() => {
                  if (!showDropdown && searchResults.length > 0) {
                    setShowDropdown(true);
                  }
                }}
                placeholder="Digite código ou nome do produto..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />

              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {searchResults.map((produto) => (
                    <button
                      key={produto.reference_code}
                      type="button"
                      onClick={() => adicionarProduto(produto)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">{produto.reference_code}</div>
                      <div className="text-xs text-gray-600">{produto.reference_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selectedProducts.length > 0 && (
            <div className="border border-gray-200 rounded-lg bg-gray-50 max-h-40 overflow-y-auto">
              {selectedProducts.map((produto) => (
                <div
                  key={produto.reference_code}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-200 last:border-b-0 hover:bg-gray-100"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{produto.reference_code}</div>
                    <div className="text-xs text-gray-600">{produto.reference_name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removerProduto(produto.reference_code)}
                    className="ml-2 text-gray-400 hover:text-red-600"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Início</label>
            <input
              type="date"
              value={filtro.dataInicio}
              onChange={(e) => setFiltro({ ...filtro, dataInicio: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data Fim</label>
            <input
              type="date"
              value={filtro.dataFim}
              onChange={(e) => setFiltro({ ...filtro, dataFim: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Canal</label>
            <select
              value={filtro.canal}
              onChange={(e) => setFiltro({ ...filtro, canal: e.target.value as 'varejo' | 'atacado' | 'todos' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="todos">Todos</option>
              <option value="varejo">Varejo</option>
              <option value="atacado">Atacado</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Visão</label>
            <select
              value={filtro.visao}
              onChange={(e) => setFiltro({ ...filtro, visao: e.target.value as 'sintetico' | 'analitico' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="analitico">Analítico</option>
              <option value="sintetico">Sintético</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filtro.agruparPorCor || false}
                onChange={(e) => setFiltro({ ...filtro, agruparPorCor: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded"
              />
              <span className="text-sm font-medium text-gray-700">Agrupar por Cor</span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={buscarDados}
            disabled={loading || selectedProducts.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
          {selectedProducts.length === 0 && (
            <span className="text-sm text-gray-500 self-center">Selecione pelo menos um produto</span>
          )}
        </div>
      </Card>

      {/* Erro */}
      {error && (
        <Card className="bg-red-50 border-red-200">
          <p className="text-red-800 text-sm">{error}</p>
        </Card>
      )}

      {/* Resultados */}
      {data && data.produtos.length > 0 && (
        <div className="space-y-6">
          {data.produtos.map((produto, idx) => (
            <Card key={idx}>
              <div className="mb-4 flex items-center gap-3">
                <h3 className="text-lg font-bold text-gray-900">
                  {produto.referenceCode} - {produto.referenceName}
                  {produto.cor && <span className="text-gray-600 ml-2">({produto.cor})</span>}
                </h3>
                {produto.emPromocao && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    PROMOÇÃO
                  </span>
                )}
              </div>

              {produto.lojas.map((loja) => {
                // Extrair todos os tamanhos disponíveis nesta loja
                const tamanhos = loja.grades.map(g => g.tamanho);

                // Criar um mapa para acesso rápido aos dados de cada tamanho
                const gradesPorTamanho = new Map(
                  loja.grades.map(g => [g.tamanho, g])
                );

                return (
                  <div key={loja.branchCode} className="mb-6">
                    <h4 className="text-md font-semibold text-gray-800 mb-2">
                      {loja.branchName}
                    </h4>

                    {filtro.visao === 'analitico' ? (
                      // MODO ANALÍTICO: mostra todos os tamanhos
                      <Table className="mb-4">
                        <TableHead>
                          <TableRow>
                            <TableCell isHeader>MÉTRICA</TableCell>
                            {tamanhos.map((tamanho) => (
                              <TableCell key={tamanho} isHeader align="right">
                                {tamanho}
                              </TableCell>
                            ))}
                            <TableCell isHeader align="right">TOTAL</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {/* Linha: Estoque Inicial */}
                          <TableRow>
                            <TableCell className="font-medium">ESTOQUE INICIAL</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell key={tamanho} align="right">
                                  {grade ? formatarNumero(grade.estoqueInicial) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" className="font-semibold bg-gray-50">
                              {formatarNumero(loja.totais.estoqueInicial)}
                            </TableCell>
                          </TableRow>

                          {/* Linha: Transferências */}
                          <TableRow>
                            <TableCell className="font-medium">TRANSFERÊNCIAS</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell key={tamanho} align="right">
                                  {grade ? formatarNumero(grade.transferencias) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" className="font-semibold bg-gray-50">
                              {formatarNumero(loja.totais.transferencias)}
                            </TableCell>
                          </TableRow>

                          {/* Linha: Vendas Varejo */}
                          <TableRow>
                            <TableCell className="font-medium">V. VAREJO</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell key={tamanho} align="right">
                                  {grade ? formatarNumero(grade.vendasVarejo) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" className="font-semibold bg-gray-50">
                              {formatarNumero(loja.totais.vendasVarejo)}
                            </TableCell>
                          </TableRow>

                          {/* Linha: Vendas Atacado */}
                          <TableRow>
                            <TableCell className="font-medium">V. ATACADO</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell key={tamanho} align="right">
                                  {grade ? formatarNumero(grade.vendasAtacado) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" className="font-semibold bg-gray-50">
                              {formatarNumero(loja.totais.vendasAtacado)}
                            </TableCell>
                          </TableRow>

                          {/* Linha: Estoque Final */}
                          <TableRow>
                            <TableCell className="font-medium">ESTOQUE FINAL</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell key={tamanho} align="right">
                                  {grade ? formatarNumero(grade.estoqueFinal) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell align="right" className="font-semibold bg-gray-50">
                              {formatarNumero(loja.totais.estoqueFinal)}
                            </TableCell>
                          </TableRow>

                          {/* Linha: Cobertura */}
                          <TableRow>
                            <TableCell className="font-medium">COBERTURA</TableCell>
                            {tamanhos.map((tamanho) => {
                              const grade = gradesPorTamanho.get(tamanho);
                              return (
                                <TableCell
                                  key={tamanho}
                                  align="right"
                                  className={grade ? getCorCobertura(grade.cobertura, data.config) : ''}
                                >
                                  {grade ? formatarCobertura(grade.cobertura) : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell
                              align="right"
                              className={`font-semibold bg-gray-50 ${getCorCobertura(loja.totais.cobertura, data.config)}`}
                            >
                              {formatarCobertura(loja.totais.cobertura)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    ) : (
                      // MODO SINTÉTICO: mostra apenas totais
                      <Table className="mb-4">
                        <TableHead>
                          <TableRow>
                            <TableCell isHeader>MÉTRICA</TableCell>
                            <TableCell isHeader align="right">VALOR</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">ESTOQUE INICIAL</TableCell>
                            <TableCell align="right">{formatarNumero(loja.totais.estoqueInicial)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">TRANSFERÊNCIAS</TableCell>
                            <TableCell align="right">{formatarNumero(loja.totais.transferencias)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">V. VAREJO</TableCell>
                            <TableCell align="right">{formatarNumero(loja.totais.vendasVarejo)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">V. ATACADO</TableCell>
                            <TableCell align="right">{formatarNumero(loja.totais.vendasAtacado)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">ESTOQUE FINAL</TableCell>
                            <TableCell align="right">{formatarNumero(loja.totais.estoqueFinal)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">COBERTURA</TableCell>
                            <TableCell align="right" className={getCorCobertura(loja.totais.cobertura, data.config)}>
                              {formatarCobertura(loja.totais.cobertura)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </div>
                );
              })}

              {/* Total Geral do Produto */}
              <div className="border-t pt-4">
                <h4 className="text-md font-bold text-gray-900 mb-2">TOTAL GERAL</h4>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell isHeader>Métrica</TableCell>
                      <TableCell isHeader align="right">Estoque Inicial</TableCell>
                      <TableCell isHeader align="right">Transferências</TableCell>
                      <TableCell isHeader align="right">V. Varejo</TableCell>
                      <TableCell isHeader align="right">V. Atacado</TableCell>
                      <TableCell isHeader align="right">Estoque Final</TableCell>
                      <TableCell isHeader align="right">Cobertura</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow className="bg-yellow-50 font-bold">
                      <TableCell>GERAL</TableCell>
                      <TableCell align="right">{formatarNumero(produto.totalGeral.estoqueInicial)}</TableCell>
                      <TableCell align="right">{formatarNumero(produto.totalGeral.transferencias)}</TableCell>
                      <TableCell align="right">{formatarNumero(produto.totalGeral.vendasVarejo)}</TableCell>
                      <TableCell align="right">{formatarNumero(produto.totalGeral.vendasAtacado)}</TableCell>
                      <TableCell align="right">{formatarNumero(produto.totalGeral.estoqueFinal)}</TableCell>
                      <TableCell
                        align="right"
                        className={getCorCobertura(produto.totalGeral.cobertura, data.config)}
                      >
                        {formatarCobertura(produto.totalGeral.cobertura)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {data && data.produtos.length === 0 && !loading && (
        <Card>
          <p className="text-gray-600 text-center py-8">Nenhum produto encontrado para os filtros selecionados.</p>
        </Card>
      )}
    </div>
  );
}

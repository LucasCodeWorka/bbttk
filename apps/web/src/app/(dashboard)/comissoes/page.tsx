'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { FilialMultiSelect } from '@/components/ui/FilialMultiSelect';
import { metasApi, ComissoesResponse } from '@/lib/api';
import { formatMoney, FILIAIS, MESES } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export default function ComissoesPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState<number[]>([]);
  const [dados, setDados] = useState<ComissoesResponse | null>(null);

  const carregarDados = useCallback(async () => {
    setIsLoading(true);
    try {
      const branchCodes = filiaisSelecionadas.length > 0 ? filiaisSelecionadas : undefined;
      const res = await metasApi.getComissoes(ano, mes, branchCodes);
      setDados(res);
    } catch (error) {
      console.error('Erro ao carregar comissoes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ano, mes, filiaisSelecionadas]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filiaisDisponiveis = Object.entries(FILIAIS)
    .filter(([code]) => {
      if (user?.role === 'admin') return true;
      return user?.branchCodes.includes(parseInt(code));
    })
    .map(([code, name]) => ({ value: parseInt(code), label: name }));

  const anoOptions = Array.from({ length: 4 }, (_, i) => {
    const year = new Date().getFullYear() + 1 - i;
    return { value: year, label: String(year) };
  });
  const mesOptions = MESES.slice(1).map((m, i) => ({ value: i + 1, label: m }));

  const niveis = dados?.niveis || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comissoes</h1>
          <p className="text-gray-500 text-sm mt-1">
            {MESES[mes]} de {ano}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Select
            value={ano}
            onChange={(e) => setAno(parseInt(e.target.value))}
            options={anoOptions}
            label="Ano"
            className="w-24"
          />
          <Select
            value={mes}
            onChange={(e) => setMes(parseInt(e.target.value))}
            options={mesOptions}
            label="Mes"
            className="w-32"
          />
          <FilialMultiSelect
            selected={filiaisSelecionadas}
            onChange={setFiliaisSelecionadas}
            options={filiaisDisponiveis}
            label="Filial"
            className="w-52"
          />
          <Button onClick={carregarDados} isLoading={isLoading}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* Realizado vs Meta + Canal + Top3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-[var(--bbtk-red)]">
          <CardTitle>Realizado vs Meta</CardTitle>
          <div className="mt-2">
            <p className="text-2xl font-bold text-gray-900">
              {formatMoney(dados?.resumo.realizado || 0)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Meta: {formatMoney(dados?.resumo.meta || 0)}
            </p>
            <div className="mt-2">
              <Badge variant={(dados?.resumo.resultado_pct || 0) >= 100 ? 'success' : 'warning'}>
                Resultado: {(dados?.resumo.resultado_pct || 0).toFixed(1)}%
              </Badge>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Canal</CardTitle>
          <div className="mt-2 space-y-2">
            {(dados?.canal || []).map((c) => (
              <div key={c.canal} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                <span className="font-medium text-gray-700">{c.nome}</span>
                <div className="text-right">
                  <p className="font-semibold">{formatMoney(c.faturamento)}</p>
                  <p className="text-xs text-gray-500">{c.pct_meta.toFixed(1)}% da meta</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Faturamento Top3</CardTitle>
          <div className="mt-2 space-y-2">
            {(dados?.top3 || []).map((v, i) => (
              <div key={v.seller_code} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                <span className="flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white ${
                    i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-400'
                  }`}>
                    {i + 1}
                  </span>
                  <span className="truncate max-w-[140px]" title={v.seller_name}>{v.seller_name}</span>
                </span>
                <span className="font-semibold">{formatMoney(v.faturamento)}</span>
              </div>
            ))}
            {(!dados || dados.top3.length === 0) && (
              <p className="text-sm text-gray-400">Sem dados</p>
            )}
          </div>
        </Card>
      </div>

      {/* Tabela de vendedores */}
      <Card>
        <CardHeader>
          <CardTitle>Analise Geral (Realizado vs Meta por Vendedor)</CardTitle>
        </CardHeader>
        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Carregando...</div>
        ) : !dados || dados.vendedores.length === 0 ? (
          <div className="py-10 text-center text-gray-500">Nenhum vendedor com vendas nesse periodo</div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell isHeader>#</TableCell>
                <TableCell isHeader>Vendedor</TableCell>
                <TableCell isHeader align="right">Faturamento</TableCell>
                {niveis.map((n) => (
                  <TableCell key={n.nivel_ordem} isHeader align="right" className="whitespace-nowrap">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                      style={{ backgroundColor: n.nivel_cor }}
                    />
                    {n.nivel_nome}
                  </TableCell>
                ))}
                <TableCell isHeader align="center">Resultado</TableCell>
                <TableCell isHeader align="center">% Comissao</TableCell>
                <TableCell isHeader align="right">Comissao</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dados.vendedores.map((v, i) => {
                const nivelInfo = niveis.find((n) => n.nivel_ordem === v.nivel_atingido);
                return (
                  <TableRow key={v.seller_code}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{v.seller_name}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap">{formatMoney(v.faturamento)}</TableCell>
                    {niveis.map((n) => {
                      const alvo = v[`nivel_${n.nivel_ordem}` as keyof typeof v] as number;
                      const atingiu = v.nivel_atingido >= n.nivel_ordem && alvo > 0;
                      return (
                        <TableCell
                          key={n.nivel_ordem}
                          align="right"
                          className={`whitespace-nowrap ${atingiu ? 'font-semibold' : 'text-gray-400'}`}
                        >
                          {alvo > 0 ? formatMoney(alvo) : '-'}
                        </TableCell>
                      );
                    })}
                    <TableCell align="center" className="whitespace-nowrap">
                      {nivelInfo ? (
                        <Badge
                          className="text-white"
                          style={{ backgroundColor: nivelInfo.nivel_cor }}
                          variant="default"
                        >
                          {nivelInfo.nivel_nome} ({v.resultado_pct.toFixed(1)}%)
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">{v.resultado_pct.toFixed(1)}%</span>
                      )}
                    </TableCell>
                    <TableCell align="center" className="whitespace-nowrap">{v.comissao_pct.toFixed(1)}%</TableCell>
                    <TableCell align="right" className="whitespace-nowrap font-semibold">
                      {formatMoney(v.comissao_valor)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {dados.vendedores.length > 0 && (
              <tfoot>
                <TableRow isHighlighted>
                  <TableCell className="font-bold" colSpan={2}>TOTAL</TableCell>
                  <TableCell align="right" className="font-bold whitespace-nowrap">
                    {formatMoney(dados.vendedores.reduce((s, v) => s + v.faturamento, 0))}
                  </TableCell>
                  {niveis.map((n) => (
                    <TableCell key={n.nivel_ordem} />
                  ))}
                  <TableCell align="center">-</TableCell>
                  <TableCell align="center">-</TableCell>
                  <TableCell align="right" className="font-bold whitespace-nowrap">
                    {formatMoney(dados.vendedores.reduce((s, v) => s + v.comissao_valor, 0))}
                  </TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </div>
  );
}

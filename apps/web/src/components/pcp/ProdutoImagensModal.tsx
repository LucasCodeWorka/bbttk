'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { produtosApi, ProdutoImagensResponse } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

export interface GradeProdutoImagem {
  sku: string;
  codigo: number | null;
  cor: string;
  tamanho: string;
}

export function ProdutoImagensModal({ referencia, grades, skuInicial, onClose }: {
  referencia: string; grades: GradeProdutoImagem[]; skuInicial: string; onClose: () => void;
}) {
  const { token } = useAuth();
  const [sku, setSku] = useState(skuInicial);
  const [resposta, setResposta] = useState<ProdutoImagensResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [indice, setIndice] = useState(0);
  const [falhaImagem, setFalhaImagem] = useState(false);
  const grade = grades.find(item => item.sku === sku) || grades[0];
  const codigo = grade?.codigo;
  const imagens = resposta?.productCode === codigo ? resposta.images : [];
  const imagem = imagens[indice];

  useEffect(() => {
    const controller = new AbortController();
    setResposta(null);
    setErro(null);
    setIndice(0);
    setCarregando(true);
    if (!codigo || !token) {
      setErro(!codigo ? 'Código do produto indisponível para esta grade.' : 'Entre novamente para consultar as fotos.');
      setCarregando(false);
      return () => controller.abort();
    }
    produtosApi.getImagens(token, codigo, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResposta(data); })
      .catch(error => {
        if (!controller.signal.aborted) setErro(error instanceof Error ? error.message : 'Não foi possível carregar as fotos.');
      })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [codigo, token, tentativa]);

  useEffect(() => { setFalhaImagem(false); }, [imagem]);

  return (
    <Modal isOpen onClose={onClose} title={`Fotos — ${referencia}`} size="lg">
      <Select label="Grade (cor / tamanho)" value={grade?.sku || ''}
        onChange={event => setSku(event.target.value)}
        options={grades.map(item => ({ value: item.sku, label: `${item.cor} / ${item.tamanho} · SKU ${item.sku}` }))} />
      <p className="mt-2 text-xs text-gray-500">Imagens cadastradas no TOTVS · Código {codigo || '—'}</p>

      {carregando ? (
        <p role="status" className="py-16 text-center text-sm text-gray-500">Carregando fotos...</p>
      ) : erro ? (
        <div role="alert" className="py-12 text-center">
          <p className="mb-4 text-sm text-red-600">{erro}</p>
          {!!codigo && <Button variant="secondary" onClick={() => setTentativa(n => n + 1)}>Tentar novamente</Button>}
        </div>
      ) : imagens.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">Nenhuma foto cadastrada para esta grade.</p>
      ) : imagem && (
        <div className="mt-5">
          <div className="flex min-h-48 items-center justify-center rounded-lg bg-gray-50 p-3">
            {falhaImagem ? <p role="alert" className="text-sm text-gray-500">Não foi possível exibir esta foto.</p> : (
              <img src={`data:${imagem.mimeType};base64,${imagem.base64}`}
                alt={`${referencia} — ${grade.cor} / ${grade.tamanho} — Foto ${indice + 1}`}
                className="max-h-[48vh] max-w-full object-contain" onError={() => setFalhaImagem(true)} />
            )}
          </div>
          {imagem.imageDescription && <p className="mt-2 text-center text-sm text-gray-600">{imagem.imageDescription}</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" disabled={indice === 0} onClick={() => setIndice(n => n - 1)}>Anterior</Button>
            <p className="text-sm text-gray-600">Foto {indice + 1} de {imagens.length}</p>
            <Button variant="secondary" disabled={indice === imagens.length - 1} onClick={() => setIndice(n => n + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

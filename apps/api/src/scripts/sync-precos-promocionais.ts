import 'dotenv/config';
import { prisma } from '../config/database.js';
import { syncPrecosPromocionais } from '../services/totvs.service.js';

// Foto do preco promocional vigente (PDV ATUAL do Relatorio Base). Mesmo codigo do botao
// das Configuracoes PCP; existe em linha de comando pra poder ser agendado (cron) - a
// promocao muda sem avisar e vence por data, entao a foto envelhece se ninguem rodar.
//   npm run sync:precos-promocionais -w apps/api
//   npm run sync:precos-promocionais:dryrun -w apps/api   (le o TOTVS, nao grava)
async function main() {
  const dryRun = process.argv.slice(2).some((arg) => ['--dry-run', '--dryrun', '-n'].includes(arg));
  console.log(`[precos-promocionais] inicio ${new Date().toISOString()}${dryRun ? ' (dry-run)' : ''}`);
  const resumo = await syncPrecosPromocionais({
    dryRun,
    onProgress: (e) => {
      if (e.erro) {
        console.log(`[precos-promocionais] lote ${e.chunkIndex}/${e.totalChunks} pagina ${e.page}: tentativa ${e.tentativa} falhou (${e.erro}), tentando de novo...`);
        return;
      }
      console.log(`[precos-promocionais] lote ${e.chunkIndex}/${e.totalChunks} pagina ${e.page}: ${e.produtosLidos} produtos lidos, ${e.promocoes} precos em promocao`);
    },
  });
  console.log(`[precos-promocionais] filial ${resumo.branchCode}: ${resumo.produtos} produtos, ${resumo.promocoes} precos em promocao, ${Math.round(resumo.duracaoMs / 1000)}s${dryRun ? ' (nada gravado)' : ''}`);
}

main()
  .catch((error) => {
    console.error('[precos-promocionais] erro:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

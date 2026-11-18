# Fotos da grade na Visão Geral do PCP

Na tabela da Visão Geral, abrir uma referência continua mostrando seu detalhe de
SKUs. O clique em uma grade ou no botão Fotos abre uma janela para consultar as
imagens daquela cor/tamanho. É possível trocar a grade na própria janela e
navegar entre as fotos. Grade sem imagem tem mensagem própria; falhas permitem
tentar novamente. As fotos são apresentadas conforme o vínculo cadastrado no TOTVS.

## Integração

- `GET /api/produtos/:productCode/imagens`, em `apps/api`, exige login e acesso ao
  módulo PCP; o código precisa ser um inteiro positivo dentro de int32.
- Consulta somente `POST /image/v2/product/search`, com
  `filter.productCodeList: [productCode]`, `pageSize: 100` e avanço por `hasNext`.
  Não consulta imagens de outras grades como fallback.
- `imageFile` foi confirmado como base64 em teste real. O backend verifica a
  assinatura da imagem, informa seu MIME e elimina duplicidades por `imageCode`.
  O navegador recebe as imagens pela API autenticada do BI. Credenciais e token
  TOTVS permanecem no servidor.
- Cache em memória por produto: 24 horas para fotos e 5 minutos para ausência de
  foto, até 100 produtos e 24 MiB estimados. Consultas simultâneas do mesmo produto
  são compartilhadas; há limite de quatro consultas de produtos em andamento.
- Token de autenticação é reaproveitado até a expiração e renovado uma vez em
  caso de 401. Requisições possuem timeout e limites de tamanho e paginação.
- Não há carga de imagens durante a consulta do relatório nem alteração de ETL,
  banco de dados ou cálculos dos indicadores. Imagens são cadastros atuais do ERP,
  sem reconstrução da foto conforme a data histórica de estoque selecionada.

## Validação

Teste HTTP local com integração real ao TOTVS, SKU `7800000308884`, produto
`30888`, referência `003 BB CST413`: HTTP 200, duas fotos JPEG (1845 e 1846),
27.978 e 30.375 bytes. Uma consulta ao endpoint de imagens trouxe as duas fotos
com `pageSize: 100`; a segunda chamada à nossa rota usou o cache, sem nova
requisição ao TOTVS. O teste anterior com `pageSize: 1` exigiu duas páginas.

Testes automatizados: `npm run test:imagens -w apps/api`, 12 testes aprovados.
Cobrem paginação, duplicidades, cache e expiração, isolamento por produto,
consultas simultâneas, renovação de token, erros recuperáveis, conteúdo inválido,
limites, autenticação e permissão PCP. Builds de API e frontend aprovados.

Chrome local, com a resposta real de imagens interceptada e cenários simulados
para ausência e indisponibilidade: nenhuma busca ao carregar o relatório ou
expandir a referência; clique na grade correta, navegação das duas fotos, troca
de grade, ausência de foto, erro, nova tentativa e fechamento, sem exceções de
JavaScript.

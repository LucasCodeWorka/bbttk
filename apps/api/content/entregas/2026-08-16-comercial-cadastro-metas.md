---
title: Comercial - Cadastro de Metas: exclusão em lote, gerente e vínculo de vendedora por loja
date: 2026-08-16
modulo: comercial
---
Cinco ajustes na tela de Cadastro de Metas, todos pedidos a partir de uso real da tela.

## Excluir várias metas de uma vez

A listagem de metas cadastradas agora tem checkbox por linha e "selecionar todas" no cabeçalho. Com uma ou mais marcadas, aparece o botão "Excluir selecionadas (N)" ao lado de "Cadastrar Metas". O botão "Excluir" individual de cada linha continua igual.

## Modal "Cadastrar Metas" não guarda mais sessão anterior

O modal ficava "em cache" - reabrir depois de mexer em algo (tipo de distribuição, loja expandida, gerente marcada) trazia de volta o estado da vez anterior, em vez de começar do zero. Agora todo abrir zera o modal por completo.

## Lista de vendedoras por loja não depende mais de venda recente

Antes, só entrava na lista de uma loja quem tinha vendido lá nos últimos 3 meses - vendedora nova (sem venda ainda) ficava de fora, e quem estava fora há pouco tempo (mas ainda vendeu no período) podia aparecer indevidamente. Agora a lista usa o vínculo oficial da vendedora com a filial, direto do cadastro do TOTVS - o histórico de venda passa a servir só pra calcular a média/peso da distribuição, não pra decidir quem aparece.

## Desconsiderar vendedora (férias, afastamento)

Cada vendedora da lista (exceto a gerente) ganhou um link "Desconsiderar" - remove ela da distribuição daquela loja nesse cadastro e redistribui o valor entre as que restaram. Como o vínculo agora é mais amplo (item acima), esse é o mecanismo pra tirar manualmente quem não deveria entrar num mês específico.

## Gerente pode assumir o restante, em vez do valor cheio

Ao marcar uma vendedora como gerente, a meta dela sempre virava o valor cheio da loja, por fora da divisão com as demais. Agora tem uma opção: "Assume o restante" - a gerente fica só com o que sobrar depois de distribuir a meta entre as demais vendedoras (útil quando as metas das vendedoras são cadastradas manualmente e sobra um valor sem dono). O modo padrão ("Valor cheio da loja") continua o mesmo de antes.

## Bug encontrado e corrigido: não deixava salvar no modo "assume o restante"

Existia uma segunda validação, no backend, que exigia a soma das vendedoras batendo exatamente com a meta da loja - ela não sabia do modo novo e bloqueava o salvamento sempre que a gerente estava configurada pra assumir o restante (a soma das demais fica abaixo da meta de propósito). Corrigido: quando há gerente, só é erro se a soma das demais **ultrapassar** a meta da loja.

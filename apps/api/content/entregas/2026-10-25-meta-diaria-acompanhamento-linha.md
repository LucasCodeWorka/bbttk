---
title: Acompanhamento por Linha - card de Meta Diária
date: 2026-10-25
modulo: pcp
---
A tela de Acompanhamento por Linha ganhou um card próprio de **Meta Diária**, ao lado
do card "Meta do Período". Os dois passaram a usar a mesma meta de loja que já é
cadastrada todo mês no módulo Comercial (não é mais preciso cadastrar a meta de novo
nesta tela para o card aparecer).

Fórmula: meta mensal da(s) loja(s)/canal selecionado ÷ dias do mês × dias do período
escolhido no cabeçalho; a meta diária é esse valor dividido pelos dias do período.
Ficam em branco só quando não há meta de loja cadastrada no Comercial para o mês/canal
selecionado - o subtítulo do card avisa isso diretamente.

As colunas META R$ / ATING. META da tabela (por categoria, linha, coleção, gênero ou
status) continuam vindo do cadastro de meta por classificação desta mesma tela (botão
"Cadastrar Metas") - é o único cadastro que sabe repartir a meta entre as classificações.
Uma nota abaixo dos cards mostra quantos itens da tabela já têm meta cadastrada.

Também corrigido, nos bastidores: salvar a meta de uma loja no módulo Comercial podia
gerar linhas duplicadas no banco (bug de corrida ao salvar duas vezes seguidas), o que
já havia acontecido com duas lojas em meses recentes. Corrigido e os dados já existentes
foram limpos.

# Fotos no nível da referência

Na Visão Geral do PCP, modo Por referência, o botão Fotos aparece junto ao código
da referência na tabela principal. Pode ser usado diretamente, sem expandir o
detalhamento. O clique do botão não abre nem recolhe as linhas de SKUs.

O detalhamento de cor/tamanho mantém suas informações e deixa de oferecer botões
ou ações de foto. A janela de fotos apresenta a referência, imagens do TOTVS e
navegação entre as fotos; o seletor de grade foi retirado.

A consulta reaproveita a integração existente, usando o primeiro produto com
código válido entre os SKUs da referência. Como as fotos estão replicadas entre
as variações no cadastro informado, a mesma galeria é apresentada uma vez no
nível da referência. Não se consultam todos os SKUs nem se misturam imagens de
outras referências. O backend mantém cache por produto e deduplicação por código
de imagem, sem mudanças de endpoint, banco ou ETL.

Build do frontend aprovado. Chrome local com fotos reais já obtidas do produto
30888: botão visível antes de expandir, abertura direta sem alterar o detalhe,
duas fotos navegáveis, ausência de seletor de grade e de ação de foto nos SKUs,
tratamento de indisponibilidade com nova tentativa e mensagem de ausência de
foto por referência. Sem exceções de JavaScript.

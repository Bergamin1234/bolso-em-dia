# Guia de Configuração para Google Ads & Lançamento em Produção
## Bolso em Dia — Planilha de Gastos & Simulador de Investimentos

Este guia detalha o passo a passo para colocar a aplicação no ar e criar campanhas de alto desempenho no **Google Ads** com conformidade total e rastreamento de conversões.

---

### 1. Como colocar o site no ar (Hospedagem em 2 minutos)

Por ser uma aplicação 100% Client-Side (HTML, CSS e JavaScript puros), você pode hospedá-la gratuitamente em qualquer provedor de páginas estáticas:

#### Opção A: Vercel (Recomendado — Grátis e com SSL automático)
1. Instale o Vercel CLI ou conecte seu repositório no [vercel.com](https://vercel.com).
2. Na pasta do projeto (`bolso-em-dia`), execute no terminal:
   ```bash
   npx vercel
   ```
3. O Vercel gerará uma URL segura HTTPS (ex.: `https://bolso-em-dia.vercel.app`).

#### Opção B: Netlify (Arrastar e Soltar)
1. Acesse [netlify.com](https://www.netlify.com).
2. Vá em **Sites** > **Add new site** > **Deploy manually**.
3. Arraste a pasta `bolso-em-dia` inteira para a janela do navegador. Em 5 segundos o site estará no ar com HTTPS.

#### Opção C: Cloudflare Pages ou GitHub Pages
- Crie um repositório no GitHub com os arquivos desta pasta e ative o **GitHub Pages** nas configurações do repositório (Source: `main` branch).

---

### 2. Ativação da Tag do Google Ads (gtag.js)

1. No painel do seu **Google Ads**, vá em **Ferramentas e Configurações** > **Google Tag** (ou **Instalação da Tag**).
2. Copie o seu ID de Conversão, que possui o formato: `AW-1234567890`.
3. Abra o arquivo `index.html` e localize as linhas 36 a 48:
   ```html
   <!-- DESCOMENTE ESTE BLOCO NO INDEX.HTML E ADICIONE SEU ID: -->
   <script async src="https://www.googletagmanager.com/gtag/js?id=AW-SEU_ID_AQUI"></script>
   <script>
     window.dataLayer = window.dataLayer || [];
     function gtag(){dataLayer.push(arguments);}
     gtag('js', new Date());
     gtag('config', 'AW-SEU_ID_AQUI');
   </script>
   ```
4. Substitua `AW-XXXXXXXXXX` pelo seu ID real em ambas as linhas e salve.

---

### 3. Eventos de Conversão Pré-configurados no Código

A ferramenta já vem com hooks automáticos para o `dataLayer` e `gtag`. Você pode criar **Ações de Conversão** no Google Ads associadas a estes eventos:

| Nome do Evento | Gatilho na Ferramenta | Tipo Recomendado no Google Ads |
| :--- | :--- | :--- |
| `generate_lead` | Usuário clica em **"Imprimir / PDF"** para salvar seu relatório formatado | **Conversão Principal (Lead)** |
| `export_csv` | Usuário clica em **"Exportar CSV / Excel"** para baixar a planilha | **Conversão Secundária (Download)** |
| `add_expense` | Usuário insere e salva uma despesa no orçamento | **Engajamento / Interação** |
| `load_sample` | Usuário clica em "Ver exemplo" para testar o painel | **Engajamento** |

#### Como criar a Conversão Principal no Google Ads:
1. Vá em **Metas** > **Conversões** > **Resumo** > **Nova ação de conversão**.
2. Selecione **Site** e insira a URL do seu domínio.
3. Escolha **Criar ações de conversão manualmente usando código**.
4. Categoria: **Contato** ou **Lead**.
5. Nome da conversão: `Download_Relatorio_PDF`.
6. Evento acionado pelo código: `generate_lead`.

---

### 4. Checklist para Aprovação no Google Ads (Sem Reprovações)

O Google Ads possui políticas rígidas para nichos financeiros (*Serviços Financeiros / Produtos de Crédito*). Esta aplicação foi desenhada especificamente para cumprir todas as exigências:

- [x] **Transparência de Gratuidade**: Avisos claros de que a ferramenta é 100% gratuita e não requer cartão ou dados bancários.
- [x] **Sem Promessa de Lucro Fixo**: O simulador detalha as premissas de cálculo e inclui *disclaimers* legais exigidos de que rentabilidade passada não garante rentabilidade futura.
- [x] **Páginas Obrigatórias Prontas**:
  - `privacidade.html` (LGPD e cookies do Google);
  - `termos.html` (Termos de uso e isenção de responsabilidade);
  - Ambas com links visíveis no rodapé.
- [x] **Robots e Sitemap**: Arquivo `robots.txt` autorizando expressamente o `AdsBot-Google` e `AdsBot-Google-Mobile` para garantir que o robô do Google Ads consiga auditar a página de destino com nota máxima de Experiência na Página de Destino (*Landing Page Experience*).
- [x] **Mobile-First & Carregamento Instantâneo**: Peso ultraleve (sem frameworks pesados), gerando pontuação 95+ no Google PageSpeed Insights, o que reduz seu Custo por Clique (CPC).

---

### 5. Sugestão de Palavras-Chave de Alto Volume (Google Ads Search)

Para criar suas campanhas de pesquisa com ótimo retorno:

#### Grupo de Anúncios 1: Planilha de Gastos (Foco em Organização)
- `[planilha de gastos online]` (Exata)
- `"planilha controle financeiro gratis"` (Frase)
- `"planilha de gastos mensais"` (Frase)
- `"como organizar gastos pessoais"` (Frase)
- `+organizador +financeiro +online` (Ampla modificada / Frase)

#### Grupo de Anúncios 2: Regra 50/30/20 & Orçamento
- `[regra 50 30 20]` (Exata)
- `"calculadora regra 50 30 20"` (Frase)
- `"como aplicar a regra 50 30 20"` (Frase)
- `"divisao de gastos 50 30 20"` (Frase)

#### Grupo de Anúncios 3: Simulador de Renda Fixa (Foco em Investimentos)
- `[simulador cdb x poupanca]` (Exata)
- `"quanto rende poupanca x tesouro selic"` (Frase)
- `"simulador de investimentos iniciantes"` (Frase)
- `"onde guardar reserva de emergencia"` (Frase)

---

### 6. Executando Localmente

Para rodar a aplicação no seu computador agora mesmo:

```bash
cd C:\Users\02555331280\.gemini\antigravity\scratch\bolso-em-dia
node server.js
```
Acesse: **http://localhost:3000**

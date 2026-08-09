# Plan 3: Native Function Calling Support

## Samenvatting

Voeg native function calling toe als optionele provider-capability, terwijl LM Studio en andere providers zonder expliciete ondersteuning het bestaande tekstprotocol blijven gebruiken. De implementatie moet native tool calls correct bewaren in de volgende request; alleen een toolnaam en vrije tekst opslaan is onvoldoende voor OpenAI-compatibele API's en Gemini.

De eerste versie ondersteunt één native tool call per model-turn, net als de huidige agent-loop. Multi-tool responses blijven buiten scope en horen bij plan 04.

## Belangrijkste ontwerpkeuzes

- Gebruik optionele interfaceleden in `ILLMProvider`, zodat bestaande providers compileerbaar blijven:
  - `supportsNativeFunctionCalling?(): boolean`;
  - `chatCompletionStreamWithTools?(...)`.
- Gebruik een gedeeld intern message-type met optionele native metadata:
  - gewone `{ role, content }` berichten blijven geldig;
  - assistant tool calls bevatten `tool_calls: [{ id, type: 'function', function: { name, arguments } }]`;
  - toolresultaten bevatten `role: 'tool'`, `tool_call_id` en `content`.
- De native methode retourneert altijd een genormaliseerd resultaat:
  - `{ type: 'text', text }`; of
  - `{ type: 'tool_call', text, toolCall: { id, name, args } }`.
- `AgentExecutor` blijft één tool per iteratie uitvoeren. Bij een native call wordt de assistant-call inclusief call-id aan de history toegevoegd; na uitvoering wordt het resultaat als `tool`-bericht toegevoegd.
- Providers zonder native capability blijven exact het bestaande `chatCompletionStream()` + `parseToolCall()` pad gebruiken.

## Implementatiewijzigingen

### Providerinterface en gedeelde types

Wijzig `code/src/providers/ILLMProvider.ts`:

- Voeg de gedeelde chat-message- en native-tool-call-types toe.
- Maak de native capability en methode optioneel om backward compatibility te behouden.
- Laat de native methode dezelfde streaming callback, abort signal, thinking-instellingen en modelparameters accepteren als de bestaande methode.

### OpenAI-compatibele providers

Wijzig `code/src/providers/BaseCloudProviderClient.ts` en `code/src/providers/FreeProviderClient.ts`:

- Voeg `supportsNativeFunctionCalling()` toe aan `BaseCloudProviderClient`, met `true` voor de providers die het gedeelde OpenAI-toolformaat daadwerkelijk ondersteunen.
- Voeg `tools` en `tool_choice: 'auto'` toe aan native requests; gebruik de bestaande `FunctionDeclaration`-schemas.
- Parse streaming `tool_calls` delta's door id, functienaam en gefragmenteerde JSON-argumenten per response te accumuleren.
- Geef teksttokens door via `onToken`; geef na afloop één complete genormaliseerde tool call terug.
- Parse argumenten met `JSON.parse`; geef een duidelijke providerfout terug bij ongeldige of onvolledige argumenten.
- Zet bij volgende requests native assistant/tool-berichten rechtstreeks om naar het OpenAI-compatibele wire-formaat.
- Laat `FreeProviderClient` de capability en native call delegeren aan de concrete resolved provider, in plaats van zichzelf blind als native-capable te markeren.
- Behoud de bestaande `preparePayload()`-paden voor legacy requests.

### Gemini

Wijzig `code/src/providers/GeminiClient.ts`:

- Implementeer native function calling met Gemini `tools[].functionDeclarations` en `toolConfig.functionCallingConfig.mode = 'AUTO'`.
- Converteer `FunctionDeclaration.parameters` naar Gemini's `parameters`-schema zonder OpenAI-wrappervelden.
- Detecteer `functionCall` parts in zowel non-streaming als streaming responses; combineer tekstparts voor de UI en retourneer de function call gestructureerd.
- Converteer native history provider-specifiek:
  - assistant function calls naar een Gemini `model`-contentpart met `functionCall`;
  - toolresultaten naar een Gemini `user`-contentpart met `functionResponse`.
- Houd de bestaande `systemInstruction` en thinking-configuratie intact.

### AgentExecutor

Wijzig `code/src/AgentExecutor.ts`:

- Verzamel schemas via `this.tools.map(tool => tool.getFunctionDeclaration())`.
- Bepaal per model-turn of de provider beide native capabilityleden aanbiedt.
- Native pad:
  - stuur schemas mee;
  - zet een native tool-call-result om naar het genormaliseerde assistant-bericht;
  - voer dezelfde bestaande `executeTool()` uit;
  - voeg het native `tool`-resultaat toe voor de volgende model-turn.
- Legacy pad blijft ongewijzigd voor providers zonder native support.
- Gebruik voor native providers een system prompt zonder de `ACTION SCHEMAS`-sectie. Verwijder alleen het begrensde schemasegment; als de verwachte markering ontbreekt, blijft de volledige prompt behouden.
- Voeg geen automatische tweede API-call toe wanneer een provider een native request met HTTP 400 afwijst; rapporteer de fout duidelijk. Alleen capability-false providers gebruiken legacy parsing, zodat dubbele/betaalde requests worden vermeden.
- Native responses met meerdere tool calls worden niet uitgevoerd; retourneer een gecontroleerde fout of beperk de provideradapter tot de eerste call met expliciete logging. Volledige multi-tool-executie blijft plan 04.

### Provider capability matrix

- `GeminiClient`: native aan.
- `BaseCloudProviderClient`-subklassen: native aan waar hun endpoint het OpenAI-compatible `tools`-formaat ondersteunt.
- `FreeProviderClient`: dynamisch delegeren naar de resolved subprovider.
- `LMStudioClient`: native uit; bestaand tekstprotocol blijft actief.
- Providers die niet expliciet zijn gevalideerd blijven native uit totdat hun API-contract is bevestigd.

## Verificatie

- Compileer met `npm.cmd run compile`.
- Schema-test: controleer dat alle geregistreerde `getFunctionDeclaration()`-resultaten geldige function schemas opleveren.
- OpenAI-compatibele adaptertest met een mock HTTP/SSE-response:
  - gewone tekststream blijft tekst leveren;
  - gefragmenteerde `tool_calls` worden samengevoegd;
  - JSON-argumenten worden correct geparsed;
  - assistant tool-call en tool-result verschijnen in de volgende request.
- Gemini-adaptertest met mock responses:
  - `functionCall` wordt herkend;
  - volgende history gebruikt `functionCall`/`functionResponse` parts;
  - gewone tekst blijft werken.
- Legacy regressietest met LM Studio: bestaande `<|tool_call|>` parsing en één tool-executie blijven werken.
- Prompttest: native mode verwijdert alleen `ACTION SCHEMAS`; legacy mode behoudt de volledige prompt.
- Test dat meerdere native tool calls niet stilzwijgend tot meerdere executions leiden.
- Controleer `git diff --check` en voer een handmatige smoke-test uit met één Gemini- en één lokaal model wanneer credentials/server beschikbaar zijn.

## Scope en aannames

- Deze wijziging ondersteunt één native tool call per model-turn; parallelle/multi-tool execution blijft plan 04.
- Er wordt geen externe SDK of tokenizer toegevoegd.
- Bestaande tekst parsing en tool execution blijven de compatibility fallback.
- De bestaande UI-events blijven behouden: teksttokens worden gestreamd en native tool calls gebruiken dezelfde `tool_start`/`tool_end`-events.
- `.agents/rules/` ontbreekt in de huidige checkout; er zijn geen extra lokale regels om toe te passen.

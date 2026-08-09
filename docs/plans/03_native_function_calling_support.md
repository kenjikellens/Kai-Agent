# Plan 3: Native Function Calling Support

## Probleem

Kai-Agent's tool call protocol is momenteel volledig gebaseerd op **tekst-parsing** van de ruwe model-output (in `AgentExecutor.parseToolCall()`, regels 263–296). Het model moet zelf een JSON-blok produceren in een specifiek formaat, omsloten door `<|tool_call|>` tags of markdown codeblokken.

Dit werkt goed voor lokale modellen via LM Studio (die geen native function calling API hebben), maar is suboptimaal voor cloud providers die **native function calling** ondersteunen:

| Provider | Native Function Calling API | Kai-Agent gebruikt het? |
|---|---|---|
| **Gemini** | ✅ `tools` + `function_declarations` in request body | ❌ Nee |
| **Mistral** | ✅ `tools` parameter in chat completion | ❌ Nee |
| **OpenAI-compatibel** (LM Studio) | ⚠️ Beperkt (model-afhankelijk) | ❌ Nee |
| **Cohere** | ✅ `tools` parameter | ❌ Nee |
| **Cerebras** | ✅ `tools` parameter | ❌ Nee |

### Waarom is native function calling beter?

1. **Betrouwbaarheid**: Het model retourneert een gestructureerd JSON-object via de API response, niet als vrije tekst. Geen regex-parsing of fallback-strategieën nodig.
2. **Geen prompt-overhead**: De tool-schemas in `system_prompt.md` (regels 29–102, ~70 regels) hoeven niet in de system prompt te staan — ze worden apart meegegeven via de API.
3. **Minder tokens**: De ACTION SCHEMAS sectie in de system prompt verbruikt ~1500 tokens die bespaard kunnen worden.
4. **Betere tool selectie**: Modellen die getraind zijn op function calling maken minder fouten in tool-keuze en parameterformattering.

---

## Doel

Een hybride systeem bouwen waarbij:
- **Cloud providers** (Gemini, Mistral, Cohere, etc.) native function calling gebruiken via hun API.
- **Lokale modellen** (LM Studio) het huidige tekst-parsing systeem blijven gebruiken als fallback.

---

## Gedetailleerde Aanpak

### Stap 1: `ILLMProvider` interface uitbreiden

In `code/src/providers/ILLMProvider.ts`, voeg een capability-flag en function calling methode toe:

```typescript
export interface ILLMProvider {
    // ... bestaande methodes ...

    /**
     * Geeft aan of deze provider native function calling ondersteunt.
     * Als true, zal AgentExecutor tools via de API meesturen in plaats van in de system prompt.
     */
    supportsNativeFunctionCalling(): boolean;

    /**
     * Voert een streaming chat completion uit met native function calling.
     * @param messages Chat history.
     * @param model Target model.
     * @param temperature Sampling temperature.
     * @param tools Array van FunctionDeclaration schemas.
     * @param onToken Token callback.
     * @param signal Abort signal.
     * @returns Een object met ofwel een text response, ofwel een tool call.
     */
    chatCompletionStreamWithTools?(
        messages: { role: string; content: string }[],
        model: string,
        temperature: number,
        tools: FunctionDeclaration[],
        onToken: (token: string) => void,
        signal?: any,
        thinking?: boolean,
        geminiThinkingLevel?: string
    ): Promise<{
        type: 'text' | 'tool_call';
        text?: string;
        toolCall?: { name: string; args: Record<string, any> };
    }>;
}
```

### Stap 2: Tool schemas genereren vanuit bestaande `Tool` klassen

Elke tool heeft al een `getFunctionDeclaration()` methode (in `Tool.ts`, regel 41). Deze schemas worden nu niet gebruikt, maar zijn precies wat nodig is voor native function calling.

In `AgentExecutor`, verzamel de schemas:
```typescript
private getToolSchemas(): FunctionDeclaration[] {
    return this.tools.map(t => t.getFunctionDeclaration());
}
```

### Stap 3: `GeminiClient` implementatie voor native function calling

Gemini ondersteunt function calling via de `tools` parameter in de API request. In `code/src/providers/GeminiClient.ts`:

```typescript
supportsNativeFunctionCalling(): boolean {
    return true;
}

async chatCompletionStreamWithTools(
    messages, model, temperature, tools, onToken, signal, thinking, geminiThinkingLevel
) {
    // Converteer FunctionDeclaration[] naar Gemini's formaat
    const geminiTools = [{
        functionDeclarations: tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }))
    }];

    // Voeg `tools` en `tool_config` toe aan de API request body
    const body = {
        contents: convertedMessages,
        tools: geminiTools,
        tool_config: { function_calling_config: { mode: 'AUTO' } },
        // ... bestaande parameters ...
    };

    // Parse response: check voor functionCall in candidates
    // Als response.candidates[0].content.parts bevat een functionCall object:
    //   return { type: 'tool_call', toolCall: { name, args } }
    // Anders:
    //   return { type: 'text', text: responseText }
}
```

### Stap 4: `BaseCloudProviderClient` implementatie (Mistral, Cohere, Cerebras)

Voor OpenAI-compatibele providers, voeg de `tools` parameter toe aan de request:

```typescript
supportsNativeFunctionCalling(): boolean {
    return true;
}

// In de request body:
const body = {
    model,
    messages,
    tools: tools.map(t => ({ type: 'function', function: t.function })),
    tool_choice: 'auto',
    // ... bestaande parameters ...
};

// Parse response: check voor tool_calls in de choice
// response.choices[0].message.tool_calls[0] bevat { function: { name, arguments } }
```

### Stap 5: `LMStudioClient` — geen native support, fallback

```typescript
supportsNativeFunctionCalling(): boolean {
    return false;  // Lokale modellen gebruiken het bestaande tekst-parsing systeem
}
```

### Stap 6: `AgentExecutor.run()` aanpassen voor hybride modus

```typescript
// In de while-loop, vervang het huidige blok (regels 157–177):
const provider = LLMProviderFactory.getProvider(model, this.serverUrl);

let toolCall = null;
let responseText = '';

if (provider.supportsNativeFunctionCalling?.() && provider.chatCompletionStreamWithTools) {
    // Native function calling pad
    const result = await provider.chatCompletionStreamWithTools(
        messages, model, this.temperature,
        this.getToolSchemas(),
        (token) => this.onProgress({ type: 'token', output: token }),
        signal, thinking, geminiThinkingLevel
    );

    if (result.type === 'tool_call' && result.toolCall) {
        toolCall = {
            name: result.toolCall.name,
            args: result.toolCall.args,
            query: `${result.toolCall.name}: native function call`
        };
        responseText = result.text || `[Calling tool: ${result.toolCall.name}]`;
    } else {
        responseText = result.text || '';
    }
} else {
    // Fallback: bestaande tekst-parsing pad (ongewijzigd)
    responseText = await provider.chatCompletionStream(
        messages, model, this.temperature,
        (token) => this.onProgress({ type: 'token', output: token }),
        signal, thinking, geminiThinkingLevel
    );
    toolCall = this.parseToolCall(responseText);
}

lastAssistantResponse = responseText;
if (!toolCall) break;
```

### Stap 7: System Prompt aanpassen

Wanneer native function calling actief is, hoeven de ACTION SCHEMAS (regels 29–102 in `system_prompt.md`) niet in de system prompt te staan. Dit bespaart ~1500 tokens.

Optie: `getSystemPrompt()` uitbreiden met een `nativeFunctionCalling: boolean` parameter die de schemas-sectie conditioneel weglaat.

---

## Bestanden die Geraakt Worden

| Bestand | Actie | Beschrijving |
|---|---|---|
| `code/src/providers/ILLMProvider.ts` | **WIJZIG** | Voeg `supportsNativeFunctionCalling()` en `chatCompletionStreamWithTools()` toe |
| `code/src/providers/GeminiClient.ts` | **WIJZIG** | Implementeer native function calling voor Gemini API |
| `code/src/providers/BaseCloudProviderClient.ts` | **WIJZIG** | Implementeer native function calling voor OpenAI-compatibele providers |
| `code/src/LMStudioClient.ts` | **WIJZIG** | Return `false` voor `supportsNativeFunctionCalling()` |
| `code/src/AgentExecutor.ts` | **WIJZIG** | Hybride modus: native FC vs. tekst-parsing fallback |
| `code/system_prompt.md` | **WIJZIG** | Conditioneel ACTION SCHEMAS sectie weglaten |

---

## Verificatie

1. **Gemini Test**: Stuur een agent-taak met een Gemini model en verifieer dat tool calls via de native API response komen (niet via tekst-parsing).
2. **LM Studio Fallback Test**: Stuur dezelfde taak met een lokaal model en verifieer dat het bestaande `<|tool_call|>` parsing systeem nog steeds werkt.
3. **Schema Validatie**: Verifieer dat `getFunctionDeclaration()` van elke tool een geldig schema produceert dat geaccepteerd wordt door de Gemini API.
4. **Token Besparing**: Meet het verschil in system prompt tokengebruik met en zonder ACTION SCHEMAS.

---

## Risico's & Aandachtspunten

- **API Compatibiliteit**: Niet alle cloud providers hanteren exact hetzelfde function calling formaat. Gemini gebruikt `functionDeclarations`, OpenAI-compatibelen gebruiken `tools[].function`. De conversie moet per provider correct zijn.
- **Multi-tool calls**: Sommige providers retourneren meerdere tool calls in één response. De huidige architectuur voert één tool per iteratie uit. Dit zou later uitgebreid kunnen worden (zie Plan 4).
- **Backward Compatibility**: Het bestaande tekst-parsing systeem moet 100% intact blijven als fallback.

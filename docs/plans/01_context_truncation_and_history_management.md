# Plan 1: Context Truncation & History Management

## Probleem

De `AgentExecutor.run()` loop (in `code/src/AgentExecutor.ts`, regels 152–226) pusht elke iteratie onbeperkt nieuwe berichten naar de `messages[]` array:
- Regel 180: `messages.push({ role: 'assistant', content: response })` — volledige model-response
- Regel 222–225: `messages.push({ role: 'user', content: toolResult })` — volledige tool-output

Na meerdere iteraties met grote tool-outputs (bijv. `read_file` van een 500-regel bestand, `grep_search` met 50 matches, `run_command` met lange logs) groeit de totale token-count exponentieel. Dit veroorzaakt:
1. **Context window overflow** — het model ontvangt meer tokens dan zijn limiet en begint informatie te verliezen of errors te gooien.
2. **Kwaliteitsdegradatie** — zelfs als het past, worden oudere instructies "vergeten" door het model bij grote context.
3. **Latency & kosten** — meer tokens = langzamere responses en hogere API-kosten bij cloud providers.

---

## Doel

Een `ContextManager` klasse introduceren die de `messages[]` array automatisch beheert en inkort wanneer een configureerbare tokendrempel bereikt wordt, zonder dat het model kritieke context verliest.

---

## Gedetailleerde Aanpak

### Stap 1: Nieuw bestand `code/src/ContextManager.ts` aanmaken

```typescript
/**
 * ContextManager beheert de gespreksgeschiedenis van de agent loop.
 * Het telt tokens, detecteert overschrijding van de limiet,
 * en comprimeert oudere berichten om binnen het context window te blijven.
 */
export class ContextManager {
    private maxTokens: number;
    private reservedTokens: number; // ruimte voor system prompt + nieuwe response

    constructor(maxTokens: number = 16000, reservedTokens: number = 4000) { ... }

    /**
     * Schat het aantal tokens in een string (simpele heuristiek: ~4 chars per token).
     */
    estimateTokens(text: string): number { ... }

    /**
     * Berekent het totale tokengebruik van de huidige messages array.
     */
    getTotalTokens(messages: { role: string; content: string }[]): number { ... }

    /**
     * Comprimeert de messages array als de tokendrempel overschreden wordt.
     * Strategie:
     *   1. System prompt (index 0) wordt NOOIT ingekort.
     *   2. Het eerste user-bericht (de oorspronkelijke vraag) wordt NOOIT ingekort.
     *   3. Het laatste assistant-bericht en laatste user-bericht worden NOOIT ingekort (recente context).
     *   4. Tussenliggende tool-result berichten worden ingekort tot een samenvatting:
     *      "[Tool Result for X]: [Output truncated — originally N lines, key findings: ...]"
     *   5. Als dat niet genoeg is, worden oudere assistant-berichten verkort tot:
     *      "[Previous step: used tool X on file Y]"
     */
    compressIfNeeded(messages: { role: string; content: string }[]): { role: string; content: string }[] { ... }
}
```

### Stap 2: `ContextManager` integreren in `AgentExecutor`

In `AgentExecutor.ts`:
- Importeer `ContextManager` bovenaan.
- Voeg een `private contextManager: ContextManager` property toe aan de klasse.
- Initialiseer in de constructor: `this.contextManager = new ContextManager()`.
- **Na elke `messages.push()`** in de while-loop (regels 180 en 222–225), roep `this.contextManager.compressIfNeeded(messages)` aan.

```typescript
// Na regel 180 (assistant response push):
messages.push({ role: 'assistant', content: response });
this.contextManager.compressIfNeeded(messages);

// Na regel 225 (tool result push):
messages.push({
    role: 'user',
    content: `[Tool Result for ${toolCall.name}]:\n${toolResult}\n\nPlease proceed...`
});
this.contextManager.compressIfNeeded(messages);
```

### Stap 3: Configureerbare Token Limiet

- Voeg een optionele `maxContextTokens` parameter toe aan `AgentExecutor.run()`.
- Verschillende modellen hebben verschillende limieten:
  - LM Studio lokale modellen: ~4K–8K tokens
  - Gemini Flash: ~32K–1M tokens
  - Cloud providers: variabel

De `ContextManager` zou de limiet moeten ontvangen op basis van het geselecteerde model.

### Stap 4: Token Counting Heuristiek

Simpele implementatie (geen externe dependency nodig):
```typescript
estimateTokens(text: string): number {
    // ~4 karakters per token is een veilige heuristiek voor Engelse tekst
    return Math.ceil(text.length / 4);
}
```

Optioneel later upgraden naar een echte tokenizer (bijv. `tiktoken` voor OpenAI-compatibele modellen).

---

## Bestanden die Geraakt Worden

| Bestand | Actie | Beschrijving |
|---|---|---|
| `code/src/ContextManager.ts` | **NIEUW** | Nieuwe klasse voor context management |
| `code/src/AgentExecutor.ts` | **WIJZIG** | Importeer en gebruik `ContextManager` in de run-loop |

---

## Verificatie

1. **Unit Test**: Maak een test die een `messages[]` array met >20K geschatte tokens doorgeeft aan `ContextManager.compressIfNeeded()` en controleer dat het resultaat onder de drempel zit.
2. **Integration Test**: Voer een agent-taak uit die meerdere grote bestanden leest (>5 iteraties) en verifieer dat het model niet crasht op context overflow.
3. **Visueel**: Controleer in de sidebar UI dat de agent niet halverwege vastloopt bij langere taken.

---

## Risico's & Aandachtspunten

- **Informatieverlies**: Te agressief comprimeren kan ervoor zorgen dat het model eerder werk "vergeet". De compressie moet selectief zijn (tool outputs eerst, nooit het originele user-verzoek).
- **Samenvatting kwaliteit**: De statische samenvatting (`[Output truncated]`) is beperkt. Een toekomstige upgrade zou het model zelf een samenvatting kunnen laten maken (maar dit kost extra API-calls).
- **Model-specifieke limieten**: De tokendrempel moet per provider/model configureerbaar zijn.

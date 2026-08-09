# Plan 4: Parallelle / Multi-Tool Executie

## Probleem

De huidige `AgentExecutor` loop (in `code/src/AgentExecutor.ts`, regels 152–226) volgt een strikt **sequentieel single-tool-per-turn** patroon:

```
Model turn 1 → parst 1 tool call → voert 1 tool uit → feedback → Model turn 2 → ...
```

Het system prompt (`code/system_prompt.md`, regel 11) forceert dit expliciet:
> "EXACTLY ONE tool call enclosed inside `<|tool_call|>` tags. Do not output multiple tool calls in one turn."

Dit veroorzaakt drie beperkingen:

1. **Latency**: Als de agent 3 onafhankelijke bestanden moet lezen, kost dat 3 volledige model-turns (elk met streaming, parsing, en tool execution) in plaats van 1 turn met 3 parallelle reads.
2. **Token verspilling**: Elke extra turn genereert een assistant-bericht + tool-result bericht in de history, wat onnodig tokens verbruikt.
3. **Iteratie-limiet**: De `maxIterations = 10` limiet wordt sneller bereikt bij taken die veel onafhankelijke tool-calls nodig hebben.

---

## Doel

Ondersteuning toevoegen voor **meerdere tool calls per model-turn**, met parallelle executie van onafhankelijke tools. Het systeem moet backward-compatibel blijven met het bestaande single-tool formaat.

---

## Gedetailleerde Aanpak

### Stap 1: Multi-Tool Parsing in `parseToolCall()`

Huidige methode `parseToolCall()` retourneert een enkel object of `null`. Maak een nieuwe methode `parseToolCalls()` (meervoud) die een array retourneert:

```typescript
/**
 * Parst alle tool calls uit de model response.
 * Ondersteunt zowel enkel als meerdere tool calls per turn.
 * @returns Array van tool call objecten, of lege array als er geen zijn.
 */
private parseToolCalls(text: string): { name: string; args: any; query: string }[] {
    const calls: { name: string; args: any; query: string }[] = [];

    // Strategie 1: Meerdere <|tool_call|> blokken
    const tagRegex = /<\|?tool_call\|?>\s*([\s\S]*?)\s*<\|?\/?tool_call\|?>/gi;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        const parsed = this.parseJsonString(match[1]);
        if (parsed) calls.push(parsed);
    }
    if (calls.length > 0) return calls;

    // Strategie 2: JSON array van tool calls
    const arrayRegex = /```json\s*(\[[\s\S]*?\])\s*```/i;
    const arrayMatch = arrayRegex.exec(text);
    if (arrayMatch) {
        try {
            const arr = JSON.parse(arrayMatch[1]);
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    const parsed = this.parseJsonString(JSON.stringify(item));
                    if (parsed) calls.push(parsed);
                }
                if (calls.length > 0) return calls;
            }
        } catch { /* ignore */ }
    }

    // Strategie 3: Native function calling (meerdere tool_calls in API response)
    // Dit wordt afgehandeld in Plan 3's chatCompletionStreamWithTools()

    // Fallback: bestaand single-tool parsing
    const single = this.parseToolCall(text);
    if (single) calls.push(single);

    return calls;
}
```

### Stap 2: Parallelle Executie Engine

Voeg een helper methode toe die meerdere tools parallel uitvoert:

```typescript
/**
 * Voert meerdere tool calls parallel uit.
 * Onafhankelijke tools (read_file, list_dir, grep_search) draaien gelijktijdig.
 * Schrijf-tools (write_file, edit_file, replace_file_content) worden sequentieel uitgevoerd
 * om race conditions te voorkomen.
 */
private async executeToolsParallel(
    toolCalls: { name: string; args: any; query: string }[],
    modifiedFiles: Set<string>
): Promise<{ name: string; result: string; target: string }[]> {

    // Categoriseer: read-only tools vs. write tools
    const READ_ONLY_TOOLS = ['read_file', 'list_dir', 'grep_search', 'symbol_search',
                              'get_diagnostics', 'fetch_url'];

    const readCalls = toolCalls.filter(c => READ_ONLY_TOOLS.includes(c.name));
    const writeCalls = toolCalls.filter(c => !READ_ONLY_TOOLS.includes(c.name));

    const results: { name: string; result: string; target: string }[] = [];

    // Read-only tools: parallel via Promise.all
    if (readCalls.length > 0) {
        const readResults = await Promise.all(
            readCalls.map(async (call) => {
                const activeToolId = `tool-${Date.now()}-${call.name}`;
                const targetName = this.getToolTarget(call.name, call.args);

                this.onProgress({
                    type: 'tool_start', tool: call.name,
                    query: call.query, toolId: activeToolId, fileName: targetName
                });

                let result = '';
                try {
                    result = await this.executeTool(call.name, call.args);
                } catch (err: any) {
                    result = `[Error executing tool ${call.name}]: ${err.message || err}`;
                }

                this.onProgress({
                    type: 'tool_end', tool: call.name,
                    output: result, toolId: activeToolId, fileName: targetName
                });

                return { name: call.name, result, target: targetName };
            })
        );
        results.push(...readResults);
    }

    // Write tools: sequentieel (volgorde behouden)
    for (const call of writeCalls) {
        const activeToolId = `tool-${Date.now()}-${call.name}`;
        const targetName = this.getToolTarget(call.name, call.args);

        this.onProgress({
            type: 'tool_start', tool: call.name,
            query: call.query, toolId: activeToolId, fileName: targetName
        });

        let result = '';
        try {
            result = await this.executeTool(call.name, call.args);
        } catch (err: any) {
            result = `[Error executing tool ${call.name}]: ${err.message || err}`;
        }

        if (!result.startsWith('[Error')) {
            if (targetName) modifiedFiles.add(targetName);
        }

        this.onProgress({
            type: 'tool_end', tool: call.name,
            output: result, toolId: activeToolId, fileName: targetName
        });

        results.push({ name: call.name, result, target: targetName });
    }

    return results;
}
```

### Stap 3: `run()` Loop Aanpassen

In de while-loop van `AgentExecutor.run()` (regels 152–226):

```typescript
while (iteration < maxIterations) {
    iteration++;
    this.onProgress({ type: 'thinking', output: `Step ${iteration}: Consulting model...` });

    // ... model call (ongewijzigd) ...

    lastAssistantResponse = response;

    // Parse meerdere tool calls
    const toolCalls = this.parseToolCalls(response);

    if (toolCalls.length === 0) {
        // Geen tools, agent is klaar
        break;
    }

    messages.push({ role: 'assistant', content: response });

    // Voer tools uit (parallel waar mogelijk)
    const results = await this.executeToolsParallel(toolCalls, modifiedFiles);

    // Combineer alle resultaten in één feedback-bericht
    const combinedResult = results
        .map(r => `[Tool Result for ${r.name}]:\n${r.result}`)
        .join('\n\n---\n\n');

    messages.push({
        role: 'user',
        content: `${combinedResult}\n\nPlease proceed with the next step based on these results.`
    });
}
```

### Stap 4: System Prompt Updaten

In `code/system_prompt.md`, vervang de restrictie op regel 11:

**Van:**
> "EXACTLY ONE tool call enclosed inside `<|tool_call|>` tags. Do not output multiple tool calls in one turn."

**Naar:**
> "Enclose each tool call inside `<|tool_call|>` tags. You may output MULTIPLE tool calls in one turn if the tools are independent of each other (e.g., reading multiple files). Place each tool call in its own `<|tool_call|>` block."

En voeg een voorbeeld toe:
```
I need to read both files to understand the full picture.
<|tool_call|>
{"type": "read_file", "path": "src/index.ts"}
<|tool_call|>
<|tool_call|>
{"type": "read_file", "path": "src/utils.ts"}
<|tool_call|>
```

### Stap 5: Maximale Parallelle Tool Calls Limiet

Voeg een veiligheidslimiet toe om runaway scenarios te voorkomen:

```typescript
const MAX_PARALLEL_CALLS = 5;
if (toolCalls.length > MAX_PARALLEL_CALLS) {
    toolCalls.length = MAX_PARALLEL_CALLS; // afkappen
    this.onProgress({
        type: 'warning',
        output: `Limited to ${MAX_PARALLEL_CALLS} parallel tool calls per turn.`
    });
}
```

---

## Bestanden die Geraakt Worden

| Bestand | Actie | Beschrijving |
|---|---|---|
| `code/src/AgentExecutor.ts` | **WIJZIG** | `parseToolCalls()` methode, `executeToolsParallel()` methode, loop-aanpassing |
| `code/system_prompt.md` | **WIJZIG** | Multi-tool instructies en voorbeeld toevoegen |

---

## Verificatie

1. **Single-Tool Backward Compatibility**: Test dat een model dat 1 tool call per turn geeft nog steeds correct werkt (regressie-test).
2. **Multi-Tool Parse Test**: Test `parseToolCalls()` met een response die 3 `<|tool_call|>` blokken bevat en verifieer dat alle 3 correct geparsed worden.
3. **Parallelle Read Test**: Stuur een taak die 3 bestanden moet lezen en verifieer dat de agent dit in 1 turn doet (3 parallelle `read_file` calls) in plaats van 3 turns.
4. **Write Sequentie Test**: Verifieer dat write-tools nog steeds sequentieel uitgevoerd worden (geen race conditions op hetzelfde bestand).
5. **UI Feedback**: Controleer dat de sidebar UI correct meerdere tool-start/tool-end events weergeeft in dezelfde stap.

---

## Risico's & Aandachtspunten

- **Model Capability**: Niet alle (vooral kleinere lokale) modellen kunnen betrouwbaar meerdere tool calls per turn produceren. De system prompt moet duidelijk zijn, maar het model kan nog steeds slechts 1 call per turn doen — en dat moet blijven werken.
- **Race Conditions**: Write-tools MOETEN sequentieel blijven. Twee gelijktijdige `write_file` calls naar hetzelfde bestand zouden data corruption veroorzaken.
- **UI Complexiteit**: De sidebar moet meerdere tool-cards tegelijk kunnen tonen. Dit kan een kleine UI-aanpassing vereisen.
- **Afhankelijkheid van Plan 3**: Als native function calling geïmplementeerd is (Plan 3), kunnen sommige providers meerdere `tool_calls` in één API response retourneren. De parallelle executie engine kan hier direct mee integreren.

---

## Implementatie Volgorde (Aanbevolen)

Dit plan heeft afhankelijkheden van de andere plannen:

1. **Plan 2** (Tool Output Truncation) eerst — voorkomt dat parallelle tool outputs de context overstromen.
2. **Plan 1** (Context Truncation) tweede — vangt het cumulatieve effect op.
3. **Plan 3** (Native Function Calling) derde — sommige providers retourneren native multi-tool calls.
4. **Plan 4** (dit plan) als laatste — bouwt voort op de infrastructuur van alle drie voorgaande plannen.
